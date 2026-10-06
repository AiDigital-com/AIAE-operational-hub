// workspace/src/lib/dashboard/brick-data.js
//
// What a block SHOWS: canonical metrics and formulas use the existing engine.
// Closed domain readings share their calculations with the legacy fixed blocks.
//
// The CANONICAL bricks (`unitBars`, `rateRows`, `flightBullet`, the canonical `note`
// and `detailCard` sources) read neither: they repeat over what the campaign HAS, and
// those series are derived here from campM / full-flight metrics so the composite and
// the block it replaces compute them once, the same way. Every one of them is a LIFT —
// the docstrings name the exact lines they came from, and T11 deletes the originals.
//
// Pure apart from the metric-readings import: the Widget gathers the context once
// (campaign metrics, full-flight metrics, and ONE useWidgetData for the whole tile) and
// every brick reads from it. Thirty bricks must not be thirty window computations.
import { flightProgress, layoutReading } from './layout-readings.js';
export { flightProgress } from './layout-readings.js';
import { kpiValue, buildSeriesModel, campaignWindowScalars } from './widget-data.js';
// The cm vocabulary and the ONE evaluation helper every cm-fed slot goes through (§2.2).
// From the PURE module, never from `report-render.js`: that file imports this one (for
// `canonicalValue`), so importing it back would be a real cycle. `cmEvalAt` lives in
// `cm-formula-context.js` for this reason, and `report-render.js` only re-exports it.
import { cmMarkerOf, cmEvalAt, cmFieldRefusal, cmSeriesContext } from './cm-formula-context.js';
// Formula chips P0: a chip bind's format is its chip's legacy field's, and its value is
// refused with the one sentence until a chip evaluator ships.
import { holderInfo } from './chips/info.js';
import { unitOf } from './chips/tokens.js';
import { CHIP_CM_NOT_YET } from './chips/resolve.js';
// `FIELDS_PLAN` is the vocabulary a WINDOW reading may name beside the comparison (§2.4): both
// cm slots in this file are window readings — a block, and a mini-chart line whose plan half is
// the window's — so both run the gate against the same set the KPI rail runs it against.
import { evaluateMaskedSeries, FIELDS_PLAN } from './widget-formula.js';
import { fI, f$, fP, fPP, fDs } from './format.js';
import { anyCoef, anyNet, basisLabel, coefLabels } from './coef-rebuild.js';
// The one predicate that says whether a money figure actually DRAWS its gross twin —
// asked per ROW here, so a rate label can never claim a basis the row does not show.
import { showsGrossPair } from './dual-money.js';
import { readingFor } from './widget-metric-readings.js';
import { CATALOG } from './metric-catalog.js';
// The word bands live in ONE place — the composite
// reads the same functions block1 and the ready cards read, so the hero and the card
// beside it can never call the same delta by two different words.
import {
  paceStatus, paceWord, marginStatus, marginWord, primaryUnit, UNIT_FIELDS,
} from './widget-status.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const EM = '—';

/** The totals rule of spec 2026-09-13 §3, said on a row that cannot show its number. */
function cvUnavailableText(n) {
  const count = n > 0 ? n : 1;
  return `${count} line item${count === 1 ? '' : 's'} cannot show conversions here`;
}

/**
 * The rate rows note of spec §7. K = line items in view counting chosen actions, N = line
 * items in view with conversion data. N is read off the plan map campM was given, and a
 * widget's scoped plan map can be a virtual one without `conversionData`; K always has
 * conversion data, so N never prints below K.
 */
function primaryCvNoteText(k, n) {
  const of = Math.max(n || 0, k);
  return k === of ? 'Primary conversions on all line items' : `Primary conversions on ${k} of ${of} line items`;
}

/**
 * The canonical metrics that are not KPI presets and the side
 * each is read from — the reading map bricks.js left as a TODO for this task.
 *
 * The split is not cosmetic. `cm` is RANGE-AWARE: to-date pacing, the expected curve
 * and every ratio OverviewBlock2 reads off `ac` follow the page's Range filter and its
 * period scope. `flCM` is FULL-FLIGHT: needed-per-day, the DSP forecast and the
 * per-bucket client plan rates are flight constants and must not move when the reader
 * narrows the window. Reading either from the wrong side draws a number that disagrees
 * with the block it replaced on every filtered dashboard.
 *
 * `format` is the metric's own — a brick that says `auto` gets it, exactly as a preset
 * brick gets the preset's. `sub` is the caption the block printed beside the number.
 */
const CANON = {
  __proto__: null,
  // full-flight (flCM)
  neededSpendPerDay: { from: 'fl', format: 'money', needsFlight: true },
  neededPerDayImpr: { from: 'fl', format: 'int', unit: 'impr', needsFlight: true },
  neededPerDayClicks: { from: 'fl', format: 'int', unit: 'clicks', needsFlight: true },
  neededPerDayViews: { from: 'fl', format: 'int', unit: 'views', needsFlight: true },
  neededPerDayInstalls: { from: 'fl', format: 'int', unit: 'installs', needsFlight: true },
  forecastDspSpend: { from: 'fl', format: 'money' },
  // The FULL-flight cost budget, and what is left of it. Canonical on purpose (T12
  // Step 0): the formula field `costBud` is range-prorated, so an expr over it printed
  // "Cost Remaining $0.00" on a campaign with $10.5k of cost budget left.
  costBudTotal: { from: 'fl', format: 'money' },
  costRemaining: { from: 'derived', format: 'money' },
  clientPlanCpm: { from: 'fl', format: 'money', unit: 'impr' },
  clientPlanCpc: { from: 'fl', format: 'money', unit: 'clicks' },
  clientPlanCpv: { from: 'fl', format: 'money4', unit: 'views' },
  // Deliberately distinct from the KPI CPM target (`tgtCpm`). The Chart guide
  // uses the media cost plan divided by planned impressions; mixed-rate campaigns
  // prove that the two targets are not interchangeable.
  bidPlanCpm: { from: 'fl', format: 'money', unit: 'impr' },
  // range-aware (cm)
  // `paced`: a pace over the window's plan, so a window holding none of it has no number —
  // an em dash, not the «0% of plan-to-date» its division by zero would print.
  imprToDatePct: { from: 'cm', format: 'percent', sub: 'of plan-to-date', unit: 'impr', paced: true },
  // The Delivery card's Fact — campM's impression-paced actual (metrics.js:334 gates
  // CPC/CPV lines out), owner decision 2026-08-15: Fact, Needed and Deviation share
  // Needed's basis. The formula field `im` counts EVERY line's impressions and
  // disagrees with imprExpected on any mixed-rate campaign.
  imprActual: { from: 'cm', format: 'int', unit: 'impr' },
  imprExpected: { from: 'cm', format: 'int', unit: 'impr' },
  imprDeviation: { from: 'derived', format: 'int', unit: 'impr' },
  dynCpm: { from: 'cm', format: 'money', unit: 'impr' },
  // DERIVED here, not a campM key: the impressions pace delta the Delivery card is
  // judged on ((actual − expected) / plan × 100, UnitCardBody:23). campM publishes the
  // three inputs and no block ever stored the ratio, so this is the one canonical
  // metric with no column of its own — and the only one that can say "this unit has no
  // plan" rather than "0.0 pp", which is what the plan-less branch (UnitCardBody:15-21)
  // needs: no badge, no colour, just the count.
  paceDeltaImpr: { from: 'derived', format: 'pp', unit: 'impr' },
  // «Impressions to Hit Budget» (2026-09-29): full flight, or the period under period scope,
  // whatever the Range filter says. Each unit's pair is absent on a pacing with no goal in it,
  // so the card's cells for views and clicks drop on a CPM-only pacing; null (an em dash)
  // while a unit has no client cost to take a rate from.
  hitBudgetAddImpr: { from: 'fl', format: 'int', unit: 'impr' },
  hitBudgetAddViews: { from: 'fl', format: 'int', unit: 'views' },
  hitBudgetAddClicks: { from: 'fl', format: 'int', unit: 'clicks' },
  hitBudgetPerDayImpr: { from: 'fl', format: 'int', unit: 'impr', needsFlight: true },
  hitBudgetPerDayViews: { from: 'fl', format: 'int', unit: 'views', needsFlight: true },
  hitBudgetPerDayClicks: { from: 'fl', format: 'int', unit: 'clicks', needsFlight: true },
  hitBudgetAddInstalls: { from: 'fl', format: 'int', unit: 'installs' },
  hitBudgetPerDayInstalls: { from: 'fl', format: 'int', unit: 'installs', needsFlight: true },
  hitBudgetPlan: { from: 'fl', format: 'money' },
  hitBudgetProjected: { from: 'fl', format: 'money' },
  hitBudgetGap: { from: 'fl', format: 'money' },
  /* ── The same seven, on the unit this pacing is actually BOUGHT on (2026-10-05) ──
   * The legacy Delivery card was unit-aware: UnitCardBody read `primaryUnit(cm)` and drew
   * impressions, clicks or views. Its Standard replacement could not — a stored definition
   * names ONE metric — so it names the impressions one, and on a CPC or CPV pacing campM's
   * whole impressions family is 0 by design (metrics.js gates CPC/CPV lines out of it). The
   * card then printed «0% of plan-to-date», Fact 0, Needed 0, Deviation 0 and «Deliver today
   * 0» on a campaign delivering perfectly well — the figures were sitting one family over,
   * under `clicks*` / `views*`.
   *
   * These seven read UNIT_FIELDS[primaryUnit(cm)] instead, so one stored definition follows
   * the pacing. `unit: 'buy'` is the same sentinel resolved in `hasPlan`/`windowPlanOf`: the
   * plan gate has to ask about the RESOLVED unit, or a CPC pacing's card would be dropped for
   * having no impressions plan. A mixed-rate pacing resolves to whichever unit `primaryUnit`
   * names (impressions where any line is impression-paced), which is exactly what the legacy
   * card showed there. */
  unitToDatePct: { from: 'derived', format: 'percent', sub: 'of plan-to-date', unit: 'buy', paced: true },
  unitActual: { from: 'derived', format: 'int', unit: 'buy' },
  unitExpected: { from: 'derived', format: 'int', unit: 'buy' },
  unitPlan: { from: 'derived', format: 'int', unit: 'buy' },
  unitDeviation: { from: 'derived', format: 'int', unit: 'buy' },
  neededPerDayUnit: { from: 'derived', format: 'int', unit: 'buy', needsFlight: true },
  paceDeltaUnit: { from: 'derived', format: 'pp', unit: 'buy' },
};

