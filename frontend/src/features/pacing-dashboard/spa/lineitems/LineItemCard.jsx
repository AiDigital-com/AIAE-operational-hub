import { formatConversion } from '../conversion-format.js';
import { CV, conversionIndex, cvStateOf } from '../primary-cv.js';
import ValueLabels from '@shared/value-labels';
// workspace/src/pages/Dashboard/components/LineItemList/LineItemCard.jsx
import { Suspense, lazy, memo, startTransition, useCallback, useMemo, useState } from 'react';
import { useLiPlan, useDisplay, useEffRange, useSplitScopedMode } from '../store.js';
import { useDashboardStore } from '../store.js';
import { useUrlFilters } from '../store.js';
import { liM } from '../metrics.js';
import { selectScopedFacts, selectScopeFilters, selectDeliveryFacts, selectHasConversions } from '../selectors.js';
import { getEffPlan } from '../config.js';
import { matchDimSplits, resolveOwningContainer, buildVirtualPlanFromDimChild } from '../dim-scope.js';
import PacingCore from '../pacing-core.js';
import { fI, f$, fP, fDs, badgeCls } from '../format.js';
import { rateLabel } from '../metrics.js';
import { completionLabelForLI } from '../completion-label.js';
import { basisLabel } from '../coef-rebuild.js';
import { netPct } from '../currency-marker.js';
import PaceBar from './PaceBar.jsx';
import Timeline from './Timeline.jsx';

// `lazyWithRetry` in Pacing; plain `lazy` here, which is what every other lazy boundary in this
// app uses. The retry wrapper existed to hard-reload a tab holding pre-deploy chunk hashes, and
// this app has no such mechanism anywhere - adding one for a single sub-row would be the only
// instance of it in the tree.
const SplitRow = lazy(() => import('./SplitRow.jsx'));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Title shown in the LI row's primary slot.
 *  Priority: custom name > description (if showDescription enabled) > "LI {id}". */
function liLabel(id, liNames, desc, showDescription) {
  const n = liNames?.[id];
  if (n) return n;
  if (showDescription && desc) return desc;
  return `LI ${id}`;
}

/** Secondary "LI 70123" chip — shown whenever the primary slot is something other than the raw id. */
function liOrigId(id, liNames, desc, showDescription) {
  const hasAlt = !!(liNames?.[id] || (showDescription && desc));
  return hasAlt ? `LI ${id}` : null;
}

// ── MetricCell ────────────────────────────────────────────────────────────────

function MetricCell({ label, value, sub, valueCls, title }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-10 text-[var(--text-muted)] leading-tight">{label}</div>
      <div className={`font-mono text-13 font-semibold leading-snug ${valueCls ?? ''}`}>
        {value}
      </div>
      {sub && (
        <div className="text-9 text-[var(--text-muted)] leading-tight mt-[1px]">{sub}</div>
      )}
    </div>
  );
}

// ── ChannelTag ────────────────────────────────────────────────────────────────

function ChannelTag({ ch }) {
  const cls = badgeCls(ch);
  const colorMap = {
    'b-Display': { background: 'var(--badge-display-bg)', color: 'var(--badge-display)' },
    'b-Video':   { background: 'var(--badge-video-bg)',   color: 'var(--badge-video)' },
    'b-Native':  { background: 'var(--badge-native-bg)',  color: 'var(--badge-native)' },
    'b-Audio':   { background: 'var(--badge-audio-bg)',   color: 'var(--badge-audio)' },
    'b-CTV':     { background: 'var(--badge-ctv-bg)',     color: 'var(--badge-ctv)' },
    'b-def':     { background: 'var(--badge-default-bg)', color: 'var(--badge-default)' },
  };
  const colors = colorMap[cls] ?? colorMap['b-def'];
  return (
    <span
      title={ch}
      className="inline-flex items-center justify-center min-w-[52px] max-w-full h-[22px] px-[7px] font-[var(--font-barlow)] text-10 font-bold tracking-[.06em] uppercase whitespace-nowrap overflow-hidden text-ellipsis"
      style={{ ...colors, borderRadius: 'var(--rxs)' }}
    >
      {ch}
    </span>
  );
}

