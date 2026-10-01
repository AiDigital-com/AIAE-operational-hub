import { highlightFill, highlightTextStyle, highlightTitle } from '../ui/highlight-style.js';
// workspace/src/pages/Dashboard/components/Widgets/Report/ReportPie.jsx
//
// The v2 report's PIE view (widget-builder v2 spec 2026-08-19 §5.4; P2 plan Task 7).
// It draws `buildReportPieModel`'s answer and decides nothing: the slices, their order, the
// Others fold and the total all arrive on `model`, and the only questions answered here are
// recharts questions and one arithmetic one — a slice's share of the whole, which is a
// reading of the model's own two numbers.
//
// PROPS ONLY, and deliberately no hooks — the same property ReportChart stands on.
//
// The donut is the Breakdown block's, deliberately (LineItemList/Breakdown.jsx): 55% inner,
// 80% outer, one degree of padding, no animation. A pacing already has one donut and the
// reader has learnt to read it; a second one with its own proportions would be a different
// chart saying the same thing.
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { fmtV2 } from '../report-render.js';
import { pieSliceColor as fillOf } from './pie-table.js';

/** No leftover slice can be filtered by: the fold is several values at once, the remainder is
 *  no value at all, and a bucket the cut could not name has no fact to match — the pair would
 *  scope the dashboard to zero delivery. The legacy panel refuses a click on the same rows. */
const pickable = (slice) => !slice.others && !slice.residual && !slice.leftover;
/** A slice's React key. The LABEL alone is not one: a dimension whose bucket is literally
 *  called «Others» sits beside the engine's own fold under the same name, and two children
 *  keyed alike is a swatch that keeps the wrong colour when the slices change. The position
 *  disambiguates, and it is stable because the model's order is. */
const sliceKey = (slice, i) => `${i}:${slice.label}`;
/** A slice's share of the whole, as the tooltip and the legend print it. The total is the
 *  model's — the sum of what is DRAWN, Others included — so the shares add to 100%. */
const shareOf = (value, total) => (total > 0 && Number.isFinite(value) ? (value / total) * 100 : null);
const pctText = (share) => (share == null ? '' : `${share.toFixed(1)}%`);

/** §6's ⇄ marks what FOLLOWS the metric switch, visible to the viewer. On a pie the title
 *  is the only thing to hang it on, exactly as on a KPI.
 *
 *  With no authored title the caption is the model's `sliceLabel` — the product's word for
 *  the dimension this ring is cutting. That is not a fallback for a missing name: a pie
 *  whose cut the VIEWER picks has no title that could stay true, so the caption has to be
 *  the cut itself, and the table's row header one view down prints the same word. */
const pieName = (view, model) => {
  const title = (view && view.title) || model.sliceLabel || '';
  // With no word to hang it on there is no mark: the ⇄ says «this follows the switch» ABOUT
  // something, and alone in the caption row it is a glyph naming nothing. The row used to be
  // guarded by `view.title`, which covered this; the guard is now the caption itself, so the
  // caption has to say it.
  if (!title) return '';
  return model.bound ? `${title} ⇄` : title;
};

function PieTooltip({ active, payload, format, total, currency }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  const share = shareOf(p.value, total);
  return (
    <div className="recharts-tooltip-custom">
      <div className="recharts-tooltip-label">{p.name}</div>
      <div className="recharts-tooltip-row">
        <span className="recharts-tooltip-value" style={highlightTextStyle(p.payload?.highlight)}>{fmtV2(p.value, format, currency)}</span>
        {share != null && <span className="recharts-tooltip-name ml-2">{pctText(share)}</span>}
      </div>
      {p.payload?.highlight?.notes?.map((note, i) => <div key={i} className="text-10">{note}</div>)}
    </div>
  );
}