/** The unit a `unit: 'buy'` metric resolves to on this pacing — `primaryUnit`'s answer, the
 *  one the legacy Delivery card picked. Never null: `primaryUnit` always names one of the
 *  three, and with no metrics at all the caller's own `!cm` guards run first. */
function buyUnitOf(cm) {
  return cm ? primaryUnit(cm) : 'impr';
}

/**
 * Does the campaign carry a GOAL for this unit? Not "does a line of this type exist" —
 * `cm.hasClicks` is true for any CPC line at all (metrics.js:490), goal or no goal, and
 * a CPC line without one printed nothing in the blocks (VerdictHero:49 filters on
 * `cm[plan] > 0`; OverviewBlock1:447 draws its no-plan row instead). Gating on the flag
 * would put "Clicks/day 0" where the original drew nothing at all.
 *
 * Asked of the WHOLE-flight plan (campM's *PlanFlight twins, 2026-09-23): a narrowed window
 * that holds none of a unit's plan — a week before a line starts — is a pace of nothing, not
 * a unit this campaign lacks, and must not drop the unit's rows. The `??` chain keeps a
 * metrics object from before the twins answering as it did.
 */
function hasPlan(cm, unit) {
  if (!cm) return true; // no metrics in the context: not this layer's call to make
  if (unit === 'buy') unit = buyUnitOf(cm);
  if (unit === 'impr') return (cm.imprPlanFlight ?? cm.imprPlan ?? cm.pI ?? 0) > 0;
  if (unit === 'clicks') return (cm.clicksPlanFlight ?? cm.clicksPlan ?? cm.planClicks ?? 0) > 0;
  if (unit === 'installs') return (cm.installsPlanFlight ?? cm.installsPlan ?? 0) > 0;
  return (cm.viewsPlanFlight ?? cm.viewsPlan ?? 0) > 0;
}

/** The plan a unit's pace is read over: the window's, which is the flight's unless the
 *  viewer narrowed it (campM `planWindowed`). */
function windowPlanOf(cm, unit) {
  if (unit === 'buy') unit = buyUnitOf(cm);
  if (unit === 'impr') return cm.imprPlan ?? cm.pI ?? 0;
  if (unit === 'clicks') return cm.clicksPlan ?? cm.planClicks ?? 0;
  if (unit === 'installs') return cm.installsPlan ?? 0;
  return cm.viewsPlan ?? 0;
}

/**
 * The flight plans this unit and the viewer's window holds none of it — a week before a line
 * starts, or after it ended. There is no pace to read there, so every pace surface says so
 * rather than turn a delta of 0 into «On track» (review 2026-09-23): the unit bars' «no plan
 * in this window», the Pacing and Delivery em dashes, and below, the Operational Read, the
 * verdict, the «Actual to date» note and the to-date percent. Never true on Flight, where the
 * window's plan IS the flight's.
 */
function noWindowPlan(cm, unit) {
  return !!cm && hasPlan(cm, unit) && !(windowPlanOf(cm, unit) > 0);
}

/**
 * The display format a BARE field carries when the brick says `auto`. The field
 * universe is closed and small (widget-formula.js), and money is the half a plain
 * integer misreads worst: the standard hero's spend bar labels its mark "needed today
 * · <expCo>", and `1,234` where the block printed `$1,234.00` is a different number to
 * a reader. Only a bare field is guessed — an expression is arithmetic whose unit
 * nobody can know, and it keeps the caller's format.
 */
const FIELD_FORMAT = {
  __proto__: null,
  sp: 'money', dc: 'money', expCo: 'money', budget: 'money', costBud: 'money',
  costBudTotal: 'money', budgetTotal: 'money', budgetToDate: 'money',
  // The plan counts print whole: a narrowed window's plan is a share of the plan curve, and
  // `auto` would print its cents of an impression («298,214.29»).
  planImpr: 'int', planClicks: 'int', planViews: 'int',
  planImprTotal: 'int', planClicksTotal: 'int', planViewsTotal: 'int',
  clExpected: 'int',
  cpm: 'money', cpc: 'money', cpv: 'money4',
  ctr: 'percent2', vcr: 'percent', acr: 'percent',
  mTgt: 'percent', ctrT: 'percent2', vcrT: 'percent', acrT: 'percent',
};

/** The bare field a formula bind names, by the key `bindValue` reads `FIELD_FORMAT` with. */
const bareFieldOf = (bind) => (bind && bind.expr ? (bind.chips ? holderInfo(bind).legacyField : bind.expr) : null);
/** The catalogue's default format per delivery field: the one a new block is born with. */
const FIELD_DEFAULT_FORMAT = new Map(CATALOG.filter((entry) => entry.kind === 'metric')
  .map((entry) => [entry.key, entry.defaultFormat]));
const FAMILY_FORMAT = { __proto__: null, count: 'int', money: 'money', percent: 'percent' };
const knownFormat = (format) => (format && format !== 'auto' ? format : null);
/**
 * What a formula bind's own words say about its unit, where the engine's format is silent:
 * the catalogue's default for a bare field (`cl` is a count `FIELD_FORMAT` knows nothing
 * about, a conversion prints one decimal), else the unit family its chips agree on — a single
 * chip with settings, which has no bare field, or a sum of same-unit ones (`unitOf`). A ratio,
 * a product or a number has no unit to name, and neither does a text the parser refuses.
 */
function impliedFormat(bind) {
  if (!bind || !bind.expr) return null;
  const byField = knownFormat(FIELD_DEFAULT_FORMAT.get(bareFieldOf(bind)));
  if (byField) return byField;
  try { return FAMILY_FORMAT[unitOf(bind)] || null; } catch { return null; }
}

