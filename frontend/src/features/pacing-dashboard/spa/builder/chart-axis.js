// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/chart-axis.js
//
// Three questions the chart card asks about what the TILE does, all answered from the
// renderer's own rules rather than from a second set typed here (widget-builder v2 §5.1):
//
//   drawnSeries(view)                  which series does the chart actually draw?
//   axisSides(view, spec)              which side does each series actually draw on?
//   autoAxisFormat(view, spec, id, e)  may a freshly picked metric fill this axis's scale?
//
// Pure — no React, no store — so the card, the series popover and a host test all read one
// answer. `placeAxes` is `report-render.js`'s own function: `auto` is not a side, it is the
// renderer PLACING the series, and an editor that guessed differently would print «left
// axis» beside a line the tile draws on the right.
import { BASIS_FAMILY } from '../report-v2.js';
import { familyOf } from '../metric-catalog.js';
import { grainTypeOf, placeAxes, resolveValue } from '../report-render.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * The series the chart really draws, in the order it draws them.
 *
 * `buildReportChartModel` drops two kinds before it places a single axis and before
 * `ReportChart` hands out a palette slot by position:
 *   · a HIDDEN series — absent from the chart, not faded on it (§5.1);
 *   · a CALC series off the date axis — §3's amendment keeps it STORED and marks it
 *     skipped, and a Plan line has nothing to stand on without days.
 * Both rules live here so the card's axis word and its swatch are read off the same list
 * the tile draws from. Counting a skipped line placed the series after it on the wrong
 * side, coloured every later swatch one slot off, and — through `autoAxisFormat` — filled
 * the scale of an axis the chart does not use.
 *
 * NOT the list `axisFamilies` walks, deliberately. The GRAMMAR's axis rules count every
 * stored series on any X (`shared/report-v2.js`: «A CALC series is in both rules on the
 * same terms»), so a REFUSAL weighs a skipped line while a DRAWING does not.
 *
 * The date test is the model's own — `grainTypeOf` is `buildReportChartModel`'s own read of
 * the axis, so a CONTROL axis counts as the dimension axis it resolves to and the two cannot
 * drift apart on an odd stored value. Read through that helper and not `view.x.type`: on a
 * control axis the raw type is neither `li` nor `dim`, so a Plan line the tile SKIPS was
 * counted as drawn here — every later series took the wrong palette slot and the wrong axis
 * word, which is the same off-by-one the hidden-series pin below already records.
 */
export function drawnSeries(view) {
  const xType = grainTypeOf(view && view.x);
  const category = xType === 'li' || xType === 'dim';
  return arr(view && view.series).filter((s) => s && !s.hidden && !(category && s.kind === 'calc'));
}

/**
 * What the OTHER series already draw, in the shape the metric catalog's two axis rules read:
 * `{left, right, all}` — the unit families sitting on each EXPLICIT axis, and the union over
 * the whole chart.
 *
 * `exceptId` leaves one series out, which is the difference between the two questions a
 * picker asks: adding a series weighs it against every existing one, while REPLACING a
 * series' value must not weigh it against the value it is replacing.
 *
 * A bound series contributes the family set of its switch OPTIONS — the same set
 * `normChartView` intersects — not the one option it happens to be showing. `auto` is not a
 * side: the grammar pairs only series that sit on the same explicit axis.
 */
export function axisFamilies(view, spec, exceptId) {
  const out = { left: [], right: [], all: [] };
  for (const s of arr(view && view.series)) {
    if (!s || s.id === exceptId) continue;
    const fams = s.kind === 'calc' ? [BASIS_FAMILY[s.basis] || 'count'] : familyOf(s.value, spec);
    for (const f of fams) {
      if (!out.all.includes(f)) out.all.push(f);
      if (s.axis !== 'left' && s.axis !== 'right') continue;
      if (!out[s.axis].includes(f)) out[s.axis].push(f);
    }
  }
  return out;
}

/**
 * The side each series sits on, keyed by series id.
 *
 * Over the DRAWN series only, exactly as `buildReportChartModel` does: a series the chart
 * does not draw takes part in no placement, and is therefore absent from this map too —
 * the caller says what to print for one.
 *
 * A bound value resolves the way the tile resolves it with no control state — through the
 * switch's default option — because that is the reading the preview underneath the card is
 * drawing.
 */
export function axisSides(view, spec) {
  const list = drawnSeries(view);
  const families = list.map((s) => (s.kind === 'calc'
    ? (BASIS_FAMILY[s.basis] || 'count')
    : ((resolveValue(s.value, spec, null) || {}).unitFamily || null)));
  const sides = placeAxes(families, list.map((s) => s.axis));
  const out = Object.create(null);
  list.forEach((s, i) => { out[s.id] = sides[i]; });
  return out;
}

/**
 * The metric-picked axis-scale default (§5.1, parity with `decideAutoAxisFormat`): picking a
 * metric may FILL an axis scale nobody has chosen yet, and may never change one that was.
 * §1.1.4 draws exactly that line — automation fills an empty default, it never overwrites an
 * explicit choice.
 *
 * Three guards, the same three the legacy decision makes, over the v2 shape:
 *   · the metric has an axis scale to offer (`entry.axisFormat`, which is the family read
 *     back through the catalog's own inverse of `METRIC_AXIS_FORMAT`);
 *   · this series is the FIRST one on that axis — a shared axis with an earlier series may
 *     have been tuned on purpose;
 *   · the axis scale is still its untouched default. A v2 chart is born `{left:'kilo',
 *     right:'number'}` (`emptyReport` / `addView`), so unlike the legacy pair — where the
 *     right axis had no skeleton entry at all and unset WAS its untouched state — both
 *     sides have a literal to compare against. This is why the twin exists rather than the
 *     legacy function being handed a view: fed `right: 'number'` it would read every right
 *     axis as touched and never fill one.
 *
 * Like the legacy one it cannot tell «still default» from «re-picked the same value on
 * purpose». That imprecision is inherited deliberately, and it only ever costs a fill that
 * was already the same value.
 *
 * @returns {{side:'left'|'right', format:string}|null}
 */
export function autoAxisFormat(view, spec, seriesId, entry) {
  const want = entry && entry.axisFormat;
  if (!want) return null;
  const sides = axisSides(view, spec);
  const side = sides[seriesId];
  // A series the chart does not draw sits on no axis, so picking a metric for one fills
  // nothing — there is no scale under it to be the default of.
  if (side !== 'left' && side !== 'right') return null;
  const onSide = drawnSeries(view).filter((s) => sides[s.id] === side);
  if (!onSide.length || onSide[0].id !== seriesId) return null;
  const cur = view.formats && view.formats[side];
  const untouched = side === 'left' ? cur === 'kilo' : cur === 'number';
  if (!untouched || cur === want) return null;
  return { side, format: want };
}