export default function ReportPie({ view, model, heightPx = 200, currency = null, pick = null, quietEmpty = false, paired = false, hideNote = false }) {
  if (!model) return null;
  const { slices, format, total } = model;
  const caption = paired && !view?.title ? '' : pieName(view, model);
  // Clicking a slice filters the dashboard by it — the legacy panel's own donut behaviour,
  // and the same handler its table rows use, so a click on either says one thing.
  const onPick = pick && pick.onPick ? pick.onPick : null;
  const isOn = (s) => !!(pick && pick.active && pick.active.has(s.label));
  // A refused value, a campaign-level one and a CM-fed one all arrive with no slices AND a
  // sentence saying why — the last of those because the CM360 side is grouped by the
  // mapping's dimensions and a pie is cut by one of the pacing's (buildReportPieModel's
  // docblock has the whole reason; it is the ONE slot attachCmData does not fill).
  const notes = Object.values(model.errors || {});
  // When the model said WHY there is nothing, that sentence is the empty state — not a
  // footnote under a generic one. «No data for selected filters» is a wrong diagnosis for a
  // pie that has a perfectly good number and no way to cut it: the filters are not the
  // reason, and a reader who acts on that headline goes looking in the wrong place.
  // `emptyNote` is the same kind of answer one step down: the value was fine and the CUT
  // was fine, but this pacing carries no such dimension. Below a refusal, because a refusal
  // is about the widget and this is about the pacing.
  const emptyText = notes[0] || model.emptyNote || 'No data for selected filters';

  return (
    <div className="rpt-view">
      {caption ? (
        <div className="text-11 rpt-view-title" style={{ padding: '10px 12px 0', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {caption}
        </div>
      ) : null}
      {slices.length === 0 ? (
        // `quietEmpty` is the tile saying another view on this row has already said it: one
        // fact explained twice, side by side, reads as two problems. The box still draws, so
        // the pair keeps the shape it has when there IS a ring.
        <div className="chart-panel__body" style={{ height: heightPx }}>
          <div className="chart-panel__empty">{quietEmpty ? '' : emptyText}</div>
        </div>
      ) : (
        // The donut keeps its size and the legend takes what is left; on a tile too narrow
        // to hold both (the legend asks for 140px), the legend WRAPS under the ring at full
        // width instead of crushing its numbers into an ellipsis.
        //
        // CENTRED, unconditionally (section view rows §4). A pie alone in a full-width
        // section used to hug the left edge with the band's whole width empty beside it,
        // which read as a rendering fault rather than as a ring. `justify-content` is a
        // statement about FREE SPACE, so it costs nothing where there is none: inside a
        // shared row the pie's cell is sized to its own content, and the pair sits exactly
        // where it did. One rule, right in both places, and no view needs to be told which
        // one it is in.
        <div
          className="flex flex-wrap items-start gap-4"
          style={{ padding: paired ? 0 : '6px 12px 10px', justifyContent: 'center' }}
        >
          <div style={{ flexShrink: 0, width: heightPx, height: heightPx, maxWidth: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices} dataKey="value" nameKey="label"
                  cx="50%" cy="50%" innerRadius="55%" outerRadius="80%"
                  paddingAngle={1} strokeWidth={0} isAnimationActive={false}
                  onClick={onPick ? (_, idx) => {
                    const s = slices[idx];
                    if (s && pickable(s)) onPick(s.label);
                  } : undefined}
                  cursor={onPick ? 'pointer' : undefined}
                >
                  {slices.map((s, i) => (
                    <Cell
                      key={sliceKey(s, i)}
                      fill={highlightFill(s.highlight) || fillOf(s, i)}
                      // The slice whose filter is ON wears the accent outline the row in the
                      // table beside it wears — one state, drawn twice, so a reader can see
                      // which segment the dashboard is scoped to from either view.
                      stroke={isOn(s) ? 'var(--accent)' : 'none'}
                      strokeWidth={isOn(s) ? 2 : 0}
                    />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip format={format} total={total} currency={currency} />} cursor={false} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* The legend carries the numbers the ring cannot: recharts' own names a colour
              and stops there, and a share with no value beside it is half a reading. It
              scrolls inside the donut's own height rather than growing the tile — a pie
              folds at twenty slices (§5.4) and twenty lines is taller than any donut. */}
          {!paired && <ul
            className="m-0 p-0 list-none rpt-pie-legend"
            // `1 1 110px` and NOT `flex: 1`: a zero basis lets the legend shrink to nothing
            // rather than wrap, which is how a 300px tile ends up with three ellipses beside
            // a donut. The label inside each row still carries the min-width: 0 it needs.
            //
            // The BASIS came down from 140 to 110 for the Breakdown pair (section-widget
            // parity 2026-09-04): beside a table, the pie's cell is only as wide as the table
            // leaves it, and at 140 the legend wrapped under the ring at about 380px of cell
            // — so flipping the cut from Audience to Geo MOVED the legend and grew the tile
            // by 57px with an empty band beside it. 110 is what the three columns need at
            // their narrowest (a name that may ellipsize, a value, the 42px share), so the
            // legend now holds beside the ring at every width a shared row gives it.
            //
            // The CEILING is the other half of the same sentence (P2 handoff §5.4): on a
            // section at 1440 the legend grew to the width of the band and the ring stopped
            // reading as part of it. 320px is the table's own label ceiling (LABEL_MAX_PX)
            // and it is what these three columns need — the widest money value this
            // renderer prints, the 42px share beside it, and ~160px left for a name.
            style={{ flex: '1 1 110px', maxWidth: 320, maxHeight: heightPx, overflowY: 'auto' }}
          >
            {slices.map((s, i) => (
              <li
                key={sliceKey(s, i)}
                className="text-11 flex items-center gap-2"
                style={{ padding: '2px 0', minWidth: 0 }}
                title={highlightTitle(s.highlight)}
              >
                <span style={{
                  flexShrink: 0, width: 9, height: 9,
                  borderRadius: 'var(--rxs)', background: highlightFill(s.highlight) || fillOf(s, i),
                }} />
                <span
                  title={s.label}
                  style={{
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', color: 'var(--text-secondary)', ...highlightTextStyle(s.highlight),
                  }}
                >
                  {s.label}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', whiteSpace: 'nowrap', ...highlightTextStyle(s.highlight) }}>
                  {fmtV2(s.value, format, currency)}
                </span>
                <span className="text-10" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', width: 42, textAlign: 'right' }}>
                  {pctText(shareOf(s.value, total))}
                </span>
              </li>
            ))}
          </ul>}
        </div>
      )}
      {/* Under a DRAWN ring only: today the model cannot hand back slices and an ERROR at
          once (every arm that names a reason returns with none), so this is the slot a note
          beside a real pie would use, and the sentence above is where the reasons actually
          land. Printing both would say the same thing twice.

          `model.note` is the other kind of sentence and it belongs here too: what the
          dimension source covers, how far it disagrees with delivery and how old its rows
          are — a statement ABOUT a ring that drew, never instead of one. */}
      {slices.length > 0 && ((!hideNote && model.note) || notes.length > 0) && (
        <div className="text-10" style={{ padding: '0 12px 8px', color: 'var(--text-muted)' }}>
          {!hideNote && model.note ? <div>{model.note}</div> : null}
          {notes.map((n) => <div key={n}>{n}</div>)}
        </div>
      )}
    </div>
  );
}