/**
 * Metrics that mean nothing before the first delivered day. OverviewBlock1:481 refuses
 * to state a margin without one — "0.0% · −20 pp · Below target" on a pre-start
 * campaign is a verdict about nothing — and the rule travels with the METRIC so the
 * hero's big number, its gauge and its badge all fall silent together.
 * Applied only when the context carries `facts`: a caller with no facts is not judging
 * delivery (the unit suites), and this must not turn into a silent null there.
 */
const NEEDS_DELIVERY = new Set(['margin']);

/** The canonical metrics campM does not carry, computed from the ones it does. */
function derived(key, ctx) {
  const cm = ctx.cm;
  if (!cm) return null;
  if (key === 'costRemaining') {
    // OverviewBlock2:127 verbatim: max(0, flCM.costBudTotal − flCM.sp). Both halves
    // full-flight — the range-prorated `costBud` field is what this metric replaces.
    const fl = ctx.flCM;
    if (!fl) return null;
    return Math.max(0, (fl.costBudTotal || 0) - (fl.sp || 0));
  }
  if (key === 'imprDeviation') {
    // Fact − Needed on ONE basis (owner decision 2026-08-15): campM's impression-paced
    // actual minus its expected — UnitCardBody:38's `actual - expected`, lifted. Never
    // the all-lines `im − expIm`, which is a different number on a mixed-rate campaign.
    return (cm.imprActual ?? cm.im ?? 0) - (cm.imprExpected ?? cm.eI ?? 0);
  }
  if (key === 'paceDeltaImpr') {
    const plan = cm.imprPlan ?? cm.pI ?? 0;
    // The plan-less guard is the POINT of this metric, and it is already covered by the
    // `unit` gate above — this is the belt to that brace.
    if (!(plan > 0)) return null;
    return (((cm.imprActual ?? cm.im ?? 0) - (cm.imprExpected ?? cm.eI ?? 0)) / plan) * 100;
  }
  /* The seven buy-unit metrics (2026-10-05): the impressions six just above, asked of
   * UNIT_FIELDS[primaryUnit(cm)] instead of a fixed family. Each is campM's own field for
   * that unit — nothing is recomputed here, so a CPC pacing's card prints exactly the numbers
   * campM already publishes under `clicks*`, and a CPM pacing's card is byte-identical to
   * what the impressions binds drew. */
  if (hasOwn(BUY_UNIT_SLOT, key)) {
    const F = UNIT_FIELDS[buyUnitOf(cm)];
    return cm[F[BUY_UNIT_SLOT[key]]] ?? null;
  }
  if (key === 'neededPerDayUnit') {
    // The FULL-flight side, like its three fixed-unit siblings above (`neededPerDayImpr` and
    // co. are `from: 'fl'`): a daily target is a flight constant and must not move when the
    // reader narrows the window. The unit itself is still decided on `cm`, the same object
    // `hasPlan` asks — flCM and cm name the same pacing.
    const fl = ctx.flCM;
    if (!fl) return null;
    return fl[UNIT_FIELDS[buyUnitOf(cm)].neededPerDay] ?? null;
  }
  if (key === 'unitDeviation') {
    const F = UNIT_FIELDS[buyUnitOf(cm)];
    // Fact − Needed on ONE basis, the same rule `imprDeviation` carries.
    return (cm[F.actual] || 0) - (cm[F.expected] || 0);
  }
  if (key === 'paceDeltaUnit') {
    const F = UNIT_FIELDS[buyUnitOf(cm)];
    const plan = cm[F.plan] || 0;
    if (!(plan > 0)) return null;
    return (((cm[F.actual] || 0) - (cm[F.expected] || 0)) / plan) * 100;
  }
  return null;
}

/** The four buy-unit metrics that are a straight read of one UNIT_FIELDS slot. The other
 *  three (`unitDeviation`, `paceDeltaUnit`) are arithmetic over two of them, and
 *  `neededPerDayUnit` is read off the FULL-flight metrics — see `derived`'s caller. */
const BUY_UNIT_SLOT = {
  __proto__: null,
  unitActual: 'actual', unitExpected: 'expected', unitPlan: 'plan', unitToDatePct: 'toDate',
};

/**
 * One bind → {value, target?, invert?, sub?, format?, error?}. Never throws: a brick is
 * one cell of a tile that holds up to thirty of them, and one bad binding may not take
 * the page down.
 */
function bindValue(bind, ctx) {
  if (bind?.reading) return layoutReading(bind.reading, ctx);
  if (bind && bind.metric != null) {
    const key = bind.metric;
    if (typeof key !== 'string') return { value: null };
    if (hasOwn(CANON, key)) {
      const c = CANON[key];
      // A unit this campaign has no GOAL for has no number here — not a zero. "Clicks/day
      // 0" beside a CPM-only campaign's impressions is a target nobody set, and the
      // blocks these bricks replace simply did not draw that row (VerdictHero:49-71,
      // std-entries' note on the same statRow). `absent` is how a statRow knows to
      // drop the cell, and a kv row to say nothing at all, rather than print an em dash
      // where there was no row to begin with.
      if (c.unit && !hasPlan(ctx.cm, c.unit)) return { value: null, absent: true, format: c.format };
      // Same silence once the flight is over: "needed per day" with no days left is not
      // 0, it is a question that stopped applying — which is why the blocks hid these
      // rows outright (BudgetCardBody:29, UnitCardBody:41, VerdictHero:68) and why
      // detailSource says "Flight ended; no daily target remaining." instead of a rate.
      if (c.needsFlight && ctx.flCM && (ctx.flCM.daysLeft || 0) <= 0) {
        return { value: null, absent: true, format: c.format };
      }
      if (c.paced && noWindowPlan(ctx.cm, c.unit)) return { value: null, format: c.format, sub: c.sub || null };
      if (c.from === 'derived') return { value: derived(key, ctx), format: c.format, sub: c.sub || null };
      const src = c.from === 'fl' ? ctx.flCM : ctx.cm;
      const v = src ? src[key] : null;
      return { value: v == null ? null : v, format: c.format, sub: c.sub || null };
    }
    const reading = readingFor(key);
    if (!reading || !ctx.cm || !ctx.flCM) return { value: null };
    if (ctx.facts && !ctx.facts.asOf && NEEDS_DELIVERY.has(key)) return { value: null, format: reading.format };
    try {
      const o = reading.compute(ctx.cm, ctx.flCM);
      return { value: o.value, target: o.target, invert: o.invert, sub: o.sub, format: reading.format };
    } catch {
      // A reading whose field this campaign's metrics do not carry. The tile shows
      // an em dash, which is the truth, instead of an error boundary.
      return { value: null, format: reading.format };
    }
  }
  if (!bind || !bind.expr) return { value: null };
  const key = bareFieldOf(bind);
  const fmt = hasOwn(FIELD_FORMAT, key) ? FIELD_FORMAT[key] : null;
  // A chip bind (formula chips P1) is evaluated by the chip engine through kpiValue's door,
  // never handed to the delivery engine as text, which would read `_c1` as an unknown field.
  if (bind.chips) {
    if (holderInfo(bind).cm) return { value: null, format: fmt, error: CHIP_CM_NOT_YET };
    if (!ctx.data?.sources) return { value: null, format: fmt };
    const o = kpiValue(bind, ctx.data.range, ctx.data.sources);
    if (o.error) return { value: null, error: o.error, format: fmt };
    return { value: o.value, warned: false, format: fmt };
  }
  // A cm-bearing binding is never handed to the delivery engine (§2.2): `cmIm` is no field of
  // it, and the population it counts is the mapping's rather than the pacing's. Five slots
  // arrive here (a block's value, its target, a progress marker, a stat-row cell, a badge)
  // and all five are WINDOW numbers, so all five read `totals` on the reader the Layout
  // context carries.
  const marker = cmMarkerOf(bind.expr);
  if (marker) {
    // §2.4's field-set gate, run here for the reason `report-render.js` runs it at all seven of
    // its cm slots: `cmMarkerOf` counts any non-comparison identifier as a plan field, so
    // `cmIm / sp` would fetch the window's scalars, find no `sp`, read it as absent — 0, by the
    // formula canon — and print a computed number where the KPI beside it draws a dash with
    // this very sentence. Only a spec that never passed the client draft gate can carry one (a
    // Library copy, a hand-written JSON, a direct API write), which is the case the gate is
    // for. The shape is the delivery engine's own refusal shape below, so the tile cannot tell
    // a refused CM360 expression from a refused delivery one.
    const badField = cmFieldRefusal(marker, FIELDS_PLAN);
    if (badField) return { value: null, error: badField, format: fmt };
    // No reader: the file has not landed (`ctx.cmPendingRead` true), or there is nothing to
    // wait for at all — a dashboard dimension/platform filter has masked the bundle, or this
    // tile never asked for one. Either way the cell draws the em dash and KEEPS ITS PLACE.
    // `absent` is «this campaign has no goal of that kind», which drops a stat-row cell
    // outright, and the cell would pop back the moment the file arrived (§2.7). `pending`
    // mirrors `ctx.cmPendingRead` exactly, so a masked bundle (not pending, just refused)
    // never reads as "waiting for the file" to a caller that tells the two apart.
    if (!ctx.cmRead) return { value: null, pending: !!ctx.cmPendingRead, format: fmt };
    // Only a formula that names a plan field pays for the window's plan, and it reads the one
    // function every window slot reads (§2.4): `campaignWindowScalars` is memoised per
    // (snapshot, window), so thirty blocks are one window computation, which is this file's
    // own rule. With no sources the door answers null, and a plan identifier then has nothing
    // to read. Evaluating anyway would read that identifier as absent, which the formula
    // canon then reads as 0 — printing "0.00%" for a plan nobody published. The cell draws
    // the same silence every other unanswered CM360 number draws instead.
    const scalars = marker.planFields.length
      ? campaignWindowScalars(ctx.data?.range, ctx.data?.sources) : null;
    if (marker.planFields.length && !scalars) return { value: null, format: fmt };
    return { value: cmEvalAt(marker, (metric) => ctx.cmRead.totals(metric), scalars), format: fmt };
  }
  if (!ctx.data?.sources) return { value: null, format: fmt };
  const o = kpiValue({ expr: bind.expr }, ctx.data.range, ctx.data.sources);
  if (o.error) return { value: null, error: o.error, format: fmt };
  return { value: o.value, warned: o.warned, format: fmt };
}

