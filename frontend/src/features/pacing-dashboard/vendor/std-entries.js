/**
 * std-entries.js — the 32 Standard canonical Widget templates.
 *
 * Runtime entries are ordinary schema-v2 Widgets: six strict Layout Views, thirteen
 * explicit Chart Views, nine explicit KPI Views and the four section widgets — Targets,
 * Delivery vs CM360, Breakdown and Daily Performance. A definition contains no preset,
 * component name or renderer selector. Choosing a template deep-clones this JSON and the
 * result is edited by the same Widget Builder as a scratch Widget.
 *
 * Template keys live in the closed `std:v2:*` catalog below. They are automation receipts
 * and Library shelf ids, never `lib`/`from` identity on a stored Widget.
 *
 * Definitions are already in the exact key order shared/report-v2.js and the production
 * validator store. tests/dashboard/std-entries.test.js proves byte-stable normalization,
 * strict Layout parity and the closed presentation/calculation seams for all 32.
 * Browser/Vite: globalThis.StdEntries; Node: module.exports.
 */
(function (root) {
"use strict";

/**
 * The build stamp. LibraryCard memoizes its live preview on `updated_at`; bump this BY
 * HAND in the same commit that changes any definition below, and never otherwise.
 */
var STD_VERSION = '2026-10-05 00:00:00.000000+00';

// Canonical chart order. `cpm` is deliberately present as its own Standard template.
var CHART_ORDER = [
  'cumImpr', 'cumSpend', 'dailyImpr', 'dailySpend', 'ctr', 'vcr', 'cpm', 'cpc', 'cpv',
  'cumClicks', 'dailyClicks', 'cumViews', 'dailyViews'
];
var CHART_NAMES = {
  cumImpr: 'Cumulative Impressions', cumSpend: 'Cumulative Spend vs Cost Budget',
  dailyImpr: 'Daily Impressions vs Expected', dailySpend: 'Daily Spend & CPM',
  ctr: 'CTR Trend', vcr: 'VCR Trend', cpm: 'CPM Trend', cpc: 'CPC Trend', cpv: 'CPV Trend',
  cumClicks: 'Cumulative Clicks', dailyClicks: 'Daily Clicks',
  cumViews: 'Cumulative Views', dailyViews: 'Daily Views vs Expected'
};
var CHART_DESCS = {
  cumImpr: 'Delivery to date against the expected curve.',
  cumSpend: 'Spend to date against the cost budget curve.',
  dailyImpr: 'Impressions per day against the daily plan.',
  dailySpend: 'Spend per day with CPM on the second axis.',
  ctr: 'Click-through rate per day, against the target.',
  vcr: 'Completion rate per day, against the target. Audio shows ACR.',
  cpm: 'Cost per thousand impressions per day, against the plan.',
  cpc: 'Cost per click per day, against the plan.',
  cpv: 'Cost per completed view per day, against the plan.',
  cumClicks: 'Clicks to date against the expected curve.',
  dailyClicks: 'Clicks per day against the daily plan.',
  cumViews: 'Views to date against the expected curve.',
  dailyViews: 'Views per day against the daily plan.'
};

// Canonical KPI order and formats. Every format is in the Report v2 brick grammar;
// the flight card is a composite Layout Widget, so it carries no standalone number format.
var PRESET_ORDER = ['margin', 'pacing', 'delivery', 'cpm', 'spend', 'ctr', 'vcr', 'cpc', 'cpv'];
var KPI_META = {
  margin: ['Margin', 'percent', 'Actual margin against the target.'],
  pacing: ['Pacing', 'pp', 'Delivery index against plan-to-date.'],
  delivery: ['Delivery', 'percent', 'Share of the plan delivered so far.'],
  cpm: ['CPM', 'money', 'Cost per thousand impressions against the plan.'],
  spend: ['Spend', 'money', 'Media spend against the cost budget.'],
  ctr: ['CTR', 'percent2', 'Click-through rate against the target.'],
  vcr: ['VCR', 'percent', 'Completion rate against the target.'],
  cpc: ['CPC', 'money', 'Cost per click against the plan.'],
  cpv: ['CPV', 'money4', 'Cost per completed view against the plan.']
};
// Canonical ready-card order; all three are ordinary Layout Widgets.
var CARD_ORDER = ['budget', 'marginbar', 'flight'];

// Seed slots (§9). ONE scale shared with the flow blocks, so the migration can lay a
// dashboard out in today's reading order without a second table:
//   100 launchPlan · 200 hero · 300 Finance · 400 alerts · 500 Targets · 600 lineItems
//   700+ charts · 800 3rd Party Data · 900 Breakdown · 1000 Daily Performance · 1100 journal
//   1200+ the KPI presets, then the ready cards — where seedLayout has always appended.
var SLOT_HERO = 200, SLOT_FINANCE = 300, SLOT_TARGETS = 500, SLOT_CHART = 700,
  SLOT_THIRD_PARTY = 800, SLOT_BREAKDOWN = 900, SLOT_DAILY = 1000, SLOT_KPI = 1200, SLOT_CARD = 1300;

function entry(key, name, description, definition, seedSlot) {
  return {
    id: key, key: key, kind: 'widget',
    name: name, description: description, definition: definition,
    owner_id: null, owner_name: 'Standard', standard: true,
    seedSlot: seedSlot, updated_at: STD_VERSION, deleted_at: null
  };
}
/** A column in normCol's own key order: span, frame, chrome text, then the bricks. */
function col(span, frame, title, bricks, extra) {
  var c = { span: span, frame: frame };
  if (title) c.title = title;
  if (extra && extra.sub) c.sub = extra.sub;
  if (extra && extra.badge) c.badge = extra.badge;
  c.bricks = bricks;
  return c;
}
function detail(label, source, sub) {
  var b = { type: 'detailCard', label: label, source: source };
  if (sub) b.sub = sub;
  return b;
}

// ── Standard hero (OverviewBlock1.jsx) ────────────────────────────────────────
// :305 grid 1fr 2fr 1fr with the middle holding two equal signals = four quarters at
// the same 14px gap. :322/:355/:394 are the left cards, :582/:619/:626 the right ones,
// :436 the Delivery signal, :480 the Margin signal, :537 the footer.
//
// The six detail labels are the block's own, minus the date it interpolates into four
// of them ("Plan rate on 14 Aug", "Actual by 14 Aug", "Needed on 14 Aug to be on
// pace", "Actual on 14 Aug"): a stored label is a literal a user may edit, and the day
// belongs to the canonical source that draws the numbers.
var HERO_STANDARD_ROWS = [
    { cols: [
      col(3, 'none', null, [
        detail('Flight Plan units', 'planUnits', 'Full-flight plan from NetSuite.'),
        detail('Plan rate', 'planRate'),
        detail('Actual to date', 'actualUnits')
      ]),
      col(3, 'signal', 'Delivery', [
        { type: 'note', align: 'start', source: 'deliverySubtitle' },
        { type: 'unitBars' }
      ]),
      col(3, 'signal', 'Margin', [
        { type: 'note', align: 'start', source: 'marginTarget' },
        { type: 'bigStat', bind: { metric: 'margin' }, target: { metric: 'margin' }, invert: false, format: 'percent' },
        { type: 'note', align: 'start', source: 'marginDelta' },
        { type: 'gauge', bind: { metric: 'margin' }, target: { metric: 'margin' }, invert: false, spread: 10, format: 'pp' },
        { type: 'pill', variant: 'status', bind: { metric: 'margin' }, target: { metric: 'margin' }, invert: false, format: 'pp' }
      ]),
      col(3, 'none', null, [
        detail('Needed to be on pace', 'neededPerDay'),
        detail('Actual on the latest day', 'latestDay'),
        detail('Operational Read', 'opRead')
      ])
    ] },
    { cols: [col(12, 'none', null, [{ type: 'note', align: 'center', source: 'flightDays' }])] }
];

// ── the three ready cards (atoms/*CardBody.jsx) ───────────────────────────────
// FUNCTIONS, called once per use: the Verdict hero and the ready cards hold the same
// bricks, and a shared array literal would be the same reference in two definitions —
// one structuredClone away from an aliasing bug the day something mutates a resolved
// definition. Declared with `function` so hoisting makes them available to the `var`
// initializers above and below them; do not convert them to arrow constants.

/** BudgetCardBody.jsx — the big percent, the spend bar, Fact/Needed/Deviation, RecoStrip. */
function BUDGET_BRICKS() {
  return [
    // :13 BigStat = cm.spendToDatePct "of plan-to-date" — the canonical `budget` metric.
    { type: 'bigStat', bind: { metric: 'budget' }, format: 'percent' },
    // :14 ProgressBar pct = sp / costBudTotal, tick = costPr / costBudTotal. `expCo` IS
    // cm.costPr over the default window — both are liExpCost(plan, asOf) summed over the
    // effective line items — so the mark lands where the block puts it. The label keeps
    // the block's own wording; the bound value is what follows it (":14 needed today · $X").
    { type: 'progressBar', bind: { expr: 'sp' }, target: { expr: 'costBud' }, invert: false, tick: { expr: 'expCo' }, tickLabel: 'needed today' },
    // :21 Fact / Needed / Deviation.
    { type: 'statRow', cells: [
      { label: 'Fact', bind: { expr: 'sp' }, format: 'money' },
      { label: 'Needed', bind: { expr: 'expCo' }, format: 'money' },
      { label: 'Deviation', bind: { expr: 'sp - expCo' }, format: 'money' }
    ], layout: 'flex' },
    // :28 RecoStrip = flCM.neededSpendPerDay — needed UNITS × each rate type's 2-day
    // buying rate (metrics.js:592), which is not the remaining budget over the
    // remaining days and disagrees with it on every campaign whose delivery is off pace.
    { type: 'kvRow', label: 'Spend today', bind: { metric: 'neededSpendPerDay' }, format: 'money', emphasis: 'strong', sub: 'to be on plan' }
  ];
}

/**
 * The pace word CardChrome puts in the Budget card's badge (:12
 * paceWord/paceStatus of (sp − costPr) / costBudTotal × 100). The DELTA has no campM
 * key of its own — the block computes it inline — so it is an expression over the two
 * identities above, which makes it exact rather than approximate.
 */
function BUDGET_BADGE() {
  return { words: 'pace', bind: { expr: '(sp - expCo) / costBud * 100' } };
}

/** MarginMeterBody.jsx — the percent, the delta chip, the bullet meter, the three stats. */
function MARGIN_BRICKS() {
  return [
    { type: 'bigStat', bind: { metric: 'margin' }, target: { metric: 'margin' }, invert: false, format: 'percent' },
    { type: 'pill', variant: 'delta', bind: { metric: 'margin' }, target: { metric: 'margin' }, invert: false, format: 'pp' },
    { type: 'meter', bind: { metric: 'margin' }, target: { metric: 'margin' }, invert: false, format: 'percent' },
    // :24 Fact / Target / Deviation. campM's mA is PacingCore.margin(clientPr, sp) =
    // (dc - sp) / dc * 100, and campaignScalars' mTgt is weighted exactly like flCM.mT.
    { type: 'statRow', cells: [
      { label: 'Fact', bind: { metric: 'margin' }, format: 'percent' },
      { label: 'Target', bind: { expr: 'mTgt' }, format: 'percent' },
      { label: 'Deviation', bind: { expr: '(dc - sp) / dc * 100 - mTgt' }, format: 'pp' }
    ], layout: 'flex' }
  ];
}

/** The margin word MarginMeterBody puts in its badge (:15 marginWord(mA − mT)). */
function MARGIN_BADGE() {
  return { words: 'margin', bind: { expr: '(dc - sp) / dc * 100 - mTgt' } };
}

/** UnitCardBody.jsx — the verdict hero's middle card, on the impressions unit. */
function DELIVERY_BRICKS() {
  return [
    // :27 BigStat = "of plan-to-date" = actual / expected-to-date, on the unit this pacing is
    // BOUGHT on. It named the impressions metric until 2026-10-05, which is what UnitCardBody
    // showed on a CPM pacing — but campM gates CPC and CPV lines out of its impressions family,
    // so a click- or view-paced pacing read 0% of a plan of 0 while its real figures sat under
    // `clicks*` / `views*`. `unit*` resolves through primaryUnit at render, the way the legacy
    // card did, so ONE stored definition is right on all three.
    { type: 'bigStat', bind: { metric: 'unitToDatePct' }, format: 'percent' },
    // :28 pct = actual / plan, tick = expected / plan, label ":31 needed today · <expected>".
    // The bar's value is the impression-PACED actual (2026-09-23), the Fact cell's own basis
    // below: `planImpr` counts the CPM-side lines only, and the formula field `im` counts
    // every line's impressions, so a CPM+CPC pacing drew 296.9% of plan on Flight. Stored
    // copies of the old `im` bind are upgraded at read time
    // (standard-conversion-format.js upgradeFlightTargets).
    { type: 'progressBar', bind: { metric: 'unitActual' }, target: { metric: 'unitPlan' }, invert: false, tick: { metric: 'unitExpected' }, tickLabel: 'needed today' },
    // :35 Fact / Needed / Deviation — ONE basis, Needed's (owner decision 2026-08-15):
    // campM's impression-paced lines, the same cm[F.actual]/cm[F.expected] the old card
    // read. The formula field `im` counts EVERY line's impressions, so a mixed
    // CPM+CPC+CPV campaign printed a Fact its own Needed disagreed with.
    { type: 'statRow', cells: [
      { label: 'Fact', bind: { metric: 'unitActual' }, format: 'int' },
      { label: 'Needed', bind: { metric: 'unitExpected' }, format: 'int' },
      { label: 'Deviation', bind: { metric: 'unitDeviation' }, format: 'int' }
    ], layout: 'flex' },
    // :42 RecoStrip = flCM.neededPerDayImpr.
    { type: 'kvRow', label: 'Deliver today', bind: { metric: 'neededPerDayUnit' }, format: 'int', emphasis: 'strong', sub: 'to be on plan' }
  ];
}

/**
 * The pace word UnitCardBody puts in its badge (:26, on (actual − expected) / plan).
 * A canonical metric and not the equivalent arithmetic, because of the branch above it
 * (:15-21): a unit with NO plan gets no badge at all, and the expression divides by a
 * zero plan and answers 0.0 pp — "On track" against a goal nobody set. `paceDeltaImpr`
 * is null there instead, and a badge with no number draws nothing.
 */
function DELIVERY_BADGE() {
  return { words: 'pace', bind: { metric: 'paceDeltaUnit' } };
}

/** FlightCardBody.jsx — two things, and there is no third to decompose into. */
function FLIGHT_BRICKS() {
  return [
    { type: 'flightBullet' },
    { type: 'statRow', cells: [
      { label: 'Day', bind: { expr: 'daysPassed' }, format: 'int' },
      { label: 'Of', bind: { expr: 'daysPassed + daysLeft' }, format: 'int' },
      { label: 'Left', bind: { expr: 'daysLeft' }, format: 'int' }
    ], layout: 'flex' }
  ];
}

// ── Verdict hero (VerdictHero.jsx) ────────────────────────────────────────────
// :61 the three-zone band, :79 the three cards (Budget / Unit / Margin bodies).
// The band is index.css `.vh-band` — `2fr 1fr 1fr`, so 6/3/3 twelfths — and each zone
// carries a title, which bricks.js keeps only on a FRAMED column: the zones are
// 'signal', the frame that IS a titled panel. (The band draws one surface around all
// three; three panels is the closest the two-level arrangement gets.)
var HERO_VERDICT_ROWS = [
    { cols: [
      // The word, its status colour and its reason are computed by brick-data.verdictOf;
      // a header takes no binding, exactly like flightBullet.
      col(6, 'signal', 'Campaign verdict', [{ type: 'header', label: 'Verdict' }]),
      col(3, 'signal', 'Flight', [{ type: 'flightBullet' }]),
      col(3, 'signal', 'To reach plan', [
        // :71 one cell per unit whose plan is set, each flCM[UNIT_FIELDS[u].neededPerDay];
        // a stored row names all three and the renderer drops the ones this campaign
        // does not run.
        { type: 'statRow', cells: [
          { label: 'Impr/day', bind: { metric: 'neededPerDayImpr' }, format: 'int' },
          { label: 'Clicks/day', bind: { metric: 'neededPerDayClicks' }, format: 'int' },
          { label: 'Views/day', bind: { metric: 'neededPerDayViews' }, format: 'int' },
          { label: 'Installs/day', bind: { metric: 'neededPerDayInstalls' }, format: 'int' }
        ], layout: 'flex' },
        // :75 RecoStrip = flCM.neededSpendPerDay.
        { type: 'kvRow', label: 'Spend/day', bind: { metric: 'neededSpendPerDay' }, format: 'money', emphasis: 'strong' }
      ])
    ] },
    { cols: [
      col(4, 'card', 'Budget', BUDGET_BRICKS(), { badge: BUDGET_BADGE() }),
      col(4, 'card', 'Delivery', DELIVERY_BRICKS(), { badge: DELIVERY_BADGE() }),
      col(4, 'card', 'Margin', MARGIN_BRICKS(), { badge: MARGIN_BADGE() })
    ] }
];

// ── Finance (OverviewBlock2.jsx) ──────────────────────────────────────────────
// :146 four cards; each leads with its money value, then a pair, then the per-rate-type
// repeat (:157 planRate, :166 bidPair, :214 earned, :217 dynamic).
var FINANCE_ROWS = [{ cols: [
    col(3, 'card', 'Client Plan', [
      // :151 MoneyValue(ac.budPr): the client's plan from the window's first day to asOf (or
      // the window's end, if sooner), while «Client Budget Plan» in the Client Fact card is
      // `budget`, the whole window's (the «to Date», 2026-09-23).
      // `budgetToDate` (owner-approved 2026-09-23) sums each line's CLIENT money over those
      // days. The cell used to divide the summed cost plan by one budget-weighted margin,
      // `if(mTgt < 100, costBud / (1 - mTgt / 100), budget)`, which is the client's plan only
      // while every line and part has the same margin: +2% on Flight on a 30%/25% pacing, and
      // $541.88 above «Client Budget Plan» read over the same September days. Stored copies of
      // the old text are upgraded at read time (standard-conversion-format.js).
      { type: 'moneyStat', label: 'Budget Plan to Date', bind: { expr: 'budgetToDate' }, role: 'client' },
      // :153 the pair. Its left half is the PRIMARY rate type's client plan rate, each
      // derived from its OWN budget bucket (metrics.js:546); a stored cell names one,
      // and clientPlanCpm is the primary of every impression-paced pacing.
      { type: 'statRow', cells: [
        { label: 'Plan rate', bind: { metric: 'clientPlanCpm' }, format: 'money' },
        { label: 'Margin Target', bind: { expr: 'mTgt' }, format: 'percent' }
      ], layout: 'pair' },
      { type: 'rateRows', series: 'planRate' }
      // :148 the badge is "Client Side", and "Client Side · Converted" when the campaign
      // carries a real non-USD rate (Currency.isConverted).
    ], { badge: { words: 'currency', text: 'Client Side' } }),
    col(3, 'card', 'Buying Guardrail', [
      // :165 f$(ac.costBudTotal) — plain USD, no second currency, so not a moneyStat.
      { type: 'bigStat', label: 'Our Cost Plan', bind: { expr: 'costBud' }, format: 'money' },
      { type: 'rateRows', series: 'bidPair' }
    ], { badge: 'Rate Ceiling' }),
    col(3, 'card', 'DSP Side', [
      { type: 'moneyStat', label: 'DSP Spend Fact', bind: { expr: 'sp' }, role: 'media' },
      // :190 the row labelled "Budget for DSP" draws flCM.forecastDspSpend
      // (metrics.js:545 = imprSpend / imprActual × imprPlan), NOT the cost budget:
      // spend at today's rate, extended to the whole plan.
      { type: 'kvRow', label: 'Budget for DSP', bind: { metric: 'forecastDspSpend' }, format: 'money', emphasis: 'muted' },
      // :193 the chip is that forecast AGAINST the cost plan — value and target, so the
      // delta the chip prints is the block's fcDelta (forecastDspSpend − the FULL-flight
      // costBudTotal). Canonical, not `expr: 'costBud'`: the formula field is
      // range-prorated, and the parity frames (T12 Step 0) caught the chip printing a
      // delta against the to-date cost instead of the block's own number.
      { type: 'pill', variant: 'delta', bind: { metric: 'forecastDspSpend' }, target: { metric: 'costBudTotal' }, invert: true, format: 'money' },
      // :127/:200 costRem = max(0, costBudTotal - sp), clamp and all — canonical for the
      // same reason (the expr over `costBud` printed $0.00 with $10.5k actually left).
      { type: 'kvRow', label: 'Cost Remaining', bind: { metric: 'costRemaining' }, format: 'money', emphasis: 'muted' }
    ], { badge: 'Actuals' }),
    col(3, 'card', 'Client Fact', [
      { type: 'moneyStat', label: 'Client Budget Fact', bind: { expr: 'dc' }, role: 'client' },
      // :210 the pair: the client plan on the left, and on the right the FIRST dynamic
      // client rate (ac.dynCpm = imprDc / imprActual × 1000, relabelled "Client CPM" on
      // a coefficient-cost pacing). The rest of the dynamic rates are the last brick.
      { type: 'statRow', cells: [
        { label: 'Client Budget Plan', bind: { expr: 'budget' }, format: 'money' },
        { label: 'Dyn CPM', bind: { metric: 'dynCpm' }, format: 'money' }
      ], layout: 'pair' },
      { type: 'rateRows', series: 'earned' },
      { type: 'rateRows', series: 'dynamic' }
    ], { badge: 'Actuals' })
  ] }];

// The same three bodies, each alone in a card-profile composite — and each wearing the
// same live badge its CardChrome draws today. FlightCardBody has no badge at all.
var CARD_ROWS = {
  budget: [{ cols: [col(12, 'card', 'Budget', BUDGET_BRICKS(), { badge: BUDGET_BADGE() })] }],
  marginbar: [{ cols: [col(12, 'card', 'Margin', MARGIN_BRICKS(), { badge: MARGIN_BADGE() })] }],
  flight: [{ cols: [col(12, 'card', 'Flight', FLIGHT_BRICKS())] }]
};
var CARD_META = {
  budget: ['Budget', 'Spend against plan-to-date, with the needed-today mark.'],
  marginbar: ['Margin meter', 'Margin on a target-anchored meter.'],
  flight: ['Flight', 'Day of the flight, and days remaining.']
};

function metricValue(metric, family) {
  return { kind: 'metric', metric: metric, source: 'bq', unitFamily: family };
}
function canonicalValue(key, family, reading) {
  var out = { kind: 'canonical', key: key, unitFamily: family };
  if (reading) out.reading = reading;
  return out;
}
function line(width, points) {
  return { type: 'line', width: width, curve: 'smooth', points: !!points };
}
function area(width) {
  return { type: 'area', width: width, curve: 'smooth', points: false, fill: 'light' };
}
function bars(width) { return { type: 'bar', bars: 'grouped', width: width }; }

/** A value series in report-v2's exact stored key order. */
function valueSeries(id, label, value, style, axis, color, opts) {
  var o = opts || {};
  var out = {
    id: id, kind: 'value', label: label, labelAuto: false, value: value,
    style: style, axis: axis, color: color
  };
  if (o.fill) out.fill = o.fill;
  if (o.border) out.border = o.border;
  out.dashed = o.dashed || false;
  if (o.opacity !== undefined) out.opacity = o.opacity;
  out.valuesOnChart = false;
  out.accumulate = o.accumulate || 'daily';
  out.hidden = false;
  if (o.guide) out.guide = o.guide;
  return out;
}

/** A Plan/Reforecast projection Guide in report-v2's exact stored key order. It stores no
 *  basis and no output: the parent series' metric and accumulate decide both. */
function projectionGuide(label, modeControlId, style, color, dashed) {
  var out = { calc: 'projection' };
  if (modeControlId) out.modeControlId = modeControlId;
  out.invert = false;
  out.label = label;
  out.labelPlacement = 'legend';
  out.style = style;
  out.color = color;
  out.dashed = dashed;
  out.opacity = 1;
  out.valuesOnChart = false;
  return out;
}

function targetGuide(key, family, invert, reading) {
  return {
    value: canonicalValue(key, family, reading), invert: !!invert,
    label: 'Target', labelPlacement: 'plotTopRight'
  };
}

function widgetDefinition(title, profile, controls, views) {
  return {
    kind: 'composite', title: title, profile: profile, schemaVersion: 2,
    datasetType: 'delivery',
    spec: {
      dataset: { type: 'delivery' }, period: null, controls: controls,
      views: views, interactions: [], formatDefaultsVersion: 1
    }
  };
}

function layoutDefinition(title, profile, rows) {
  return widgetDefinition(title, profile, [], [
    { id: 'layout', kind: 'layout', title: '', rows: rows }
  ]);
}

function chartDefinition(key, series, formats, withProjectionControl, titleAuto, emptyBehavior) {
  var controls = withProjectionControl
    ? [{ id: 'projection', type: 'projection', label: 'Projection' }]
    : [];
  var view = { id: 'chart', kind: 'chart', title: '' };
  if (titleAuto) view.titleAuto = true;
  view.x = { type: 'date', domain: 'factDates' };
  view.orientation = 'vertical';
  view.series = series;
  view.formats = formats;
  view.emptyBehavior = emptyBehavior || 'placeholder';
  view.journal = true;
  return widgetDefinition(CHART_NAMES[key], 'chart', controls, [view]);
}

function chartSeed(key) {
  var expectedCumulative = function (label) {
    return projectionGuide(label || 'Expected', null, line(1.5, false), 'expected', 'medium');
  };
  var expectedDaily = function (controlled, label) {
    return projectionGuide(label || 'Expected / day', controlled ? 'projection' : null,
      line(1.5, false), 'expected', 'short');
  };
  if (key === 'cumImpr') return chartDefinition(key, [
    valueSeries('actual', 'Actual', metricValue('im', 'count'), area(2), 'left', 'actual',
      { fill: 'actualFill', opacity: 1, accumulate: 'cumulative', guide: expectedCumulative() })
  ], { left: 'kilo', right: 'number' }, false, false);
  if (key === 'cumSpend') return chartDefinition(key, [
    valueSeries('actual', 'Actual Spend', metricValue('sp', 'money'), area(2), 'left', 'spend',
      { fill: 'spendFill', opacity: 1, accumulate: 'cumulative', guide: expectedCumulative('Cost Budget') })
  ], { left: 'currency', right: 'number' }, false, false);
  if (key === 'dailyImpr') return chartDefinition(key, [
    valueSeries('actual', 'Actual Impr', metricValue('im', 'count'), bars(1), 'left', 'impressions',
      { fill: 'impressions', border: 'impressionsBorder', opacity: 1, guide: expectedDaily(true) })
  ], { left: 'kilo', right: 'number' }, true, false);
  if (key === 'dailySpend') return chartDefinition(key, [
    valueSeries('actual', 'Daily Spend', metricValue('sp', 'money'), bars(1), 'left', 'bar',
      { fill: 'bar', border: 'barBorder', opacity: 1, guide: expectedDaily(true, 'Daily Budget') }),
    valueSeries('cpm', 'CPM', metricValue('cpm', 'money'), line(1.5, false), 'right', 'cpm',
      { opacity: 1 })
  ], { left: 'currency', right: 'currency' }, true, false);
  if (key === 'ctr') return chartDefinition(key, [
    valueSeries('ctr', 'CTR %', metricValue('ctr', 'percent'), line(2, true), 'left', 'ctr', {
      opacity: 1, guide: targetGuide('ctr', 'percent', false, 'target')
    })
  ], { left: 'percent2', right: 'number' }, false, false);
  if (key === 'vcr') return chartDefinition(key, [
    valueSeries('vcr', 'VCR %', metricValue('vcr', 'percent'), line(2, true), 'left', 'vcr', {
      opacity: 1, guide: targetGuide('vcr', 'percent', false, 'target')
    })
  ], { left: 'percent1', right: 'number' }, false, true, 'hide');
  if (key === 'cpm') return chartDefinition(key, [
    valueSeries('cpm', 'CPM', metricValue('cpm', 'money'), line(2, true), 'left', 'cpm', {
      opacity: 1, guide: targetGuide('bidPlanCpm', 'money', true)
    })
  ], { left: 'currency', right: 'number' }, false, false);
  if (key === 'cpc') return chartDefinition(key, [
    valueSeries('cpc', 'CPC', metricValue('cpc', 'money'), line(2, true), 'left', 'cpc', {
      opacity: 1, guide: targetGuide('cpc', 'money', true, 'target')
    })
  ], { left: 'currency', right: 'number' }, false, false);
  if (key === 'cpv') return chartDefinition(key, [
    valueSeries('cpv', 'CPV', metricValue('cpv', 'money'), line(2, true), 'left', 'cpv', {
      opacity: 1, guide: targetGuide('cpv', 'money', true, 'target')
    })
  ], { left: 'currency4', right: 'number' }, false, false);
  if (key === 'cumClicks') return chartDefinition(key, [
    valueSeries('actual', 'Actual Clicks', metricValue('cl', 'count'), area(2), 'left', 'ctr',
      { fill: 'ctrFill', opacity: 1, accumulate: 'cumulative', guide: expectedCumulative() })
  ], { left: 'kilo', right: 'number' }, false, false);
  if (key === 'dailyClicks') return chartDefinition(key, [
    valueSeries('actual', 'Actual Clicks', metricValue('cl', 'count'), bars(1), 'left', 'ctr',
      { fill: 'ctr', border: 'ctr', opacity: 1, guide: expectedDaily(false) })
  ], { left: 'number', right: 'number' }, false, false);
  if (key === 'cumViews') return chartDefinition(key, [
    valueSeries('actual', 'Actual Views', metricValue('coViews', 'count'), area(2), 'left', 'vcr',
      { fill: 'vcrFill', opacity: 1, accumulate: 'cumulative', guide: expectedCumulative() })
  ], { left: 'kilo', right: 'number' }, false, false);
  return chartDefinition(key, [
    valueSeries('actual', 'Actual Views', metricValue('coViews', 'count'), bars(1), 'left', 'vcr',
      { fill: 'vcr', border: 'vcr', opacity: 1, guide: expectedDaily(true) })
  ], { left: 'number', right: 'number' }, true, false);
}

var KPI_FAMILY = {
  margin: 'percent', pacing: 'percent', delivery: 'percent', cpm: 'money', spend: 'money',
  ctr: 'percent', vcr: 'percent', cpc: 'money', cpv: 'money'
};
var KPI_TARGET_INVERT = {
  margin: false, cpm: true, spend: true, ctr: false, vcr: false, cpc: true, cpv: true
};
function kpiDefinition(key) {
  var meta = KPI_META[key];
  var family = KPI_FAMILY[key];
  var view = {
    id: 'kpi', kind: 'kpi', title: '',
    value: canonicalValue(key, family), format: meta[1]
  };
  if (Object.prototype.hasOwnProperty.call(KPI_TARGET_INVERT, key)) {
    view.target = {
      value: canonicalValue(key, family, 'target'), invert: KPI_TARGET_INVERT[key]
    };
  }
  view.support = { kind: 'valueMeta' };
  view.deltaVsOtherSource = false;
  return widgetDefinition(meta[0], 'card', [], [view]);
}

// ── the four section widgets (sections cutover 2026-09-07) ───────────────────
// The legacy Targets / 3rd Party / Breakdown / Daily Performance sections, in the v2
// grammar, moved here from the browser's own preset module, deleted in the same cutover. Each was
// audited element by element (section-widget parity, 2026-09-04); the JSON below is the
// section and nothing else, in the normalizer's own stored key order — the byte-stability
// case in tests/dashboard/std-entries.test.js is what holds that.
//
// Breakdown is the one that used to read the pacing at mint. It no longer does: the dimension
// switch is `optionsAuto`, the metric default is `defaultBy: 'buyUnit'`, the CPM column is
// `buyUnit: 'im'` and the conversions table carries `basis: 'conversions'` — four rules the
// tile resolves on every render (workspace auto-controls.js). One definition serves every
// pacing, and the widget follows the pacing as it gains a Geo or a sheet source.

/** The delivery-metric value, under the short name the definitions below read best with.
 *  One implementation: `metricValue` above is the module's only mint for the shape. */
function bq(metric, family) { return metricValue(metric, family); }
/** One value column in normColumn's stored key order: the six required keys, then the
 *  optional ones in the order the normalizer appends them. */
function vcol(id, label, value, format, extra) {
  var c = { id: id, kind: 'value', label: label, labelAuto: label === '', value: value, format: format };
  var e = extra || {};
  if (e.target) c.target = e.target;
  if (e.hideWhenEmpty) c.hideWhenEmpty = true;
  if (e.zeroAs) c.zeroAs = e.zeroAs;
  if (e.highlightExtremes) c.highlightExtremes = true;
  if (e.buyUnit) c.buyUnit = e.buyUnit;
  return c;
}
function planTarget(metric, family, format) { return { value: bq(metric, family), format: format }; }
function countOpt(id, metric) { return { id: id, label: '', labelAuto: true, value: bq(metric, 'count') }; }
function pctValue(metric) { return bq(metric, 'percent'); }
/** One KPI cell in normKpiView's order; `band` only where the product has a corridor. */
function kpiCell(id, title, value, format, target, invert, basis, band) {
  var t = { value: target, invert: invert };
  if (band) t.band = band;
  return { id: id, kind: 'kpi', title: title, value: value, format: format, target: t,
    deltaVsOtherSource: false, basis: basis, density: 'band' };
}
function sectionDefinition(title, datasetType, dataset, controls, views) {
  return {
    kind: 'composite', title: title, profile: 'section', schemaVersion: 2, datasetType: datasetType,
    spec: { dataset: dataset, period: null, controls: controls, views: views, interactions: [], formatDefaultsVersion: 1 }
  };
}

/** «Targets» — four cells in one band, each naming the BASIS the tile asks per render. */
function targetsDefinition() {
  var cells = [
    kpiCell('ctr', 'CTR', pctValue('ctr'), 'percent2', pctValue('ctrT'), false, 'campaign', 'ctr'),
    kpiCell('vcr', 'VCR', pctValue('vcr'), 'percent', pctValue('vcrT'), false, 'video', 'vcr'),
    kpiCell('acr', 'ACR', pctValue('acr'), 'percent', pctValue('acrT'), false, 'audio'),
    // The flight's CPC target: the whole flight's cost budget over the whole flight's planned
    // clicks. `planClicksTotal`, not `planClicks`, which follows a narrowed window
    // (2026-09-23) and would divide the flight's money by a week's clicks. Stored copies of
    // the old text are upgraded at read time (standard-conversion-format.js).
    kpiCell('cpc', 'CPC', bq('cpc', 'money'), 'money',
      { kind: 'formula', expr: 'costBudTotal / planClicksTotal', unitFamily: 'money' }, true, 'cpc')
  ];
  for (var i = 0; i < cells.length - 1; i++) cells[i].besideNext = true;
  return sectionDefinition('Targets', 'delivery', { type: 'delivery' }, [], cells);
}

/** «Delivery vs CM360» — the compare view alone, mapping chosen by the viewer (runtime). */
function thirdPartyDefinition() {
  return sectionDefinition('Delivery vs CM360', 'deliveryCm360',
    { type: 'deliveryCm360', mapping: { mode: 'runtime' } },
    [
      { id: 'metric', type: 'metric', label: 'Metric', options: [
        countOpt('oim', 'impressions'), countOpt('ocl', 'clicks'),
        { id: 'oco', label: 'Completes', labelAuto: false, value: bq('completions', 'count') }
      ], defaultOptionId: 'oim' },
      { id: 'brk', type: 'breakdown', label: 'Break down by', maxSelected: 20 }
    ],
    [{ id: 'vcmp', kind: 'compare', title: '', metricControlId: 'metric', breakdownControlId: 'brk' }]);
}

/** «Daily Performance» — one dateLi table, twelve columns, newest first, totals. */
function dailyDefinition() {
  return sectionDefinition('Daily Performance', 'delivery', { type: 'delivery' }, [], [{
    id: 'daily', kind: 'table', title: '', rows: { type: 'dateLi' },
    columns: [
      vcol('im', '', bq('im', 'count'), 'int', { target: planTarget('imprExpected', 'count', 'int') }),
      // Expected clicks TO DATE on the click-paced lines, the twin of the impressions target
      // above it (2026-10-05). It was `planClicks`, the whole plan on Flight, which read as a
      // wrong expected number; `expCl` would add every other line's CTR target to it.
      vcol('cl', '', bq('cl', 'count'), 'int', { target: planTarget('clExpected', 'count', 'int') }),
      vcol('sp', '', bq('sp', 'money'), 'money', { target: planTarget('costBud', 'money', 'money') }),
      vcol('cpm', '', bq('cpm', 'money'), 'money', { target: planTarget('tgtCpm', 'money', 'money') }),
      vcol('ctr', 'CTR %', bq('ctr', 'percent'), 'percent', { target: planTarget('ctrT', 'percent', 'percent') }),
      vcol('co', 'Completed', bq('co', 'count'), 'int', { hideWhenEmpty: true }),
      vcol('vcr', '', bq('vcr', 'percent'), 'percent', { target: planTarget('vcrT', 'percent', 'percent'), hideWhenEmpty: true }),
      vcol('dc', '', bq('dc', 'money'), 'money', { hideWhenEmpty: true, zeroAs: 'blank' }),
      vcol('cv', 'Conv', bq('cv', 'count'), 'count1', { hideWhenEmpty: true, zeroAs: 'blank' }),
      vcol('cvr', 'Conv Rate %', { kind: 'formula', expr: 'cv / cl * 100', unitFamily: 'percent' }, 'percent', { hideWhenEmpty: true, zeroAs: 'blank' }),
      vcol('pc', 'PC Conv', bq('pc', 'count'), 'count1', { hideWhenEmpty: true, zeroAs: 'blank' }),
      vcol('pv', 'PV Conv', bq('pv', 'count'), 'count1', { hideWhenEmpty: true, zeroAs: 'blank' })
    ],
    sort: { columnId: '__row__', dir: 'desc' },
    totals: true
  }]);
}

/** «Breakdown» — a donut beside a table on the cut the viewer picks, plus the conversions
 *  mart's own table; every pacing-dependent answer is a render-time key. */
/**
 * The value the donut and the row share draw: the pacing's BUY UNIT, resolved at render
 * (auto-controls.js). `im` is the placeholder the grammar stores — a legal metric that keeps the
 * definition readable and valid on its own — and `metricBy` is what makes the tile overwrite it
 * with im / cl / co per pacing.
 *
 * This replaced a metric switch (2026-09-08): the Standard Breakdown showed a control the legacy
 * section never had, and the answer it offered was one the pacing already knows. A viewer who
 * WANTS the switch adds a Metric switch in the builder and binds these two values to it, the
 * ordinary way.
 */
function unitValue() { return { kind: 'metric', metric: 'im', source: 'bq', unitFamily: 'count', metricBy: 'buyUnit' }; }

function breakdownDefinition() {
  var cols = [
    vcol('im', 'Impressions', bq('im', 'count'), 'int'),
    vcol('cl', 'Clicks', bq('cl', 'count'), 'int'),
    vcol('ctr', 'CTR', bq('ctr', 'percent'), 'percent2', { highlightExtremes: true }),
    vcol('sp', 'Spend', bq('sp', 'money'), 'money'),
    vcol('cpm', 'CPM', bq('cpm', 'money'), 'money', { buyUnit: 'im' }),
    vcol('co', 'Compl.', bq('coV', 'count'), 'int', { hideWhenEmpty: true }),
    vcol('vcr', 'VCR', bq('vcr', 'percent'), 'percent2', { hideWhenEmpty: true, highlightExtremes: true }),
    vcol('cv', 'Conv', bq('cv', 'count'), 'count1', { hideWhenEmpty: true, zeroAs: 'blank' }),
    vcol('cvr', 'CVR', { kind: 'formula', expr: 'cv / cl * 100', unitFamily: 'percent' }, 'percent2', { hideWhenEmpty: true, zeroAs: 'blank' })
  ];
  return sectionDefinition('Breakdown', 'delivery', { type: 'delivery' },
    [
      { id: 'dim', type: 'dimension', label: 'Break down by', optionsAuto: true }
    ],
    [
      { id: 'donut', kind: 'pie', title: '', value: unitValue(), sliceBy: { controlId: 'dim' },
        topN: 10, format: 'int', residual: true, filterOnClick: true, besideNext: true },
      { id: 'rows', kind: 'table', title: '', rows: { type: 'control', controlId: 'dim' }, columns: cols,
        sort: { columnId: '__share__', dir: 'desc' }, totals: true, limit: 10, residual: true,
        share: { value: unitValue() }, search: true, filterOnClick: true },
      { id: 'conv', kind: 'table', title: '', rows: { type: 'dim', key: 'aux:conversion' }, columns: [
        vcol('cv', 'Conv', bq('cv', 'count'), 'count1', { zeroAs: 'blank' }),
        vcol('pc', 'P-Click', bq('pc', 'count'), 'count1', { zeroAs: 'blank' }),
        vcol('pv', 'P-View', bq('pv', 'count'), 'count1', { zeroAs: 'blank' })
      ], sort: { columnId: 'cv', dir: 'desc' }, totals: true, limit: 10, share: { columnId: 'cv' },
        search: true, basis: 'conversions' }
    ]);
}

function seed(key, name, description, definition, seedSlot) {
  return entry(key, name, description, definition, seedSlot);
}

var STD_ENTRIES = [
  seed('std:v2:hero-standard', 'Delivery, Pacing & Margin',
    'The standard hero: plan units, pace against plan, and the margin gauge.',
    layoutDefinition('Delivery, Pacing & Margin', 'section', HERO_STANDARD_ROWS), SLOT_HERO),
  seed('std:v2:hero-verdict', 'Campaign verdict',
    'A one-word read on the campaign, flight progress, and what it takes to reach plan.',
    layoutDefinition('Campaign verdict', 'section', HERO_VERDICT_ROWS), SLOT_HERO),
  seed('std:v2:finance', 'Finance',
    'Client Plan · Buying Guardrail · DSP Side · Client Fact.',
    layoutDefinition('Finance', 'section', FINANCE_ROWS), SLOT_FINANCE),
  seed('std:v2:targets', 'Targets',
    'Each rate against its target, for the KPIs this pacing has.', targetsDefinition(), SLOT_TARGETS)
];
for (var c = 0; c < CHART_ORDER.length; c++) {
  var ck = CHART_ORDER[c];
  STD_ENTRIES.push(seed('std:v2:chart:' + ck, CHART_NAMES[ck], CHART_DESCS[ck],
    chartSeed(ck), SLOT_CHART + c));
}
STD_ENTRIES.push(seed('std:v2:third-party', 'Delivery vs CM360',
  'Ad-server delivery beside the DSP numbers, on the mapping.', thirdPartyDefinition(), SLOT_THIRD_PARTY));
STD_ENTRIES.push(seed('std:v2:breakdown', 'Breakdown',
  'A donut and a table on the dimension the viewer picks; the chips follow the pacing.', breakdownDefinition(), SLOT_BREAKDOWN));
STD_ENTRIES.push(seed('std:v2:daily', 'Daily Performance',
  'Date by line item, twelve columns and totals.', dailyDefinition(), SLOT_DAILY));
for (var k = 0; k < PRESET_ORDER.length; k++) {
  var kk = PRESET_ORDER[k], meta = KPI_META[kk];
  STD_ENTRIES.push(seed('std:v2:kpi:' + kk, meta[0], meta[2], kpiDefinition(kk), SLOT_KPI + k));
}
for (var a = 0; a < CARD_ORDER.length; a++) {
  var ak = CARD_ORDER[a];
  STD_ENTRIES.push(seed('std:v2:card:' + ak, CARD_META[ak][0], CARD_META[ak][1],
    layoutDefinition(CARD_META[ak][0], 'card', CARD_ROWS[ak]), SLOT_CARD + a));
}

var STD_BY_KEY = Object.create(null);
for (var i = 0; i < STD_ENTRIES.length; i++) STD_BY_KEY[STD_ENTRIES[i].key] = STD_ENTRIES[i];

/** Own-key checked — 'constructor' and friends can never answer for a real entry. */
function stdEntry(key) {
  if (typeof key !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(STD_BY_KEY, key) ? STD_BY_KEY[key] : null;
}
function isStdKey(key) { return stdEntry(key) !== null; }

// ── fixed instance ids (§9 of the widget-library spec; sections cutover 2026-09-07) ─────
// The instance id a Standard entry is seeded and migrated under. Fixed, so a migration is
// idempotent, a layout key is a rename rather than a rebuild, and the grid can rank the tile
// by the entry's seedSlot (seedSlotOf below). Moved here from dash-gate/lib/widget-seed.mjs
// because the BROWSER needs the reverse map too: seedLayout orders a pacing that has no saved
// layout by these slots. A KPI preset or card keeps the random id the shelf mints — they
// have no page slot to defend.
var SEED_ID_BY_KEY = {
  'std:v2:hero-standard': 'w_herostandard',
  'std:v2:hero-verdict': 'w_heroverdict',
  'std:v2:finance': 'w_finance',
  'std:v2:targets': 'w_targets',
  'std:v2:third-party': 'w_thirdparty',
  'std:v2:breakdown': 'w_breakdown',
  'std:v2:daily': 'w_daily'
};
for (var ci = 0; ci < CHART_ORDER.length; ci++) {
  SEED_ID_BY_KEY['std:v2:chart:' + CHART_ORDER[ci]] = 'w_chart' + CHART_ORDER[ci].toLowerCase();
}
Object.freeze(SEED_ID_BY_KEY); // the browser re-exports this very object; nobody rewrites an id
var SEED_KEY_BY_ID = Object.create(null);
for (var sk in SEED_ID_BY_KEY) {
  if (Object.prototype.hasOwnProperty.call(SEED_ID_BY_KEY, sk)) SEED_KEY_BY_ID[SEED_ID_BY_KEY[sk]] = sk;
}
/** The catalogue key a fixed instance id stands for, or null for a random id. */
function seedKeyOf(id) {
  if (typeof id !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(SEED_KEY_BY_ID, id) ? SEED_KEY_BY_ID[id] : null;
}
/** The page slot of a fixed instance id, or null — the grid's question. */
function seedSlotOf(id) {
  var key = seedKeyOf(id);
  var e = key ? stdEntry(key) : null;
  return e ? e.seedSlot : null;
}

// ── the auto-add rules (spec §1a.1) ───────────────────────────────────────────
// They live HERE, beside the keys they produce, because TWO runtimes run them: the
// server create-path seed and the browser's load-time one-shot hook in dashboardStore.js
// (through workspace/src/lib/dashboard/std-catalog.js). Two copies would disagree the
// first time somebody edited one and could add the same template twice.

var CHART_PREFIX = 'std:v2:chart:';

function lowerStr(v) { return String(v === null || v === undefined ? '' : v).toLowerCase(); }
/** The first argument that is neither null nor undefined — `??`, spelled out. */
function firstSet(a, b, c, d) {
  if (a !== null && a !== undefined) return a;
  if (b !== null && b !== undefined) return b;
  if (c !== null && c !== undefined) return c;
  return d;
}

/**
 * The M11 rate-type rules (the deleted dashboardStore.js:174-222 block), as Standard
 * keys and in catalog order. Every branch is that code's, deliberately verbatim in
 * meaning:
 *   CPC              → cpc, cumClicks, dailyClicks
 *   CPV | vcr target | non-audio completes → vcr
 *   CPV              → cpv, cumViews, dailyViews
 * Audio is excluded end to end: a pure audio campaign gets ACR, not an all-zero VCR.
 *
 * `opts.hasVideoCompletes` is the one input this cannot compute — true / false /
 * null when it is unknown (no facts file on the server; no facts loaded in the
 * browser). Only an explicit `true` adds the VCR chart, so "unknown" never invents one.
 *
 * The VCR target is read under FOUR spellings on purpose. PG stores `target_vcr`
 * (merge.mjs:63 turns it into vcrTargetPct, which normalize.js turns into the store's
 * vcrTgt); the plan's draft said `vcr_target`, which exists nowhere in the stack. Reading
 * only that one would have silently dropped the VCR chart from every CPM-video pacing.
 */
function autoAddKeys(config, opts) {
  var o = opts || {};
  var lis = (config && Array.isArray(config.line_items)) ? config.line_items : [];
  var rate = Object.create(null);
  var hasVcrTarget = false;
  for (var i = 0; i < lis.length; i++) {
    var p = lis[i];
    if (!p) continue;
    var rt = p.rate_type || p.rateType;
    if (rt) rate[rt] = true;
    var t = Number(firstSet(p.target_vcr, p.vcr_target, p.vcrTargetPct, p.vcrTgt));
    if (lowerStr(p.channel || p.ch) !== 'audio' && isFinite(t) && t > 0) hasVcrTarget = true;
  }
  var hasRate = function (k) { return rate[k] === true; };
  var out = [];
  var add = function (k) { if (out.indexOf(k) === -1) out.push(k); };
  if (hasRate('CPC')) { add(CHART_PREFIX + 'cpc'); add(CHART_PREFIX + 'cumClicks'); add(CHART_PREFIX + 'dailyClicks'); }
  if (hasRate('CPV') || hasVcrTarget || o.hasVideoCompletes === true) add(CHART_PREFIX + 'vcr');
  if (hasRate('CPV')) { add(CHART_PREFIX + 'cpv'); add(CHART_PREFIX + 'cumViews'); add(CHART_PREFIX + 'dailyViews'); }
  // The CM360 widget (sections cutover 2026-09-07): where a 3rd-party source is CONFIGURED,
  // and only there — on a pacing with no source the tile would have nothing to compare.
  var tp = config && Array.isArray(config.third_party) ? config.third_party : [];
  if (tp.length) add('std:v2:third-party');
  // Slot order, so two pacings with the same rules produce the same array; charts keep
  // CHART_ORDER because their slots are SLOT_CHART + index.
  return out.sort(function (a, b) { return stdEntry(a).seedSlot - stdEntry(b).seedSlot; });
}

var StdEntries = {
  STD_VERSION: STD_VERSION,
  STD_ENTRIES: STD_ENTRIES,
  STD_BY_KEY: STD_BY_KEY,
  CHART_ORDER: CHART_ORDER,
  PRESET_ORDER: PRESET_ORDER,
  CARD_ORDER: CARD_ORDER,
  stdEntry: stdEntry,
  isStdKey: isStdKey,
  SEED_ID_BY_KEY: SEED_ID_BY_KEY,
  seedKeyOf: seedKeyOf,
  seedSlotOf: seedSlotOf,
  autoAddKeys: autoAddKeys
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StdEntries;
} else {
  root.StdEntries = StdEntries;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