// ── SpendStatus ───────────────────────────────────────────────────────────────

function spendStatus(sp, costPr, thresholds) {
  if (!costPr || costPr <= 0) return '';
  const pct = (sp / costPr) * 100;
  if (pct <= (thresholds?.spendWarn ?? 105)) return 'text-[var(--status-green)]';
  if (pct <= (thresholds?.spendBad ?? 115)) return 'text-[var(--status-amber)]';
  return 'text-[var(--status-red)]';
}

// ── MarginStatus ──────────────────────────────────────────────────────────────

function marginStatusCls(mA, mTgt, thresholds) {
  const warnThreshold = thresholds?.marginWarn ?? -5;
  const st = PacingCore.marginStatus(mA, mTgt, warnThreshold);
  return st === 'g' ? 'text-[var(--status-green)]' :
         st === 'w' ? 'text-[var(--status-amber)]' :
                      'text-[var(--status-red)]';
}

function SplitRowsFallback() {
  return (
    <div
      className="text-12"
      style={{
        padding: '14px 20px',
        color: 'var(--text-muted)',
      }}
    >
      Loading split details...
    </div>
  );
}

// ── LineItemCard ──────────────────────────────────────────────────────────────

// Virtual plans are leaves for calculation, not a replacement for the editable
// structure. Keep the owning containers, scoping each child's plan separately.
export function lineItemSplitRows(plan, periodKey, scopeBrkf) {
  const owning = periodKey ? resolveOwningContainer(plan, periodKey) : null;
  const containers = owning ? [owning.container] : (plan.containers || []);
  const scoped = scopeBrkf.length > 0;
  const dateRows = [], dimRows = [], shownContainers = [];
  for (const container of containers) {
    const one = { [plan.id]: { ...plan, containers: [container] } };
    if (scoped && !matchDimSplits(one, scopeBrkf, { periodKey }).active) continue;
    shownContainers.push(container);
    for (const child of container.date_children || []) {
      if (!child || (!child.fs && !child.fe && !child.target_impressions && !child.target_spend)) continue;
      if (owning?.dateChild && child !== owning.dateChild) continue;
      const planOverride = scoped
        ? matchDimSplits(one, scopeBrkf, { periodKey: `${child.fs}|${child.fe}` }).plans[plan.id]
        : owning?.dateChild ? PacingCore.buildVirtualPlanFromDateChild(plan, child, container) : null;
      if (scoped && !planOverride) continue;
      dateRows.push({ kind: 'date', child, container, planOverride });
    }
    for (const child of container.dim_children || []) {
      if (!child || !(Number(child.target_value) > 0)) continue;
      const pair = `${child.dim_key}:${child.dim_value}`;
      if (scoped && !scopeBrkf.includes(pair)) continue;
      const planOverride = owning
        ? matchDimSplits(one, [pair], { periodKey }).plans[plan.id]
        : scoped ? buildVirtualPlanFromDimChild(plan, child, container) : null;
      dimRows.push({ kind: 'dim', child, container, planOverride });
    }
  }
  return { containers: shownContainers, dateRows, dimRows };
}

// ── Conv tile ─────────────────────────────────────────────────────────────────

/**
 * What the Conv tile prints for one line item (spec 2026-09-13 §3, §7). `dayMap` is the
 * day map the card's liM read, and its cv state says which source the number uses.
 *   primary      the value even at 0, "CVR x% · primary", the chosen actions as tooltip
 *   unavailable  "—" and "CVR —", the reason as tooltip
 *   otherwise    exactly today's tile: "—" at 0, no tooltip
 * `actionLabels` (ValueLabels.lookup for conversion_action, or null) names the chosen actions
 * in the tooltip by the pacing's display names, each name once (spec
 * docs/2026-09-24-display-names.md). The in-data test stays on the raw names.
 */