/**
 * brickValue(brick, ctx) → { value, target, invert, format, sub, error, warned, absent, pending }.
 * An explicit `target` bind wins over the metric's canonical one — and when it is itself
 * a metric, what is taken is that metric's VALUE, not its target: "margin against
 * pacing" means the pacing number. So does an explicit `format` over the preset's.
 * `null` values are honest — the caller renders an em dash, never a 0 that reads as real
 * delivery. `pending` is the CM360 file-not-landed-yet flag the spec's shape carries (§2.7):
 * true only while a requested bundle is still in flight, never for a masked or refused one.
 *
 * ONE exception, and the built-in hero depends on it: a target naming the SAME metric
 * as the value ("margin against margin") is the metric measured against ITS OWN target,
 * because a number compared with itself is a delta of zero and means nothing. That is
 * what the standard hero's margin gauge, its badge and the Margin card's meter are
 * written as (std-entries.js:155-158, :213-215) — read literally they would all sit at
 * "On target" forever, on every campaign.
 */
export function brickValue(brick, ctx) {
  const c = ctx || {};
  const v = bindValue(brick && brick.bind, c);
  const selfTarget = !!(brick && brick.target && brick.bind
    && brick.target.metric != null && brick.target.metric === brick.bind.metric);
  const t = (brick && brick.target && !selfTarget) ? bindValue(brick.target, c) : null;
  return {
    value: v.value,
    target: t ? t.value : (v.target ?? null),
    // A self-target keeps the METRIC's own invert: the target being read is the metric's
    // own, so its direction is the metric's too. `bind: cpm, target: cpm` with the
    // brick's default `invert:false` would tone a cost metric backwards — cheaper CPM
    // shown red — and the constructor offers every metric to every brick.
    invert: selfTarget ? !!v.invert : (brick && brick.target ? !!brick.invert : !!v.invert),
    format: (brick && brick.format && brick.format !== 'auto') ? brick.format : (v.format || 'auto'),
    sub: v.sub || null,
    error: v.error || null,
    warned: !!v.warned,
    absent: !!v.absent,
    // «The file has not landed yet» (mirrors `ctx.cmPendingRead`), which is NOT `absent`: the
    // cell is drawn, wearing the em dash every other unanswered CM360 number wears (§2.7). A
    // masked or never-requested bundle draws the same dash but is NOT pending — there is
    // nothing left to wait for — so a caller can tell the two silences apart.
    pending: !!v.pending,
  };
}

/**
 * A progress bar's MARKER → the brickValue shape, in the format it prints in.
 *
 * In order: the author's `tickFormat`; the marker's OWN unit (a bare `expCo` or a canonical
 * metric, as the Standard bars print today; a bare field or chip the catalogue names, so the
 * editor's default `expIm` is a whole count on any bar); and only then the bar's, because a
 * formula has no unit of its own and the marker stands on the bar's scale (its place is
 * marker / target): the bar value's format or unit, then the bar target's. A formula over a
 * bar of formulas has no unit anyone can name and stays `auto` until the author picks one.
 * Feedback 2026-10-02: «needed today · 3,038.16» on a clicks bar, «5,311.48» with no $ on a
 * budget one.
 */
export function tickValue(brick, ctx, bar) {
  const c = ctx || {};
  const tick = brickValue({ bind: brick && brick.tick }, c);
  if (!brick || !brick.tick) return tick;
  const format = knownFormat(brick.tickFormat)
    || knownFormat(tick.format) || impliedFormat(brick.tick)
    || knownFormat((bar || brickValue(brick, c)).format) || impliedFormat(brick.bind)
    || (brick.target ? knownFormat(bindValue(brick.target, c).format) || impliedFormat(brick.target) : null);
  return format ? { ...tick, format } : tick;
}

/** A statRow cell is a brick with fewer opinions. */
export function cellValue(cell, ctx) {
  return brickValue({ bind: cell && cell.bind, format: cell && cell.format }, ctx);
}

/**
 * The signed distance a value sits from its reference, in the reference's own units —
 * the one number every status word, tone and fill in this file is derived from.
 * `invert` flips it for cost-like metrics, where under is over.
 */
export function deltaOf(out) {
  if (out == null || out.value == null || out.target == null) return null;
  const d = out.value - out.target;
  return out.invert ? -d : d;
}

/**
 * ONE cm-bearing mini-chart line, over the calendar the engine built for the lines beside it.
 *
 * A day the join has no row for BREAKS the line, exactly as the CM360 column beside it prints
 * a dash: the mask is what carries that fact through `cumsum` and `rolling` (§2.9), which is
 * why this goes through `evaluateMaskedSeries` and not `evaluateSeries` — absence-is-zero
 * would start a running total on days the comparison says nothing about.
 *
 * A plan field reads the WINDOW's scalars, the same ones a date row reads (§2.4: only a
 * dimension row has a plan of its own). Unlike `bindValue`, this reads `scalars` with no
 * explicit "no plan is silence" check: `campaignWindowScalars` answers null only for missing
 * `sources` (its own docblock), and `miniSeries`'s `!ctx.data?.sources` early return already
 * keeps that case from reaching here, so `scalars` is always a real object by this line.
 */
