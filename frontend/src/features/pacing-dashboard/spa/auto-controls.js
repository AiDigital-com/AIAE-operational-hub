// workspace/src/lib/dashboard/auto-controls.js
//
// The render-time pre-step behind the Standard «Breakdown» (sections cutover 2026-09-07,
// spec §4). A stored spec may carry `optionsAuto: true` on its dimension switch, `defaultBy:
// 'buyUnit'` on a metric switch, and `metricBy: 'buyUnit'` on a metric VALUE (2026-09-08 — the
// Standard Breakdown lost its switch, and its pie and share follow the buy unit through the
// value itself); nothing downstream reads any of the three. The TILE runs
// `resolveAutoControls` once per render over the pacing's own inventory and hands the
// concrete spec (a list, a default) to useReportControls and the models — which is what the
// legacy Breakdown panel did with its tab bar on every render, and what the preset used to
// freeze at mint.
//
// Pure. No React, no store: the hook beside the tile (useAutoInventory.js) reads the store
// and this module answers.
import { DIM_KEYS } from './metric-catalog.js';
import { domRateType } from './metrics.js';

const BUY_UNIT_OF_RATE = { CPC: 'cl', CPV: 'co' };

/** The unit this pacing is bought on: the dominant rate type's, impressions when there is
 *  nothing to dominate. `domRateType` answers 'CPC' for an EMPTY set (0 >= 0 both ways), so
 *  the emptiness is asked first — the same guard kpi-basis.js carries. */
export function buyUnitOf(liPlan, effLIs) {
  const lines = Array.isArray(effLIs) ? effLIs : [];
  if (!lines.length) return 'im';
  return BUY_UNIT_OF_RATE[domRateType(liPlan || {}, lines)] || 'im';
}

/** Does an aux file carry a row for a line item on this pacing? The legacy Breakdown panel's
 *  own presence-as-signal test (moved here from WidgetGallery.jsx with the preset mint). */
export function auxRows(rows, liPlan) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const ids = new Set(Object.keys(liPlan || {}));
  return ids.size > 0 && rows.some((r) => r && ids.has(String(r.line_item_id)));
}

/**
 * The chips an auto dimension switch offers on THIS pacing — breakdownShape's rule, now asked
 * at render: the catalogue's dimensions the pacing carries, in DIM_KEYS' OWN order — which
 * already opens with `audience`, so nothing here reorders anything; never `channel` (a
 * property of the line item, not a split of the facts); then the DSP creative when creatives
 * are fetched; then every dimension SOURCE the pacing has read.
 *
 * @param {{availDims?: Set<string>|string[], hasCreatives?: boolean, dimSourceKeys?: string[]}} inv
 */
export function autoDimensionOptions(inv) {
  const avail = inv && inv.availDims;
  const present = avail instanceof Set ? avail : new Set(Array.isArray(avail) ? avail : []);
  const dims = DIM_KEYS.filter((k) => k !== 'channel' && present.has(k));
  if (inv && inv.hasCreatives) dims.push('aux:creative');
  for (const key of (inv && Array.isArray(inv.dimSourceKeys) ? inv.dimSourceKeys : [])) {
    if (typeof key === 'string' && key.startsWith('ds:') && dims.indexOf(key) === -1) dims.push(key);
  }
  return dims;
}

/** The three metrics a buy unit can name (`buyUnitOf`'s own answers). */
const BUY_UNIT_METRICS = ['im', 'cl', 'co'];
/** One option of a metric switch, matched against a buy unit — the ONE spelling, so the
 *  panel that offers `defaultBy` and the resolver that reads it cannot disagree about which
 *  options the rule can reach. (The grammar keeps a `cm` source out of this set on its own:
 *  a cm value carries only impressions/clicks/completions.) */
const isBuyUnitOption = (o, unit) => !!o && !!o.value && o.value.kind === 'metric' && o.value.metric === unit;