export function convTile(m, liId, plan, dayMap, cvCtx, actionLabels = null) {
  const state = cvStateOf(dayMap)?.[liId] || null;
  if (state && state.cv === CV.UNAVAILABLE) {
    return { value: '—', sub: 'CVR —', title: state.reason || 'Conversions cannot be shown here' };
  }
  if (state && state.cv === CV.PRIMARY) {
    const chosen = Array.isArray(plan?.primaryCv) ? plan.primaryCv : [];
    const rows = Array.isArray(cvCtx?.conversions) ? (conversionIndex(cvCtx.conversions).get(liId) || []) : [];
    const inData = new Set(rows.map((r) => String(r.conversion_action ?? '').trim()));
    const shown = [...new Set(chosen.map((name) => ValueLabels.labelOf(actionLabels, name)))];
    const title = chosen.some((name) => inData.has(name))
      ? `Primary conversions: ${shown.join(', ')}`
      : 'None of the chosen actions are in the current data';
    return { value: formatConversion(m?.cv ?? 0), sub: `CVR ${fP(m?.cvr ?? 0)} · primary`, title };
  }
  const cv = m?.cv ?? 0;
  return { value: cv > 0 ? formatConversion(cv) : '—', sub: cv > 0 ? `CVR ${fP(m.cvr ?? 0)}` : null, title: undefined };
}

/**
 * LineItemCard — expandable row showing line item metrics.
 *
 * Props:
 *   liId       {string}  line item ID key in liPlan
 *   filters    {object}  current URL filters (from useUrlFilters)
 *   setFilters {function} URL filter setter
 */