function cmMiniLine(line, marker, dates, ctx) {
  // The same §2.4 gate `bindValue` runs one function up, and for the same reason: the plan half
  // of this line is the WINDOW's, so a field the window publishes none of can never be read,
  // and evaluating anyway would draw a computed zero down an axis the column beside it refuses
  // by name. `error` rides the line the way `bindValue`'s rides a block — the chart draws no
  // points for it, and the formula preview prints the sentence.
  const badField = cmFieldRefusal(marker, FIELDS_PLAN);
  if (badField) return { id: line.id, label: line.label, values: dates.map(() => null), warned: false, error: badField };
  if (!ctx.cmRead) return { id: line.id, label: line.label, values: dates.map(() => null), warned: false };
  const pairs = new Map();
  for (const read of marker.reads) {
    if (pairs.has(read.metric)) continue;
    pairs.set(read.metric, dates.map((date) => ctx.cmRead.atDate(read.metric, date)));
  }
  const scalars = marker.planFields.length
    ? campaignWindowScalars(ctx.data.range, ctx.data.sources) : null;
  const out = evaluateMaskedSeries(marker.ast, cmSeriesContext(pairs, scalars));
  return {
    id: line.id,
    label: line.label,
    values: out.values.map((value, i) => (out.present[i] ? value : null)),
    warned: !!out.warned,
  };
}

/**
 * The series a `miniChart` draws, through the SAME evaluator a custom chart uses.
 *
 * The cm-bearing lines are held OUT of the engine call and spliced back at their own index
 * (§2.7). The delivery engine has no field called `cmIm`, so handing it one would draw
 * «Unknown field» where a line belongs; and the engine still builds the continuous calendar
 * (it does so for an empty expression list too), which is what puts a CM360 line and a
 * delivery line on ONE axis instead of two charts that happen to sit side by side.
 */
export function miniSeries(brick, ctx, withDates = false) {
  const list = (brick && Array.isArray(brick.series)) ? brick.series : [];
  if (!list.length || !ctx || !ctx.data?.sources) return [];
  const markers = list.map((line) => (line && typeof line.expr === 'string' ? cmMarkerOf(line.expr) : null));
  const built = buildSeriesModel(list.filter((line, i) => !markers[i]), ctx.data.range, ctx.data.sources);
  let engine = 0;
  const series = list.map((line, i) => (markers[i]
    ? cmMiniLine(line, markers[i], built.dates, ctx)
    : built.series[engine++]));
  return withDates ? series.map((line) => ({ ...line, dates: built.dates })) : series;
}

/* ── canonical series ─────────────────────────────────────────────────────── */

/**
 * The delivery units this campaign actually has, each with everything a UnitBar draws.
 * Lifted from OverviewBlock1's three parallel blocks (:211-227 impressions, :409-426
 * clicks and views) — one loop instead of three copies, and the ONLY place the pace
 * arithmetic lives now. `hasPlan:false` is the NoPlanRow case (:447, :460): a unit that
 * delivers against no goal shows its count and no bar, because there is no pace to be
 * on or off.
 *
 * Each row's actual, expected and plan are ONE population: the lines bought in that unit.
 * The Clicks row reads `clicksActual` (the click-paced lines' clicks), never `cl`, which counts
 * every line's clicks: on a CPM + CPC pacing `cl` put the CPM lines' clicks over the CPC
 * lines' plan and read +558.85 pp «Ahead of pace» where the CPC lines were at +2.55 pp, beside
 * an «Actual to date» card and a verdict that already read `clicksActual` (review 2026-09-23).
 */
export function deliveryUnits(cm, units) {
  if (!cm) return [];
  const rows = [
    { unit: 'Impressions', show: !!cm.hasImpr, plan: cm.pI || 0, actual: cm.im || 0, expected: cm.eI || 0 },
    { unit: 'Clicks', show: !!cm.hasClicks, plan: cm.planClicks || 0, actual: cm.clicksActual ?? cm.cl ?? 0, expected: cm.eCl || 0 },
    { unit: 'Views', show: !!cm.hasViews, plan: cm.viewsPlan || 0, actual: cm.viewsActual || 0, expected: cm.viewsExpected || 0 },
  ];
  const selected = Array.isArray(units) ? units.map((unit) => rows.find((row) => row.unit.toLowerCase() === unit)).filter(Boolean) : rows;
  // «Plan not set» is a fact about the FLIGHT (hasPlan above). `r.plan` is the window's —
  // equal to the flight's unless the viewer narrowed it — and a window holding none of it is
  // not a «plan not set» row either: it is `noWindowPlan`, which UnitBar draws as the count
  // and «no plan in this window», with no bar. Drawn as a bar it read «Actual 0.0% / Plan
  // 0.0% · +0.0 pp on plan · On track» beside the Delivery reading's em dash (review
  // 2026-09-23); there is no pace to be on or off, the NoPlanRow's own reason.
  const flightPlan = { Impressions: 'impr', Clicks: 'clicks', Views: 'views' };
  return selected.filter((r) => r.show).map((r) => {
    const planned = hasPlan(cm, flightPlan[r.unit]);
    const onPlan = planned && r.plan > 0;
    // Division by zero returns 0 — the canonical rule, and the reason a plan-less unit
    // reads "plan not set" rather than "0.0% behind".
    const paceDelta = onPlan ? ((r.actual - r.expected) / r.plan) * 100 : 0;
    return {
      unit: r.unit,
      plan: r.plan,
      actual: r.actual,
      expected: r.expected,
      hasPlan: planned,
      noWindowPlan: planned && !onPlan,
      paceDelta,
      plannedPct: onPlan ? (r.expected / r.plan) * 100 : 0,
      actualPct: onPlan ? (r.actual / r.plan) * 100 : 0,
      status: paceStatus(paceDelta),
      opText: paceWord(paceDelta),
    };
  });
}

/**
 * The rate types this campaign runs, exactly as OverviewBlock2:109-124 builds them:
 * each rate derived from its OWN budget bucket (metrics.js), never from the total.
 */
function rateTypes(cm, flCM) {
  const ac = cm || {};
  const pl = flCM || {};
  const out = [];
  if (ac.hasImpr) {
    out.push({
      unit: 'CPM', planRate: pl.clientPlanCpm, bidPlan: pl.bidPlanCpm, bidFact: ac.bidFact2dCpm,
      earned: (ac.imprActual || 0) * (pl.clientPlanCpm || 0) / 1000,
    });
  }
  if (ac.hasClicks) {
    out.push({
      unit: 'CPC', planRate: pl.clientPlanCpc, bidPlan: pl.bidPlanCpc, bidFact: ac.bidFact2dCpc,
      earned: (ac.clicksActual || 0) * (pl.clientPlanCpc || 0),
    });
  }
  if (ac.hasViews) {
    out.push({
      // Earned @ Plan CPV = CPV completes × the CPV rate. cpvViewsActual is CPV-only —
      // views/CPV is strictly per-CPV line item (OverviewBlock2:121).
      unit: 'CPV', planRate: pl.clientPlanCpv, bidPlan: pl.bidPlanCpv, bidFact: ac.bidFact2dCpv,
      earned: (ac.cpvViewsActual || 0) * (pl.clientPlanCpv || 0),
    });
  }
  return out;
}

/**
 * The rate types this campaign runs, with the four series OverviewBlock2 repeats over
 * (:157 planRate, :166 bidPair, :214 earned, :217 dynamic). One row shape out of all
 * four so RateRows draws them without knowing which series it holds:
 *   {kind:'row', label, value}      a labelled figure
 *   {kind:'money', label, usd}      a CLIENT-side figure, which carries two currencies
 *   {kind:'pair', left, right, delta}
 * `planRate` and `dynamic` skip the CPM entry on purpose: the Finance card shows it in
 * the pair above the repeat (:153 clientPlanCpm, :210 dynCpm), and printing it twice is
 * how the block would grow a duplicate row. The block skipped "the first" instead,
 * which is the same row on an impression-paced pacing and the WRONG one on a CPC-only
 * pacing — there the pair's own cell is empty and the CPC rate belongs in the repeat.
 */
