// workspace/src/pages/Dashboard/components/LineItemList/Timeline.jsx
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFacts } from '../store.js';
import { fDs } from '../format.js';
import { dI, rangeOverlap } from '../date-utils.js';

// Timeline palette — mirrors vanilla --tl-0..5
const TL_PALETTE = [
  'var(--tl-0)',
  'var(--tl-1)',
  'var(--tl-2)',
  'var(--tl-3)',
  'var(--tl-4)',
  'var(--tl-5)',
];

// CSS tooltip for single-line segment labels. Overlap zones use a React
// portal instead (see OverlapTooltip) because multi-line tooltips are tall
// enough to get clipped by SectionCard's overflow:hidden.
const TL_TOOLTIP_CSS = `
.tl-seg[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface, #1e1e2e);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border-soft, #333);
  border-radius: 6px;
  padding: 5px 9px;
  font-size: 10px;
  font-family: var(--font-sans);
  line-height: 1.5;
  white-space: pre;
  pointer-events: none;
  opacity: 0;
  transition: opacity .12s;
  z-index: 50;
  box-shadow: 0 3px 10px rgba(0,0,0,.25);
  max-width: 280px;
}
.tl-seg[data-tip]:hover::after { opacity: 1; }
`;

let tooltipInjected = false;
function ensureTooltipCSS() {
  if (tooltipInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = TL_TOOLTIP_CSS;
  document.head.appendChild(style);
  tooltipInjected = true;
}

/** Add n calendar days (UTC) to an ISO date string. */
function addDays(dateIso, n) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Sweep-line overlap detection within a single group of segments.
 * Segments are expected to carry day-index range { sIdx, eIdx } (inclusive).
 * Emits contiguous regions where 2+ segments of this group are simultaneously
 * active. Each region lists every overlapping segment, not just pairs.
 */
function sweepOverlaps(group) {
  if (group.length < 2) return [];

  const events = [];
  for (const s of group) {
    events.push({ idx: s.sIdx, delta: 1, seg: s });
    events.push({ idx: s.eIdx + 1, delta: -1, seg: s });
  }
  events.sort((a, b) => a.idx - b.idx);

  const out = [];
  const active = new Set();
  let cursor = null;

  let i = 0;
  while (i < events.length) {
    const curIdx = events[i].idx;
    // Flush the prior region (before mutating active set at this boundary)
    if (cursor !== null && active.size >= 2 && cursor < curIdx) {
      out.push({ sIdx: cursor, eIdx: curIdx - 1, segs: Array.from(active) });
    }
    // Apply all transitions landing on this idx atomically
    while (i < events.length && events[i].idx === curIdx) {
      const ev = events[i];
      if (ev.delta > 0) active.add(ev.seg);
      else active.delete(ev.seg);
      i++;
    }
    cursor = curIdx;
  }
  return out;
}

/**
 * Portal-rendered tooltip for overlap zones. Positions itself above the anchor
 * rect via getBoundingClientRect; flips below when there is not enough space,
 * and clamps horizontally to the viewport. Rendering into document.body
 * escapes the SectionCard's overflow:hidden that would otherwise clip tall
 * multi-line tooltips.
 */
function OverlapTooltip({ content, rect }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!ref.current || !rect) return;
    const tt = ref.current.getBoundingClientRect();
    const SPACE = 8;

    const fitsAbove = rect.top >= tt.height + SPACE;
    let top = fitsAbove ? rect.top - tt.height - SPACE : rect.bottom + SPACE;
    top = Math.max(SPACE, Math.min(top, window.innerHeight - tt.height - SPACE));

    let left = rect.left + rect.width / 2 - tt.width / 2;
    left = Math.max(SPACE, Math.min(left, window.innerWidth - tt.width - SPACE));

    setPos({ top, left });
  }, [rect, content]);

  if (!content || !rect || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      className="text-10"
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        opacity: pos ? 1 : 0,
        background: 'var(--surface, #1e1e2e)',
        color: 'var(--text-primary, #e0e0e0)',
        border: '1px solid var(--border-soft, #333)',
        borderRadius: 'var(--rs)',
        padding: '5px 9px',
        fontFamily: 'var(--font-sans)',
        lineHeight: 1.5,
        whiteSpace: 'pre',
        boxShadow: '0 3px 10px rgba(0,0,0,.25)',
        maxWidth: 280,
        pointerEvents: 'none',
        zIndex: 9999,
        transition: 'opacity 120ms ease',
      }}
    >
      {content}
    </div>,
    document.body,
  );
}

/**
 * Timeline — flight bar with split/period segments and overlap zones.
 *
 * Hovering a segment dims other segments and glows the hovered one.
 * Hovering an overlap zone lists every split active in that span.
 *
 * Overlap detection runs independently within two groups:
 *   · temporal (period/manual) — conflict between periods
 *   · dimensional (audience/others) — audience slices sharing a window
 * Cross-group (temp↔dim) intersections are NOT treated as overlap —
 * a period crossing an audience is a normal cross-cut, not a scope conflict.
 *
 * Props:
 *   plan            {object}    liPlan entry — { fs, fe, containers? }
 *   onSegmentClick  {function?} (fs, fe) => void — called on segment click
 */