/**
 * Can `defaultBy: 'buyUnit'` ever change anything on this switch? Only where an option names
 * the pacing's buy unit — so on «Delivery vs CM360», whose options are the CM360-join counts
 * `impressions` / `clicks` / `completions`, the rule is inert and the builder does not offer
 * it (final review 2026-09-08).
 */
export function buyUnitDefaultApplies(control) {
  const options = control && Array.isArray(control.options) ? control.options : [];
  return BUY_UNIT_METRICS.some((unit) => options.some((o) => isBuyUnitOption(o, unit)));
}

const isAutoDim = (c) => !!c && c.type === 'dimension' && c.optionsAuto === true;
const isAutoMetric = (c) => !!c && c.type === 'metric' && typeof c.defaultBy === 'string';
const controlsOf = (spec) => (spec && Array.isArray(spec.controls) ? spec.controls : []);

/** A stored VALUE that follows the buy unit (grammar 2026-09-08): its `metric` is a placeholder
 *  and this module writes the pacing's own unit over it. The Standard Breakdown's pie and its
 *  share column carry it, which is what lets that widget follow the buy unit with NO control on
 *  the tile — a viewer who wants a switch adds one in the builder and binds the values to it. */
const isAutoValue = (v) => !!v && typeof v === 'object' && v.kind === 'metric' && v.metricBy === 'buyUnit';

/**
 * Every value slot inside `views`, walked GENERICALLY rather than slot by slot.
 *
 * report-v2.js has the authoritative list (pushViewValues: series, series guide, table column,
 * column target, table share, KPI value, KPI target, pie value, and containers recursing) and a
 * second copy of it here would be a copy that drifts — a ninth slot added there would silently
 * stop resolving here. Inside a view every `{kind:'metric'}` object IS a drawn value, so
 * matching on the shape reaches all of them and can reach nothing else.
 *
 * CONTROL options are deliberately not walked: the grammar refuses `metricBy` on one (an option
 * is a fixed choice), so there is nothing there to resolve.
 *
 * Identity-preserving — an unchanged node comes back BY REFERENCE, so the memo below the tile
 * keeps holding for a spec with no such value, and key order survives for the ones with.
 */
function mapAutoValues(node, unit) {
  if (Array.isArray(node)) {
    let moved = false;
    const out = node.map((x) => { const y = mapAutoValues(x, unit); if (y !== x) moved = true; return y; });
    return moved ? out : node;
  }
  if (!node || typeof node !== 'object') return node;
  if (isAutoValue(node)) {
    const { metricBy, ...rest } = node;   // eslint-disable-line no-unused-vars
    // `rest` already holds `metric` in its stored position, so re-assigning it keeps the
    // grammar's key order (kind, metric, source, unitFamily) in the resolved copy.
    return { ...rest, metric: unit };
  }
  let moved = false;
  const out = {};
  for (const k of Object.keys(node)) {
    const y = mapAutoValues(node[k], unit);
    if (y !== node[k]) moved = true;
    out[k] = y;
  }
  return moved ? out : node;
}

/** Does any value under `views` follow the buy unit? Same walk, asked before any store read. */
function someAutoValue(node) {
  if (Array.isArray(node)) return node.some((x) => someAutoValue(x));
  if (!node || typeof node !== 'object') return false;
  if (isAutoValue(node)) return true;
  return Object.keys(node).some((k) => someAutoValue(node[k]));
}

/** The two halves, asked APART — the hook beside the tile pays for the store's breakdown
 *  inventory only for the dimension one (`selectAvailDims` materializes the lazy aggregate),
 *  while the metric one needs the buy unit and nothing else. Both spellings live here, so the
 *  hook and this module cannot read the same spec differently. */
export function hasAutoDimension(spec) { return controlsOf(spec).some((c) => isAutoDim(c)); }
export function hasAutoMetric(spec) {
  return controlsOf(spec).some((c) => isAutoMetric(c)) || someAutoValue(spec && spec.views);
}