export function rateTypeRows(cm, flCM, series, opts) {
  const requested = opts?.units;
  const all = rateTypes(cm, flCM);
  const types = Array.isArray(requested) ? requested.map((unit) => all.find((row) => row.unit === unit)).filter(Boolean) : all;
  // Net cost mode (spec 2026-09-07 §7): the client plan rates and the earned figures
  // are client money, and on a net pacing the numbers printed here are the NET ones —
  // they are derived from the stored (net) plan budget. They draw no gross twin, so
  // the caption is what tells them apart from the «(gross)» rows in the same card.
  const netMode = !!(opts && opts.netMode);
  if (series === 'planRate') {
    return types.filter((t) => Array.isArray(requested) || t.unit !== 'CPM')
      .map((t) => ({ kind: 'row', label: basisLabel(`Plan ${t.unit}`, 'net', netMode), value: f$(t.planRate), ...(opts?.highlightReadings ? { numeric: t.planRate } : {}) }));
  }
  if (series === 'earned') {
    return types.filter((t) => t.earned > 0)
      .map((t) => ({ kind: 'row', label: basisLabel(`Earned @ Plan ${t.unit}`, 'net', netMode), value: f$(t.earned), ...(opts?.highlightReadings ? { numeric: t.earned } : {}) }));
  }
  if (series === 'bidPair') {
    return types.map((t) => {
      const d = (t.bidFact || 0) - (t.bidPlan || 0);
      return {
        kind: 'pair',
        unit: t.unit,
        left: { label: `Bid Plan ${t.unit}`, value: f$(t.bidPlan), ...(opts?.highlightReadings ? { numeric: t.bidPlan } : {}) },
        right: { label: `Bid Fact 2d ${t.unit}`, value: f$(t.bidFact), ...(opts?.highlightReadings ? { numeric: t.bidFact, target: t.bidPlan } : {}) },
        // Buying UNDER the planned bid is the good news, so `good` is not `d >= 0`.
        delta: (t.bidPlan || 0) > 0 ? { text: `${d >= 0 ? '+' : ''}${f$(d)} vs plan`, good: d <= 0 } : null,
      };
    });
  }
  if (series === 'dynamic') {
    // Coef-gated wording (spec §8): on a coefficient-cost pacing the dc-based rates are
    // the client's REAL cost, so "Dyn CPM" becomes "Client CPM" (OverviewBlock2:140).
    // On a NET pacing the row leads with the gross rate (spec 2026-09-07 §7), so the
    // label says which of the two dollar figures is the big one.
    const coefMode = !!(opts && opts.coefMode);
    const labels = coefLabels(coefMode, netMode);
    // The same names with no basis suffix, for the rows that draw no pair.
    const plain = coefLabels(coefMode, false);
    const ac = cm || {};
    const parts = [];
    // CPM is the pair's cell (the stored binding is `dynCpm`), so the repeat carries
    // the others — see the note above.
    for (const unit of (Array.isArray(requested) ? requested : ['CPC', 'CPV', 'CPA'])) {
      const u = unit[0] + unit.slice(1).toLowerCase();
      const v = ac[`dyn${u}`];
      // The gross twin rides along (net cost mode, spec §7): a dynamic client rate is
      // computed off net dc, so on a net pacing the row leads with the client's own
      // gross rate and says the net one underneath. campM carries both (metrics.js).
      //
      // The basis is decided PER ROW, not per pacing: a rate whose gross equals its net
      // (every line item behind it bills at gross) draws no second line, and «(gross)»
      // over that lone figure would name the wrong basis — it is the net number, and on
      // a net pacing it says so. `showsGrossPair` is MoneyValue's own predicate, asked
      // here so the caption and the figure below it can never disagree.
      const g = ac[`dyn${u}Gross`] ?? null;
      // Primary conversions (spec 2026-09-13 §6): campM answers null, not 0, when a line item
      // in view cannot show conversions. That is a number the card expected and did not get,
      // so the row stays and says why, instead of disappearing like a zero rate.
      if (unit === 'CPA' && v === null) {
        parts.push({ kind: 'money', label: basisLabel(plain.dyn('CPA'), 'net', netMode), usd: null, gross: null,
          reason: cvUnavailableText(ac.cvUnavailableCount) });
        continue;
      }
      if (v > 0) {
        const name = u.toUpperCase();
        const label = showsGrossPair({ usd: v, role: 'client', gross: g })
          ? labels.dyn(name)
          : basisLabel(plain.dyn(name), 'net', netMode);
        parts.push({ kind: 'money', label, usd: v, gross: g });
      }
    }
    // Spec §7: which source the conversion rates use, after the other rows and only when
    // there are some. Not operative, or no line item in view with a choice: nothing added.
    if (opts && opts.primaryCvOperative && parts.length > 0 && (ac.cvPrimaryCount || 0) > 0) {
      parts.push({ kind: 'note', text: primaryCvNoteText(ac.cvPrimaryCount, ac.cvDataCount) });
    }
    return parts;
  }
  return [];
}

/**
 * The four caption lines these blocks compute rather than state:
 * the hero footer (OverviewBlock1:537), the Margin signal's subtitle (:480) and its
 * delta line (:505), and the Delivery subtitle that changes wording with the unit
 * count (:436).
 */
export function canonicalNote(source, cm, flCM, effLIs, facts) {
  if (!cm || !flCM) return '';
  if (source === 'flightPosition' || source === 'flightRemaining') {
    const progress = flightProgress(cm, flCM, effLIs);
    return source === 'flightPosition' ? `Day ${progress.day} / ${progress.total}` : progress.daysLeftText;
  }
  if (source === 'flightDays') {
    const f = flightProgress(cm, flCM, effLIs);
    return `Day ${f.day} of ${f.total} · ${f.daysLeft} days left`;
  }
  if (source === 'marginTarget') return `Target ${fP(flCM.mT)}`;
  if (source === 'marginDelta') {
    // The same guard the big number takes (NEEDS_DELIVERY): with no delivered day
    // there is no margin, and a delta against nothing is noise.
    if (facts && !facts.asOf) return 'No delivery yet; margin appears with the first spend.';
    return `${fPP((cm.mA || 0) - (flCM.mT || 0))} vs target`;
  }
  if (source === 'deliverySubtitle') {
    const n = (cm.hasImpr ? 1 : 0) + (cm.hasClicks ? 1 : 0) + (cm.hasViews ? 1 : 0);
    return n > 1 ? 'Plan vs Fact pace by units' : 'Plan Pace vs Fact Pace';
  }
  return '';
}

/** The status word + band the `marginDelta` line is coloured by (OverviewBlock1:232). */
export function marginTone(cm, flCM, facts) {
  if (!cm || !flCM || (facts && !facts.asOf)) return null;
  return marginStatus((cm.mA || 0) - (flCM.mT || 0));
}

/* ── the six canonical DetailCard bodies ─────────────────────────────────── */

/**
 * The latest delivered day's units and spend — OverviewBlock1:248-266, lifted onto the
 * widget-data sources so the loop runs once per tile instead of once per block.
 * campM carries latestDayImpr/Clicks/Views already (metrics.js:641, promoted from this
 * very loop); the SPEND has no campM key, and reading three numbers from one place and
 * the fourth from another is how two of them end up describing different days.
 */
function latestDayUnits(sources, asOf) {
  const out = { im: 0, cl: 0, co: 0, sp: 0 };
  if (!asOf || !sources || !sources.liDaily) return out;
  for (const id of sources.effLIs || []) {
    const p = (sources.liPlan || {})[id];
    if (p && p.fs && p.fe && (asOf < p.fs || asOf > p.fe)) continue;
    const dd = (sources.campaignLiDaily || sources.liDaily || {})[id];
    const day = dd && dd[asOf];
    if (!day) continue;
    out.sp += day.sp || 0;
    const rt = (p && p.rateType) || 'CPM';
    if (rt === 'CPC') out.cl += day.cl || 0;
    else if (rt === 'CPV') out.co += day.co || 0;
    else out.im += day.im || 0;
  }
  return out;
}

/** One stacked value line: a number, its unit word, and the explainer under it. */
const detailLine = (value, unit, note) => ({ value, unit: unit || null, note: note || null });
const muted = (text) => ({ value: text, unit: null, note: null, muted: true });