function Timeline({ plan, onSegmentClick }) {
  ensureTooltipCSS();
  const [hoverId, setHoverId] = useState(null);
  const [overlapTip, setOverlapTip] = useState(null); // { content, rect }

  const facts = useFacts();
  const asOf = facts?.asOf ?? null;

  // Hide overlap tooltip on scroll/resize — fixed positioning would otherwise
  // leave the tooltip floating at stale coordinates while the anchor moves.
  useEffect(() => {
    if (!overlapTip) return undefined;
    const hide = () => setOverlapTip(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [overlapTip]);

  const segs = useMemo(() => {
    if (!plan?.fs || !plan?.fe) return { all: [], overlaps: [] };

    // Timeline draws one segment per date_child (temporal) and ignores dim_children
    // (those don't carry their own dates — they inherit the container's window
    // which is already represented by the date_children or the container itself
    // when it has no children).
    const containers = Array.isArray(plan.containers) ? plan.containers : [];
    const allSegs = [];
    for (const c of containers) {
      if (!c.fs || !c.fe) continue;
      const dcs = Array.isArray(c.date_children) ? c.date_children : [];
      if (dcs.length === 0) {
        allSegs.push({ fs: c.fs, fe: c.fe, label: c.name || 'Container', container: c, isContainer: true });
      } else {
        for (const dc of dcs) {
          if (!dc.fs || !dc.fe) continue;
          allSegs.push({ fs: dc.fs, fe: dc.fe, label: dc.name || c.name || 'Period', container: c, isContainer: false });
        }
      }
    }
    if (allSegs.length === 0) return { all: [], overlaps: [] };

    const fd = Math.max(1, dI(plan.fs, plan.fe));

    // L2: Use the original index in allSegs for stable color assignment,
    // even when flatMap filters some segments out.
    const all = allSegs.flatMap((sp, origIdx) => {
      const ov = rangeOverlap(plan.fs, plan.fe, sp.fs, sp.fe);
      if (!ov) return [];
      const leftD = Math.max(0, dI(plan.fs, ov.start) - 1);
      const widD = dI(ov.start, ov.end);
      const lPct = (leftD / fd) * 100;
      const wPct = (widD / fd) * 100;
      const isDim = false; // containers/date_children — date axis only
      const lbl = sp.label || `Period ${origIdx + 1}`;
      return [{
        id: origIdx,
        lPct,
        wPct,
        col: TL_PALETTE[origIdx % TL_PALETTE.length],
        isDim,
        lbl,
        start: ov.start,
        end: ov.end,
        sIdx: leftD,
        eIdx: leftD + widD - 1,
      }];
    });

    // Sweep-line per group, then merge regions that share the same day range
    // so a single hatch + tooltip covers coincident temp and dim overlaps.
    const tempGroup = all.filter((s) => !s.isDim);
    const dimGroup = all.filter((s) => s.isDim);
    const rawRegions = [...sweepOverlaps(tempGroup), ...sweepOverlaps(dimGroup)];

    const mergedByRange = new Map();
    for (const r of rawRegions) {
      const key = `${r.sIdx}:${r.eIdx}`;
      if (mergedByRange.has(key)) {
        mergedByRange.get(key).segs.push(...r.segs);
      } else {
        mergedByRange.set(key, { sIdx: r.sIdx, eIdx: r.eIdx, segs: [...r.segs] });
      }
    }

    const overlaps = Array.from(mergedByRange.values()).map((r) => {
      const widD = r.eIdx - r.sIdx + 1;
      return {
        lPct: (r.sIdx / fd) * 100,
        wPct: (widD / fd) * 100,
        labels: r.segs.map((s) => s.lbl),
        start: addDays(plan.fs, r.sIdx),
        end: addDays(plan.fs, r.eIdx),
      };
    });

    return { all, overlaps };
  }, [plan]);

  // Elapsed fill (fs → asOf)
  const elapsedPct = useMemo(() => {
    if (!plan?.fs || !plan?.fe || !asOf) return 0;
    if (asOf < plan.fs) return 0;
    const fd = Math.max(1, dI(plan.fs, plan.fe));
    const eff = asOf > plan.fe ? plan.fe : asOf;
    const dp = dI(plan.fs, eff);
    return Math.min(100, (dp / fd) * 100);
  }, [plan, asOf]);

  // Paused-window bands — a muted hatch drawn ON the flight bar for each manual
  // pause interval, clipped to [fs, fe] with the SAME fs→px math the segments use
  // (rangeOverlap + dI). Purely visual (pointer-events:none) so it never blocks
  // segment hover. Additive: no pause_intervals ⇒ empty ⇒ nothing drawn.
  const pausedBands = useMemo(() => {
    if (!plan?.fs || !plan?.fe) return [];
    const iv = Array.isArray(plan.pause_intervals) ? plan.pause_intervals : [];
    if (iv.length === 0) return [];
    const fd = Math.max(1, dI(plan.fs, plan.fe));
    const out = [];
    for (const ip of iv) {
      const from = ip && ip.from;
      if (!from) continue;
      const to = ip && ip.to ? ip.to : plan.fe;   // open interval → clip to flight end
      const ov = rangeOverlap(plan.fs, plan.fe, from, to);
      if (!ov) continue;
      const leftD = Math.max(0, dI(plan.fs, ov.start) - 1);
      const widD = dI(ov.start, ov.end);
      out.push({
        lPct: (leftD / fd) * 100,
        wPct: (widD / fd) * 100,
        start: ov.start,
        end: ov.end,
      });
    }
    return out;
  }, [plan]);

  if (!plan?.fs || !plan?.fe) return null;
  if (segs.all.length === 0) return null;

  const hasHover = hoverId !== null;

  return (
    <div className="mt-[4px] relative" style={{ minWidth: 80 }}>
      {/* Track + segments. No overflow:hidden — would clip the CSS ::after tooltip on segments. */}
      <div
        className="tl-bar relative h-[6px]"
        style={{ background: 'var(--surface-tertiary)', borderRadius: 1 }}
      >
        {/* Elapsed fill */}
        {elapsedPct > 0 && (
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: `${elapsedPct.toFixed(2)}%`,
              background: 'var(--text-muted)',
              opacity: 0.12,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Split segments — hover dims the others and glows the active one */}
        {segs.all.map((seg) => {
          const isActive = hasHover && hoverId === seg.id;
          const dimmed = hasHover && hoverId !== seg.id;
          const baseOpacity = seg.isDim ? 0.5 : 0.85;
          return (
            <div
              key={seg.id}
              className="tl-seg absolute top-0 bottom-0 box-border"
              data-tip={`${seg.lbl}: ${fDs(seg.start)} \u2013 ${fDs(seg.end)}`}
              style={{
                left: `${seg.lPct.toFixed(2)}%`,
                width: `${seg.wPct.toFixed(2)}%`,
                background: seg.col,
                borderRadius: 2,
                opacity: dimmed ? 0.22 : (isActive ? 1 : baseOpacity),
                cursor: onSegmentClick ? 'pointer' : 'default',
                transition: 'opacity 120ms ease',
                zIndex: isActive ? 3 : 1,
              }}
              onMouseEnter={() => setHoverId(seg.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={(e) => {
                e.stopPropagation();
                if (onSegmentClick) onSegmentClick(seg.start, seg.end);
              }}
            />
          );
        })}

        {/* Paused-window bands — muted hatch over the bar marking dark (paused)
            days. Horizontal band ON the bar, not a left-rail status accent. */}
        {pausedBands.map((pb, i) => (
          <div
            key={`pause-${i}`}
            className="tl-pause absolute top-0 h-full"
            style={{
              left: `${pb.lPct.toFixed(2)}%`,
              width: `${pb.wPct.toFixed(2)}%`,
              background:
                'repeating-linear-gradient(-45deg, var(--text-muted) 0 1.5px, transparent 1.5px 5px)',
              opacity: 0.5,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        ))}

        {/* Overlap regions — dark diagonal hatch; tooltip via React portal (OverlapTooltip) */}
        {segs.overlaps.map((ov, i) => (
          <div
            key={i}
            className="tl-ov absolute top-0 h-full z-10"
            style={{
              left: `${ov.lPct.toFixed(2)}%`,
              width: `${ov.wPct.toFixed(2)}%`,
              background:
                'repeating-linear-gradient(45deg, var(--text-primary) 0 1.5px, transparent 1.5px 4px)',
              opacity: 0.55,
              cursor: 'help',
            }}
            onMouseEnter={(e) => setOverlapTip({
              content: `${ov.labels.join('\n')}\n\n${fDs(ov.start)} \u2013 ${fDs(ov.end)}`,
              rect: e.currentTarget.getBoundingClientRect(),
            })}
            onMouseLeave={() => setOverlapTip(null)}
          />
        ))}
      </div>

      {/* Today marker — 2px vertical line extending 2px above/below the bar */}
      {elapsedPct > 0 && elapsedPct < 100 && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${elapsedPct.toFixed(2)}%`,
            top: -2,
            bottom: -2,
            width: 2,
            background: 'var(--text-primary)',
            borderRadius: 1,
            transform: 'translateX(-1px)',
            zIndex: 4,
          }}
        />
      )}

      <OverlapTooltip content={overlapTip?.content ?? null} rect={overlapTip?.rect ?? null} />
    </div>
  );
}

export default memo(Timeline);