function LineItemCard({ liId, filters, setFilters }) {
  const [expanded, setExpanded] = useState(false);
  const { filters: urlFilters, setFilters: setUrlFilters } = useUrlFilters();
  const activeSetFilters = setFilters || setUrlFilters;

  const liPlan = useLiPlan();
  const facts = useDashboardStore((s) => selectDeliveryFacts(s, urlFilters));
  const scopeFilters = useDashboardStore((s) => selectScopeFilters(s, urlFilters));
  const pacingFacts = useDashboardStore((s) => selectScopedFacts(s, urlFilters));
  const hasLens = (urlFilters.platforms || []).length > 0
    || (urlFilters.brkf || []).some(pair => !scopeFilters.brkf.includes(pair));
  const display = useDisplay();
  const effRange = useEffRange();
  const splitScopedMode = useSplitScopedMode();
  const selectedPeriodKey = useDashboardStore((s) => s.selectedPeriodKey);
  const notify = useDashboardStore((s) => s.notify);
  const hasConv = useDashboardStore(selectHasConversions);
  // The pacing's stored display names for conversion actions, for the Conv tooltip. The
  // store's own reference (dataConfig is replaced whole on a save), mapped in a memo.
  const storedValueLabels = useDashboardStore((s) => s.dataConfig?.value_labels);
  const actionLabels = useMemo(() => ValueLabels.lookup(storedValueLabels, 'conversion_action'), [storedValueLabels]);

  // Timeline segment click: set custom date range to the segment's flight dates
  const handleSegmentClick = useCallback((fs, fe) => {
    startTransition(() => {
      activeSetFilters({ range: 'custom', customRange: { from: fs, to: fe } });
    });
  }, [activeSetFilters]);

  const p = liPlan?.[liId];
  const effPlan = p ? getEffPlan(liPlan, liId, pacingFacts.mode, pacingFacts.plans) : null;
  const liNames = display?.liNames ?? {};
  const thresholds = useMemo(() => {
    const a = notify?.alerts || {};
    return {
      spendWarn: a.spend_overspend?.warn_pct ?? 90,
      spendBad: a.spend_overspend?.bad_pct ?? 100,
      marginWarn: -(a.margin_below_target?.gap_pp ?? 3),
    };
  }, [notify]);

  // Compute metrics for this LI
  // L4: depend on specific facts sub-fields to avoid re-computation on unrelated facts changes
  const m = useMemo(() => {
    if (!p || !facts?.liDaily) return null;
    return liM(liId, facts.liDaily, liPlan, facts.asOf, effRange, pacingFacts.mode, pacingFacts.plans);
  }, [liId, p, facts?.liDaily, facts?.asOf, liPlan, effRange, pacingFacts.mode, pacingFacts.plans]);

  // Lens chips narrow the delivery cells. Pacing compares the scoped plan with
  // its own facts, retaining date/period/dimension Scope and ignoring Lens cuts.
  const pacing = useMemo(() => {
    if (!p || !pacingFacts?.liDaily) return null;
    return liM(liId, pacingFacts.liDaily, liPlan, facts?.asOf, effRange, pacingFacts.mode, pacingFacts.plans);
  }, [liId, p, pacingFacts, liPlan, facts?.asOf, effRange]);

  // The Conv tile reads the state of the same day map `m` was computed from.
  const conv = useMemo(
    () => (p ? convTile(m, liId, p, facts?.liDaily, facts?.cvCtx, actionLabels) : null),
    [m, liId, p, facts?.liDaily, facts?.cvCtx, actionLabels],
  );

  if (!p) return null;

  // Manual-pause + auto out-of-schedule status, as of the same data-freshness
  // date (facts.asOf) the rest of the card's metrics are computed against —
  // keeps the badge consistent with the pacing bar / expected numbers above.
  // Display marker uses isLiPausedNow (open manual interval = paused now, even
  // if the pause started after the data date). Freeze/pace numbers stay on asOf.
  const paused = PacingCore.isLiPausedNow(p, facts?.asOf);

  // ── Selection state ──
  const selection = filters?.selection ?? [];
  const isSelected = selection.includes(liId);
  function toggleSelection(e) {
    e.stopPropagation();
    if (!setFilters) return;
    const next = isSelected
      ? selection.filter((id) => id !== liId)
      : [...selection, liId];
    setFilters({ selection: next });
  }

  const { containers, dateRows, dimRows } = lineItemSplitRows(
    p, splitScopedMode ? selectedPeriodKey : null, scopeFilters.brkf,
  );
  const hasDimCfg = dimRows.length > 0;
  const hasTemp = dateRows.length > 0;
  const hasExpand = hasDimCfg || hasTemp;

  const rt = p.rateType || 'CPM';
  const uLbl = rateLabel(rt);
  const showDescription = !!display?.showDescription;
  const hasAltLabel = !!(liNames[liId] || (showDescription && p.desc));
  const origId = liOrigId(liId, liNames, p.desc, showDescription);

  const spInfo = [];
  if (containers.length > 0) spInfo.push(`${containers.length} container${containers.length > 1 ? 's' : ''}`);
  if (hasDimCfg) spInfo.push(`${dimRows.length} dim split${dimRows.length > 1 ? 's' : ''}`);
  if (hasTemp) spInfo.push(`${dateRows.length} periods`);

  const lbls = p.labels || [];

  const flightStr = p.fs && p.fe ? `${fDs(p.fs)} — ${fDs(p.fe)}` : null;

  // Metric values
  const mA = m?.mA ?? 0;
  const mTgt = effPlan.mTgt ?? 0;
  const sp = m?.sp ?? 0;
  const costPr = pacing?.costPr ?? 0;
  const au = m?.au ?? 0;
  const eI = pacing?.eI ?? 0;
  const pI = pacing?.pI ?? 0;
  const st = pacing?.st ?? 'no_data';
  const dP = pacing?.dP ?? 0;
  const fDays = pacing?.fDays ?? 0;

  // Rate-specific cost metric
  const rtCost =
    rt === 'CPC' ? (m?.cl > 0 ? sp / m.cl : 0) :
    rt === 'CPV' ? (m?.co > 0 ? sp / m.co : 0) :
    (m?.cpm ?? 0);

  const rtSub =
    p.vcrTgt != null && p.vcrTgt > 0 ? `${completionLabelForLI(p)} ${fP(m?.vcr ?? 0)} / target ${fP(p.vcrTgt)}` :
    // A stored CTR target of 0 is «no target» (owner decision 2026-09-23): no «target 0.00%».
    p.ctrTgt > 0 ? `CTR ${fP(m?.ctr ?? 0)} / target ${fP(p.ctrTgt)}` :
    null;

  return (
    <div
      className={`border-b border-[var(--border-soft)] transition-[opacity,background,border-color] duration-150 last:border-b-0 ${isSelected ? 'hover:bg-[var(--accent-bg)]' : 'hover:bg-[var(--hover-bg)]'}`}
      style={{
        contentVisibility: 'auto',
        containIntrinsicBlockSize: expanded ? 420 : 60,
        background: isSelected ? 'var(--accent-bg)' : expanded ? 'var(--surface-alt)' : undefined,
      }}
    >
      {/* ── Main row ── */}
      <div
        className="grid gap-1.5 items-center px-5 py-2 cursor-pointer select-none min-h-[44px]"
        style={{ gridTemplateColumns: `96px minmax(210px,2.5fr) repeat(${hasConv ? 6 : 5},1fr)` }}
        onClick={toggleSelection}
        title={[
          liNames[liId] || `LI ${liId}`,
          origId,
          p.desc,
          flightStr,
          lbls.length ? `Labels: ${lbls.join(', ')}` : null,
        ].filter(Boolean).join(' | ')}
      >
        {/* ── Channel column ── */}
        <div className="flex items-center">
          <ChannelTag ch={p.ch || 'Unknown'} />
        </div>

        {/* ── Identity column ── */}
        <div className="flex items-start gap-1.5 min-w-0">
          {/* Expand arrow or placeholder */}
          {hasExpand ? (
            <svg
              className={`w-5 h-5 flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200 mt-[2px] cursor-pointer hover:text-[var(--text-secondary)] ${expanded ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          ) : (
            <div className="w-4 flex-shrink-0" />
          )}

          <div className="min-w-0 w-full">
            {/* Title line — name (+ LI ID chip when custom) */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`font-semibold text-13 leading-snug truncate min-w-0 flex-1 ${hasAltLabel ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] font-mono'}`}
              >
                {liLabel(liId, liNames, p.desc, showDescription)}
              </span>
              {origId && (
                <span className="flex-shrink-0 font-mono text-10 font-medium text-[var(--text-muted)] bg-[var(--surface-alt)] px-[6px] py-[1px] rounded-[3px] leading-[1.3] tracking-[.01em]">
                  {origId}
                </span>
              )}
              {paused && (
                <span
                  className="flex-shrink-0 font-mono text-10 font-medium uppercase tracking-[.01em] px-[6px] py-[1px] rounded-[3px] leading-[1.3]"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}
                >
                  Paused
                </span>
              )}
              {p.coef === true && (
                <span
                  className="flex-shrink-0 font-mono text-10 font-medium uppercase tracking-[.01em] px-[6px] py-[1px] rounded-[3px] leading-[1.3]"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}
                  title="Client cost = spend / (1 − margin), not delivered"
                >
                  Coef
                </span>
              )}
              {p.k > 0 && p.k < 1 && (
                <span
                  className="flex-shrink-0 font-mono text-10 font-medium uppercase tracking-[.01em] px-[6px] py-[1px] rounded-[3px] leading-[1.3]"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}
                  title="Client cost invoiced at net — margin and pacing use net"
                >
                  Net {netPct(p.k)}
                </span>
              )}
            </div>

            {/* Meta line — splits summary + labels (collapses when empty) */}
            {(spInfo.length > 0 || lbls.length > 0) && (
              <div className="text-10 leading-none text-[var(--text-muted)] mt-[3px] whitespace-nowrap overflow-hidden text-ellipsis">
                {spInfo.length > 0 && <span>{spInfo.join(' · ')}</span>}
                {spInfo.length > 0 && lbls.length > 0 && <span> · </span>}
                {lbls.length > 0 && (
                  <span className="text-[var(--text-secondary)]" title={lbls.join(', ')}>
                    {lbls.join(', ')}
                  </span>
                )}
              </div>
            )}

            {/* Timeline */}
            <Timeline plan={p} onSegmentClick={handleSegmentClick} />
          </div>
        </div>

        {/* ── Margin ── */}
        <MetricCell
          label={basisLabel('Margin', 'margin', p.k > 0 && p.k < 1)}
          value={fP(mA)}
          sub={`target ${fP(mTgt)}`}
          valueCls={pacing ? (hasLens || p.coef === true ? 'text-[var(--text-primary)]' : marginStatusCls(pacing.mA, mTgt, thresholds)) : 'text-[var(--text-muted)]'}
        />

        {/* ── Spend ── */}
        <MetricCell
          label="Spend / Cost Bud."
          value={f$(sp)}
          sub={`${f$(costPr)} pror. · day ${dP}/${fDays}`}
          valueCls={pacing && !hasLens ? spendStatus(pacing.sp, costPr, thresholds) : ''}
        />

        {/* ── Impressions/Units ── */}
        <MetricCell
          label={uLbl}
          value={fI(au)}
          sub={`${fI(Math.round(eI))} expected`}
        />

        {/* ── Pacing bar ── */}
        <div className="min-w-0">
          <div className="text-10 text-[var(--text-muted)] mb-1" title={hasLens ? 'Pacing uses Scope delivery and plan. Lens filters the displayed delivery.' : undefined}>
            {hasLens ? 'Pacing · Scope' : 'Pacing'}
          </div>
          <PaceBar value={pI} status={st} />
        </div>

        {/* ── Rate cost column (CPM / CPC / CPV) ── */}
        <MetricCell
          label={rt}
          value={f$(rtCost)}
          sub={rtSub}
        />

        {/* ── Conv / CVR column (auto-shown when any LI has cv > 0, or has primary conversions) ── */}
        {hasConv && (
          <MetricCell
            label="Conv"
            value={conv.value}
            sub={conv.sub}
            title={conv.title}
          />
        )}
      </div>

      {/* ── Expanded content ── */}
      {hasExpand && expanded && (
        <div
          className="overflow-hidden bg-[var(--surface-alt)] border-t border-[var(--border-soft)]"
        >
          <Suspense fallback={<SplitRowsFallback />}>
            {/* Dim children (audience / comment carve-outs) */}
            {hasDimCfg && dimRows.map(({ child, container, planOverride }) => (
              <SplitRow
                key={`dim:${container.id || container.name}:${child.id || child.dim_key + ':' + child.dim_value}`}
                liId={liId}
                kind="dim"
                child={child}
                container={container}
                planOverride={planOverride}
                range={effRange}
                hasConv={hasConv}
              />
            ))}

            {/* Date children (temporal sub-periods inside containers) */}
            {hasTemp && (
              <>
                <div className="text-9 font-bold text-[var(--text-muted)] uppercase tracking-[.8px] px-5 py-1 border-t border-[var(--border-soft)]">
                  Pacing Periods
                </div>
                {dateRows.map(({ child, container, planOverride }, si) => (
                  <SplitRow
                    key={`date:${container.id || container.name || si}:${child.id || child.fs + '-' + child.fe}`}
                    liId={liId}
                    kind="date"
                    child={{ ...child, name: child.name || `${container.name || 'Period'} ${si + 1}` }}
                    container={container}
                    planOverride={planOverride}
                    range={effRange}
                    hasConv={hasConv}
                  />
                ))}
              </>
            )}
          </Suspense>
        </div>
      )}
    </div>
  );
}

function sameSelection(prevSelection = [], nextSelection = []) {
  if (prevSelection === nextSelection) return true;
  if (prevSelection.length !== nextSelection.length) return false;
  for (let i = 0; i < prevSelection.length; i += 1) {
    if (prevSelection[i] !== nextSelection[i]) return false;
  }
  return true;
}

function areLineItemCardPropsEqual(prevProps, nextProps) {
  return prevProps.liId === nextProps.liId
    && prevProps.setFilters === nextProps.setFilters
    && sameSelection(prevProps.filters?.selection, nextProps.filters?.selection);
}

export default memo(LineItemCard, areLineItemCardPropsEqual);