/**
 * The six DetailCard bodies of OverviewBlock1 (:322 planUnits, :355 planRate,
 * :394 actualUnits, :582 neededPerDay, :619 latestDay, :626 opRead), lifted whole.
 * → { lines: [{value, unit, note, muted}], sub }
 *
 * The day these cards interpolated into four of their LABELS ("Actual by 14 Aug") now
 * rides the SUB: a stored label is a literal a user may rename, and the card that draws
 * the numbers is what knows which day they are from (§7 Conversion, std-entries note).
 */
export function detailSource(source, ctx, withReadings = false) {
  const line = (value, unit, note, numeric, target) => ({
    ...detailLine(value, unit, note),
    ...(withReadings ? { numeric: numeric ?? null, target: target ?? null } : {}),
  });
  const cm = ctx && ctx.cm;
  const flCM = ctx && ctx.flCM;
  if (!cm || !flCM) return { lines: [], sub: null };
  const asOf = ctx.facts ? ctx.facts.asOf : null;
  const day = asOf ? fDs(asOf) : EM;
  const showImpr = !!cm.hasImpr;
  const showClicks = !!cm.hasClicks;
  const showViews = !!cm.hasViews;
  // Whether a unit HAS a plan is a fact about the flight (hasPlan), so a narrowed window
  // holding none of the clicks plan does not print «Clicks plan not set» (2026-09-23).
  const clicksHasPlan = hasPlan(cm, 'clicks');
  const viewsHasPlan = hasPlan(cm, 'views');
  const flightEnded = (flCM.daysLeft || 0) <= 0;

  if (source === 'planUnits') {
    // «Flight Plan units» (the card's own note: the full-flight plan from NetSuite) — the
    // whole flight's, whatever window the viewer narrowed. flCM, never the window's cm.
    const planClicks = flCM.planClicks || 0;
    return {
      lines: [
        showImpr ? line(fI(flCM.pI), 'impr', null, flCM.pI) : null,
        showClicks ? (planClicks > 0 ? line(fI(planClicks), 'clicks', null, planClicks) : muted('Clicks plan not set')) : null,
        showViews ? line(fI(flCM.viewsPlan), 'views', null, flCM.viewsPlan) : null,
      ].filter(Boolean),
      sub: null,
    };
  }

  if (source === 'planRate') {
    const imprPlanDaily = flCM.imprPlanDailyRate ?? flCM.planDailyRate ?? 0;
    const imprEnded = flCM.imprPlanDailyEnded ?? flCM.planDailyEnded;
    const imprSub = imprEnded
      ? 'Impr · flight ended · avg rate.'
      : cm.daysInSplit > 0
        ? `${fI(cm.planForCurrentSplit)} ÷ ${cm.daysInSplit} days.`
        : 'Daily impressions plan (split-aware).';
    const sub = showImpr
      ? imprSub
      : showClicks
        ? (clicksHasPlan ? 'Daily clicks plan (split-aware).' : EM)
        : showViews
          ? (viewsHasPlan ? 'Daily views plan (split-aware).' : EM)
          : EM;
    return {
      lines: [
        showImpr ? line(`${fI(imprPlanDaily)}/day`, 'impr', null, imprPlanDaily) : null,
        showClicks
          ? (clicksHasPlan ? line(`${fI(flCM.clicksPlanDailyRate ?? 0)}/day`, 'clicks', null, flCM.clicksPlanDailyRate ?? 0) : muted('Clicks plan not set'))
          : null,
        showViews
          ? (viewsHasPlan ? line(`${fI(flCM.viewsPlanDailyRate ?? 0)}/day`, 'views', null, flCM.viewsPlanDailyRate ?? 0) : muted('Views plan not set'))
          : null,
      ].filter(Boolean),
      sub: `On ${day} · ${sub}`,
    };
  }

  if (source === 'actualUnits') {
    const imA = cm.imprActual ?? cm.im ?? 0;
    const imE = cm.imprExpected ?? cm.eI ?? 0;
    const clA = cm.clicksActual ?? cm.cl ?? 0;
    const clE = cm.clicksExpected ?? cm.eCl ?? 0;
    const vwA = cm.viewsActual ?? 0;
    const vwE = cm.viewsExpected ?? 0;
    // The note judges the first unit shown. A window holding none of that unit's plan has
    // nothing to be «on target» against: 0 expected beside 0 delivered read «Impr on target.»
    const noteUnit = showImpr ? 'impr' : showClicks ? 'clicks' : showViews ? 'views' : null;
    let sub;
    if (noteUnit && noWindowPlan(cm, noteUnit)) {
      sub = 'No plan in this window.';
    } else if (showImpr) {
      sub = imA < imE ? `${fI(Math.round(imE - imA))} impr below expected.`
        : imA > imE ? `${fI(Math.round(imA - imE))} impr above expected.` : 'Impr on target.';
    } else if (showClicks) {
      sub = clA < clE ? `${fI(Math.round(clE - clA))} clicks below expected.`
        : clA > clE ? `${fI(Math.round(clA - clE))} clicks above expected.` : 'Clicks on target.';
    } else if (showViews) {
      sub = vwA < vwE ? `${fI(Math.round(vwE - vwA))} views below expected.`
        : vwA > vwE ? `${fI(Math.round(vwA - vwE))} views above expected.` : 'Views on target.';
    } else sub = 'No plan.';
    return {
      lines: [
        showImpr ? line(fI(imA), 'impr', null, imA, imE) : null,
        showClicks ? line(fI(clA), 'clicks', null, clA, clE) : null,
        showViews ? line(fI(vwA), 'views', null, vwA, vwE) : null,
      ].filter(Boolean),
      sub: `By ${day} · ${sub}`,
    };
  }

  if (source === 'neededPerDay') {
    const imprNeeded = flCM.neededPerDayImpr ?? flCM.neededPerDay ?? 0;
    const clicksNeeded = flCM.neededPerDayClicks ?? 0;
    const viewsNeeded = flCM.neededPerDayViews ?? 0;
    const spendNeeded = flCM.neededSpendPerDay ?? 0;
    // The notes explain the headline beside them with its own terms (metrics.js, the
    // neededPerDay* sums and their `needed*Basis`, 2026-09-29): what the running lines below
    // plan still have to deliver, each over its own days left. When those lines share one days
    // left, the note is the headline times the days, «X ÷ N days»; otherwise it says how many
    // lines it sums. Every term is flCM's, never the window's delivery against the flight's plan.
    const imP = flCM.imprPlan ?? flCM.pI ?? 0;
    const clP = flCM.clicksPlan ?? flCM.planClicks ?? 0;
    const vwP = flCM.viewsPlan ?? 0;
    const needNote = (plan, basis, word) => {
      if (!(plan > 0)) return null;
      const b = basis || { left: 0, lines: 0, days: null };
      if (!(b.lines > 0)) return `No ${word} left to deliver on running line items.`;
      return b.days != null
        ? `${fI(b.left)} ${word} ÷ ${b.days} days.`
        : `${fI(b.left)} ${word} left on ${b.lines} line items, each over its own days left.`;
    };
    // The per-type breakdown of the needed spend (:571-574): needed units × that rate
    // type's 2-day buying rate, which is what neededSpendPerDay actually sums.
    const parts = [];
    if (showImpr && imprNeeded > 0 && (flCM.bidFact2dCpm || 0) > 0) parts.push(`${fI(imprNeeded)} impr × ${f$(flCM.bidFact2dCpm)} CPM ÷ 1000`);
    if (showClicks && clicksNeeded > 0 && (flCM.bidFact2dCpc || 0) > 0) parts.push(`${fI(clicksNeeded)} clicks × ${f$(flCM.bidFact2dCpc)}`);
    if (showViews && viewsNeeded > 0 && (flCM.bidFact2dCpv || 0) > 0) parts.push(`${fI(viewsNeeded)} views × ${f$(flCM.bidFact2dCpv)}`);
    const note = (t) => (flightEnded ? null : t);
    return {
      lines: [
        showImpr ? line(`${fI(imprNeeded)}/day`, 'impr', note(needNote(imP, flCM.neededImprBasis, 'impr')), imprNeeded) : null,
        showClicks
          ? (clicksHasPlan
            ? line(`${fI(clicksNeeded)}/day`, 'clicks', note(needNote(clP, flCM.neededClicksBasis, 'clicks')), clicksNeeded)
            : muted('Clicks plan not set'))
          : null,
        showViews
          ? (viewsHasPlan
            ? line(`${fI(viewsNeeded)}/day`, 'views', note(needNote(vwP, flCM.neededViewsBasis, 'views')), viewsNeeded)
            : muted('Views plan not set'))
          : null,
        spendNeeded > 0 ? line(`${f$(spendNeeded)}/day`, 'spend', note(parts.length ? `${parts.join(' + ')}.` : null), spendNeeded) : null,
      ].filter(Boolean),
      sub: flightEnded ? 'Flight ended; no daily target remaining.' : `Rates needed on ${day}.`,
    };
  }

  if (source === 'latestDay') {
    const d = latestDayUnits(ctx.data && ctx.data.sources, asOf);
    const imprNeeded = flCM.neededPerDayImpr ?? flCM.neededPerDay ?? 0;
    const clicksNeeded = flCM.neededPerDayClicks ?? 0;
    const viewsNeeded = flCM.neededPerDayViews ?? 0;
    const spendNeeded = flCM.neededSpendPerDay ?? 0;
    // No asOf = no delivered day to judge — a "below daily target" verdict before the
    // first data day is noise, not a reading (:609-611).
    const noDeltas = flightEnded || !asOf;
    const cnt = (v) => {
      const r = Math.round(v);
      return r < 0 ? `${fI(Math.abs(r))} below daily target.`
        : r > 0 ? `${fI(r)} above daily target.` : 'On daily target.';
    };
    const spendUnder = d.sp - spendNeeded;
    const money = spendUnder < 0 ? `${f$(Math.abs(spendUnder))} below daily target.`
      : spendUnder > 0 ? `${f$(spendUnder)} above daily target.` : 'On daily target.';
    return {
      lines: [
        showImpr ? line(fI(d.im), 'impr', noDeltas ? null : cnt(d.im - imprNeeded), d.im, noDeltas ? null : imprNeeded) : null,
        showClicks ? line(fI(d.cl), 'clicks', noDeltas || !clicksHasPlan ? null : cnt(d.cl - clicksNeeded), d.cl, noDeltas || !clicksHasPlan ? null : clicksNeeded) : null,
        showViews ? line(fI(d.co), 'views', noDeltas || !viewsHasPlan ? null : cnt(d.co - viewsNeeded), d.co, noDeltas || !viewsHasPlan ? null : viewsNeeded) : null,
        d.sp > 0 ? line(f$(d.sp), 'spend', noDeltas || spendNeeded <= 0 ? null : money, d.sp, noDeltas ? null : spendNeeded) : null,
      ].filter(Boolean),
      sub: flightEnded ? 'Flight ended.' : (!asOf ? 'No delivery data yet.' : `Delivered on ${day}.`),
    };
  }

  if (source === 'opRead') {
    // The PRIMARY delivery unit (:221-227): impressions, else views, else clicks — so a
    // CPV-only or CPC-only campaign is not judged against an impressions plan it does
    // not have. Each fallback checks its OWN plan, or a goal-less unit wins the vote.
    // primaryUnit makes that choice on the whole-flight plans; the delta is over the
    // window's plan (2026-09-23), and a window holding none of it has no pace to read: the
    // card says so, uncoloured, where a delta of 0 used to print a green «On track».
    const u = primaryUnit(cm);
    if (noWindowPlan(cm, u)) {
      return {
        lines: [muted('No plan in this window')],
        status: null,
        sub: 'This window holds none of the plan, so there is no pace to read.',
      };
    }
    const planU = u === 'impr' ? (cm.pI || 0) : u === 'clicks' ? (cm.planClicks || 0) : (cm.viewsPlan || 0);
    // Clicks: the click-paced lines' own clicks, the population the clicks plan and expected
    // count (deliveryUnits' note) — never `cl`, every line's.
    const actU = u === 'impr' ? (cm.im || 0) : u === 'clicks' ? (cm.clicksActual ?? cm.cl ?? 0) : (cm.viewsActual || 0);
    const expU = u === 'impr' ? (cm.eI || 0) : u === 'clicks' ? (cm.eCl || 0) : (cm.viewsExpected || 0);
    const primaryDelta = hasPlan(cm, u) && planU > 0 ? ((actU - expU) / planU) * 100 : 0;
    return {
      lines: [line(paceWord(primaryDelta), null, null, primaryDelta)],
      status: paceStatus(primaryDelta),
      sub: primaryDelta > 5
        ? 'Latest day exceeded the daily target. Overall pace is ahead.'
        : primaryDelta >= -2
          ? 'Latest day is near the daily target. Overall pace is within range.'
          : primaryDelta >= -5
            ? 'Latest day missed the daily target. Overall pace is slightly behind.'
            : 'Latest day missed the daily target. Overall pace is behind.',
    };
  }

  return { lines: [], sub: null };
}