/** Does this spec need the pre-step at all? Asked before any store read, so a widget with
 *  stored lists costs nothing. */
export function hasAutoControls(spec) {
  return hasAutoDimension(spec) || hasAutoMetric(spec);
}

/** One view's grain, fixed to `key` where it followed the switch `controlId` — report-draft.js
 *  refixGrain's rule, applied at render for a switch that collapsed. Containers recurse. */
function fixGrain(v, controlId, key) {
  if (!v || typeof v !== 'object') return v;
  const follows = (g) => !!g && typeof g === 'object' && g.type === 'control' && g.controlId === controlId;
  if (v.kind === 'chart' && follows(v.x)) return { ...v, x: { type: 'dim', key } };
  if (v.kind === 'table' && follows(v.rows)) return { ...v, rows: { type: 'dim', key } };
  if (v.kind === 'pie' && v.sliceBy && typeof v.sliceBy === 'object' && v.sliceBy.controlId === controlId) {
    return { ...v, sliceBy: { key } };
  }
  if (v.kind === 'container' && Array.isArray(v.children)) {
    return { ...v, children: v.children.map((ch) => fixGrain(ch, controlId, key)) };
  }
  return v;
}

/**
 * resolveAutoControls(spec, inv) → the spec every reader below the tile sees.
 *
 * Returns `spec` ITSELF when it carries no auto key (identity, so memos keyed on the spec
 * object keep holding). Otherwise a copy:
 *   · the dimension switch carries the resolved list and its first entry as default — and
 *     with FEWER THAN TWO cuts it COLLAPSES (spec §4): the control goes and every grain that
 *     followed it is fixed to the one cut, `audience` when there is none, which draws the
 *     tile's own «This pacing has no Audience values». The old browser preset's rule,
 *     asked at render instead of frozen at mint;
 *   · the metric switch's default is the option whose metric is the buy unit, the stored
 *     default when the switch has no such option. `defaultBy` is dropped from the copy: it is a
 *     stored instruction, not a render fact, and a render-only spec must never be written back
 *     (resolveValue's own rule for `bound`);
 *   · every VALUE carrying `metricBy: 'buyUnit'` gets that same unit written into `metric`, and
 *     `metricBy` dropped, for the same reason.
 *
 * `inv` is read BY HALF, which is what lets the hook read the store by half too: only the
 * dimension branch asks `autoDimensionOptions` (availDims / creatives / dimension sources),
 * only the metric branch asks `buyUnitOf` (liPlan / effLIs). A spec whose sole auto key is
 * `defaultBy` therefore resolves over an inventory that names no dimensions at all.
 */
export function resolveAutoControls(spec, inv) {
  if (!hasAutoControls(spec)) return spec;
  let views = spec.views;
  const controls = [];
  for (const c of spec.controls) {
    if (isAutoDim(c)) {
      const list = autoDimensionOptions(inv);
      if (list.length >= 2) {
        controls.push({ id: c.id, type: 'dimension', label: c.label, options: list, defaultOption: list[0] });
      } else {
        const key = list[0] || 'audience';
        views = Array.isArray(views) ? views.map((v) => fixGrain(v, c.id, key)) : views;
      }
      continue;
    }
    if (isAutoMetric(c)) {
      const unit = buyUnitOf(inv && inv.liPlan, inv && inv.effLIs);
      const picked = (Array.isArray(c.options) ? c.options : [])
        .find((o) => isBuyUnitOption(o, unit));
      const { defaultBy, ...rest } = c;
      controls.push({ ...rest, defaultOptionId: picked ? picked.id : c.defaultOptionId });
      continue;
    }
    controls.push(c);
  }
  // The VALUES that follow the buy unit, after the grain fixes: `views` may already be the
  // collapsed copy, and both passes write the same object shape.
  if (someAutoValue(views)) views = mapAutoValues(views, buyUnitOf(inv && inv.liPlan, inv && inv.effLIs));
  return { ...spec, controls, views };
}
