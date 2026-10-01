// workspace/src/components/kit/MiniChart.jsx
//
// A sparkline. The kit had no chart at all (widget-library spec §7 calls miniChart "a
// NEW small chart primitive"), and the obvious answer — recharts — is the wrong one at
// this size: recharts is a lazily-loaded chunk mounted behind DeferredMount for a
// reason, and a composite can hold thirty bricks. This draws one <path> per series in
// inline SVG: no dependency, no chunk, no animation frame, and it renders identically
// in a card preview and on the dashboard.
import { highlightFill, highlightTitle } from './highlight-style.js';
const PAL = ['var(--pal-0)', 'var(--pal-1)'];

/**
 * Point positions for a mini-chart line: `{x, y}` per value, `null` where the value is not
 * finite (spec §2.9: a day CM360 did not join is a hole, never a measured zero). Presence
 * lives entirely in this null, so nothing downstream — the stroke, a highlight run, a
 * highlight dot — can redraw a hole as a false zero on the axis floor.
 *
 * `lo`/`hi` are scanned over FINITE values only, so one real number beside thirteen holes
 * still scales the axis to itself rather than being flattened against a phantom 0. A series
 * with no finite value at all has no `lo`/`hi` to scale by, hence no points.
 */
function pointsOf(values, w, h) {
  const n = values.length;
  if (n < 2) return values.map(() => null);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return values.map(() => null);
  // A flat series draws down the middle instead of dividing by zero (the canonical rule).
  const span = hi - lo || 1;
  const step = w / (n - 1);
  return values.map((v, i) => {
    if (!Number.isFinite(v)) return null;
    return { x: Number((i * step).toFixed(2)), y: Number((h - (v - lo) / span * h).toFixed(2)) };
  });
}

/**
 * The `d` attribute for one line, from `pointsOf`'s points. A `null` — a gap — closes the
 * current subpath: the NEXT finite point after one opens a fresh `M` rather than an `L`, so
 * the stroke breaks at the gap instead of bridging across it. A lone finite point between two
 * gaps still gets its own `M` (a zero-length subpath, invisible and harmless).
 */
function pathOf(points) {
  let open = false;
  const tokens = [];
  for (const point of points) {
    if (!point) { open = false; continue; }
    tokens.push(`${open ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
    open = true;
  }
  return tokens.join(' ');
}

export default function MiniChart({ series, label, height = 44 }) {
  const list = (series || []).filter((s) => Array.isArray(s.values) && s.values.length);
  if (!list.length) return <div className="kit-spark kit-spark--empty">no data yet</div>;
  const W = 100;
  const H = height;
  const names = list.map((item, index) => item.label || `Line ${index + 1}`);
  const showLegend = list.length > 1;
  return (
    <div className="kit-spark">
      {(label || showLegend) && <div className="kit-spark-head">
        {label && <span className="kit-spark-l">{label}</span>}
        {showLegend && <span className="kit-spark-legend" role="list" aria-label="Chart lines">
          {list.map((item, index) => <span className="kit-spark-key" role="listitem" key={item.id || index} title={names[index]}>
            <i aria-hidden="true" style={{ background: PAL[index % PAL.length] }} />
            <span>{names[index]}</span>
          </span>)}
        </span>}
      </div>}
      {/* preserveAspectRatio none: the box is a tile cell, not a square. vectorEffect
          keeps the stroke 1px at any width — without it a stretched viewBox thickens it. */}
      <svg className="kit-spark-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ height: `${H}px` }} role="img" aria-label={`Trend: ${names.join(', ')}`} focusable="false">
        {list.map((s, i) => {
          const color = PAL[i % PAL.length];
          const points = pointsOf(s.values, W, H);
          const d = pathOf(points);
          if (!s.highlights?.some((highlight) => highlight && Object.keys(highlight.style || {}).length)) return (
            <path key={s.id || i} d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          );
          // Index-aligned with `s.values`/`s.highlights` (unlike re-parsing `d`, which drops a
          // token per gap): `pts[index]` is the SAME day `s.highlights[index]` judged, so a
          // highlight dot never lands on a day the join skipped, and a run's `from`/`to`
          // bridges to a neighbour only when that neighbour is a real point — a gap breaks a
          // highlighted run exactly where it breaks the plain stroke above.
          const pts = s.values.length === 1 ? [{ x: W / 2, y: H / 2 }] : points;
          const runs = new Map();
          pts.forEach((point, index) => {
            if (!point) return;
            const highlight = s.highlights[index];
            const stroke = highlightFill(highlight) || color;
            const width = highlight?.style?.strokeWidth ?? 1.5;
            const key = `${stroke}|${width}`;
            if (!runs.has(key)) runs.set(key, { stroke, width, parts: [] });
            const previous = pts[index - 1];
            const next = pts[index + 1];
            const from = previous ? { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 } : point;
            const to = next ? { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 } : point;
            runs.get(key).parts.push(`M${from.x} ${from.y} L${point.x} ${point.y} L${to.x} ${to.y}`);
          });
          return <g key={s.id || i}>
            {[...runs.values()].map((run, index) => <path key={index} d={run.parts.join(' ')} fill="none"
              stroke={run.stroke} strokeWidth={run.width} vectorEffect="non-scaling-stroke" />)}
            {pts.map((point, index) => (point && s.highlights[index]?.style?.points ? (
              <path key={index} data-highlight-point="true" d={`M${point.x} ${point.y}h0.001`} fill="none"
                stroke={highlightFill(s.highlights[index]) || color} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke">
                <title>{highlightTitle(s.highlights[index])}</title>
              </path>
            ) : null))}
          </g>;
        })}
      </svg>
    </div>
  );
}