/** The live campaign verdict a `header` brick draws — VerdictHero.jsx:21-40, lifted. */
export function verdictOf(ctx) {
  const cm = ctx && ctx.cm;
  const flCM = ctx && ctx.flCM;
  if (!cm || !flCM) return null;
  // primaryUnit is the canonical choice (impressions, else views, else clicks — each
  // fallback gated on its OWN plan), shared with the ready cards.
  const unit = primaryUnit(cm);
  const F = UNIT_FIELDS[unit];
  const actual = cm[F.actual] || 0;
  const expected = cm[F.expected] || 0;
  const plan = cm[F.plan] || 0;
  const paceDelta = plan > 0 ? ((actual - expected) / plan) * 100 : 0;
  if (!(ctx.facts && ctx.facts.asOf)) {
    return { word: 'No delivery yet', status: 'n', reason: 'The verdict appears with the first delivered day.' };
  }
  if ((flCM.daysLeft || 0) <= 0) {
    // A header about the FLIGHT, so the flight's own totals — not a narrowed window's
    // delivery «of» the window's plan (2026-09-23) — and the flight's own pace for its colour,
    // or a 7-day window at −30 pp paints a flight that over-delivered red. On Flight the two
    // are one number: that window is the whole flight.
    const flActual = flCM[F.actual] || 0;
    const flPlan = flCM[F.plan] || 0;
    const flightDelta = flPlan > 0 ? ((flActual - (flCM[F.expected] || 0)) / flPlan) * 100 : 0;
    return {
      word: 'Flight ended',
      status: paceStatus(flightDelta),
      reason: `Delivered ${fI(flActual)} of ${fI(flPlan)} ${F.title.toLowerCase()}.`,
    };
  }
  // A window holding none of the primary unit's plan has no pace to judge. Read as a delta of
  // 0 it said «On track · 0% of plan-to-date» beside the unit bars' «no plan in this window»
  // (review 2026-09-23). Neutral, like «No delivery yet».
  if (noWindowPlan(cm, unit)) {
    return { word: 'No plan in this window', status: 'n', reason: `No ${F.title.toLowerCase()} are planned in this window.` };
  }
  const missedYesterday = (cm[F.latest] || 0) < (flCM[F.dailyRate] || 0);
  return {
    word: paceWord(paceDelta),
    status: paceStatus(paceDelta),
    reason: `${Math.round(cm[F.toDate] || 0)}% of plan-to-date.`
      + (missedYesterday ? ' Last day missed its daily plan.' : ''),
  };
}

/** Is any line item on the coefficient-cost model? (OverviewBlock2:93, for the labels.) */
export function coefModeOf(liPlan) {
  return anyCoef(liPlan);
}

/** Is any line item billed net of a ratio? (net cost mode, spec §7, for the labels.) */
export function netModeOf(liPlan) {
  return anyNet(liPlan);
}

/** The word band a live column badge prints (`pace` / `margin`). */
export function badgeWords(words, delta) {
  if (delta == null) return null;
  if (words === 'margin') return { text: marginWord(delta), status: marginStatus(delta) };
  return { text: paceWord(delta), status: paceStatus(delta) };
}
