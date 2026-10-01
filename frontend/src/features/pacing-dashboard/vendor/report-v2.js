/**
 * report-v2.js — the CLOSED wire grammar of a v2 report widget (widget-builder v2 spec
 * 2026-08-19 §2/§5/§6/§7.7/§9; wire grammar inherited from the superseded draft
 * 2026-08-18 §5.0/§7.4/§7.5/§7.6, updated to rev 3).
 *
 * Both sides must agree or a save stores something no client can draft or draw:
 *   - dash-gate/lib/widgets-validate.mjs decides what may be STORED,
 *   - the P3 builder UI decides what may be DRAFTED — against this same module,
 *     so the draft it holds is the body the server accepts.
 *
 * SCOPED STRICT DOCTRINE (§9). Inside the v2 body — `spec` and everything under it, plus
 * the discriminators `profile`, `schemaVersion`, `datasetType` — nothing clamps, coerces,
 * truncates or silently strips: an unknown key REJECTS, an out-of-union value REJECTS, an
 * over-cap string REJECTS instead of slicing. The shared legacy prefix (`id`, `kind`,
 * `title`, `from`, `scope`) keeps legacy doctrine, because those assignments are the byte
 * order the display/library goldens pin. Never call the legacy `str()`, `normScopeList()`
 * or any `X.has(v) ? v : default` fallback from in here — they truncate and coerce.
 *
 * RENDER ORDER. Views render top to bottom in `views[]` order, each exactly once. The
 * superseded §5.0.5 hung that rule on a stored `layout:{type:'stack'}` constant; the
 * constant is dropped (one legal value), so the rule lives here — it is the only record.
 * Since section view rows (spec 2026-08-27) a view may also carry `besideNext: true`, which
 * says it shares its row with the one after it — the only composition fact in the grammar,
 * and still an AUTHORED one: no renderer pairs views by guessing.
 *
 * NO `ranges` ON A v2 WIDGET (owner-approved 2026-08-20). The Period control (§6) is the
 * widget's only chip row, so a stored `ranges` array beside it would be a second mechanism
 * for one feature — and two mechanisms give two answers the moment they disagree. `ranges`
 * is therefore refused on both v2 branches, and legacy → v2 conversion MATERIALIZES a Period
 * control from the old `ranges` array: that is how an existing widget's chip row survives,
 * and it is the reason the ban costs nothing. This overrides the superseded draft's §5.0.1
 * (which listed `ranges?` on ReportV2Inline) and §5.0.6 ("Delivery permits outer scope and
 * ranges"). Untouched: `display.widgetRanges`, the shared view-pref lane — it stores the
 * viewer's SELECTION, which is a different question from what the widget offers.
 *
 * INJECTED FACTS. This file is dependency-free UMD: it cannot reach dim-sources.mjs and it
 * cannot import a sibling. Two facts arrive from the host through `ctx`:
 *     ctx.checkDimKey(where, key) -> { ok: true, key } | { ok: false, detail }
 *     ctx.isCanonicalMetric(key)  -> boolean
 * The contract is a RETURNED result, never a throw: nothing here catches, and a rejection
 * becomes fail(at, detail). The dash-gate adapter bridges the throwing checkDimKey and
 * strips the widget prefix it adds, so the prefix lands exactly once.
 *
 * ES5 SYNTAX BY CONVENTION — no arrow functions, no `??`, no optional chaining, no `let`.
 * Nothing lints it: only this note and the shared/dash-blocks.js + shared/pacing-core.js
 * precedent, because the same file is read by Node, by dash-gate and by Vite.
 *
 * Browser/Vite: globalThis.ReportV2; Node: module.exports.
 */
(function (root) {
"use strict";

var UNIT_FAMILIES = ['count', 'money', 'percent', 'number'];
var CM_FIELDS = ['impressions', 'clicks', 'completions'];
// The three CM360 identifiers a FORMULA may name (spec 2026-09-16 §2.1). A whole-identifier
// scan and not a parse, because this file has no parser and is not getting one: it decides
// shapes, never expression content. The client's own test is `identifiersOf`, and the two can
// disagree only on text that does not parse, which the draft gate refuses before it is
// stored. Not global: a `g` flag carries lastIndex between calls and would answer false every
// other time it was asked about the same expression.
var CM_EXPR_RE = /\bcm(?:Im|Cl|Co)\b/;
var VALUE_KINDS = ['metric', 'formula', 'canonical', 'bound'];
var SOURCES = ['bq', 'cm'];
var RANGE_VALUES = ['1d', '3d', '7d', '14d', '30d', 'flight'];
// `auto` is a viewer choice, never a data range. Keeping the two vocabularies separate is
// what prevents the sentinel leaking into the stored `spec.period` data range.
var PERIOD_CHOICES = ['auto'].concat(RANGE_VALUES);
var WIDGET_PROFILES = ['card', 'chart', 'table', 'section'];
// The viewer controls. This list order is ALSO the order controls are STORED in —
// see normControls; authoring order never reaches the wire.
//
// `dimension` joined on 2026-08-24 (sections-to-widgets M4, the audit's Option B): the
// viewer picks the CUT, which is what the legacy Breakdown panel's tab bar does and what no
// stored `sliceBy.key` could offer. It is APPENDED rather than filed beside `breakdown`, and
// that is the whole reason the order is safe to change at all: every widget stored before it
// keeps its bytes, so nothing already saved reads as dirty the next time it is opened.
//
// It is NOT `breakdown` widened. That control picks the MAPPING's dimensions for a CM360
// comparison and stores none of them (§6 firstTwoNonAuto); this one stores the PACING's, so
// they are checked at save time by the same injected `checkDimKey` three slots already use,
// and `maxSelected` keeps its one meaning instead of forking across two datasets.
var CONTROL_TYPES = ['period', 'metric', 'breakdown', 'dimension', 'projection'];
var PROJECTION_MODES = ['plan', 'reforecast'];
var PROJECTION_BASES = ['im', 'cl', 'coViews', 'sp'];
var PROJECTION_OUTPUTS = ['cumulative', 'perDay'];
// A calculated Guide's FIXED mode (spec 2026-09-10 «The child»). It is one choice with
// `modeControlId`: either the viewer's Projection switch decides, or the author does; without
// either the Guide draws Plan. Basis and output are NOT stored on a Guide — they are the
// parent series' metric and accumulate, which is what makes the Guide that series' own plan.
var GUIDE_MODES = ['plan', 'reforecast'];
var CELL_FORMATS = ['int', 'count1', 'money', 'money4', 'percent', 'percent2', 'pp', 'number2', 'plain2', 'auto'];
var FORMATS_BY_FAMILY = {
  count: ['auto', 'int', 'count1', 'plain2'],
  money: ['auto', 'money', 'money4', 'plain2'],
  percent: ['auto', 'percent', 'percent2', 'pp', 'plain2'],
  number: ['auto', 'int', 'number2', 'plain2']
};
// The fifteen daily FLOW facts: the registry's fourteen delivery keys plus the engine's own
// `coViews` (shared/metric-registry.js DELIVERY_KEYS; tests/report-v2-test.mjs pins the mirror —
// this UMD stays dependency-free, the WIDGET_ID_RE trade). A bare one of these as a DATE-chart
// guide is a window SUM drawn against per-day series — spec §7.2 keeps that refusal.
var FLOW_FIELDS = ['im', 'cl', 'sp', 'co', 'coViews', 'cv', 'pc', 'pv', 'dc', 'st', 'q1', 'q2', 'q3', 'rc', 'lc'];
// The spec root (§5, Table H). One dataset decides everything CM360 about a widget; nothing
// is derived from its content.
var DATASET_TYPES = ['delivery', 'deliveryCm360'];
var MAPPING_MODES = ['runtime', 'fixed'];
// §5.6 — cross-view wiring is DECLARED, never implicit: no view listens to another because of
// array order. One type today; the list is here so a second one has to be added on purpose.
var INTERACTION_TYPES = ['tupleFocus'];
// The view kinds, in canonical order. VIEW_KINDS is what this module can NORMALIZE: a
// kind enters this list in the same edit that gives it a branch in normView AND a branch in
// walkValues, so it can never be accepted with nothing behind it to normalize it and nothing to
// count its values. Both of those functions end in a refusal that fires if one ever is.
var VIEW_KINDS = ['chart', 'table', 'kpi', 'pie', 'compare', 'layout', 'container', 'atom'];
// The chart (§5.1). The X axis is DATA, not a label: `date` and `li` name a grain, `dim` names
// a mapping dimension that only the host can resolve (ctx.checkDimKey), and `control` names a
// dimension SWITCH — the same dimension question, asked of the viewer instead of the author.
var X_TYPES = ['date', 'li', 'dim', 'control'];
var ORIENTATIONS = ['vertical', 'horizontal'];
// The Y-axis display SCALES — a different question
// from FORMATS_BY_FAMILY, which formats a CELL. §5.1 states no family↔scale mapping, so
// membership is the whole rule: a count drawn on a `kilo` axis is a choice, not an error.
var CHART_FORMATS = ['number', 'kilo', 'count1', 'currency', 'currency4', 'percent', 'percent1', 'percent2'];
var DATE_DOMAINS = ['calendar', 'factDates'];
var EMPTY_BEHAVIORS = ['placeholder', 'hide'];
var GUIDE_LABEL_PLACEMENTS = ['legend', 'plotTopRight'];
var SERIES_KINDS = ['value', 'calc'];
var AXES = ['auto', 'left', 'right'];
var ACCUMULATE_MODES = ['daily', 'cumulative'];
// The families that ADD UP. Only a stock does: a rate summed is a wrong NUMBER, not a
// mis-formatted one, which is why both rules that sum are refusals and not render notes. Two
// read it — §5.1's cumulative series (summed across the days of the window) and §5.4's pie
// (summed across the slices of one total).
var ADDITIVE_FAMILIES = ['count', 'money'];
var STYLE_TYPES = ['line', 'area', 'bar'];
var STROKE_WIDTHS = ['thin', 'normal', 'bold'];
var EXACT_STROKE_WIDTHS = [1, 1.5, 2];
var DASH_PATTERNS = ['short', 'medium', 'long'];
var SEMANTIC_PAINTS = [
  'actual', 'expected', 'spend', 'bar', 'barBorder', 'impressions',
  'impressionsBorder', 'ctr', 'vcr', 'cpm', 'cpc', 'cpv',
  'actualFill', 'expectedFill', 'spendFill', 'barFill', 'barBorderFill',
  'impressionsFill', 'impressionsBorderFill', 'ctrFill', 'vcrFill',
  'cpmFill', 'cpcFill', 'cpvFill'
];
var CURVES = ['straight', 'smooth', 'step'];
var AREA_FILLS = ['light', 'strong'];
var BAR_MODES = ['grouped', 'stacked'];
// §8: the two pacing calculations, both measured in impressions. A click/view/spend variant is
// NOT inferred from the chart — §8 reserves that as its own decision, so `basis` has one legal
// value and stays stored, ready for the day it gains a second.
var CALC_KINDS = ['planPerDay', 'neededPerDay', 'projection'];
var CALC_BASES = ['im'];
// The basis IS the unit (§8): both calculations draw impressions per day, so a calc series is a
// COUNT series and meets the axis rules like any other. The table is keyed by basis so the day
// §8 adds a click or spend variant, the family arrives with it instead of being inferred.
var BASIS_FAMILY = { im: 'count', cl: 'count', coViews: 'count', sp: 'money' };
// The chart palette has eight slots, 0..7; 'auto' means the renderer picks one by position.
var COLOR_SLOTS = 8;
// The table (§5.2). Rows are DATA, like a chart's X — with one more grain: date × line item is
// table-only (§5.1 keeps it off the chart axis), which is why this is not X_TYPES.
var ROW_TYPES = ['date', 'li', 'dateLi', 'dim', 'control'];
// The grains a Δ% column may sit on: DATE, and nothing else. The production kernels define two
// CM360⇄delivery joins — by date (buildComparisonDaily buckets both sides on row.date) and by
// mapping dimension (pivotCompare groups both sides on a tuple of classified dim values) — and
// only the first is one an author can be sure of. The second matches a PACING dimension's bucket
// label against a MAPPING dimension's tuple label: two classifications that happen to spell a
// value the same way, over populations that need not be the same one (a delivery `geo` bucket of
// 60,000 beside a mapped Market DE of 70,000, both honest). A comparison that needs a named
// dimension on each side is the Compare view, which says which mapping dimension it groups by
// instead of joining on a coincidence of spelling. `li` went on 2026-08-21 for a harder reason
// (P2 Task 8): a CM360 row is (date, campaign, placement, creative) all the way from the BigQuery
// export — shared/cm360-query.js selects no line item, so no layer has one to join on. `dim` went
// on 2026-08-23 with the owner's decision 12; restoring it is one entry, and the reasoning is in
// §15. A WHITELIST, so a grain added to ROW_TYPES later has to be joined here on purpose instead
// of inheriting a Δ% by silence.
var DELTA_ROW_TYPES = ['date'];
var COLUMN_KINDS = ['value', 'delta'];
var SORT_DIRS = ['asc', 'desc'];
// What a table column prints where its number is exactly 0 (§5.2, section-widget parity
// 2026-09-04). `blank` is the empty-cell placeholder — the legacy Daily Performance section's
// own reading of a count nobody delivered (DailyTable.jsx `{r.cv || '—'}`), which says «none»
// where a printed 0 says «measured, and it was zero». Absent is the number itself, which is
// what every column stored before this key prints.
var COLUMN_ZERO_AS = ['blank'];
// The row grains that ARE a cut of one dimension — a stored key, or the dimension switch the
// viewer is on. Four of the Breakdown keys below only mean something there: an untagged
// remainder, and a click that filters the dashboard by the value in the row. A date row and a
// line-item row already carry all of the delivery, and neither is a dimension value.
var DIM_ROW_TYPES = ['dim', 'control'];
// The KPI's BASIS (§5.3, section-widget parity 2026-09-04) — which line items the cell is a
// reading of, and therefore whether the campaign has one to read at all. The legacy Targets
// band asks these four questions on every render and draws only the cells that answer
// (KpiPlanFact.jsx), so a stored cell that names its basis follows the pacing the same way: a
// basis with no lines is a cell that is not drawn. The host resolves them — the grammar knows
// no line item — and the four names are the band's own four cells:
//   campaign  every line in scope (the band's CTR, ungated)
//   video     the VCR-eligible lines, and only while they carry completes
//   audio     the audio lines
//   cpc       every line in scope, while clicks are what this campaign is paced on
// A cell with no `basis` is drawn always and reads whatever the tile was handed, which is
// every stored KPI written before this key existed.
var KPI_BASES = ['campaign', 'video', 'audio', 'cpc'];
// How much room ONE KPI cell takes (§5.3, same date). `band` is the legacy Targets strip's own
// line — label, number, delta and «vs» on one row — for a widget that is a glance strip rather
// than a panel. Absent is the stacked cell every v2 KPI has always drawn.
var KPI_DENSITIES = ['band'];
// Which alert corridor judges the distance between a KPI and its target: the two the product
// has (shared/kpi-band.js, and the same two dash-gate colours the Overview sparklines with).
// Absent is the sign alone, which is what every stored target reads by today.
var TARGET_BANDS = ['ctr', 'vcr'];
// Sections cutover (2026-09-07): the three vocabularies behind the four keys that let ONE
// stored Breakdown follow every pacing at render. Dedicated keys, never the word `auto` in
// an existing slot: `auto` is a legal option id (badNodeId) and is stored on period switches.
//   defaultBy   — a metric switch whose default is the option matching the pacing's buy unit
//   metricBy    — a metric VALUE whose metric IS the pacing's buy unit (2026-09-08): the stored
//                 `metric` is a PLACEHOLDER and the render-time pre-step overwrites it. Same
//                 vocabulary as `defaultBy` because it is the same rule one slot over — a
//                 Breakdown with no switch follows the buy unit through the value itself.
//   buyUnit     — a table column drawn only while the pacing is bought on that unit
//   TABLE_BASES — a table view drawn only while the pacing has that reading (the KPI `basis`
//                 idea, one kind over; KPI_BASES is untouched)
var METRIC_DEFAULT_BY = ['buyUnit'];
var COLUMN_BUY_UNITS = ['im', 'cl', 'co'];
var TABLE_BASES = ['conversions'];
// Layout uses this closed vocabulary in both the Builder and renderer. The dependency-free
// grammar owns the names; dash-gate injects the canonical-metric catalogue through ctx, so
// metric existence itself still has one owner.
var LAYOUT_BRICK_TYPES = [
  'bigStat', 'meter', 'pill', 'statRow', 'header', 'miniChart',
  'detailCard', 'unitBars', 'gauge', 'moneyStat', 'kvRow', 'rateRows',
  'progressBar', 'flightBullet', 'note'
];
var LAYOUT_FRAMES = ['none', 'card', 'signal'];
var LAYOUT_CANON_SERIES = ['planRate', 'bidPair', 'earned', 'dynamic'];
var LAYOUT_CANON_SOURCES = ['planUnits', 'planRate', 'actualUnits', 'neededPerDay', 'latestDay', 'opRead'];
var LAYOUT_CANON_NOTES = ['flightDays', 'marginTarget', 'marginDelta', 'deliverySubtitle', 'flightPosition', 'flightRemaining'];
var LAYOUT_DOMAIN_READINGS = ['flight.day', 'flight.total', 'flight.remaining'];
var LAYOUT_DELIVERY_UNITS = ['impressions', 'clicks', 'views'];
var LAYOUT_RATE_UNITS = ['CPM', 'CPC', 'CPV', 'CPA'];
var LAYOUT_HEADER_CONTENTS = ['text', 'verdict'];
var LAYOUT_MONEY_ROLES = ['client', 'media'];
var LAYOUT_KV_EMPHASIS = ['muted', 'strong'];
var LAYOUT_STATROW_LAYOUTS = ['flex', 'pair'];
var LAYOUT_PILL_VARIANTS = ['status', 'delta'];
var LAYOUT_BADGE_WORDS = ['pace', 'margin', 'currency'];
// Highlight children share one closed rule grammar across report values and Layout bricks.
var HIGHLIGHT_OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between', 'outside'];
var HIGHLIGHT_COLORS = ['red', 'amber', 'green', 'blue', 'purple', 'muted'];
var HIGHLIGHT_SCOPES = ['values', 'total', 'both'];
var HIGHLIGHT_STROKE_WIDTHS = [1, 2, 3, 4];
var HIGHLIGHT_OWNER_TYPES = ['series', 'miniSeries', 'column', 'kpi', 'pie', 'cell',
  'bigStat', 'meter', 'pill', 'header', 'detailCard', 'unitBars', 'gauge',
  'moneyStat', 'kvRow', 'rateRows', 'progressBar', 'flightBullet', 'note'];
// Reciprocal Layout rails are surfaced before an edit as well as enforced on Save. Exported
// so the Builder's disabled affordance and this normalizer answer with byte-identical words.
var LAYOUT_DELIVERY_ONLY = 'a Layout uses Delivery data and cannot use CM360';
var LAYOUT_GLOBAL_PERIOD_ONLY = 'a Layout follows the dashboard period and carries no private period';
var LAYOUT_NO_PERIOD_CONTROL = 'a Layout follows the dashboard period and carries no Period control';
var LAYOUT_NO_SCOPE = 'a Layout follows global Delivery filters and takes no widget scope';
// The authored sort may name the ROW itself instead of a column. It can never collide with a
// column id: '__row__' is not a NodeId (NODE_ID_RE starts at a lower-case letter).
var ROW_SORT_KEY = '__row__';
// Each line is ONE kind of cap, because reading 20 as "20 characters" where it means
// "at most 20 slices" is how a rail lands on the wrong quantity.
var LIMITS = {
  highlights: 8,
  compositionDepth: 6, compositionNodes: 384, compositionAtoms: 192, compositionBindings: 912, containerChildren: 32,
  views: 6, series: 4, columns: 12, controls: 5, metricOptions: 8, // array LENGTHS
  interactions: 16,    // an array LENGTH too — a DoS rail, because at most 9 pairs are drawable
  values: 48,          // a spec-WIDE total, walked across the seven value slots — not any one length
  layoutRows: 6, layoutCols: 4, layoutBricksPerCol: 8, layoutBricks: 32,
  layoutCells: 4, layoutSeries: 2, layoutSpan: 12, layoutBindings: 152,
  specBytes: 48000, compositionSpecBytes: 96000, // UTF-8 bytes; recursive geometry adds IDs and wrappers to legacy content
  nodeId: 20, label: 60, support: 120, title: 80, formula: 500, mappingId: 40, // CHARACTERS
  chartTopN: 100, pieTopN: 20, tableLimit: 1000, breakdownMaxSelected: 20 // the largest STORED VALUE
};
// Not in LIMITS: LIMITS holds caps, and this is a FLOOR. §6 sets it for both switches — one
// option is a label, not a switch, and the viewer has nothing to switch to.
var MIN_SWITCH_OPTIONS = 2;
// The ONE refusal a BUILDER has to be able to say before the grammar can (§6's coupling, in
// normReport below). A chip that offers the widget's own period is disabled on a CM360
// report, and it has to carry the reason — but normReport is fail-fast, so on a draft that
// is already broken elsewhere it never reaches this line to be asked. Exported, so the chip
// prints the sentence itself rather than a second wording of it.
var CM_NO_SPEC_PERIOD = 'a CM360 widget has no period of its own; on a deliveryCm360 dataset the spec period is null';
// §6's precedence line turned into a rail: the Period switch beats the widget's own window,
// which beats the dashboard filter. So a spec carrying BOTH a switch and a window stores a
// range no viewer can ever be shown, which is the silent dead config §9 refuses. Stated at
// `/spec/period` and not at the controls, because the switch is the half that WINS: the dead
// half is the window, and that is the key an author has to move.
// Exported for CM_NO_SPEC_PERIOD's own reason, and one more. The reason: normReport is
// fail-fast, so on a draft broken earlier it never reaches this line to be asked, and the
// builder still has to print it. The one more: the builder asks this question BEFORE the
// write on two doors (minting a switch over a fixed window, pinning a window under a switch),
// and both of those confirms say the grammar's sentence rather than a second wording of it.
var SWITCH_NO_SPEC_PERIOD = 'a Period switch overrides the widget window; keep the spec period null or remove the switch';
// The one WIDGET-LEVEL fact the CM360 join cannot survive (widget value sources phase 1,
// spec 2026-08-25 §3). A cm value is otherwise exactly as legal on a delivery dataset as on
// deliveryCm360 — one slot-legality table, read by both — but the outer `scope` sits outside
// this spec, so like LAYOUT_NO_SCOPE beside it the sentence lives here and widgets-validate
// applies it, in the one place that holds the scope and the spec at once. `scope.time` stays
// legal on purpose: CM360 rows carry dates, so a time narrowing reaches both sides alike.
var CM_NO_ENTITY_SCOPE = 'a cm value cannot be narrowed by line items, channels or dimensions; a CM360 row carries no line item, so an entity scope would reach the delivery side only and the tile would print CM360 numbers that scope does not govern';
// The ONE thing `besideNext` can be wrong about, and the ONE sentence the BUILDER has to be
// able to say before the grammar can (section view rows, spec 2026-08-27 §3): the toggle on
// the last view card is refused, and a refused control carries its reason rather than going
// quietly dead. Exported for CM_NO_SPEC_PERIOD's own two reasons — normReport is fail-fast,
// so on a draft broken earlier it never reaches this line to be asked, and one wording keeps
// the disabled chip and the 400 from saying two different things about one rule.
//
// It is the only rule the key HAS beyond «true or absent». §2's other half, «section profile
// only», needs no line of its own and would be dead config if it had one: the mark demands a
// NEXT view, and widgets-validate refuses any non-section profile more than one view at all,
// so no card / chart / table widget can reach a state where the key is even reachable. The
// theorem is pinned in tests/widgets-validate-v2-test.mjs rather than restated as a rail.
var BESIDE_NO_NEXT = 'the last view has no next view to share a row with';
// What `fail` puts between a refusal's pointer and its sentence. A COLON since 2026-08-24,
// when the owner ruled the long dash out of everything a user is shown: «Ошибки и отказы —
// user-facing.» Exported because report-draft.js splits the pointer back OFF to say which
// element a refusal is about, and a separator spelled twice is a splitter that silently
// stops splitting. It may never appear inside a pointer — every segment is a key or an
// index and a node id is `[a-z][a-z0-9_]*`, so the FIRST occurrence is always the join.
var POINTER_SEP = ': ';
// A NodeId must NOT be a legal widget-instance id. Otherwise a view id like "w_abc123" is
// ACCEPTED by layout.tiles and widgetRanges (TILE_ID = /^[A-Za-z0-9_]{1,40}$/), DROPPED by
// enabled{}, and REJECTED by groups — three answers to one id, and §9's containment rule has
// no other enforcer. WIDGET_ID_RE restates dash-blocks.js:42; no `g` flag, so no shared
// lastIndex. The {0,19} plus the leading letter IS LIMITS.nodeId (20) — badNodeId derives its
// message from LIMITS while the bound here is a literal, so the two are changed together.
var NODE_ID_RE = /^[a-z][a-z0-9_]{0,19}$/;
var WIDGET_ID_RE = /^w_[a-z0-9]{4,16}$/;
var METRIC_KEY_RE = /^[a-zA-Z][A-Za-z0-9_]{0,39}$/;
function isNodeId(v) { return typeof v === 'string' && NODE_ID_RE.test(v) && !WIDGET_ID_RE.test(v); }

// The grammar is CLOSED, so its tables are too: a consumer that pushed onto one of these
// would widen what the server accepts, at runtime, from the outside. Frozen deep where a
// table holds tables. "use strict" is on, so a later write THROWS rather than no-opping.
for (var _f = 0; _f < UNIT_FAMILIES.length; _f++) Object.freeze(FORMATS_BY_FAMILY[UNIT_FAMILIES[_f]]);
Object.freeze(UNIT_FAMILIES);
Object.freeze(CM_FIELDS);
Object.freeze(VALUE_KINDS);
Object.freeze(SOURCES);
Object.freeze(RANGE_VALUES);
Object.freeze(PERIOD_CHOICES);
Object.freeze(WIDGET_PROFILES);
Object.freeze(CONTROL_TYPES);
Object.freeze(PROJECTION_MODES);
Object.freeze(PROJECTION_BASES);
Object.freeze(PROJECTION_OUTPUTS);
Object.freeze(GUIDE_MODES);
Object.freeze(CELL_FORMATS);
Object.freeze(FORMATS_BY_FAMILY);
Object.freeze(FLOW_FIELDS);
Object.freeze(DATASET_TYPES);
Object.freeze(MAPPING_MODES);
Object.freeze(INTERACTION_TYPES);
Object.freeze(VIEW_KINDS);
Object.freeze(X_TYPES);
Object.freeze(ORIENTATIONS);
Object.freeze(CHART_FORMATS);
Object.freeze(DATE_DOMAINS);
Object.freeze(EMPTY_BEHAVIORS);
Object.freeze(GUIDE_LABEL_PLACEMENTS);
Object.freeze(SERIES_KINDS);
Object.freeze(AXES);
Object.freeze(ACCUMULATE_MODES);
Object.freeze(ADDITIVE_FAMILIES);
Object.freeze(STYLE_TYPES);
Object.freeze(STROKE_WIDTHS);
Object.freeze(EXACT_STROKE_WIDTHS);
Object.freeze(DASH_PATTERNS);
Object.freeze(SEMANTIC_PAINTS);
Object.freeze(CURVES);
Object.freeze(AREA_FILLS);
Object.freeze(BAR_MODES);
Object.freeze(CALC_KINDS);
Object.freeze(CALC_BASES);
Object.freeze(BASIS_FAMILY);
Object.freeze(ROW_TYPES);
Object.freeze(DELTA_ROW_TYPES);
Object.freeze(COLUMN_KINDS);
Object.freeze(SORT_DIRS);
Object.freeze(LAYOUT_BRICK_TYPES);
Object.freeze(LAYOUT_FRAMES);
Object.freeze(LAYOUT_CANON_SERIES);
Object.freeze(LAYOUT_CANON_SOURCES);
Object.freeze(LAYOUT_CANON_NOTES);
Object.freeze(LAYOUT_DOMAIN_READINGS);
Object.freeze(LAYOUT_DELIVERY_UNITS);
Object.freeze(LAYOUT_RATE_UNITS);
Object.freeze(LAYOUT_HEADER_CONTENTS);
Object.freeze(LAYOUT_MONEY_ROLES);
Object.freeze(LAYOUT_KV_EMPHASIS);
Object.freeze(LAYOUT_STATROW_LAYOUTS);
Object.freeze(LAYOUT_PILL_VARIANTS);
Object.freeze(LAYOUT_BADGE_WORDS);
Object.freeze(HIGHLIGHT_OPS);
Object.freeze(HIGHLIGHT_COLORS);
Object.freeze(HIGHLIGHT_SCOPES);
Object.freeze(HIGHLIGHT_STROKE_WIDTHS);
Object.freeze(HIGHLIGHT_OWNER_TYPES);
Object.freeze(LIMITS);

// REJECTION PROPAGATION, for every normalizer below. The CALLER composes the child's
// pointer before the call (at + '/series/' + i + '/value'); a child's rejection is then
// returned VERBATIM — re-wrapping it as fail(at, r.detail) prints the pointer twice. The one
// exception is a normalizer that OWNS a fixed root, as normControls owns '/spec/controls': it
// takes no `at` and composes every pointer beneath it from that constant.
//
// NAMING. `normX` normalizes ONE item, `normXs` the LIST. Whether a normalizer is public and
// whether it guards its own input are the same question, and each docblock answers it:
// normValue, normLabel and normControls are exported and obj-guard whatever they are handed;
// normControl is private and assumes what normControls already checked.
function fail(at, detail) { return { ok: false, detail: at + POINTER_SEP + detail }; }
// THE SHARED FLOOR is everything declared above normValue. No roster here — a roster is what
// went stale. A later normalizer that declares a local with one of those names shadows it,
// and the TypeError that follows is exactly the 500-instead-of-400 the header warns about.
// Add names; never reuse or shadow one.
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
/** Every entry point starts here: a non-object must REJECT, never reach a property read.
 *  widgets-validate.mjs:654-657 rethrows anything that is not a bad_widgets object, so a
 *  TypeError out of `o.dataset` answers 500 where every other rejection answers 400.
 *  `what` arrives ARTICLED — 'a value', 'an option' — so the detail reads as a sentence. */
function obj(o, at, what) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return fail(at, what + ' must be an object');
  return null;
}
/** Closed-object guard: the ONE reason nothing here silently strips. */
function onlyKeys(o, at, allowed) {
  for (var k in o) {
    if (!has(o, k)) continue;
    if (allowed.indexOf(k) === -1) return fail(at, 'unknown key "' + String(k).slice(0, 24) + '"');
  }
  return null;
}
function inList(list, v) { return typeof v === 'string' && list.indexOf(v) !== -1; }
/** The distinct entries of a list, in first-seen order. Where a SET is counted or printed a
 *  repeat is noise: a metric switch offering impressions and clicks holds two options and one
 *  unit family, and «count/count» in a refusal reads as a bug in the refusal. */
function uniq(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (out.indexOf(list[i]) === -1) out.push(list[i]);
  }
  return out;
}
function formatLegal(family, format) {
  return has(FORMATS_BY_FAMILY, family) && FORMATS_BY_FAMILY[family].indexOf(format) !== -1;
}
/** Quote a rejected value into a detail without letting a crafted 4 KB string BE the error.
 *  A non-primitive prints as its TYPE, never through String(): `{"toString": 1}` is legal
 *  JSON, and String() on it throws "Cannot convert object to primitive value" — a throw out
 *  of here is the 500 the header forbids. It also stops the detail from LYING: an object
 *  whose toString returns 'o1' would otherwise print as «"o1" names no option» when o1 is
 *  an option. */
function show(v) {
  if (typeof v === 'string') return v.slice(0, 24);
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return Array.isArray(v) ? 'an array' : 'an object';
}
/** A stored count is a WHOLE number: 2.5 slices and NaN are refusals, never a round(). */
function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
/** Every id in the grammar is a NodeId, so every id refusal explains the shape the same way.
 *  Returns a rejection or null, like `obj` and `onlyKeys`. */
function badNodeId(v, at, what) {
  if (isNodeId(v)) return null;
  return fail(at, what + ' "' + show(v) + '" is not a node id (a lower-case letter, then up to ' +
    (LIMITS.nodeId - 1) + ' letters/digits/underscores, and never a widget id)');
}

/** Highlight formulas follow normValue's syntax doctrine: the client parses; the wire
 * validates type, blankness and size. An absent reference remains repairable after
 * its Guide/Target/Marker is removed; only an impossible owner kind is refused. */
function normHighlightExpr(v, at) {
  if (typeof v !== 'string' || !v.replace(/\s/g, '')) return fail(at, 'formula is empty');
  if (v.length > LIMITS.formula) return fail(at, 'formula is over ' + LIMITS.formula + ' characters');
  return { ok: true, out: v };
}

function highlightStyleKeys(ownerType, owner) {
  if (!inList(HIGHLIGHT_OWNER_TYPES, ownerType)) return [];
  if (ownerType === 'series' || ownerType === 'miniSeries') {
    return owner && owner.style && owner.style.type === 'bar'
      ? ['color'] : ['color', 'strokeWidth', 'points'];
  }
  if (ownerType === 'pie') return ['color', 'bold'];
  return ['color', 'background', 'bold'];
}

function normHighlightThreshold(t, at, ownerType) {
  var bad = obj(t, at, 'a highlight threshold');
  if (bad) return bad;
  var reference = t.kind === 'target' || t.kind === 'guide' || t.kind === 'marker';
  if (t.kind !== 'number' && t.kind !== 'formula' && !reference) return fail(at + '/kind', 'a highlight threshold is number, formula, target, guide or marker');
  bad = onlyKeys(t, at, t.kind === 'number' ? ['kind', 'value']
    : t.kind === 'formula' ? ['kind', 'expr'] : ['kind', 'factor', 'offset']);
  if (bad) return bad;
  var out = { kind: t.kind };
  if (t.kind === 'number') {
    if (typeof t.value !== 'number' || !isFinite(t.value)) return fail(at + '/value', 'a highlight threshold must be a finite number');
    out.value = t.value;
  } else if (t.kind === 'formula') {
    var expr = normHighlightExpr(t.expr, at + '/expr');
    if (!expr.ok) return expr;
    out.expr = expr.out;
  } else {
    var targets = ['column', 'kpi', 'bigStat', 'meter', 'gauge', 'moneyStat', 'kvRow', 'pill',
      'progressBar', 'flightBullet', 'unitBars', 'rateRows', 'detailCard'];
    if ((t.kind === 'target' && targets.indexOf(ownerType) === -1)
      || (t.kind === 'guide' && ownerType !== 'series')
      || (t.kind === 'marker' && ownerType !== 'progressBar' && ownerType !== 'unitBars')) {
      return fail(at + '/kind', 'this highlight owner does not provide a ' + t.kind);
    }
    var keys = ['factor', 'offset'];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!has(t, key)) continue;
      if (typeof t[key] !== 'number' || !isFinite(t[key])) return fail(at + '/' + key, key + ' must be a finite number');
      out[key] = t[key];
    }
  }
  return { ok: true, out: out };
}

/** Public shared validation for one editor transaction. ownerType identifies the
 * containing slot; optional owner supplies bar and computed-text applicability. */
function normHighlight(rule, at, ownerType, owner) {
  var bad = obj(rule, at, 'a highlight');
  if (bad) return bad;
  if (!inList(HIGHLIGHT_OWNER_TYPES, ownerType)) return fail(at, 'this element cannot own highlights');
  bad = onlyKeys(rule, at, ['id', 'enabled', 'input', 'condition', 'guard', 'style', 'scope', 'note']);
  if (bad) return bad;
  bad = badNodeId(rule.id, at + '/id', 'highlight id');
  if (bad) return bad;
  var out = { id: rule.id };
  if (has(rule, 'enabled')) {
    if (typeof rule.enabled !== 'boolean') return fail(at + '/enabled', 'enabled must be true or false');
    out.enabled = rule.enabled;
  }
  if (has(rule, 'input')) {
    var inputAt = at + '/input';
    bad = obj(rule.input, inputAt, 'a highlight input');
    if (bad) return bad;
    var input = rule.input;
    var exprInput = has(input, 'expr');
    var readingInput = has(input, 'reading');
    var shareInput = has(input, 'kind');
    if ((exprInput ? 1 : 0) + (readingInput ? 1 : 0) + (shareInput ? 1 : 0) !== 1) return fail(inputAt, 'a highlight input is one formula, domain reading or pie share');
    bad = onlyKeys(input, inputAt, exprInput ? ['expr'] : readingInput ? ['reading'] : ['kind']);
    if (bad) return bad;
    if (exprInput) {
      var inputExpr = normHighlightExpr(input.expr, inputAt + '/expr');
      if (!inputExpr.ok) return inputExpr;
      out.input = { expr: inputExpr.out };
    } else if (readingInput) {
      if (!inList(LAYOUT_DOMAIN_READINGS, input.reading)) return fail(inputAt + '/reading', 'unknown domain reading');
      out.input = { reading: input.reading };
    } else {
      if (input.kind !== 'share' || ownerType !== 'pie') return fail(inputAt + '/kind', 'share is an input only for a pie');
      out.input = { kind: 'share' };
    }
  } else if (ownerType === 'header' || ownerType === 'note' || (ownerType === 'pill' && owner && has(owner, 'text'))) {
    return fail(at + '/input', 'a text highlight needs an explicit numeric input');
  }
  var conditionAt = at + '/condition';
  bad = obj(rule.condition, conditionAt, 'a highlight condition');
  if (bad) return bad;
  bad = onlyKeys(rule.condition, conditionAt, ['op', 'threshold', 'upper']);
  if (bad) return bad;
  var condition = rule.condition;
  if (!inList(HIGHLIGHT_OPS, condition.op)) return fail(conditionAt + '/op', 'unknown highlight comparison');
  var range = condition.op === 'between' || condition.op === 'outside';
  if (range !== has(condition, 'upper')) return fail(conditionAt + '/upper', 'only between and outside require an upper threshold');
  var threshold = normHighlightThreshold(condition.threshold, conditionAt + '/threshold', ownerType);
  if (!threshold.ok) return threshold;
  out.condition = { op: condition.op, threshold: threshold.out };
  if (range) {
    var upper = normHighlightThreshold(condition.upper, conditionAt + '/upper', ownerType);
    if (!upper.ok) return upper;
    if (threshold.out.kind === 'number' && upper.out.kind === 'number' && threshold.out.value > upper.out.value) return fail(conditionAt + '/upper', 'the upper threshold must be at least the lower threshold');
    out.condition.upper = upper.out;
  }
  if (has(rule, 'guard')) {
    var guardAt = at + '/guard';
    bad = obj(rule.guard, guardAt, 'a highlight guard');
    if (bad) return bad;
    bad = onlyKeys(rule.guard, guardAt, ['expr', 'min']);
    if (bad) return bad;
    var guardExpr = normHighlightExpr(rule.guard.expr, guardAt + '/expr');
    if (!guardExpr.ok) return guardExpr;
    if (typeof rule.guard.min !== 'number' || !isFinite(rule.guard.min) || rule.guard.min < 0) return fail(guardAt + '/min', 'minimum data volume must be a finite non-negative number');
    out.guard = { expr: guardExpr.out, min: rule.guard.min };
  }
  var styleAt = at + '/style';
  bad = obj(rule.style, styleAt, 'a highlight style');
  if (bad) return bad;
  var styleKeys = highlightStyleKeys(ownerType, owner);
  bad = onlyKeys(rule.style, styleAt, styleKeys);
  if (bad) return bad;
  var styleOut = {};
  var styleCount = 0;
  for (var si = 0; si < styleKeys.length; si++) {
    var styleKey = styleKeys[si];
    if (!has(rule.style, styleKey)) continue;
    var styleValue = rule.style[styleKey];
    if ((styleKey === 'color' || styleKey === 'background') && !inList(HIGHLIGHT_COLORS, styleValue)) return fail(styleAt + '/' + styleKey, 'a highlight color is red, amber, green, blue, purple or muted');
    if ((styleKey === 'bold' || styleKey === 'points') && typeof styleValue !== 'boolean') return fail(styleAt + '/' + styleKey, styleKey + ' must be true or false');
    if (styleKey === 'strokeWidth' && HIGHLIGHT_STROKE_WIDTHS.indexOf(styleValue) === -1) return fail(styleAt + '/strokeWidth', 'a highlight stroke width is 1, 2, 3 or 4');
    styleOut[styleKey] = styleValue;
    styleCount++;
  }
  if (!styleCount) return fail(styleAt, 'a highlight needs at least one appearance change');
  out.style = styleOut;
  if (has(rule, 'scope')) {
    if (ownerType !== 'column') return fail(at + '/scope', 'highlight scope belongs only to a table column');
    if (!inList(HIGHLIGHT_SCOPES, rule.scope)) return fail(at + '/scope', 'highlight scope is values, total or both');
    out.scope = rule.scope;
  }
  if (has(rule, 'note')) {
    if (typeof rule.note !== 'string' || !rule.note.replace(/\s/g, '')) return fail(at + '/note', 'a highlight note may not be blank');
    if (rule.note.length > LIMITS.support) return fail(at + '/note', 'a highlight note is over ' + LIMITS.support + ' characters');
    out.note = rule.note;
  }
  return { ok: true, out: out };
}

function normHighlights(list, at, ownerType, owner) {
  if (!inList(HIGHLIGHT_OWNER_TYPES, ownerType)) return fail(at, 'this element cannot own highlights');
  if (!Array.isArray(list)) return fail(at, 'highlights must be an array');
  if (list.length > LIMITS.highlights) return fail(at, 'an element holds at most ' + LIMITS.highlights + ' highlights');
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var rule = normHighlight(list[i], at + '/' + i, ownerType, owner);
    if (!rule.ok) return rule;
    if (has(seen, rule.out.id)) return fail(at + '/' + i + '/id', 'duplicate highlight id "' + rule.out.id + '"');
    seen[rule.out.id] = true;
    out.push(rule.out);
  }
  return { ok: true, out: out };
}

/** The old owner grammar runs on every old key, then the optional child is appended.
 * Existing definitions retain their exact key order and absent highlights stay absent. */
function withoutHighlights(owner) {
  if (!owner || typeof owner !== 'object' || !has(owner, 'highlights')) return owner;
  var out = Object.create(null);
  for (var key in owner) if (has(owner, key) && key !== 'highlights') out[key] = owner[key];
  return out;
}

function appendHighlights(owner, result, at, ownerType) {
  if (!result.ok || !has(owner, 'highlights')) return result;
  var highlights = normHighlights(owner.highlights, at + '/highlights', ownerType, owner);
  if (!highlights.ok) return highlights;
  result.out.highlights = highlights.out;
  return result;
}

/**
 * Table B — the value union (§2). Every value slot in the spec stores exactly one of
 * `metric` / `formula` / `canonical` / `bound`, and `out`'s keys are assigned in the
 * table's column order because the stored JSON is byte-compared.
 *
 * `unitFamily` is stored on `metric` values too and the CLIENT is its authority: the
 * server has no metric→family catalogue and cannot get one, yet axis legality, format
 * compatibility, pie summability and the cumulative rule all read it. It is checked for
 * CONSISTENCY here; it is derived from the metric catalogue exactly once, at the moment
 * the client mints the value.
 */
function normValue(v, at, ctx) {
  var bad = obj(v, at, 'a value');
  if (bad) return bad;
  if (!inList(VALUE_KINDS, v.kind)) return fail(at, 'unknown value kind "' + show(v.kind) + '"');

  if (v.kind === 'metric') {
    bad = onlyKeys(v, at, ['kind', 'metric', 'source', 'unitFamily', 'metricBy']);
    if (bad) return bad;
    // SHAPE only, never existence — the checkDimKey / preset doctrine. The delivery fields
    // live in workspace/src/lib/dashboard/widget-data.js (`TS_FIELDS`, the union of the
    // four sets widget-formula.js declares; 31 of them since M3 gave `costBudTotal` its
    // line) and a dimension source's custom keys are per-pacing config; neither is
    // reachable from dash-gate, and an unknown field already draws `Unknown field "x"` on
    // its own tile. What the charset buys is that a crafted key ('../etc') never reaches a
    // lookup. Counted by NAME rather than by line, because a line number goes stale in
    // silence and a set name does not.
    if (typeof v.metric !== 'string' || !METRIC_KEY_RE.test(v.metric)) {
      return fail(at, 'metric "' + show(v.metric) + '" is not a metric key (letter, then up to 39 letters/digits/underscores)');
    }
    if (!inList(SOURCES, v.source)) return fail(at, 'unknown value source "' + show(v.source) + '"');
    if (!inList(UNIT_FAMILIES, v.unitFamily)) return fail(at, 'unknown unitFamily "' + show(v.unitFamily) + '"');
    // §4: those three fields ARE the CM360 dataset today, and all three are counts.
    if (v.source === 'cm') {
      if (CM_FIELDS.indexOf(v.metric) === -1) {
        return fail(at, 'a cm source carries only impressions, clicks, completions; "' + show(v.metric) + '" is not one');
      }
      if (v.unitFamily !== 'count') return fail(at, 'a cm metric is a count, not "' + show(v.unitFamily) + '"');
    }
    var mval = { kind: 'metric', metric: v.metric, source: v.source, unitFamily: v.unitFamily };
    // APPENDED, so every value stored before this key is byte-identical (`defaultBy`'s rule,
    // one table over). `metricBy: 'buyUnit'` says the metric here is the pacing's buy unit —
    // the stored `metric` is a PLACEHOLDER the render-time pre-step overwrites, which is how a
    // Breakdown with NO metric switch still shows clicks on a CPC campaign. The three rails
    // are what makes the placeholder safe to overwrite with im / cl / co: the buy unit is a
    // delivery count, so a value that is not one could never hold the answer, and a stored
    // spec that says otherwise is a bug rather than something to repair silently.
    if (has(v, 'metricBy')) {
      if (!inList(METRIC_DEFAULT_BY, v.metricBy)) return fail(at, 'metricBy is ' + METRIC_DEFAULT_BY.join(' or ') + ', not "' + show(v.metricBy) + '"');
      if (v.source !== 'bq') return fail(at, 'a metricBy value reads the delivery source, not "' + show(v.source) + '"');
      if (v.unitFamily !== 'count') return fail(at, 'a metricBy value is a count, not "' + show(v.unitFamily) + '"');
      // COLUMN_BUY_UNITS is the SAME three ids for the same reason (`buyUnitOf`'s answers), so
      // the column rail and this one cannot come to disagree about what a buy unit is.
      if (COLUMN_BUY_UNITS.indexOf(v.metric) === -1) {
        return fail(at, 'a metricBy value holds a buy-unit metric (' + COLUMN_BUY_UNITS.join(', ') + '); "' + show(v.metric) + '" is not one');
      }
      mval.metricBy = v.metricBy;
    }
    return { ok: true, out: mval };
  }

  if (v.kind === 'formula') {
    bad = onlyKeys(v, at, ['kind', 'expr', 'unitFamily']);
    if (bad) return bad;
    // CONTENT is not parsed (§7.1: the client is the syntax gate, and a broken expression
    // only ever breaks its own tile). Length and blankness are the whole server rule.
    if (typeof v.expr !== 'string' || !v.expr.replace(/\s/g, '')) return fail(at, 'formula is empty');
    if (v.expr.length > LIMITS.formula) return fail(at, 'formula is over ' + LIMITS.formula + ' characters');
    if (!inList(UNIT_FAMILIES, v.unitFamily)) return fail(at, 'a formula declares its unitFamily; "' + show(v.unitFamily) + '" is not one of count, money, percent, number');
    return { ok: true, out: { kind: 'formula', expr: v.expr, unitFamily: v.unitFamily } };
  }

  if (v.kind === 'canonical') {
    bad = onlyKeys(v, at, ['kind', 'key', 'unitFamily', 'reading']);
    if (bad) return bad;
    // A missing ctx is a HOST bug, and it still has to reject rather than throw: see INJECTED
    // FACTS above — a TypeError out of here answers 500 where every grammar rejection is a 400.
    if (!ctx || typeof ctx.isCanonicalMetric !== 'function') return fail(at, 'no canonical-metric catalogue was injected');
    if (typeof v.key !== 'string' || !ctx.isCanonicalMetric(v.key)) return fail(at, 'unknown canonical metric "' + show(v.key) + '"');
    if (!inList(UNIT_FAMILIES, v.unitFamily)) return fail(at, 'unknown unitFamily "' + show(v.unitFamily) + '"');
    if (has(v, 'reading') && v.reading !== 'value' && v.reading !== 'target') {
      return fail(at, 'reading is value or target, not "' + show(v.reading) + '"');
    }
    var canonical = { kind: 'canonical', key: v.key, unitFamily: v.unitFamily };
    // Omission is the existing value reading and stays omitted, so every old fixture remains
    // byte-stable. An explicit `value` is retained because the strict grammar never strips an
    // authored key merely because it equals the semantic default.
    if (has(v, 'reading')) canonical.reading = v.reading;
    return { ok: true, out: canonical };
  }

  // `bound` = "whatever the metric switch is on". It names no control BECAUSE there is at
  // most one metric switch (Table C) — a second one would make every bound element
  // ambiguous, which is why that cap is derived rather than authored.
  bad = onlyKeys(v, at, ['kind']);
  if (bad) return bad;
  return { ok: true, out: { kind: 'bound' } };
}

/**
 * The stored auto/manual label flag (§2). `labelAuto: true` means the renderer writes the
 * caption from the value, so the stored label MUST be empty — a non-empty one beside the
 * flag is two answers to one question. `labelAuto: false` means the user typed it, and it
 * sticks: 1..60 characters, stored verbatim, never trimmed and never sliced.
 *
 * Reads exactly `label` and `labelAuto`; the CONTAINING object owns its own onlyKeys, so
 * this may be handed the whole series/column/option. `ctx` is unused today and is here for
 * symmetry with normValue — a future label rule that needs the catalogue changes no call
 * site.
 */
function normLabel(o, at, ctx) {
  var bad = obj(o, at, 'a label pair');
  if (bad) return bad;
  if (typeof o.label !== 'string') return fail(at, 'label must be a string');
  if (typeof o.labelAuto !== 'boolean') return fail(at, 'labelAuto must be true or false');
  if (o.label.length > LIMITS.label) return fail(at, 'label is over ' + LIMITS.label + ' characters');
  if (o.labelAuto && o.label !== '') return fail(at, 'labelAuto true stores an empty label; a typed label sets labelAuto false');
  if (!o.labelAuto && !o.label.replace(/\s/g, '')) return fail(at, 'a manual label may not be blank; set labelAuto true instead');
  return { ok: true, out: { label: o.label, labelAuto: o.labelAuto } };
}

/**
 * One control (§6, Table C). The TYPE decides which key set is legal, so `onlyKeys` runs per
 * branch, before anything else on the object is read. PRIVATE: normControls has already
 * guarded the object and checked `c.type` against CONTROL_TYPES, and the last branch here is
 * breakdown by elimination — an unchecked type reaching this would be read as one.
 *
 * `label` is 1..60 and always authored: a control names a question the viewer is answering,
 * and there is no value to write it from, so there is no labelAuto here and normLabel does
 * not apply. The blank refusal is normLabel's manual rule, restated for the same reason.
 */
function normControl(c, at, ctx) {
  // Every allowed[] lists its keys in exactly the order the matching out{} literal stores
  // them. The two move together — otherwise canonical-order review breaks with nothing to
  // catch it, because onlyKeys does not care about order and the goldens are byte-compared.
  var allowed;
  if (c.type === 'metric') allowed = ['id', 'type', 'label', 'options', 'defaultOptionId', 'defaultBy'];
  else if (c.type === 'period') allowed = ['id', 'type', 'label', 'options', 'defaultOption'];
  else if (c.type === 'dimension') allowed = ['id', 'type', 'label', 'options', 'defaultOption', 'optionsAuto'];
  else if (c.type === 'projection') allowed = ['id', 'type', 'label'];
  else allowed = ['id', 'type', 'label', 'maxSelected'];
  var bad = onlyKeys(c, at, allowed);
  if (bad) return bad;

  bad = badNodeId(c.id, at, 'control id');
  if (bad) return bad;
  if (typeof c.label !== 'string') return fail(at, 'label must be a string');
  if (c.label.length > LIMITS.label) return fail(at, 'label is over ' + LIMITS.label + ' characters');
  if (!c.label.replace(/\s/g, '')) return fail(at, 'a control label is typed, never derived; it may not be blank');

  if (c.type === 'metric') {
    if (!Array.isArray(c.options)) return fail(at + '/options', 'options must be an array');
    if (c.options.length < MIN_SWITCH_OPTIONS) return fail(at + '/options', 'a metric switch needs at least ' + MIN_SWITCH_OPTIONS + ' options');
    if (c.options.length > LIMITS.metricOptions) return fail(at + '/options', 'a metric switch holds at most ' + LIMITS.metricOptions + ' options');
    var options = [];
    var seenOption = {};
    for (var j = 0; j < c.options.length; j++) {
      var oAt = at + '/options/' + j;
      var o = c.options[j];
      var badOpt = obj(o, oAt, 'an option');
      if (badOpt) return badOpt;
      badOpt = onlyKeys(o, oAt, ['id', 'label', 'labelAuto', 'value']);
      if (badOpt) return badOpt;
      badOpt = badNodeId(o.id, oAt, 'option id');
      if (badOpt) return badOpt;
      // The ids are what defaultOptionId and every per-option rejection NAME, so a repeat
      // would make one detail point at two options.
      if (has(seenOption, o.id)) return fail(oAt, 'duplicate option id "' + show(o.id) + '"');
      seenOption[o.id] = true;
      var lab = normLabel(o, oAt, ctx);
      if (!lab.ok) return lab;
      var val = normValue(o.value, oAt + '/value', ctx);
      if (!val.ok) return val;
      // `bound` is "whatever this switch is on" — an option of it would be the switch
      // pointing at itself, and there would be nothing left to resolve.
      if (val.out.kind === 'bound') return fail(oAt + '/value', 'a switch option may not be a bound value; bound is what this switch resolves TO');
      // …and for the same reason it may not follow the buy unit either: an option is one of the
      // choices the VIEWER picks between, so resolving every one of them to the pacing's buy
      // unit would leave a switch offering the same metric three times. `defaultBy` on the
      // switch is how a switch follows the buy unit.
      if (has(val.out, 'metricBy')) return fail(oAt + '/value', 'a switch option is a fixed choice; use defaultBy on the switch to follow the buy unit');
      options.push({ id: o.id, label: lab.out.label, labelAuto: lab.out.labelAuto, value: val.out });
    }
    // The string guard is LOAD-BEARING, not a type formality: hasOwnProperty converts its key
    // with ToPropertyKey, so { toString: function () { return 'o1'; } } answers true on a bare
    // lookup — and then the OBJECT, not an id, is what gets stored as the default.
    if (typeof c.defaultOptionId !== 'string' || !has(seenOption, c.defaultOptionId)) {
      return fail(at, 'defaultOptionId "' + show(c.defaultOptionId) + '" names no option of this switch');
    }
    var mout = { id: c.id, type: 'metric', label: c.label, options: options, defaultOptionId: c.defaultOptionId };
    // APPENDED, so every switch stored before it is byte-identical. The stored default stays
    // the fallback: a pacing with no line items, or one bought on a unit this switch has no
    // option for, opens on it.
    if (has(c, 'defaultBy')) {
      if (!inList(METRIC_DEFAULT_BY, c.defaultBy)) return fail(at + '/defaultBy', 'defaultBy is ' + METRIC_DEFAULT_BY.join(' or ') + ', not "' + show(c.defaultBy) + '"');
      mout.defaultBy = c.defaultBy;
    }
    return { ok: true, out: mout };
  }

  if (c.type === 'period') {
    if (!Array.isArray(c.options)) return fail(at + '/options', 'options must be an array');
    if (c.options.length < MIN_SWITCH_OPTIONS) return fail(at + '/options', 'a period switch needs at least ' + MIN_SWITCH_OPTIONS + ' choices');
    var picked = {};
    for (var k = 0; k < c.options.length; k++) {
      var range = c.options[k];
      if (!inList(PERIOD_CHOICES, range)) return fail(at + '/options/' + k, 'unknown period choice "' + show(range) + '"');
      if (has(picked, range)) return fail(at + '/options/' + k, 'period choice "' + range + '" is listed twice');
      picked[range] = true;
    }
    // No maximum is stated: seven unique values out of a seven-value list IS the maximum, and
    // an eighth entry can only be a repeat, which the line above already refused.
    // Same ToPropertyKey trap as defaultOptionId above, same guard.
    if (typeof c.defaultOption !== 'string' || !has(picked, c.defaultOption)) {
      return fail(at, 'defaultOption "' + show(c.defaultOption) + '" is not one of this switch\'s options');
    }
    // The stored order comes from PERIOD_CHOICES, not from the author — so it is structural,
    // and a sort comparator can never disagree with it. (The legacy `ranges` rule.)
    return { ok: true, out: {
      id: c.id, type: 'period', label: c.label,
      options: PERIOD_CHOICES.filter(function (r) { return has(picked, r); }),
      defaultOption: c.defaultOption
    } };
  }

  if (c.type === 'dimension') {
    // The AUTO switch (sections cutover 2026-09-07): no stored list at all — the tile
    // resolves the pacing's dimensions on every render (auto-controls.js), which is the legacy
    // Breakdown panel's own tab bar. Either shape, never both: a list beside the flag would be
    // two answers to which chips this switch offers.
    if (has(c, 'optionsAuto')) {
      if (c.optionsAuto !== true) return fail(at + '/optionsAuto', 'optionsAuto is true or absent; a switch with a stored list simply does not carry it');
      if (has(c, 'options') || has(c, 'defaultOption')) return fail(at, 'a dimension switch is auto (optionsAuto) or a stored list (options and defaultOption), never both');
      return { ok: true, out: { id: c.id, type: 'dimension', label: c.label, optionsAuto: true } };
    }
    // The viewer's own cut (M4). Its options ARE stored — the opposite trade from breakdown
    // above, and the reason Option B is the smaller change: a dimension key is a fact the
    // host already answers for three slots, so the same injected `checkDimKey` judges these
    // at save time and no new host contract appears. `where` is 'option', so a rejection
    // reads as a sentence about the option it points at.
    if (!Array.isArray(c.options)) return fail(at + '/options', 'options must be an array');
    if (c.options.length < MIN_SWITCH_OPTIONS) return fail(at + '/options', 'a dimension switch needs at least ' + MIN_SWITCH_OPTIONS + ' dimensions');
    var dims = [];
    for (var d = 0; d < c.options.length; d++) {
      var dAt = at + '/options/' + d;
      var got = checkDim(c.options[d], dAt, ctx, 'option');
      if (!got.ok) return got;
      // By VALUE, never as a property key: a dimension key is free text (a `ds:` axis
      // carries a per-pacing source id), so a seen-MAP would answer for '__proto__'.
      if (dims.indexOf(got.key) !== -1) return fail(dAt, 'dimension "' + show(got.key) + '" is listed twice');
      dims.push(got.key);
    }
    // No maximum, and that is a decision: every option is a distinct key the HOST accepted,
    // so the list is bounded by the pacing's own dimension catalogue the way the period
    // switch's is bounded by RANGE_VALUES. What is left unbounded is how many of them one
    // author picks, and `LIMITS.specBytes` is the rail that already answers for that.
    //
    // The stored order is the AUTHOR's, unlike the period switch's. RANGE_VALUES is a closed
    // vocabulary whose order means something (1d before flight); a dimension list has no
    // order this dependency-free module can see, and the order IS the chip order the viewer
    // reads left to right. The two mints that write one (the builder's panel and the
    // Breakdown preset) write it in the catalogue's order, which is the nearest thing this
    // product has to the legacy DIM_ORDER.
    //
    // Same ToPropertyKey trap as defaultOptionId, guarded the same way — and `indexOf` is
    // what the membership test is, so a crafted `{toString}` matches nothing either.
    if (typeof c.defaultOption !== 'string' || dims.indexOf(c.defaultOption) === -1) {
      return fail(at, 'defaultOption "' + show(c.defaultOption) + '" is not one of this switch\'s dimensions');
    }
    return { ok: true, out: { id: c.id, type: 'dimension', label: c.label, options: dims, defaultOption: c.defaultOption } };
  }

  if (c.type === 'projection') {
    // Plan/Reforecast is deliberately fixed vocabulary. Options are not repeated in every
    // Widget; the control id is the stable preference key and the renderer reads
    // PROJECTION_MODES from this grammar.
    return { ok: true, out: { id: c.id, type: 'projection', label: c.label } };
  }

  // Breakdown. Which dimensions it offers is resolved at RUNTIME from the effective mapping
  // (§6 firstTwoNonAuto) and is never stored — that is what makes the widget portable across
  // pacings. `maxSelected` is the whole stored rule. Its dataset requirement (CM360 only)
  // needs the dataset, so it lives in normReport.
  if (!isInt(c.maxSelected) || c.maxSelected < 1 || c.maxSelected > LIMITS.breakdownMaxSelected) {
    return fail(at, 'maxSelected is a whole number from 1 to ' + LIMITS.breakdownMaxSelected + ', not "' + show(c.maxSelected) + '"');
  }
  return { ok: true, out: { id: c.id, type: 'breakdown', label: c.label, maxSelected: c.maxSelected } };
}

/**
 * The control list. 0..5 entries, at most one of EACH type, and the stored
 * order is the fixed CONTROL_TYPES order: an author who drags the
 * breakdown switch above the period switch moves no stored byte, so two identical widgets
 * stay byte-identical.
 *
 * Takes no `at`. Controls sit at exactly one place in the grammar, so the pointer root is a
 * constant here and every child pointer is composed from it.
 *
 * NOT here, because a control list cannot see either fact: REACHABILITY (a metric, breakdown
 * or dimension control nobody consumes rejects) needs the views, and the two COUPLING rules
 * (a CM360 dataset or an absolute scope forbids the period control) need the dataset and the
 * outer scope. They land in normReport and in widgets-validate.
 */
function normControls(list, ctx) {
  var at = '/spec/controls';
  if (!Array.isArray(list)) return fail(at, 'controls must be an array');
  // Unfireable today, and kept on purpose: with five types a sixth entry can only REPEAT a
  // type, which the per-type rail below refuses first. It became binding for one edit when
  // `dimension` joined CONTROL_TYPES and this number was still 3 — which is exactly the day
  // the file predicted, and the reason the line is here. That is also why the period
  // switch's maximum is not stated: six unique values out of a six-value list cannot be
  // exceeded EVER, by any later edit, so a cap there would be unreachable rather than
  // merely dormant.
  if (list.length > LIMITS.controls) return fail(at, 'a widget carries at most ' + LIMITS.controls + ' controls, one of each type');
  var byType = {};
  var seenId = {};
  var i;
  for (i = 0; i < list.length; i++) {
    var cAt = at + '/' + i;
    var c = list[i];
    var bad = obj(c, cAt, 'a control');
    if (bad) return bad;
    if (!inList(CONTROL_TYPES, c.type)) return fail(cAt, 'unknown control type "' + show(c.type) + '"');
    if (has(byType, c.type)) {
      // One metric switch is DERIVED, not chosen: a `bound` value stores no control id, so a
      // second switch would leave every bound element ambiguous. The other two are one-of-a-
      // kind because the widget has one chip row and one breakdown picker.
      return fail(cAt, c.type === 'metric'
        ? 'only one metric control is allowed; a bound value names no control'
        : 'only one ' + c.type + ' control is allowed');
    }
    var r = normControl(c, cAt, ctx);
    if (!r.ok) return r;
    if (has(seenId, c.id)) return fail(cAt, 'duplicate control id "' + show(c.id) + '"');
    seenId[c.id] = true;
    byType[c.type] = r.out;
  }
  var out = [];
  for (i = 0; i < CONTROL_TYPES.length; i++) {
    if (has(byType, CONTROL_TYPES[i])) out.push(byType[CONTROL_TYPES[i]]);
  }
  return { ok: true, out: out };
}

/**
 * The VALUES a stored slot can resolve to: itself, for a fixed value; and for a `bound` one, the
 * value of EVERY option of the metric switch — §6 says every option must be legal for every bound
 * element, so each rule walks this array and names `options[i]` when it refuses. `options[i]` is
 * null for a fixed value, because there is no option to name.
 *
 * Call form: optionValues(value, at, env) — `at` is the pointer the refusal carries, and it points
 * at the ELEMENT: the fix for a bound value with no switch is "add a metric control", not "fix
 * this value". `env` is the view env (its `controls` is the normalized list).
 *
 * Not part of the shared floor: it reads the NORMALIZED control list, so it sits beside the
 * normalizer that produces one. `familiesOf` is this walk read for unit families; the dual-source
 * rules (a Δ% column, a KPI's Δ-vs-other-source line) read the values themselves.
 *
 * NOT the spec walk — walkValues is. This EXPANDS one element (one bound value → N option values)
 * so a rule can be checked against every position the switch can take, while walkValues counts
 * SLOTS: one column value is ONE value whether it is bound or fixed, and a switch's options are
 * counted once, under controls[]. Reading this as the walk would count a bound element N times
 * and still miss the option values of a switch nothing binds to.
 */
function optionValues(value, at, env) {
  if (value.kind !== 'bound') return { ok: true, values: [value], options: [null] };
  var ctl = null;
  var i;
  for (i = 0; i < env.controls.length; i++) {
    if (env.controls[i].type === 'metric') ctl = env.controls[i];
  }
  // There is at most one metric switch (Table C), which is why a bound value stores no control
  // id — and why the only way to be unresolvable is for there to be no switch at all.
  if (!ctl) return fail(at, 'a bound value follows the metric switch, and this widget has no metric control');
  var values = [];
  var options = [];
  for (i = 0; i < ctl.options.length; i++) {
    values.push(ctl.options[i].value);
    options.push(ctl.options[i].id);
  }
  return { ok: true, values: values, options: options };
}

/**
 * The unit families a stored value can SHOW — optionValues read one field deep. Its readers are
 * the chart's axis and cumulative rules, a column's format, a KPI's format and target, and a
 * pie's format and summability; each refusal names `options[i]`.
 */
function familiesOf(value, at, env) {
  var r = optionValues(value, at, env);
  if (!r.ok) return r;
  var families = [];
  for (var i = 0; i < r.values.length; i++) {
    // Every value kind but `bound` stores a unitFamily, and an option may not BE bound (Table C),
    // so this answers for a fixed value and for every option of a switch alike.
    families.push(r.values[i].unitFamily);
  }
  return { ok: true, families: families, options: r.options };
}

/** Two family SETS overlap. A one-entry set is a fixed value's; a longer one is a bound
 *  value's, and any single option landing in both sets is enough — the switch has one
 *  position at a time. */
function sharesFamily(a, b) {
  for (var i = 0; i < a.length; i++) {
    if (b.indexOf(a[i]) !== -1) return true;
  }
  return false;
}

/**
 * The dual-source canonical form (§4 + the plan's Table B/G/D): a metric BOTH sources carry,
 * stored on the bq side. ONE form, so the same switch drives ordinary series without ambiguity
 * and a Δ% always knows which side it subtracts. Three slots ask — a Δ% column (Table G), a KPI's
 * deltaVsOtherSource line (Table D) and the metric switch a compare view names (Table D). `v` is
 * already normalized, so these four conjuncts are the whole rule.
 *
 * Three of the four are observable one at a time; the `kind` conjunct is not, and no test can
 * make it so: normValue stores `metric` on a metric value ONLY, so a formula or a canonical
 * value fails the CM_FIELDS line anyway. It stays because it states what the next three read,
 * and because a caller that ever hands this an UN-normalized value has to fail on the kind.
 */
function isDualSource(v) {
  return v.kind === 'metric' && CM_FIELDS.indexOf(v.metric) !== -1 && v.source === 'bq' && v.unitFamily === 'count';
}

/**
 * How deep a brick can sit under the node this walk is given: a Layout view's `rows` list, a
 * row, its `cols`, a column, its `bricks`, the block, its `cells` / `series`, a cell, and that
 * cell's `bind`. Nine levels, and twelve leaves room for a draft mid-edit that is one level
 * off. It is a TERMINATION bound first: the builder asks this on every keystroke, and a draft
 * object may be cyclic long before it is ever normalized.
 */
var CM_BRICK_DEPTH = 12;

/**
 * The node budget the two walks below share. It is a TERMINATION and DoS rail — they are asked
 * of a DRAFT, which may be cyclic, and the depth bound alone does not stop a wide cyclic graph
 * from branching — so it has to sit above the largest tree the grammar ACCEPTS. Under it, a
 * legal Layout's last binding is silently missed: the walk answers false and the tile never
 * fetches the CM360 file for a number it is drawing. `LIMITS.compositionNodes` (384) counts
 * VIEW nodes and is smaller than that tree, so the bound comes off the Layout caps instead:
 *
 *   structure   1 rows list + 6 rows + 6 cols lists + 24 columns + 24 bricks lists  =    61
 *   badges      24 column badges, each with its binding                             =    48
 *   blocks      32 blocks × (1 cells/series list + 4 cells + 2 lines)               =   224
 *   bindings    layoutBindings of them at most, one object each                     =   152
 *   highlights  224 rule owners × (1 list + 8 rules × 7 — the rule, its style, its
 *               condition, both thresholds, an input and a guard)                   = 12768
 *
 * — about 13 250 object visits for the highlight walk, and the expression walk, which skips
 * `highlights`, costs under 500 of it. The doubling is the headroom the caps get when they
 * grow. A walk stops at the first cm identifier, so this is a ceiling and not a cost.
 */
var CM_BRICK_NODE_BUDGET = 2 * (LIMITS.layoutBricks * (1 + LIMITS.layoutCells + LIMITS.layoutSeries)
  * (1 + LIMITS.highlights * 7) + LIMITS.layoutBindings + 512);

/**
 * anyCmBrickExpr(node) → does this brick, Layout rows list or badge hold a cm-bearing
 * formula anywhere inside it?
 *
 * Bricks never enter `walkValues`. A Layout binding is `{expr}` with no value union around
 * it, so the seven slots `pushViewValues` declares cannot see one, and that walk may not
 * learn to: it also feeds the 48-value cap and rail 6c, where a block binding has no
 * business being counted. Two readers ask this one instead, for the same reason they share
 * `specWantsCm`: the tile that fetches the CM360 file for a block printing `cmIm`, and rail
 * 6d, which would otherwise refuse that widget for showing none of the data it reads.
 *
 * `highlights` is skipped deliberately. A highlight paints, it shows no number, and rail 6d
 * does not count one as a consumer (§2.8); walking into one here is how a highlight-only
 * widget would pass that rail through the back door.
 *
 * Text only, like every other cm test in this module: it parses no formula content, so the
 * whole-identifier scan IS the answer (§2.1).
 */
function anyCmBrickExpr(node) {
  return cmBrickWalk(node, 1, { left: CM_BRICK_NODE_BUDGET });
}
function cmBrickWalk(value, depth, budget) {
  var i;
  var k;
  if (!value || typeof value !== 'object' || depth > CM_BRICK_DEPTH || budget.left <= 0) return false;
  budget.left--;
  if (Array.isArray(value)) {
    for (i = 0; i < value.length; i++) if (cmBrickWalk(value[i], depth + 1, budget)) return true;
    return false;
  }
  if (typeof value.expr === 'string' && CM_EXPR_RE.test(value.expr)) return true;
  // Every key but `highlights`, on purpose. An object carrying a string `expr` under a brick
  // IS a binding, whatever slot holds it, so a slot the brick grammar grows later is one this
  // walk already reads. A typed list of slots would go stale the day that happens, and the
  // walk would answer false for a CM360 number the tile is drawing.
  for (k in value) {
    if (!has(value, k) || k === 'highlights') continue;
    if (cmBrickWalk(value[k], depth + 1, budget)) return true;
  }
  return false;
}

/**
 * anyCmBrickHighlight(node) → does this brick, Layout rows list or badge hold a cm-bearing
 * HIGHLIGHT anywhere inside it?
 *
 * The other half of the pair, and the two are separate because their readers are (§2.7,
 * §2.8). A rule reading `cmIm` has nothing to paint with until the file lands, so the FETCH
 * gate must count it — `specWantsCm` ORs this in. Rail 6d must NOT: a highlight paints, it
 * shows no number, and a widget whose only CM360 is a rule is the silent dead config that
 * rail refuses. One predicate answering both would have to lie to one of them.
 *
 * `anyCmHighlight` (§2.8) is the per-owner rule — input, guard, and both thresholds — and it
 * is asked on every node this walk reaches, which is how a block, a stat-row cell and a
 * mini-chart line are covered by one scan. It is declared further down this file; both are
 * hoisted function declarations, so the order is a reading convenience only.
 */
function anyCmBrickHighlight(node) {
  return cmBrickHighlightWalk(node, 1, { left: CM_BRICK_NODE_BUDGET });
}
function cmBrickHighlightWalk(value, depth, budget) {
  var i;
  var k;
  if (!value || typeof value !== 'object' || depth > CM_BRICK_DEPTH || budget.left <= 0) return false;
  budget.left--;
  if (Array.isArray(value)) {
    for (i = 0; i < value.length; i++) if (cmBrickHighlightWalk(value[i], depth + 1, budget)) return true;
    return false;
  }
  if (anyCmHighlight(value)) return true;
  for (k in value) {
    if (!has(value, k)) continue;
    if (cmBrickHighlightWalk(value[k], depth + 1, budget)) return true;
  }
  return false;
}

/**
 * Does this VALUE read CM360 through an expression (§2.1)? The second of the two ways a value
 * can be CM-fed, and the one with no `source` key to read: a formula carries none, and never
 * gained one, because the source is in the identifier — `tests/report-v2-test.mjs` pins that
 * shape. Everything this file does with a cm value it must also do with one of these: fetch
 * for it (specWantsCm), refuse an entity scope over it, and count it as a consumer (6d).
 */
function exprIsCmBearing(v) {
  return !!v && typeof v === 'object' && v.kind === 'formula'
    && typeof v.expr === 'string' && CM_EXPR_RE.test(v.expr);
}

/**
 * The format ⇄ unit-family rule (§2's compatibility table), for the three slots that store a CELL
 * format AND print the value's own family: a table VALUE column, a KPI, a pie. It REJECTS, it
 * never reformats (§9). For a bound value every family the switch can show must accept the format,
 * and the refusal names the option (§6). A `delta` column is the one slot that does NOT come here
 * — see normColumn: it prints a family its value does not carry.
 *
 * `autoOk` is the only difference between the slots: `auto` says "the renderer picks", which a
 * table cell may say and §5.3/§5.4 forbid on a KPI and a pie — the two lists are the same set
 * minus one member, so the caller passes the difference instead of the module storing two tables.
 * `what` arrives as the §6 element phrase — `column "c1"`, `view "v1"` — because §6 says the
 * refusal names the element. Returns a rejection or null, like `obj`, `onlyKeys` and `badNodeId`.
 */
function badCellFormat(format, fams, at, what, autoOk) {
  if (!inList(CELL_FORMATS, format)) {
    return fail(at, 'unknown format "' + show(format) + '"; a cell prints as ' + CELL_FORMATS.join(', '));
  }
  if (!autoOk && format === 'auto') return fail(at, what + ' names the format it prints; auto belongs to a table cell');
  for (var i = 0; i < fams.families.length; i++) {
    var fam = fams.families[i];
    if (formatLegal(fam, format)) continue;
    return fail(at, what + ' stores format "' + format + '", which does not print the ' + fam + ' family; ' +
      (fams.options[i] === null ? 'this value is ' + fam : 'option "' + fams.options[i] + '" is ' + fam) +
      ', and ' + fam + ' prints as ' + FORMATS_BY_FAMILY[fam].join(', '));
  }
  return null;
}

/**
 * The ONE place a dimension key is resolved. Three slots ask a dimension question — a chart's X,
 * a table's rows, a pie's slices — and each names its own `where`, which is the word the HOST
 * prints in its detail, so a refusal says which slot it came from. It also type-checks the key: a
 * non-string is a dimension the host does not have, and its own detail says so. Every call site
 * stores the key the HOST returned (`dim.key`), never the one it was handed, so a host that
 * canonicalizes a key is what lands on the wire.
 */
function checkDim(key, at, ctx, where) {
  // A missing ctx is a HOST bug and still rejects rather than throws — see INJECTED FACTS.
  if (!ctx || typeof ctx.checkDimKey !== 'function') return fail(at, 'no dimension catalogue was injected');
  var r = ctx.checkDimKey(where, key);
  // The contract is a RETURNED result, so its detail becomes ours with our pointer in front —
  // it carries reasons («source "x" carries dimension "y"») a boolean would have thrown away.
  if (!r.ok) return fail(at, r.detail);
  return { ok: true, key: r.key };
}

/**
 * The OTHER way a slot names a dimension (M4): it names the dimension SWITCH, and the viewer
 * picks. All three dim slots resolve their reference through here, against the NORMALIZED
 * control list on `env` — the same place `normCompareView` resolves its two references, and
 * the same reason it can: controls are normalized before views (normReport's pass order).
 *
 * The type check is what makes the refusal readable. A slot that named the metric switch
 * would otherwise be refused by reachability instead, one pass later and about the wrong
 * control — the metric switch moves the NUMBER, and this slot moves the CUT.
 *
 * `whose` is the slot's own word, so the sentence says which chip to go and fix.
 */
function dimensionControl(controlId, at, env, whose) {
  var c = byId(env.controls, controlId);
  if (!c || c.type !== 'dimension') {
    return fail(at, whose + ' follows a dimension switch, and "' + show(controlId) + '" names none of this widget\'s controls');
  }
  return { ok: true, id: c.id };
}

/** One authored series paint. `auto` and palette slots preserve the existing grammar;
 * semantic names are the closed theme bridge used by materialized built-ins. */
function normPaint(v, at, what) {
  if (v === 'auto' || inList(SEMANTIC_PAINTS, v)) return { ok: true, out: v };
  if (isInt(v) && v >= 0 && v < COLOR_SLOTS) return { ok: true, out: v };
  return fail(at, what + ' is "auto", a palette slot 0-' + (COLOR_SLOTS - 1) +
    ' or a semantic paint token, not "' + show(v) + '"');
}

function normStrokeWidth(v, at) {
  if (inList(STROKE_WIDTHS, v) || EXACT_STROKE_WIDTHS.indexOf(v) !== -1) {
    return { ok: true, out: v };
  }
  return fail(at, 'unknown width "' + show(v) + '"; a stroke uses thin, normal, bold, 1, 1.5 or 2');
}

/**
 * The X axis (§5.1) is DATA, not a caption: it decides which series are drawable, whether Top N
 * means anything, and whether §7.2's guide refusal applies.
 */
function normXAxis(x, at, env, ctx) {
  var bad = obj(x, at, 'an x axis');
  if (bad) return bad;
  if (!inList(X_TYPES, x.type)) return fail(at, 'unknown x axis "' + show(x.type) + '"; a chart runs along date, li, a mapping dim or a dimension switch');
  if (x.type === 'control') {
    bad = onlyKeys(x, at, ['type', 'controlId']);
    if (bad) return bad;
    var ctl = dimensionControl(x.controlId, at, env, 'a chart axis');
    if (!ctl.ok) return ctl;
    return { ok: true, out: { type: 'control', controlId: ctl.id } };
  }
  if (x.type === 'date') {
    bad = onlyKeys(x, at, ['type', 'domain']);
    if (bad) return bad;
    if (has(x, 'domain') && !inList(DATE_DOMAINS, x.domain)) {
      return fail(at, 'unknown date domain "' + show(x.domain) + '"; a date axis uses calendar or factDates');
    }
    var dateAxis = { type: 'date' };
    if (has(x, 'domain')) dateAxis.domain = x.domain;
    return { ok: true, out: dateAxis };
  }
  if (x.type !== 'dim') {
    bad = onlyKeys(x, at, ['type']);
    if (bad) return bad;
    return { ok: true, out: { type: x.type } };
  }
  bad = onlyKeys(x, at, ['type', 'key']);
  if (bad) return bad;
  var dim = checkDim(x.key, at, ctx, 'xAxis');
  if (!dim.ok) return dim;
  return { ok: true, out: { type: 'dim', key: dim.key } };
}

/**
 * Table F — the series style. The TYPE decides the key set, so `onlyKeys` runs per branch. All
 * sub-keys are required: a style is always fully materialized, so the stored shape is one shape
 * and the renderer fills nothing at read time.
 */
function normStyle(st, at) {
  var bad = obj(st, at, 'a style');
  if (bad) return bad;
  if (!inList(STYLE_TYPES, st.type)) return fail(at, 'unknown style "' + show(st.type) + '"; a series is drawn as a line, an area or a bar');
  // Every allowed[] lists its keys in the order the matching out{} literal stores them (the
  // lockstep rule in normControl).
  if (st.type === 'bar') {
    bad = onlyKeys(st, at, ['type', 'bars', 'width']);
    if (bad) return bad;
    if (!inList(BAR_MODES, st.bars)) return fail(at, 'unknown bars "' + show(st.bars) + '"; bars are grouped or stacked');
    var barStyle = { type: 'bar', bars: st.bars };
    if (has(st, 'width')) {
      var bw = normStrokeWidth(st.width, at + '/width');
      if (!bw.ok) return bw;
      barStyle.width = bw.out;
    }
    return { ok: true, out: barStyle };
  }
  bad = onlyKeys(st, at, st.type === 'area' ? ['type', 'width', 'curve', 'points', 'fill'] : ['type', 'width', 'curve', 'points']);
  if (bad) return bad;
  var sw = normStrokeWidth(st.width, at + '/width');
  if (!sw.ok) return sw;
  if (!inList(CURVES, st.curve)) return fail(at, 'unknown curve "' + show(st.curve) + '"; a line runs straight, smooth or step');
  if (typeof st.points !== 'boolean') return fail(at, 'points must be true or false');
  if (st.type === 'line') return { ok: true, out: { type: 'line', width: sw.out, curve: st.curve, points: st.points } };
  if (!inList(AREA_FILLS, st.fill)) return fail(at, 'unknown fill "' + show(st.fill) + '"; an area fills light or strong');
  return { ok: true, out: { type: 'area', width: sw.out, curve: st.curve, points: st.points, fill: st.fill } };
}

/** The flow field a value IS, or '' when it is not one — the §7.2 test, which reads a BARE
 *  field only: a metric value naming one, or a formula that is nothing but one. `sp / im`
 *  contains two and is not one. */
function flowFieldOf(v) {
  if (v.kind === 'metric' && FLOW_FIELDS.indexOf(v.metric) !== -1) return v.metric;
  if (v.kind === 'formula' && FLOW_FIELDS.indexOf(v.expr.trim()) !== -1) return v.expr.trim();
  return '';
}

/**
 * The guide is a SLOT on a value series (§5.1 lists it under Calculations, but the same
 * paragraph says it is "owned by a named series"), so there is at most one — it is an object,
 * not an array — and a calc series has none. A value Guide is a fixed reference line; a
 * calculated Guide is its parent's own pacing plan: it stores the calculation and the mode,
 * never a basis or an output, because those ARE the parent's metric and accumulate (spec
 * 2026-09-10 «The child»). One fact, one place — a stored basis could only disagree.
 */
function normGuide(g, at, env, ctx, ownerValue) {
  var bad = obj(g, at, 'a guide');
  if (bad) return bad;
  var dynamic = has(g, 'calc');
  if (dynamic && (has(g, 'basis') || has(g, 'output'))) {
    return fail(at, 'a calculated guide follows its series; basis and output are not stored');
  }
  bad = onlyKeys(g, at, dynamic
    ? ['calc', 'mode', 'modeControlId', 'invert', 'label', 'labelPlacement', 'style', 'color', 'dashed', 'opacity', 'valuesOnChart']
    : ['value', 'invert', 'label', 'labelPlacement', 'style', 'color', 'dashed', 'opacity', 'valuesOnChart']);
  if (bad) return bad;
  var out;
  if (dynamic) {
    var calculation = normCalculationGuide(g, at, env, ownerValue);
    if (!calculation.ok) return calculation;
    out = calculation.out;
  } else {
    var val = normValue(g.value, at + '/value', ctx);
    if (!val.ok) return val;
    if (val.out.kind === 'bound') return fail(at + '/value', 'a guide is a fixed reference line; it may not follow the metric switch');
    // A bare flow is a window total, not a daily target. Calculation Guides use the
    // existing dated projection engine instead of weakening this scalar rule.
    var flow = env.xType === 'date' ? flowFieldOf(val.out) : '';
    if (flow) {
      return fail(at + '/value', '"' + flow + '" is a window total, off by the window length against a daily series; use a rate, a plan scalar, or a formula');
    }
    out = { value: val.out };
  }
  if (typeof g.invert !== 'boolean') return fail(at, 'invert must be true or false');
  out.invert = g.invert;
  var hasLabel = has(g, 'label');
  var hasPlacement = has(g, 'labelPlacement');
  if (hasLabel !== hasPlacement) {
    return fail(at, 'guide label and labelPlacement are an atomic pair; provide both or neither');
  }
  if (hasLabel) {
    if (typeof g.label !== 'string' || !g.label.replace(/\s/g, '')) return fail(at + '/label', 'a guide label may not be blank');
    if (g.label.length > LIMITS.label) return fail(at + '/label', 'guide label is over ' + LIMITS.label + ' characters');
    if (!inList(GUIDE_LABEL_PLACEMENTS, g.labelPlacement)) {
      return fail(at + '/labelPlacement', 'a guide label sits in the legend or plotTopRight, not "' + show(g.labelPlacement) + '"');
    }
    out.label = g.label;
    out.labelPlacement = g.labelPlacement;
  }
  // Sparse on both variants: old Guides retain their exact bytes, and changing the
  // source of a styled Guide does not discard its appearance.
  if (has(g, 'style')) {
    var style = normStyle(g.style, at + '/style');
    if (!style.ok) return style;
    if (style.out.type !== 'line') return fail(at + '/style', 'a guide is drawn as a line');
    out.style = style.out;
  }
  if (has(g, 'color')) {
    var color = normPaint(g.color, at + '/color', 'color');
    if (!color.ok) return color;
    out.color = color.out;
  }
  if (has(g, 'dashed')) {
    if (typeof g.dashed !== 'boolean' && !inList(DASH_PATTERNS, g.dashed)) return fail(at + '/dashed', 'dashed is true, false, short, medium or long');
    out.dashed = g.dashed;
  }
  if (has(g, 'opacity')) {
    if (typeof g.opacity !== 'number' || !isFinite(g.opacity) || g.opacity < 0 || g.opacity > 1) return fail(at + '/opacity', 'opacity is a finite number from 0 to 1');
    out.opacity = g.opacity;
  }
  if (has(g, 'valuesOnChart')) {
    if (typeof g.valuesOnChart !== 'boolean') return fail(at + '/valuesOnChart', 'valuesOnChart must be true or false');
    out.valuesOnChart = g.valuesOnChart;
  }
  return { ok: true, out: out };
}

/** A Guide owns a calculation, not a reference to another series. Non-date axes retain
 * the stored child; the renderer explains why it cannot draw there until Date is restored.
 *
 * The ONE calculation is the projection: Plan / day and Needed / day are its two fixed modes,
 * not kinds of their own. The parent decides the rest — every option the series can show
 * must be a metric the pacing engine plans (`PROJECTION_BASES`: im, cl, coViews, sp), so
 * the renderer can read the basis off the resolved value and the output off `accumulate`. */
function normCalculationGuide(g, at, env, ownerValue) {
  if (g.calc !== 'projection') return fail(at + '/calc', 'a calculated guide draws the projection; Plan / day and Needed / day are its fixed modes');
  if (env.datasetType !== 'delivery') return fail(at, 'a calculated guide uses delivery pacing plans and is unavailable for this data source');
  var out = { calc: 'projection' };
  if (has(g, 'mode')) {
    if (!inList(GUIDE_MODES, g.mode)) return fail(at + '/mode', 'a guide mode is plan or reforecast');
    if (has(g, 'modeControlId')) return fail(at, 'mode and modeControlId are one choice; keep one');
    out.mode = g.mode;
  }
  if (has(g, 'modeControlId')) {
    var modeControl = byId(env.controls, g.modeControlId);
    if (!modeControl || modeControl.type !== 'projection') return fail(at + '/modeControlId', 'projection mode "' + show(g.modeControlId) + '" names no Projection control of this widget');
    out.modeControlId = modeControl.id;
  }
  var owner = optionValues(ownerValue, at, env);
  if (!owner.ok) return owner;
  for (var i = 0; i < owner.values.length; i++) {
    var value = owner.values[i];
    var label = owner.options[i] === null ? 'this series' : 'metric option "' + owner.options[i] + '"';
    if (value.kind === 'metric' && value.source === 'cm') return fail(at, 'a calculated guide uses delivery pacing plans; ' + label + ' reads a different data source');
    if (value.kind !== 'metric' || !inList(PROJECTION_BASES, value.metric)) {
      return fail(at, 'a calculated guide needs a series measured in impressions, clicks, views or spend; ' + label + ' is not');
    }
  }
  return { ok: true, out: out };
}

function normSeriesPaint(s, at) {
  var color = normPaint(s.color, at + '/color', 'color');
  if (!color.ok) return color;
  var out = { color: color.out };
  if (has(s, 'fill')) {
    var fill = normPaint(s.fill, at + '/fill', 'fill');
    if (!fill.ok) return fill;
    out.fill = fill.out;
  }
  if (has(s, 'border')) {
    var border = normPaint(s.border, at + '/border', 'border');
    if (!border.ok) return border;
    out.border = border.out;
  }
  if (typeof s.dashed !== 'boolean' && !inList(DASH_PATTERNS, s.dashed)) {
    return fail(at + '/dashed', 'dashed is true, false, short, medium or long, not "' + show(s.dashed) + '"');
  }
  out.dashed = s.dashed;
  if (has(s, 'opacity')) {
    if (typeof s.opacity !== 'number' || !isFinite(s.opacity) || s.opacity < 0 || s.opacity > 1) {
      return fail(at + '/opacity', 'opacity is a finite number from 0 to 1, not "' + show(s.opacity) + '"');
    }
    out.opacity = s.opacity;
  }
  return { ok: true, out: out };
}

/**
 * Table E — ONE series of a chart (the list, and the cross-series axis rules, are
 * normChartView's own loop). Guards its own input: a `series: [null]` entry must reject as a
 * 400, never reach a property read.
 *
 * Returns the usual { ok, out } plus `families`, which is NOT stored: it is the family set the
 * axis rules intersect. A calc series derives its set from BASIS_FAMILY — a plan line IS a
 * count series (§8 makes the basis the unit), never null. Computing the set here is what lets
 * the cumulative refusal name the offending switch option.
 */
function normSeries(s, at, env, ctx) {
  return appendHighlights(s, normSeriesBody(withoutHighlights(s), at, env, ctx), at, 'series');
}

function normSeriesBody(s, at, env, ctx) {
  var bad = obj(s, at, 'a series');
  if (bad) return bad;
  if (!inList(SERIES_KINDS, s.kind)) return fail(at, 'unknown series kind "' + show(s.kind) + '"; a series draws a value or a calculation');
  // Every allowed[] lists its keys in the order the matching out{} literal stores them (the
  // lockstep rule in normControl); `guide` is last in both, and the one optional key.
  bad = onlyKeys(s, at, s.kind === 'value'
    ? ['id', 'kind', 'label', 'labelAuto', 'value', 'style', 'axis', 'color', 'fill', 'border', 'dashed', 'opacity', 'valuesOnChart', 'accumulate', 'hidden', 'guide']
    : ['id', 'kind', 'calc', 'basis', 'output', 'modeControlId', 'label', 'labelAuto', 'style', 'axis', 'color', 'fill', 'border', 'dashed', 'opacity', 'valuesOnChart', 'hidden']);
  if (bad) return bad;

  bad = badNodeId(s.id, at, 'series id');
  if (bad) return bad;
  var lab = normLabel(s, at, ctx);
  if (!lab.ok) return lab;
  var style = normStyle(s.style, at + '/style');
  if (!style.ok) return style;
  if (!inList(AXES, s.axis)) return fail(at, 'unknown axis "' + show(s.axis) + '"; a series sits on auto, left or right');
  var paint = normSeriesPaint(s, at);
  if (!paint.ok) return paint;
  if (typeof s.valuesOnChart !== 'boolean') return fail(at, 'valuesOnChart must be true or false');
  if (typeof s.hidden !== 'boolean') return fail(at, 'hidden must be true or false');

  if (s.kind === 'calc') {
    // Every calculation here is delivery pacing maths; a CM360 widget carries no plan.
    if (env.datasetType === 'deliveryCm360') return fail(at, 'a calculated projection is delivery pacing maths; a CM360 widget carries no plan');
    if (!inList(CALC_KINDS, s.calc)) return fail(at, 'unknown calculation "' + show(s.calc) + '"; a calc series draws planPerDay, neededPerDay or projection');

    var projection = s.calc === 'projection';
    var modeControl = null;
    if (projection) {
      if (!inList(PROJECTION_BASES, s.basis)) {
        return fail(at + '/basis', 'a projection basis is im, cl, coViews or sp, not "' + show(s.basis) + '"');
      }
      if (!inList(PROJECTION_OUTPUTS, s.output)) {
        return fail(at + '/output', 'a projection output is cumulative or perDay, not "' + show(s.output) + '"');
      }
      if (has(s, 'modeControlId')) {
        modeControl = byId(env.controls, s.modeControlId);
        if (!modeControl || modeControl.type !== 'projection') {
          return fail(at + '/modeControlId', 'projection mode "' + show(s.modeControlId) + '" names no Projection control of this widget');
        }
      }
    } else {
      if (has(s, 'output') || has(s, 'modeControlId')) {
        return fail(at, 'output and modeControlId belong only to the projection calculation');
      }
      if (!inList(CALC_BASES, s.basis)) return fail(at, 'a Plan/Needed line is measured in impressions; "im" is the only basis, not "' + show(s.basis) + '"');
    }
    // §3 amendment: legal on ANY x. On a non-date axis the stored series is SKIPPED at render
    // with its reason on the tile — it is never refused here, because refusing would delete a
    // series the user typed the moment they change the axis.
    // `basis` passed CALC_BASES above, so the family lookup below always answers.
    var calcOut = { id: s.id, kind: 'calc', calc: s.calc, basis: s.basis };
    if (projection) {
      calcOut.output = s.output;
      if (modeControl) calcOut.modeControlId = modeControl.id;
    }
    calcOut.label = lab.out.label;
    calcOut.labelAuto = lab.out.labelAuto;
    calcOut.style = style.out;
    calcOut.axis = s.axis;
    calcOut.color = paint.out.color;
    if (has(paint.out, 'fill')) calcOut.fill = paint.out.fill;
    if (has(paint.out, 'border')) calcOut.border = paint.out.border;
    calcOut.dashed = paint.out.dashed;
    if (has(paint.out, 'opacity')) calcOut.opacity = paint.out.opacity;
    calcOut.valuesOnChart = s.valuesOnChart;
    calcOut.hidden = s.hidden;
    return { ok: true, families: [BASIS_FAMILY[s.basis]], out: calcOut };
  }

  var val = normValue(s.value, at + '/value', ctx);
  if (!val.ok) return val;
  var fams = familiesOf(val.out, at, env);
  if (!fams.ok) return fams;
  if (!inList(ACCUMULATE_MODES, s.accumulate)) return fail(at, 'unknown accumulate "' + show(s.accumulate) + '"; a series runs daily or cumulative');
  if (s.accumulate === 'cumulative') {
    // The KIND rule first, then the family (owner, 2026-08-23 — §15). A canonical metric is ONE
    // number for the whole flight (§2), so a running sum of it adds that number to itself once
    // per day and draws a staircase describing nothing. The family rule below cannot catch it:
    // `imprExpected` is a count, and counts add up. Read option by option for a bound value,
    // because the switch can land on one.
    var cum = optionValues(val.out, at, env);
    if (!cum.ok) return cum;
    for (var ki = 0; ki < cum.values.length; ki++) {
      if (cum.values[ki].kind !== 'canonical') continue;
      return fail(at, 'series "' + s.id + '" adds up over the window (cumulative), and a campaign total cannot ' +
        'accumulate by day; ' + (cum.options[ki] === null ? 'this value' : 'option "' + cum.options[ki] + '"') +
        ' is one number for the whole flight');
    }
    for (var ci = 0; ci < fams.families.length; ci++) {
      if (ADDITIVE_FAMILIES.indexOf(fams.families[ci]) !== -1) continue;
      // §6: the refusal names the ELEMENT, and for a bound value the option that broke it.
      return fail(at, 'series "' + s.id + '" adds up over the window (cumulative), so it holds a count or money value; ' +
        (fams.options[ci] === null ? 'this one is ' : 'option "' + fams.options[ci] + '" is ') + fams.families[ci]);
    }
  }
  var guide = null;
  if (has(s, 'guide')) {
    guide = normGuide(s.guide, at + '/guide', env, ctx, val.out);
    if (!guide.ok) return guide;
  }
  var out = {
    id: s.id, kind: 'value', label: lab.out.label, labelAuto: lab.out.labelAuto, value: val.out,
    style: style.out, axis: s.axis, color: paint.out.color
  };
  if (has(paint.out, 'fill')) out.fill = paint.out.fill;
  if (has(paint.out, 'border')) out.border = paint.out.border;
  out.dashed = paint.out.dashed;
  if (has(paint.out, 'opacity')) out.opacity = paint.out.opacity;
  out.valuesOnChart = s.valuesOnChart;
  out.accumulate = s.accumulate;
  out.hidden = s.hidden;
  if (guide) out.guide = guide.out;
  return { ok: true, families: fams.families, out: out };
}

/**
 * Tables D, E and F — the Chart view (§5.1). PRIVATE: normView has obj-guarded the object and
 * matched `kind` against VIEW_KINDS, exactly as normControls does for normControl.
 *
 * The rail is onlyKeys FIRST, then reads in canonical order. The cross-series axis rules come
 * last because they need every series normalized.
 */
function normChartView(v, at, env, ctx) {
  // Every allowed[] lists its keys in the order the matching out{} literal stores them (the
  // lockstep rule in normControl); `topN` is last in both, and it is assigned after the literal
  // so the order still holds.
  var bad = onlyKeys(v, at, ['id', 'kind', 'title', 'titleAuto', 'x', 'orientation', 'series', 'formats', 'emptyBehavior', 'journal', 'topN']);
  if (bad) return bad;
  bad = badNodeId(v.id, at, 'view id');
  if (bad) return bad;
  if (typeof v.title !== 'string') return fail(at, 'title must be a string');
  if (v.title.length > LIMITS.title) return fail(at, 'title is over ' + LIMITS.title + ' characters');
  if (has(v, 'titleAuto')) {
    if (typeof v.titleAuto !== 'boolean') return fail(at + '/titleAuto', 'titleAuto must be true or false');
    if (v.titleAuto && v.title !== '') return fail(at, 'titleAuto true stores an empty authored title');
  }

  var x = normXAxis(v.x, at + '/x', env, ctx);
  if (!x.ok) return x;
  if (!inList(ORIENTATIONS, v.orientation)) return fail(at, 'unknown orientation "' + show(v.orientation) + '"; a chart runs vertical or horizontal');
  // §5.1 offers the toggle only off Date: time runs along the X axis, and a horizontal date
  // chart is a different chart, not a rotated one.
  if (v.orientation === 'horizontal' && x.out.type === 'date') {
    return fail(at, 'a date chart runs vertical; horizontal belongs on a line-item or dimension axis');
  }

  if (!Array.isArray(v.series)) return fail(at + '/series', 'series must be an array');
  if (!v.series.length) return fail(at + '/series', 'a chart draws at least one series');
  if (v.series.length > LIMITS.series) return fail(at + '/series', 'a chart holds at most ' + LIMITS.series + ' series');
  // The X axis is data the series are read against, so a series is normalized KNOWING it —
  // §7.2's guide refusal is a date-only rule and has nowhere else to read it from. This rebuild
  // is a WHITELIST: a fact added to env later must be re-listed here or it silently vanishes
  // below the series level.
  var senv = { controls: env.controls, datasetType: env.datasetType, xType: x.out.type };
  var series = [];
  var families = [];  // families[i] is series[i]'s set; a calc series carries its BASIS_FAMILY
  var seen = {};
  var i;
  var j;
  for (i = 0; i < v.series.length; i++) {
    var sAt = at + '/series/' + i;
    var r = normSeries(v.series[i], sAt, senv, ctx);
    if (!r.ok) return r;
    // The ids are what every per-series refusal NAMES, and what a P2 interaction would point at.
    if (has(seen, r.out.id)) return fail(sAt, 'duplicate series id "' + show(r.out.id) + '"');
    seen[r.out.id] = true;
    series.push(r.out);
    families.push(r.families);
  }

  bad = obj(v.formats, at + '/formats', 'an axis format pair');
  if (bad) return bad;
  bad = onlyKeys(v.formats, at + '/formats', ['left', 'right']);
  if (bad) return bad;
  if (!inList(CHART_FORMATS, v.formats.left)) return fail(at + '/formats', 'unknown left axis scale "' + show(v.formats.left) + '"; use a closed Chart format');
  if (!inList(CHART_FORMATS, v.formats.right)) return fail(at + '/formats', 'unknown right axis scale "' + show(v.formats.right) + '"; use a closed Chart format');

  if (has(v, 'emptyBehavior') && !inList(EMPTY_BEHAVIORS, v.emptyBehavior)) {
    return fail(at + '/emptyBehavior', 'emptyBehavior is placeholder or hide, not "' + show(v.emptyBehavior) + '"');
  }
  if (has(v, 'journal')) {
    if (typeof v.journal !== 'boolean') return fail(at + '/journal', 'journal must be true or false');
    if (v.journal && x.out.type !== 'date') return fail(at + '/journal', 'the journal overlay needs a date axis');
  }

  var hasTopN = has(v, 'topN');
  if (hasTopN) {
    // §7.3: Top N ranks categories. A date chart draws every day in the window, so there is
    // nothing to rank — and the key is REFUSED rather than ignored, because a stored topN
    // nobody applies is a setting that lies.
    if (x.out.type === 'date') return fail(at, 'a date chart draws every day in the window; topN belongs on a line-item or dimension axis');
    if (!isInt(v.topN) || v.topN < 1 || v.topN > LIMITS.chartTopN) {
      return fail(at, 'topN is a whole number from 1 to ' + LIMITS.chartTopN + ', not "' + show(v.topN) + '"');
    }
  }

  // Axis legality (§5.1) without ever MOVING a series. `auto` means "the renderer places it";
  // coercing it here would be the silent decision §9 forbids. Two rules:
  //   1. PAIRWISE, across DISTINCT series: for each EXPLICIT axis, no two series on it may have
  //      DISJOINT family sets. A series is never in conflict with itself, which is why a lone
  //      bound series spanning {count, money} is legal on one axis.
  //   2. WHOLE-CHART: the union of every series' family set may not exceed TWO families — two
  //      axes cannot hold three, so an `auto` series would be unplaceable and the refusal has to
  //      come now, not as a blank tile later.
  // A bound series' family SET is the set of its switch options' families. That set feeds rule 2,
  // the format check, the cumulative check and the pie check; in rule 1 it is intersected against
  // each other series' set.
  //
  // A CALC series is in both rules on the same terms: §8 makes the basis the unit, so a Plan or
  // Needed line drawing impressions per day IS a count series on whatever axis it lands on.
  for (i = 0; i < series.length; i++) {
    for (j = i + 1; j < series.length; j++) {
      if (series[i].axis === 'auto' || series[i].axis !== series[j].axis) continue;
      if (sharesFamily(families[i], families[j])) continue;
      return fail(at + '/series', 'series "' + series[i].id + '" (' + uniq(families[i]).join('/') + ') and series "' +
        series[j].id + '" (' + uniq(families[j]).join('/') + ') sit on the ' + series[i].axis +
        ' axis and share no unit; put one of them on the other axis');
    }
  }
  var all = [];
  for (i = 0; i < series.length; i++) {
    all = all.concat(families[i]);
  }
  var union = uniq(all);
  // The 2 here is the number of axes a chart has, which is structural — not a tunable cap.
  if (union.length > 2) {
    return fail(at + '/series', 'this chart mixes more than two unit families (' + union.join(', ') +
      '); it has a left axis and a right axis, and two axes cannot hold three');
  }

  var out = { id: v.id, kind: 'chart', title: v.title };
  if (has(v, 'titleAuto')) out.titleAuto = v.titleAuto;
  out.x = x.out;
  out.orientation = v.orientation;
  out.series = series;
  out.formats = { left: v.formats.left, right: v.formats.right };
  if (has(v, 'emptyBehavior')) out.emptyBehavior = v.emptyBehavior;
  if (has(v, 'journal')) out.journal = v.journal;
  if (hasTopN) out.topN = v.topN;
  return { ok: true, out: out };
}

/**
 * The row grain of a table (§5.2) — the same question normXAxis asks, over ROW_TYPES.
 */
function normRows(rw, at, env, ctx) {
  var bad = obj(rw, at, 'a row grain');
  if (bad) return bad;
  if (!inList(ROW_TYPES, rw.type)) return fail(at, 'unknown row grain "' + show(rw.type) + '"; a table runs down date, li, dateLi, a mapping dim or a dimension switch');
  if (rw.type === 'control') {
    bad = onlyKeys(rw, at, ['type', 'controlId']);
    if (bad) return bad;
    var ctl = dimensionControl(rw.controlId, at, env, 'a table\'s rows');
    if (!ctl.ok) return ctl;
    return { ok: true, out: { type: 'control', controlId: ctl.id } };
  }
  if (rw.type !== 'dim') {
    bad = onlyKeys(rw, at, ['type']);
    if (bad) return bad;
    return { ok: true, out: { type: rw.type } };
  }
  bad = onlyKeys(rw, at, ['type', 'key']);
  if (bad) return bad;
  var dim = checkDim(rw.key, at, ctx, 'rows');
  if (!dim.ok) return dim;
  return { ok: true, out: { type: 'dim', key: dim.key } };
}

/**
 * Table G — ONE column of a table (§5.2). Both kinds carry the SAME key set in the same order, so
 * there is one onlyKeys and one out literal; only the rules fork. Guards its own input: a
 * `columns: [null]` entry must reject as a 400, never reach a property read.
 *
 * `env` here is normTableView's rebuild, which carries the row grain: a Δ% needs a CM360⇄delivery
 * join, and only the VIEW knows which grain the rows run down.
 */
/**
 * A table column's TARGET (§5.2, section-widget parity 2026-09-04) — the plan number the totals
 * cell stacks under its fact, which is what the legacy Daily Performance totals row is for:
 * 714,286 expected impressions under 2,140,269 delivered, 0.12% CTR target under 0.13%.
 *
 * It is `{value, format}` and not the KPI target's `{value, invert}`: nothing here is JUDGED —
 * no delta, no verdict, no colour — so `invert` would be a key with no reader, while the format
 * is the one thing a plan number needs that the column's own cannot always give (a count column
 * whose plan is money has no other place to say so).
 *
 * `bound` is refused for the KPI target's reason, in the KPI target's words: a plan that moves
 * with the metric switch is not a plan.
 */
function normColumnTarget(t, at, ctx) {
  var bad = obj(t, at, 'a target');
  if (bad) return bad;
  bad = onlyKeys(t, at, ['value', 'format']);
  if (bad) return bad;
  var val = normValue(t.value, at + '/value', ctx);
  if (!val.ok) return val;
  if (val.out.kind === 'bound') return fail(at + '/value', 'a target is a fixed number to measure against; it may not follow the metric switch');
  // `env` is deliberately not threaded: a target names no CM360 side and sits on no grain, so
  // the two facts `familiesOf` reads it for cannot apply. A bound value is already gone above,
  // which is the only shape that needs an option list.
  var fams = familiesOf(val.out, at, null);
  if (!fams.ok) return fams;
  bad = badCellFormat(t.format, fams, at, 'a column target', true);
  if (bad) return bad;
  return { ok: true, out: { value: val.out, format: t.format } };
}

function normColumn(c, at, env, ctx) {
  return appendHighlights(c, normColumnBody(withoutHighlights(c), at, env, ctx), at, 'column');
}

function normColumnBody(c, at, env, ctx) {
  var bad = obj(c, at, 'a column');
  if (bad) return bad;
  // The CHECK is load-bearing: `kind` is stored from the input, so without this line a column of
  // any kind — 'total', anything — passes through the value branch and is SAVED with that kind on
  // it, and the tile later meets a kind no renderer has. Its POSITION, before the key set, is the
  // lighter question: both column kinds share ONE key set today (unlike normControl, whose per-
  // branch sets make its type check lead for correctness), so being first only decides which
  // detail a doubly-invalid column gets. The position becomes load-bearing the day the sets diverge.
  if (!inList(COLUMN_KINDS, c.kind)) return fail(at, 'unknown column kind "' + show(c.kind) + '"; a column prints a value or a Δ%');
  bad = onlyKeys(c, at, ['id', 'kind', 'label', 'labelAuto', 'value', 'format', 'target', 'hideWhenEmpty', 'zeroAs', 'highlightExtremes', 'highlightDirection', 'buyUnit']);
  if (bad) return bad;
  bad = badNodeId(c.id, at, 'column id');
  if (bad) return bad;
  var lab = normLabel(c, at, ctx);
  if (!lab.ok) return lab;
  var val = normValue(c.value, at + '/value', ctx);
  if (!val.ok) return val;

  if (c.kind === 'delta') {
    // Table H: the DATASET is the one thing that makes a widget CM360, and a Δ% has nothing to
    // subtract without it. Nothing is derived from content in the other direction.
    if (env.datasetType !== 'deliveryCm360') {
      return fail(at, 'a Δ% column subtracts CM360 from delivery; it needs a deliveryCm360 dataset');
    }
    if (DELTA_ROW_TYPES.indexOf(env.rowType) === -1) {
      // §6: one refusal, one reason — and the two refused grains have DIFFERENT reasons. A row
      // that carries a line item has nothing to join on at all (the CM360 export selects none);
      // a dimension row could be joined only by matching two classifications that happen to
      // spell a bucket the same way. Naming both at once tells the author the wrong one.
      // A `control` grain resolves to a dimension at render, so it takes the dimension's
      // reason — the sentence is about what the rows ARE, not about how they were named.
      var why = (env.rowType === 'dim' || env.rowType === 'control')
        ? 'matching a delivery dimension against a mapping one by label is the Compare view\'s job'
        : 'a CM360 row carries no line item to join on';
      return fail(at, 'a Δ% column sits on ' + DELTA_ROW_TYPES.join(', ') + ' rows; ' + why);
    }
    var opts = optionValues(val.out, at, env);
    if (!opts.ok) return opts;
    for (var oi = 0; oi < opts.values.length; oi++) {
      if (isDualSource(opts.values[oi])) continue;
      // §6: the refusal names the ELEMENT, and for a bound value the option that broke it.
      return fail(at, 'column "' + c.id + '" prints a Δ%, so it reads a field both sources carry (' +
        CM_FIELDS.join(', ') + ') on the bq side; ' +
        (opts.options[oi] === null ? 'this value is not one' : 'option "' + opts.options[oi] + '" is not one'));
    }
    // The COLUMN prints a percentage even though its VALUE is a count: (CM − BQ) / BQ is a ratio.
    // So the format is judged against percent — the same table, a different family from the value's.
    // That mismatch is also why this does NOT call badCellFormat: badCellFormat builds its sentence
    // around the VALUE's family ("option "o2" is count"), which here would name the wrong family
    // and read as a lie. Same table, own sentence.
    if (!formatLegal('percent', c.format)) {
      return fail(at, 'a Δ% column prints a percentage; its format is one of ' +
        FORMATS_BY_FAMILY.percent.join(', ') + ', not "' + show(c.format) + '"');
    }
  } else {
    var fams = familiesOf(val.out, at, env);
    if (!fams.ok) return fams;
    bad = badCellFormat(c.format, fams, at, 'column "' + c.id + '"', true);
    if (bad) return bad;
  }

  // The FOUR OPTIONAL keys, judged after the branches and APPENDED to the stored shape — which
  // is what keeps every column written before them byte-identical: an optional key in the middle
  // of the key order would re-write the lot (normKpiView's `basis` says the same thing).
  var target = null;
  if (has(c, 'target')) {
    target = normColumnTarget(c.target, at + '/target', ctx);
    if (!target.ok) return target;
  }
  // `true` or absent, never `false` — `besideNext`'s rule, for its reason: a stored `false` is a
  // key that says what the absence already says, and two spellings of one state is a diff nobody
  // can read.
  if (has(c, 'hideWhenEmpty') && c.hideWhenEmpty !== true) {
    return fail(at + '/hideWhenEmpty', 'hideWhenEmpty is true or absent; a column that always prints simply does not carry it');
  }
  if (has(c, 'zeroAs') && COLUMN_ZERO_AS.indexOf(c.zeroAs) === -1) {
    return fail(at + '/zeroAs', 'a zero prints as ' + COLUMN_ZERO_AS.join(' or ') + ', not "' + show(c.zeroAs) + '"');
  }
  // The best and worst reading in this column, tinted (§5.2, section-widget parity 2026-09-04) —
  // the legacy Breakdown table's own mark on CTR and VCR, which is the fastest read on that
  // panel: which segment is working. Only ever `true`, on `hideWhenEmpty`'s rule.
  if (has(c, 'highlightExtremes') && c.highlightExtremes !== true) {
    return fail(at + '/highlightExtremes', 'highlightExtremes is true or absent; a column that tints nothing simply does not carry it');
  }
  if (has(c, 'highlightDirection') && !inList(['higher', 'lower'], c.highlightDirection)) {
    return fail(at + '/highlightDirection', 'highlightDirection is higher or lower; omit it for automatic metric direction');
  }
  // Drawn only while the pacing is bought on this unit (section-widget parity's «CPM only
  // on an impression-bought pacing», resolved at render instead of at mint). The sentence
  // reads the vocabulary rather than repeating it, so a fourth unit needs no copy edit.
  if (has(c, 'buyUnit') && !inList(COLUMN_BUY_UNITS, c.buyUnit)) {
    return fail(at + '/buyUnit', 'buyUnit is ' + COLUMN_BUY_UNITS.slice(0, -1).join(', ') +
      ' or ' + COLUMN_BUY_UNITS[COLUMN_BUY_UNITS.length - 1] + ', not "' + show(c.buyUnit) + '"');
  }

  // `kind` passed COLUMN_KINDS above, and the two branches store the same shape.
  var cout = {
    id: c.id, kind: c.kind, label: lab.out.label, labelAuto: lab.out.labelAuto, value: val.out, format: c.format
  };
  if (target) cout.target = target.out;
  if (has(c, 'hideWhenEmpty')) cout.hideWhenEmpty = true;
  if (has(c, 'zeroAs')) cout.zeroAs = c.zeroAs;
  if (has(c, 'highlightExtremes')) cout.highlightExtremes = true;
  if (has(c, 'highlightDirection')) cout.highlightDirection = c.highlightDirection;
  if (has(c, 'buyUnit')) cout.buyUnit = c.buyUnit;
  return { ok: true, out: cout };
}

/**
 * The authored sort (§5.2): a column of this table, or the row label itself. The VIEWER's click
 * re-sorts their own view and is never persisted, so this is the only sort on the wire.
 * `columnIds` is normTableView's seen-map, which is why this runs after the column loop.
 */
function normSort(s, at, columnIds, hasShare) {
  var bad = obj(s, at, 'a sort');
  if (bad) return bad;
  bad = onlyKeys(s, at, ['columnId', 'dir']);
  if (bad) return bad;
  // The string guard is LOAD-BEARING, exactly as it is for defaultOptionId: hasOwnProperty
  // converts its key with ToPropertyKey, so { toString: function () { return 'c1'; } } answers
  // true on a bare lookup — and then the OBJECT, not an id, is what gets stored as the sort.
  if (typeof s.columnId !== 'string' || (s.columnId !== ROW_SORT_KEY && !(s.columnId === '__share__' && hasShare) && !has(columnIds, s.columnId))) {
    return fail(at, 'sort column "' + show(s.columnId) + '" names no column of this table, and it is not "' + ROW_SORT_KEY + '" (the row itself)');
  }
  if (!inList(SORT_DIRS, s.dir)) return fail(at, 'unknown sort direction "' + show(s.dir) + '"; a table sorts asc or desc');
  return { ok: true, out: { columnId: s.columnId, dir: s.dir } };
}

/**
 * One of the two Breakdown MARKS a view can carry (`residual`, `filterOnClick`) — `true` or
 * absent on `besideNext`'s rule, and only where the rows are a cut of one dimension. Shared by
 * the table and the pie so both carry the same rule in the same words; a pie is always such a
 * cut, so it passes `true` and only the true-or-absent half can fire there.
 *
 * Returns a rejection or null, like `obj` and `onlyKeys`.
 */
function badDimFlag(v, key, isDimRows, at, why) {
  if (!has(v, key)) return null;
  if (v[key] !== true) {
    return fail(at + '/' + key, key + ' is true or absent; a view that does not do this simply does not carry it');
  }
  if (!isDimRows) return fail(at + '/' + key, why);
  return null;
}

/**
 * What a row share may DIVIDE (§5.2, widened 2026-09-16 §2.6). Two readings:
 *
 *   · an additive DELIVERY metric — the engine sums it down the rows, so the percentages add
 *     to 100. On a CM360 report the delivery half of a pair is stored under its CM name and
 *     fed by the adapter (`isDualSource`); that half stays refused, because it is not the
 *     engine's to sum and the CM reading below is how an author says the same thing on
 *     purpose.
 *   · a CM360 reading — a `source:'cm'` metric of an additive family, or a formula naming one
 *     of the three CM360 identifiers. `report-render.js` fills BOTH from the adapter, row by
 *     row (`model.shareCm`), over the join the table's rows already have.
 *
 * A DELIVERY formula is still refused, and the asymmetry is the whole point: the engine's
 * share is a hidden `__share__` COLUMN it computes, and there is no second pass on that side
 * to fill in something the engine did not compute. The CM360 side has exactly that second
 * pass, which is why it can carry an expression and the delivery side cannot.
 *
 * The cm arm asks ADDITIVE_FAMILIES too, though today's three CM360 fields are all counts and
 * cannot fail it: the rule is «a share is a proportion of a total», and a fourth CM360 field
 * of another family must meet it without this being remembered. The formula arm asks nothing
 * of the declared family — a formula's family says how the number PRINTS, and what it divides
 * is in the expression, which this file parses nothing of and never will (Global Constraints).
 *
 * Which DATASET the widget reads is not asked here, exactly as it is not asked of a cm value
 * column: `specWantsCm` decides what the tile fetches, and rail 6d decides whether a CM360
 * widget shows enough CM360 to be worth the file.
 */
function shareReads(p, env) {
  if (exprIsCmBearing(p)) return true;
  if (p.kind !== 'metric' || ADDITIVE_FAMILIES.indexOf(p.unitFamily) === -1) return false;
  if (p.source === 'cm') return true;
  return p.source === 'bq' && !(env.datasetType === 'deliveryCm360' && isDualSource(p));
}

/**
 * A row's SHARE of the table (§5.2, section-widget parity 2026-09-04) — the muted percentage the
 * legacy Breakdown table prints beside every segment name, which is the whole reason a breakdown
 * is read: proportions. The author names a column or an independent additive delivery value.
 * A bound value follows the current metric switch. Existing columnId reports retain their
 * basis; the row label is not a number, so `ROW_SORT_KEY` is refused here where `sort` accepts it.
 *
 * It is not the sorted column: a viewer's re-sort is theirs alone (§5.2) and would otherwise
 * change what every share on the table MEANS, one click at a time.
 */
function normShare(s, at, columnIds, env, ctx) {
  var bad = obj(s, at, 'a share');
  if (bad) return bad;
  bad = onlyKeys(s, at, ['columnId', 'value']);
  if (bad) return bad;
  // Existing column-based reports keep their authored basis. A separate value lets
  // a share follow the metric switch without adding a visible duplicate column.
  if (has(s, 'value')) {
    if (has(s, 'columnId')) return fail(at, 'share names either a columnId or a value, not both');
    var val = normValue(s.value, at + '/value', ctx);
    if (!val.ok) return val;
    var picks = optionValues(val.out, at + '/value', env);
    if (!picks.ok) return picks;
    for (var i = 0; i < picks.values.length; i++) {
      var p = picks.values[i];
      // Like a pie, a row share divides an additive total: the delivery metric the engine
      // sums, or the CM360 reading the adapter fills (`shareReads`). A rate, a flight
      // constant and a delivery formula establish no total, and the sentence is unchanged —
      // one rule, one refusal, four causes.
      if (!shareReads(p, env)) {
        return fail(at + '/value', 'row shares need an additive delivery metric' +
          (picks.options[i] === null ? '' : '; option "' + picks.options[i] + '" cannot supply one'));
      }
    }
    return { ok: true, out: { value: val.out } };
  }
  // The string guard is normSort's, for normSort's reason: hasOwnProperty converts its key with
  // ToPropertyKey, so a crafted `{toString}` would answer true and then be STORED as the column.
  if (typeof s.columnId !== 'string' || !has(columnIds, s.columnId)) {
    return fail(at, 'share column "' + show(s.columnId) + '" names no column of this table');
  }
  return { ok: true, out: { columnId: s.columnId } };
}

/**
 * Tables D and G — the Table view (§5.2). PRIVATE: normView has obj-guarded the object and matched
 * `kind` against VIEW_KINDS, exactly as normControls does for normControl.
 *
 * `sort` and `limit` are OPTIONAL and `sort` is not last, so the out object is built in Table D's
 * key order rather than "literal, then the optional keys": the stored JSON is byte-compared, and
 * that order is the only thing the comparison has to go on. allowed[] follows the same order.
 *
 * The FOUR Breakdown keys (section-widget parity 2026-09-04) are APPENDED after `limit`, on
 * normColumn's rule: an optional key in the middle of the order re-writes every table stored
 * before it. Three of them are refused off a dimension grain — see DIM_ROW_TYPES.
 */
function normTableView(v, at, env, ctx) {
  var bad = onlyKeys(v, at, ['id', 'kind', 'title', 'rows', 'columns', 'sort', 'totals', 'limit',
    'residual', 'share', 'search', 'filterOnClick', 'basis']);
  if (bad) return bad;
  bad = badNodeId(v.id, at, 'view id');
  if (bad) return bad;
  if (typeof v.title !== 'string') return fail(at, 'title must be a string');
  if (v.title.length > LIMITS.title) return fail(at, 'title is over ' + LIMITS.title + ' characters');

  var rows = normRows(v.rows, at + '/rows', env, ctx);
  if (!rows.ok) return rows;
  if (!Array.isArray(v.columns)) return fail(at + '/columns', 'columns must be an array');
  if (!v.columns.length) return fail(at + '/columns', 'a table prints at least one column');
  if (v.columns.length > LIMITS.columns) return fail(at + '/columns', 'a table holds at most ' + LIMITS.columns + ' columns');
  // The row grain is data the columns are read against, so a column is normalized KNOWING it —
  // the Δ% join rule has nowhere else to read it from. This rebuild is a WHITELIST: a fact added
  // to env later must be re-listed here or it silently vanishes below the column level.
  var cenv = { controls: env.controls, datasetType: env.datasetType, rowType: rows.out.type };
  var columns = [];
  var seen = {};
  for (var i = 0; i < v.columns.length; i++) {
    var cAt = at + '/columns/' + i;
    var r = normColumn(v.columns[i], cAt, cenv, ctx);
    if (!r.ok) return r;
    // The ids are what `sort` NAMES, so a repeat would make one sort point at two columns.
    if (has(seen, r.out.id)) return fail(cAt, 'duplicate column id "' + show(r.out.id) + '"');
    seen[r.out.id] = true;
    columns.push(r.out);
  }

  var sort = null;
  if (has(v, 'sort')) {
    sort = normSort(v.sort, at + '/sort', seen, has(v, 'share'));
    if (!sort.ok) return sort;
  }
  if (typeof v.totals !== 'boolean') return fail(at, 'totals must be true or false');
  var hasLimit = has(v, 'limit');
  if (hasLimit && (!isInt(v.limit) || v.limit < 1 || v.limit > LIMITS.tableLimit)) {
    return fail(at, 'limit is a whole number from 1 to ' + LIMITS.tableLimit + ', not "' + show(v.limit) + '"');
  }

  // The untagged remainder as its own row: what this window delivered that carries NO value of
  // this dimension, which the legacy Breakdown panel calls «Others». Without it every share on
  // the table is a share of the tagged part alone — 59% where the segment is 11% of the pacing.
  var isDimRows = inList(DIM_ROW_TYPES, rows.out.type);
  var flag = badDimFlag(v, 'residual', isDimRows, at,
    'a residual row is the delivery this dimension did not tag; date and line-item rows already carry all of it');
  if (flag) return flag;
  // …and the click that filters the dashboard by the value in the row — the legacy panel's own
  // `brk`/`brkf` toggle, which is the main thing anyone does with a breakdown.
  flag = badDimFlag(v, 'filterOnClick', isDimRows, at,
    'clicking a row filters the dashboard by that dimension value; a date and a line item are not dimension values');
  if (flag) return flag;
  // The viewer's own box over the row labels. Legal on every grain — every row has a label —
  // so it takes the plain true-or-absent rule with no grain question.
  if (has(v, 'search') && v.search !== true) {
    return fail(at + '/search', 'search is true or absent; a table with no search box simply does not carry it');
  }
  var share = null;
  if (has(v, 'share')) {
    share = normShare(v.share, at + '/share', seen, env, ctx);
    if (!share.ok) return share;
  }

  // A table drawn only while the pacing has this reading — the KPI `basis` rule one view kind
  // over (the conversions mart's own table on a pacing that has one). Its own list, so the
  // KPI vocabulary and its resolver pin (kpi-basis.test.js) stay exactly what they are.
  if (has(v, 'basis') && !inList(TABLE_BASES, v.basis)) {
    return fail(at + '/basis', 'a table basis is ' + TABLE_BASES.join(' or ') + ', not "' + show(v.basis) + '"');
  }

  var out = { id: v.id, kind: 'table', title: v.title, rows: rows.out, columns: columns };
  if (sort) out.sort = sort.out;
  out.totals = v.totals;
  if (hasLimit) out.limit = v.limit;
  if (has(v, 'residual')) out.residual = true;
  if (share) out.share = share.out;
  if (has(v, 'search')) out.search = true;
  if (has(v, 'filterOnClick')) out.filterOnClick = true;
  if (has(v, 'basis')) out.basis = v.basis;
  return { ok: true, out: out };
}

/**
 * A KPI target (§5.3, Table D) — the {value, invert} pair a chart guide also stores, under its own
 * rules: no flow-field refusal (a KPI prints ONE number for the window, so a window total is
 * exactly the right thing to compare it against), and the family equality normKpiView applies
 * afterwards, because only the view knows the value. `bound` is refused for the guide's reason —
 * a target that moves with the switch is not a target.
 */
function normTarget(t, at, ctx) {
  var bad = obj(t, at, 'a target');
  if (bad) return bad;
  bad = onlyKeys(t, at, ['value', 'invert', 'band']);
  if (bad) return bad;
  var val = normValue(t.value, at + '/value', ctx);
  if (!val.ok) return val;
  if (val.out.kind === 'bound') return fail(at + '/value', 'a target is a fixed number to measure against; it may not follow the metric switch');
  if (typeof t.invert !== 'boolean') return fail(at, 'invert must be true or false');
  var out = { value: val.out, invert: t.invert };
  // The corridor (§5.3, section-widget parity 2026-09-04). It is OPTIONAL and appended, so
  // every target stored before it keeps its bytes.
  if (has(t, 'band')) {
    if (TARGET_BANDS.indexOf(t.band) === -1) {
      return fail(at + '/band', 'a corridor is ' + TARGET_BANDS.join(' or ') + ', not "' + show(t.band) + '"');
    }
    // A corridor reads a rate against its target as higher-is-better — at or above target is
    // green, the band below it is amber, under that is red. `invert` says the opposite, so the
    // two together describe no colour anybody could draw.
    if (t.invert) return fail(at + '/band', 'a corridor reads at or above target as good, so it cannot sit on a target where lower is better');
    out.band = t.band;
  }
  return { ok: true, out: out };
}

function normKpiSupport(s, at) {
  var bad = obj(s, at, 'KPI support');
  if (bad) return bad;
  if (s.kind === 'valueMeta') {
    bad = onlyKeys(s, at, ['kind']);
    if (bad) return bad;
    return { ok: true, out: { kind: 'valueMeta' } };
  }
  if (s.kind !== 'text') return fail(at, 'support kind is valueMeta or text, not "' + show(s.kind) + '"');
  bad = onlyKeys(s, at, ['kind', 'text']);
  if (bad) return bad;
  if (typeof s.text !== 'string' || !s.text.replace(/\s/g, '')) return fail(at + '/text', 'support text may not be blank');
  if (s.text.length > LIMITS.support) return fail(at + '/text', 'support text is over ' + LIMITS.support + ' characters');
  return { ok: true, out: { kind: 'text', text: s.text } };
}

/**
 * Table D — the KPI view (§5.3). PRIVATE, like normChartView. `target` is optional and sits in the
 * middle of the key order, so the out object is built in that order (normTableView's note).
 */
function normKpiView(v, at, env, ctx) {
  return appendHighlights(v, normKpiViewBody(withoutHighlights(v), at, env, ctx), at, 'kpi');
}

function normKpiViewBody(v, at, env, ctx) {
  var bad = onlyKeys(v, at, ['id', 'kind', 'title', 'value', 'format', 'target', 'support', 'deltaVsOtherSource', 'basis', 'density']);
  if (bad) return bad;
  bad = badNodeId(v.id, at, 'view id');
  if (bad) return bad;
  if (typeof v.title !== 'string') return fail(at, 'title must be a string');
  if (v.title.length > LIMITS.title) return fail(at, 'title is over ' + LIMITS.title + ' characters');

  var val = normValue(v.value, at + '/value', ctx);
  if (!val.ok) return val;
  var fams = familiesOf(val.out, at, env);
  if (!fams.ok) return fams;
  bad = badCellFormat(v.format, fams, at, 'view "' + v.id + '"', false);
  if (bad) return bad;

  var target = null;
  var support = null;
  var i;
  if (has(v, 'target')) {
    target = normTarget(v.target, at + '/target', ctx);
    if (!target.ok) return target;
    // Superseded §5.0.6, inherited: a target is measured against the value, so it is measured in
    // the same unit. For a bound value EVERY option must be — the switch moves the value, and the
    // target stays where it is.
    for (i = 0; i < fams.families.length; i++) {
      if (fams.families[i] === target.out.value.unitFamily) continue;
      return fail(at + '/target', 'a target carries the unit family of the value it measures; this one is ' +
        target.out.value.unitFamily + ' and ' +
        (fams.options[i] === null ? 'the value is ' : 'option "' + fams.options[i] + '" is ') + fams.families[i]);
    }
  }

  if (has(v, 'support')) {
    support = normKpiSupport(v.support, at + '/support');
    if (!support.ok) return support;
  }

  if (typeof v.deltaVsOtherSource !== 'boolean') return fail(at, 'deltaVsOtherSource must be true or false');
  if (v.deltaVsOtherSource) {
    if (env.datasetType !== 'deliveryCm360') {
      return fail(at, 'a Δ-vs-other-source line compares CM360 against delivery; it needs a deliveryCm360 dataset');
    }
    var opts = optionValues(val.out, at, env);
    if (!opts.ok) return opts;
    for (i = 0; i < opts.values.length; i++) {
      if (isDualSource(opts.values[i])) continue;
      return fail(at, 'view "' + v.id + '" shows a Δ-vs-other-source line, so it reads a field both sources carry (' +
        CM_FIELDS.join(', ') + ') on the bq side; ' +
        (opts.options[i] === null ? 'this value is not one' : 'option "' + opts.options[i] + '" is not one'));
    }
  }

  // Both APPENDED after the required key, which is what keeps every KPI stored before them
  // byte-identical: an optional key in the middle of the order would re-write the lot.
  if (has(v, 'basis') && KPI_BASES.indexOf(v.basis) === -1) {
    return fail(at + '/basis', 'a KPI basis is one of ' + KPI_BASES.join(', ') + ', not "' + show(v.basis) + '"');
  }
  if (has(v, 'density') && KPI_DENSITIES.indexOf(v.density) === -1) {
    return fail(at + '/density', 'a KPI density is ' + KPI_DENSITIES.join(' or ') + ', not "' + show(v.density) + '"');
  }

  var out = { id: v.id, kind: 'kpi', title: v.title, value: val.out, format: v.format };
  if (target) out.target = target.out;
  if (support) out.support = support.out;
  out.deltaVsOtherSource = v.deltaVsOtherSource;
  if (has(v, 'basis')) out.basis = v.basis;
  if (has(v, 'density')) out.density = v.density;
  return { ok: true, out: out };
}

/**
 * Table D — the Pie view (§5.4). PRIVATE, like normChartView. Every key is required, so the whole
 * shape is one out literal.
 *
 * `number` is refused beside `percent` though §5.4 names only "percent/rate": the `number` family
 * is the dimensionless-ratio family (it is the only one whose formats carry `number2`), and
 * summing a ratio across slices is the same defect. Deliberately stricter than §5.4's sentence.
 */
function normPieView(v, at, env, ctx) {
  return appendHighlights(v, normPieViewBody(withoutHighlights(v), at, env, ctx), at, 'pie');
}

function normPieViewBody(v, at, env, ctx) {
  var bad = onlyKeys(v, at, ['id', 'kind', 'title', 'value', 'sliceBy', 'topN', 'format',
    'residual', 'filterOnClick']);
  if (bad) return bad;
  bad = badNodeId(v.id, at, 'view id');
  if (bad) return bad;
  if (typeof v.title !== 'string') return fail(at, 'title must be a string');
  if (v.title.length > LIMITS.title) return fail(at, 'title is over ' + LIMITS.title + ' characters');

  var val = normValue(v.value, at + '/value', ctx);
  if (!val.ok) return val;
  // What a pie may CUT (owner, 2026-08-23 — §15), before what its family may SUM. Four kinds of
  // number have no shares to divide, and none of them is caught by the family rule below:
  //   canonical — one number for the whole flight (§2). Repeated once per bucket it draws N equal
  //     slices whose shares are invented; report-render refuses it at draw time (PIE_NO_CANONICAL)
  //     and the grammar now refuses to STORE it. Its family is a count, so it adds up fine.
  //   formula — its sign is unknowable here (§7.1 does not parse the expression), and a negative
  //     share is not a slice. `sp - costBud` declares itself money and adds up fine too.
  //   cm — the CM360 side is grouped by the MAPPING's dimensions and a pie is cut by one of the
  //     PACING's, so there is no cut to make (report-render's PIE_NO_CM says the same at draw
  //     time). It is a count like any other.
  //   the dual-source TWIN on a CM360 widget — the same number from the other end. On a
  //     deliveryCm360 dataset the three fields both sources carry are fed by the JOIN on the bq
  //     side too (report-render's `cmFeedOf`, whose four conjuncts are `isDualSource` plus the
  //     dataset), so that pie draws PIE_NO_CM as surely as a cm-source one. The rule the owner
  //     named is the source; the reason he gave it is the mapping's grouping, and the twin has
  //     the same one. The DATASET is the conjunct `source` cannot see: off a CM360 widget the
  //     very same value is an ordinary delivery count and slices fine.
  // Read option by option for a bound value: the switch moves the pie's value, so an option the
  // pie could not cut is an option the viewer can land on.
  var picks = optionValues(val.out, at, env);
  if (!picks.ok) return picks;
  for (var pi = 0; pi < picks.values.length; pi++) {
    var pv = picks.values[pi];
    // §6: name the element, and the option that broke it.
    var whose = picks.options[pi] === null ? 'this value' : 'option "' + picks.options[pi] + '"';
    var lead = 'view "' + v.id + '" is a pie, so it cuts a delivery count or money into shares; ';
    if (pv.kind === 'canonical') return fail(at, lead + whose + ' is one number for the whole flight, and one number has no shares');
    if (pv.kind === 'formula') return fail(at, lead + whose + ' is a formula, which may come out negative, and a negative share is not a slice');
    if (pv.source === 'cm') return fail(at, lead + whose + ' is a CM360 number, grouped by the mapping dimensions and not by this one');
    if (env.datasetType === 'deliveryCm360' && isDualSource(pv)) {
      return fail(at, lead + whose + ' is the delivery half of a CM360 pair (' + CM_FIELDS.join(', ') +
        '), which this widget reads through the join, grouped by the mapping dimensions and not by this one');
    }
  }
  var fams = familiesOf(val.out, at, env);
  if (!fams.ok) return fams;
  for (var i = 0; i < fams.families.length; i++) {
    if (ADDITIVE_FAMILIES.indexOf(fams.families[i]) !== -1) continue;
    // §6 again: name the element, and the option that broke it.
    return fail(at, 'view "' + v.id + '" is a pie, so it cuts one total into slices and its value adds up; ' +
      (fams.options[i] === null ? 'this one is ' : 'option "' + fams.options[i] + '" is ') + fams.families[i] +
      ', and ' + fams.families[i] + ' values are not summable');
  }

  var sAt = at + '/sliceBy';
  bad = obj(v.sliceBy, sAt, 'a slice dimension');
  if (bad) return bad;
  // The one dim slot with no `type` discriminator — a pie is ALWAYS cut by a dimension, so
  // there was never a union to tag. The key that is present is what says which shape it is,
  // and each shape's onlyKeys then refuses the other's key.
  var sliceBy;
  if (has(v.sliceBy, 'controlId')) {
    bad = onlyKeys(v.sliceBy, sAt, ['controlId']);
    if (bad) return bad;
    var sctl = dimensionControl(v.sliceBy.controlId, sAt, env, 'a pie\'s slices');
    if (!sctl.ok) return sctl;
    sliceBy = { controlId: sctl.id };
  } else {
    bad = onlyKeys(v.sliceBy, sAt, ['key']);
    if (bad) return bad;
    var dim = checkDim(v.sliceBy.key, sAt, ctx, 'sliceBy');
    if (!dim.ok) return dim;
    sliceBy = { key: dim.key };
  }
  // §5.4 states the cap as part of the view: a pie ALWAYS folds its tail into Others, so unlike a
  // chart's topN there is no "unset" — the key is required and the rest folds at what it says.
  if (!isInt(v.topN) || v.topN < 1 || v.topN > LIMITS.pieTopN) {
    return fail(at, 'topN is a whole number from 1 to ' + LIMITS.pieTopN + ', not "' + show(v.topN) + '"');
  }
  // Format LAST, in Table D's key order like every other normalizer. The summability check above
  // sits with the `fams` read it needs; nothing else here depends on the order, so this is which
  // refusal a doubly-wrong pie shows, not what it accepts.
  bad = badCellFormat(v.format, fams, at, 'view "' + v.id + '"', false);
  if (bad) return bad;
  // The table's two Breakdown marks, on the ring beside it (section-widget parity 2026-09-04):
  // the untagged remainder as its own grey slice — without it every share the ring draws is a
  // share of the tagged part — and the click that filters the dashboard by the slice. A pie is
  // always cut by a dimension, so only the true-or-absent half of the rule can fire here.
  var flag = badDimFlag(v, 'residual', true, at, '');
  if (flag) return flag;
  flag = badDimFlag(v, 'filterOnClick', true, at, '');
  if (flag) return flag;

  var pout = {
    id: v.id, kind: 'pie', title: v.title, value: val.out, sliceBy: sliceBy, topN: v.topN, format: v.format
  };
  // APPENDED, on normColumn's rule: every pie stored before these keys keeps its bytes.
  if (has(v, 'residual')) pout.residual = true;
  if (has(v, 'filterOnClick')) pout.filterOnClick = true;
  return { ok: true, out: pout };
}

/**
 * The entry of a normalized list with this id, or null. The two cross-object REFERENCES use it: a
 * compare view names two controls, an interaction names two views. It scans and compares with
 * `===`, so nothing here is used as a property KEY — the ToPropertyKey trap that defaultOptionId
 * and normSort guard against cannot arise, and a crafted `{toString}` reference matches nothing.
 */
function byId(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/**
 * Table D — the Compare view (§5.5). PRIVATE, like normChartView. It is the one view that stores
 * no value: it names the two controls that drive it, and their values live under controls[] —
 * which is why the value walk finds a compare view's metrics there and never here.
 *
 * Takes no `ctx`: nothing in it asks the host a question (no dimension key, no canonical metric),
 * which is the same reason normStyle takes none.
 */
function normCompareView(v, at, env) {
  var bad = onlyKeys(v, at, ['id', 'kind', 'title', 'metricControlId', 'breakdownControlId']);
  if (bad) return bad;
  bad = badNodeId(v.id, at, 'view id');
  if (bad) return bad;
  if (typeof v.title !== 'string') return fail(at, 'title must be a string');
  if (v.title.length > LIMITS.title) return fail(at, 'title is over ' + LIMITS.title + ' characters');

  // Table H: the DATASET is the one thing that makes a widget CM360, and a comparison has no
  // other side without it. FIRST, because the controls this view names are themselves
  // conditioned on the dataset — a breakdown control is CM360-only (normReport) — so on a
  // delivery widget the reference rules below could only ever answer "there is no breakdown
  // control", which sends the author to add a control the dataset forbids.
  if (env.datasetType !== 'deliveryCm360') {
    return fail(at, 'a compare view reads CM360 beside delivery; it needs a deliveryCm360 dataset');
  }
  var mc = byId(env.controls, v.metricControlId);
  if (!mc || mc.type !== 'metric') {
    return fail(at, 'metricControlId "' + show(v.metricControlId) + '" names no metric control of this widget');
  }
  var bc = byId(env.controls, v.breakdownControlId);
  if (!bc || bc.type !== 'breakdown') {
    return fail(at, 'breakdownControlId "' + show(v.breakdownControlId) + '" names no breakdown control of this widget');
  }
  // §5.5 + the dual-source canonical form: this switch drives BOTH sides of the comparison, so
  // every position it can take has to exist on both. It reads the NAMED control's options
  // directly rather than through optionValues, which resolves THE metric switch by type — here
  // it is the reference that binds, and only a control the view named is the view's business.
  for (var i = 0; i < mc.options.length; i++) {
    if (isDualSource(mc.options[i].value)) continue;
    return fail(at, 'view "' + v.id + '" compares CM360 against delivery, so its metric switch offers only ' +
      'the fields both sources carry (' + CM_FIELDS.join(', ') + ') on the bq side; option "' +
      mc.options[i].id + '" is not one');
  }
  // The RESOLVED ids, so an unresolved reference can never be what lands on the wire. They are
  // the same strings the input carried — a structural guarantee, not a transform.
  return { ok: true, out: {
    id: v.id, kind: 'compare', title: v.title, metricControlId: mc.id, breakdownControlId: bc.id
  } };
}

/** Strict Layout subgrammar. Unlike legacy Bricks.normComposite, every field below is either
 * accepted verbatim or rejected: there are no defaults, bool coercions, clamps or slices. */
function normLayoutText(v, at, cap, blankOk) {
  if (typeof v !== 'string') return fail(at, 'text must be a string');
  if (v.length > cap) return fail(at, 'text is over ' + cap + ' characters');
  if (!blankOk && !v.replace(/\s/g, '')) return fail(at, 'text may not be blank');
  return { ok: true, out: v };
}

function normLayoutBind(v, at, ctx, budget) {
  var bad = obj(v, at, 'a Layout binding');
  if (bad) return bad;
  var hasMetric = has(v, 'metric');
  var hasExpr = has(v, 'expr');
  var hasReading = has(v, 'reading');
  if ((hasMetric ? 1 : 0) + (hasExpr ? 1 : 0) + (hasReading ? 1 : 0) !== 1) return fail(at, 'bind a canonical metric, domain reading or formula, exactly one');
  bad = onlyKeys(v, at, hasMetric ? ['metric'] : hasReading ? ['reading'] : ['expr']);
  if (bad) return bad;
  budget.bindings++;
  var bindingLimit = budget.bindingLimit || LIMITS.layoutBindings;
  if (budget.bindings > bindingLimit) {
    return fail(at, 'a ' + (budget.bindingLimit ? 'composition' : 'Layout') + ' stores at most ' + bindingLimit + ' bindings');
  }
  if (hasReading) {
    if (!inList(LAYOUT_DOMAIN_READINGS, v.reading)) return fail(at, 'unknown domain reading');
    return { ok: true, out: { reading: v.reading } };
  }
  if (hasMetric) {
    if (!ctx || typeof ctx.isCanonicalMetric !== 'function') return fail(at, 'no canonical-metric catalogue was injected');
    if (typeof v.metric !== 'string' || !ctx.isCanonicalMetric(v.metric)) {
      return fail(at, 'unknown canonical metric "' + show(v.metric) + '"');
    }
    return { ok: true, out: { metric: v.metric } };
  }
  if (typeof v.expr !== 'string' || !v.expr.replace(/\s/g, '')) return fail(at, 'formula is empty');
  if (v.expr.length > LIMITS.formula) return fail(at, 'formula is over ' + LIMITS.formula + ' characters');
  return { ok: true, out: { expr: v.expr } };
}

function normLayoutFormat(v, at) {
  if (!inList(CELL_FORMATS, v)) return fail(at, 'unknown Layout format "' + show(v) + '"');
  return { ok: true, out: v };
}

function normLayoutOptionalLabel(b, out, at) {
  if (!has(b, 'label')) return { ok: true };
  var label = normLayoutText(b.label, at + '/label', LIMITS.label, false);
  if (!label.ok) return label;
  out.label = label.out;
  return { ok: true };
}

function normLayoutValueFields(b, out, at, ctx, budget, targetRequired) {
  var bind = normLayoutBind(b.bind, at + '/bind', ctx, budget);
  if (!bind.ok) return bind;
  out.bind = bind.out;
  if (has(b, 'target')) {
    var target = normLayoutBind(b.target, at + '/target', ctx, budget);
    if (!target.ok) return target;
    if (typeof b.invert !== 'boolean') return fail(at + '/invert', 'invert must be true or false beside a target');
    out.target = target.out;
    out.invert = b.invert;
  } else {
    if (targetRequired) return fail(at + '/target', 'this block requires a target');
    if (has(b, 'invert')) return fail(at + '/invert', 'invert exists only beside a target');
  }
  return { ok: true };
}

function normLayoutBadge(v, at, ctx, budget) {
  if (typeof v === 'string') {
    var literal = normLayoutText(v, at, LIMITS.label, false);
    if (!literal.ok) return literal;
    return { ok: true, out: literal.out };
  }
  var bad = obj(v, at, 'a badge');
  if (bad) return bad;
  if (!inList(LAYOUT_BADGE_WORDS, v.words)) return fail(at, 'unknown badge words "' + show(v.words) + '"');
  if (v.words === 'currency') {
    bad = onlyKeys(v, at, ['words', 'text']);
    if (bad) return bad;
    var words = normLayoutText(v.text, at + '/text', LIMITS.label, false);
    if (!words.ok) return words;
    return { ok: true, out: { words: 'currency', text: words.out } };
  }
  bad = onlyKeys(v, at, ['words', 'bind']);
  if (bad) return bad;
  var bind = normLayoutBind(v.bind, at + '/bind', ctx, budget);
  if (!bind.ok) return bind;
  return { ok: true, out: { words: v.words, bind: bind.out } };
}

function normLayoutUnitSelection(values, allowed, at) {
  if (!Array.isArray(values) || !values.length || values.length > allowed.length) return fail(at, 'choose at least one supported unit');
  var seen = {};
  for (var i = 0; i < values.length; i++) {
    if (!inList(allowed, values[i]) || has(seen, values[i])) return fail(at, 'units must be supported and unique');
    seen[values[i]] = true;
  }
  return { ok: true, out: values.slice() };
}

function normLayoutBrick(b, at, ctx, budget) {
  return appendHighlights(b, normLayoutBrickBody(withoutHighlights(b), at, ctx, budget), at, b && b.type);
}

function normLayoutBrickBody(b, at, ctx, budget) {
  var bad = obj(b, at, 'a Layout block');
  if (bad) return bad;
  if (!inList(LAYOUT_BRICK_TYPES, b.type)) return fail(at, 'unknown Layout block type "' + show(b.type) + '"');

  if (b.type === 'unitBars') {
    bad = onlyKeys(b, at, ['type', 'units']);
    if (bad) return bad;
    var unitOut = { type: b.type };
    if (has(b, 'units')) {
      var units = normLayoutUnitSelection(b.units, LAYOUT_DELIVERY_UNITS, at + '/units');
      if (!units.ok) return units;
      unitOut.units = units.out;
    }
    return { ok: true, out: unitOut };
  }
  if (b.type === 'flightBullet') {
    bad = onlyKeys(b, at, ['type']);
    if (bad) return bad;
    return { ok: true, out: { type: b.type } };
  }
  if (b.type === 'rateRows') {
    bad = onlyKeys(b, at, ['type', 'series', 'units']);
    if (bad) return bad;
    if (!inList(LAYOUT_CANON_SERIES, b.series)) return fail(at + '/series', 'unknown rate series "' + show(b.series) + '"');
    var rateOut = { type: 'rateRows', series: b.series };
    if (has(b, 'units')) {
      var rates = normLayoutUnitSelection(b.units, LAYOUT_RATE_UNITS, at + '/units');
      if (!rates.ok) return rates;
      rateOut.units = rates.out;
    }
    return { ok: true, out: rateOut };
  }
  if (b.type === 'note') {
    var noteHasSource = has(b, 'source');
    var noteHasText = has(b, 'text');
    if (noteHasSource === noteHasText) return fail(at, 'a note has a canonical source or authored text, exactly one');
    bad = onlyKeys(b, at, noteHasSource ? ['type', 'align', 'source', 'style'] : ['type', 'align', 'text', 'style']);
    if (bad) return bad;
    if (b.align !== 'start' && b.align !== 'center') return fail(at + '/align', 'note align is start or center');
    var noteOut = { type: 'note', align: b.align };
    if (noteHasSource) {
      if (!inList(LAYOUT_CANON_NOTES, b.source)) return fail(at + '/source', 'unknown note source "' + show(b.source) + '"');
      noteOut.source = b.source;
    } else {
      var noteText = normLayoutText(b.text, at + '/text', LIMITS.support, false);
      if (!noteText.ok) return noteText;
      noteOut.text = noteText.out;
    }
    if (has(b, 'style')) {
      if (!inList(['headline', 'caption'], b.style)) return fail(at + '/style', 'text style is headline or caption; omit for a note');
      noteOut.style = b.style;
    }
    return { ok: true, out: noteOut };
  }

  if (b.type === 'header') {
    bad = onlyKeys(b, at, ['type', 'label', 'sub', 'content']);
    if (bad) return bad;
    var headerLabel = normLayoutText(b.label, at + '/label', LIMITS.label, false);
    if (!headerLabel.ok) return headerLabel;
    var headerOut = { type: 'header', label: headerLabel.out };
    if (has(b, 'content')) {
      if (!inList(LAYOUT_HEADER_CONTENTS, b.content)) return fail(at + '/content', 'heading content is text or verdict');
      headerOut.content = b.content;
    }
    if (has(b, 'sub')) {
      var headerSub = normLayoutText(b.sub, at + '/sub', LIMITS.label, false);
      if (!headerSub.ok) return headerSub;
      headerOut.sub = headerSub.out;
    }
    return { ok: true, out: headerOut };
  }

  if (b.type === 'detailCard') {
    var detailSource = has(b, 'source');
    var detailBind = has(b, 'bind');
    if (detailSource === detailBind) return fail(at, 'a detail card has a canonical source or binding, exactly one');
    bad = onlyKeys(b, at, detailSource
      ? ['type', 'label', 'source', 'sub']
      : ['type', 'label', 'bind', 'format', 'sub']);
    if (bad) return bad;
    var detailLabel = normLayoutText(b.label, at + '/label', LIMITS.label, false);
    if (!detailLabel.ok) return detailLabel;
    var detailOut = { type: 'detailCard', label: detailLabel.out };
    if (detailSource) {
      if (!inList(LAYOUT_CANON_SOURCES, b.source)) return fail(at + '/source', 'unknown detail source "' + show(b.source) + '"');
      detailOut.source = b.source;
    } else {
      var dbind = normLayoutBind(b.bind, at + '/bind', ctx, budget);
      if (!dbind.ok) return dbind;
      var dformat = normLayoutFormat(b.format, at + '/format');
      if (!dformat.ok) return dformat;
      detailOut.bind = dbind.out;
      detailOut.format = dformat.out;
    }
    if (has(b, 'sub')) {
      var detailSub = normLayoutText(b.sub, at + '/sub', LIMITS.support, false);
      if (!detailSub.ok) return detailSub;
      detailOut.sub = detailSub.out;
    }
    return { ok: true, out: detailOut };
  }

  if (b.type === 'statRow') {
    bad = onlyKeys(b, at, ['type', 'label', 'cells', 'layout']);
    if (bad) return bad;
    var statOut = { type: 'statRow' };
    var statLabel = normLayoutOptionalLabel(b, statOut, at);
    if (!statLabel.ok) return statLabel;
    if (!Array.isArray(b.cells) || !b.cells.length) return fail(at + '/cells', 'a stat row needs cells');
    if (b.cells.length > LIMITS.layoutCells) return fail(at + '/cells', 'a stat row holds at most ' + LIMITS.layoutCells + ' cells');
    var cells = [];
    for (var ci = 0; ci < b.cells.length; ci++) {
      var cellAt = at + '/cells/' + ci;
      var cell = b.cells[ci];
      bad = obj(cell, cellAt, 'a stat cell');
      if (bad) return bad;
      bad = onlyKeys(cell, cellAt, ['label', 'bind', 'format', 'highlights']);
      if (bad) return bad;
      var cellLabel = normLayoutText(cell.label, cellAt + '/label', LIMITS.label, true);
      if (!cellLabel.ok) return cellLabel;
      var cellBind = normLayoutBind(cell.bind, cellAt + '/bind', ctx, budget);
      if (!cellBind.ok) return cellBind;
      var cellFormat = normLayoutFormat(cell.format, cellAt + '/format');
      if (!cellFormat.ok) return cellFormat;
      var cellResult = appendHighlights(cell, { ok: true, out: { label: cellLabel.out, bind: cellBind.out, format: cellFormat.out } }, cellAt, 'cell');
      if (!cellResult.ok) return cellResult;
      cells.push(cellResult.out);
    }
    if (!inList(LAYOUT_STATROW_LAYOUTS, b.layout)) return fail(at + '/layout', 'stat row layout is flex or pair');
    statOut.cells = cells;
    statOut.layout = b.layout;
    return { ok: true, out: statOut };
  }

  if (b.type === 'miniChart') {
    bad = onlyKeys(b, at, ['type', 'label', 'series']);
    if (bad) return bad;
    var miniOut = { type: 'miniChart' };
    var miniLabel = normLayoutOptionalLabel(b, miniOut, at);
    if (!miniLabel.ok) return miniLabel;
    if (!Array.isArray(b.series) || !b.series.length) return fail(at + '/series', 'a mini chart needs a series');
    if (b.series.length > LIMITS.layoutSeries) return fail(at + '/series', 'a mini chart holds at most ' + LIMITS.layoutSeries + ' series');
    var miniSeries = [];
    var miniIds = {};
    for (var si = 0; si < b.series.length; si++) {
      var msAt = at + '/series/' + si;
      var ms = b.series[si];
      bad = obj(ms, msAt, 'a mini-chart series');
      if (bad) return bad;
      bad = onlyKeys(ms, msAt, ['id', 'label', 'expr', 'highlights']);
      if (bad) return bad;
      bad = badNodeId(ms.id, msAt, 'series id');
      if (bad) return bad;
      if (has(miniIds, ms.id)) return fail(msAt, 'duplicate series id "' + show(ms.id) + '"');
      miniIds[ms.id] = true;
      var msLabel = normLayoutText(ms.label, msAt + '/label', LIMITS.label, true);
      if (!msLabel.ok) return msLabel;
      if (typeof ms.expr !== 'string' || !ms.expr.replace(/\s/g, '')) return fail(msAt + '/expr', 'formula is empty');
      if (ms.expr.length > LIMITS.formula) return fail(msAt + '/expr', 'formula is over ' + LIMITS.formula + ' characters');
      budget.bindings++;
      var seriesBindingLimit = budget.bindingLimit || LIMITS.layoutBindings;
      if (budget.bindings > seriesBindingLimit) return fail(msAt, 'a ' + (budget.bindingLimit ? 'composition' : 'Layout') + ' stores at most ' + seriesBindingLimit + ' bindings');
      var miniResult = appendHighlights(ms, { ok: true, out: { id: ms.id, label: msLabel.out, expr: ms.expr } }, msAt, 'miniSeries');
      if (!miniResult.ok) return miniResult;
      miniSeries.push(miniResult.out);
    }
    miniOut.series = miniSeries;
    return { ok: true, out: miniOut };
  }

  if (b.type === 'pill' && has(b, 'text')) {
    bad = onlyKeys(b, at, ['type', 'label', 'variant', 'text']);
    if (bad) return bad;
    var literalOut = { type: 'pill' };
    var literalLabel = normLayoutOptionalLabel(b, literalOut, at);
    if (!literalLabel.ok) return literalLabel;
    if (!inList(LAYOUT_PILL_VARIANTS, b.variant)) return fail(at + '/variant', 'pill variant is status or delta');
    var pillText = normLayoutText(b.text, at + '/text', LIMITS.label, false);
    if (!pillText.ok) return pillText;
    literalOut.variant = b.variant;
    literalOut.text = pillText.out;
    return { ok: true, out: literalOut };
  }

  var allowed = ['type', 'label', 'bind', 'target', 'invert'];
  if (b.type === 'bigStat' || b.type === 'meter' || b.type === 'gauge' || b.type === 'kvRow' || b.type === 'pill') allowed.push('format');
  if (b.type === 'gauge') allowed.push('spread');
  if (b.type === 'moneyStat') allowed.push('role');
  if (b.type === 'kvRow') allowed = allowed.concat(['emphasis', 'sub']);
  if (b.type === 'pill') allowed.push('variant');
  if (b.type === 'progressBar') allowed = allowed.concat(['tick', 'tickLabel', 'tone', 'size']);
  bad = onlyKeys(b, at, allowed);
  if (bad) return bad;

  var out = { type: b.type };
  var optionalLabel = normLayoutOptionalLabel(b, out, at);
  if (!optionalLabel.ok) return optionalLabel;
  if (b.type === 'kvRow' && !has(out, 'label')) return fail(at + '/label', 'a key/value row needs a label');
  var needsTarget = b.type === 'meter' || b.type === 'gauge';
  var values = normLayoutValueFields(b, out, at, ctx, budget, needsTarget);
  if (!values.ok) return values;

  if (b.type === 'gauge') {
    if (typeof b.spread !== 'number' || !isFinite(b.spread) || b.spread <= 0 || b.spread > 100) {
      return fail(at + '/spread', 'gauge spread is a finite number over 0 and at most 100');
    }
    out.spread = b.spread;
  }
  if (b.type === 'bigStat' || b.type === 'meter' || b.type === 'gauge' || b.type === 'kvRow' || b.type === 'pill') {
    var format = normLayoutFormat(b.format, at + '/format');
    if (!format.ok) return format;
    out.format = format.out;
  }
  if (b.type === 'moneyStat') {
    if (!inList(LAYOUT_MONEY_ROLES, b.role)) return fail(at + '/role', 'money role is client or media');
    out.role = b.role;
  }
  if (b.type === 'kvRow') {
    if (!inList(LAYOUT_KV_EMPHASIS, b.emphasis)) return fail(at + '/emphasis', 'key/value emphasis is muted or strong');
    out.emphasis = b.emphasis;
    if (has(b, 'sub')) {
      var kvSub = normLayoutText(b.sub, at + '/sub', LIMITS.label, false);
      if (!kvSub.ok) return kvSub;
      out.sub = kvSub.out;
    }
  }
  if (b.type === 'pill') {
    if (!inList(LAYOUT_PILL_VARIANTS, b.variant)) return fail(at + '/variant', 'pill variant is status or delta');
    // Canonical legacy order has variant before bind/format. Rebuild to that exact order.
    var valuePill = { type: 'pill' };
    if (has(out, 'label')) valuePill.label = out.label;
    valuePill.variant = b.variant;
    valuePill.bind = out.bind;
    if (has(out, 'target')) { valuePill.target = out.target; valuePill.invert = out.invert; }
    valuePill.format = out.format;
    return { ok: true, out: valuePill };
  }
  if (b.type === 'progressBar') {
    if (has(b, 'tone')) {
      if (b.tone !== 'neutral') return fail(at + '/tone', 'progress colour is neutral; omit for automatic');
      out.tone = b.tone;
    }
    if (has(b, 'size')) {
      if (b.size !== 'compact') return fail(at + '/size', 'progress thickness is compact; omit for regular');
      out.size = b.size;
    }
    if (has(b, 'tick')) {
      var tick = normLayoutBind(b.tick, at + '/tick', ctx, budget);
      if (!tick.ok) return tick;
      out.tick = tick.out;
    }
    if (has(b, 'tickLabel')) {
      var tickLabel = normLayoutText(b.tickLabel, at + '/tickLabel', LIMITS.label, false);
      if (!tickLabel.ok) return tickLabel;
      out.tickLabel = tickLabel.out;
    }
  }
  return { ok: true, out: out };
}

function normLayoutCol(c, at, ctx, budget) {
  var bad = obj(c, at, 'a Layout column');
  if (bad) return bad;
  bad = onlyKeys(c, at, ['span', 'frame', 'title', 'sub', 'badge', 'bricks']);
  if (bad) return bad;
  if (!has(c, 'span')) return fail(at + '/span', 'span is required; null means equal-width auto layout');
  if (c.span !== null && (!isInt(c.span) || c.span < 1 || c.span > LIMITS.layoutSpan)) {
    return fail(at + '/span', 'span is null or a whole number from 1 to ' + LIMITS.layoutSpan);
  }
  if (!inList(LAYOUT_FRAMES, c.frame)) return fail(at + '/frame', 'unknown Layout frame "' + show(c.frame) + '"');
  if (c.frame === 'none' && (has(c, 'title') || has(c, 'sub') || has(c, 'badge'))) {
    return fail(at, 'an unframed column carries no title, subtitle or badge');
  }
  var out = { span: c.span, frame: c.frame };
  if (has(c, 'title')) {
    var title = normLayoutText(c.title, at + '/title', LIMITS.label, false);
    if (!title.ok) return title;
    out.title = title.out;
  }
  if (has(c, 'sub')) {
    var sub = normLayoutText(c.sub, at + '/sub', LIMITS.support, false);
    if (!sub.ok) return sub;
    out.sub = sub.out;
  }
  if (has(c, 'badge')) {
    var badge = normLayoutBadge(c.badge, at + '/badge', ctx, budget);
    if (!badge.ok) return badge;
    out.badge = badge.out;
  }
  if (!Array.isArray(c.bricks) || !c.bricks.length) return fail(at + '/bricks', 'a Layout column needs at least one block');
  if (c.bricks.length > LIMITS.layoutBricksPerCol) return fail(at + '/bricks', 'a Layout column holds at most ' + LIMITS.layoutBricksPerCol + ' blocks');
  var bricks = [];
  for (var bi = 0; bi < c.bricks.length; bi++) {
    budget.bricks++;
    if (budget.bricks > LIMITS.layoutBricks) return fail(at + '/bricks/' + bi, 'a Layout holds at most ' + LIMITS.layoutBricks + ' blocks');
    var brick = normLayoutBrick(c.bricks[bi], at + '/bricks/' + bi, ctx, budget);
    if (!brick.ok) return brick;
    bricks.push(brick.out);
  }
  out.bricks = bricks;
  return { ok: true, out: out };
}

function normLayoutView(v, at, ctx) {
  var bad = obj(v, at, 'a Layout view');
  if (bad) return bad;
  bad = onlyKeys(v, at, ['id', 'kind', 'title', 'rows']);
  if (bad) return bad;
  if (v.kind !== 'layout') return fail(at + '/kind', 'Layout view kind must be "layout"');
  bad = badNodeId(v.id, at, 'view id');
  if (bad) return bad;
  if (typeof v.title !== 'string') return fail(at + '/title', 'title must be a string');
  if (v.title.length > LIMITS.title) return fail(at + '/title', 'title is over ' + LIMITS.title + ' characters');
  if (!Array.isArray(v.rows) || !v.rows.length) return fail(at + '/rows', 'a saved Layout needs at least one row and one block');
  if (v.rows.length > LIMITS.layoutRows) return fail(at + '/rows', 'a Layout holds at most ' + LIMITS.layoutRows + ' rows');
  var budget = { bricks: 0, bindings: 0 };
  var rows = [];
  for (var ri = 0; ri < v.rows.length; ri++) {
    var rowAt = at + '/rows/' + ri;
    var row = v.rows[ri];
    bad = obj(row, rowAt, 'a Layout row');
    if (bad) return bad;
    bad = onlyKeys(row, rowAt, ['cols']);
    if (bad) return bad;
    if (!Array.isArray(row.cols) || !row.cols.length) return fail(rowAt + '/cols', 'a Layout row needs at least one column');
    if (row.cols.length > LIMITS.layoutCols) return fail(rowAt + '/cols', 'a Layout row holds at most ' + LIMITS.layoutCols + ' columns');
    var cols = [];
    var spanned = 0;
    for (var li = 0; li < row.cols.length; li++) {
      var col = normLayoutCol(row.cols[li], rowAt + '/cols/' + li, ctx, budget);
      if (!col.ok) return col;
      if (col.out.span !== null) spanned += col.out.span;
      cols.push(col.out);
    }
    if (spanned > LIMITS.layoutSpan) return fail(rowAt + '/cols', 'column spans total ' + spanned + ', over ' + LIMITS.layoutSpan);
    rows.push({ cols: cols });
  }
  if (!budget.bricks) return fail(at + '/rows', 'a saved Layout needs at least one block');
  return { ok: true, out: { id: v.id, kind: 'layout', title: v.title, rows: rows } };
}

/**
 * A shallow copy of a view WITHOUT the one key every kind shares. Own enumerable keys only,
 * read exactly the way `onlyKeys` reads them, so the copy a branch is handed carries the same
 * key set the branch would have judged — minus the one normView has already judged itself.
 */
function withoutBesideNext(v) {
  var out = {};
  for (var k in v) {
    if (has(v, k) && k !== 'besideNext') out[k] = v[k];
  }
  return out;
}

/**
 * The view dispatcher (Table D). It owns the two guards every view branch then assumes: the
 * object guard, so a `views: [null]` entry rejects as a 400 instead of throwing a TypeError at
 * `v.kind`, and the kind check — the same split normControls/normControl already use.
 *
 * And, since section view rows (spec 2026-08-27 §2), the one key EVERY kind may carry:
 * `besideNext`. It is read HERE, once, and taken off before the branch runs — each branch's
 * `onlyKeys` is closed, and adding the key to six lists would be six places for a seventh
 * kind to forget it, on a fact that has nothing to do with what a view draws.
 *
 * SPARSE, and stored only when TRUE. `false` is not «does not share a row», it is a second
 * spelling of the absent key, and §9 has one spelling per fact — which is also what keeps
 * every widget stored before this rule byte-identical: the key is absent everywhere today.
 * It is APPENDED to the branch's own key order for the same reason: a key in the middle
 * would move the bytes of the widgets that later gain one.
 *
 * WHERE it is legal is not this function's question. `besideNext` names the NEXT view, which
 * only the list can see, so normReport refuses it on the last one.
 */
/** Tolerant preorder traversal, shared by runtime, editor and strict validation passes.
 * A draft may be malformed or cyclic; bounded traversal never hangs a preview. */
function walkViewNodes(views, visit) {
  var count = 0;
  var ancestors = [];
  function walk(list, parent, path, depth) {
    if (!Array.isArray(list) || depth > LIMITS.compositionDepth) return;
    for (var i = 0; i < list.length && count < LIMITS.compositionNodes; i++) {
      var node = list[i];
      var nodePath = path.concat(i);
      count++;
      visit(node, { path: nodePath, parent: parent, index: i, depth: depth });
      if (node && node.kind === 'container' && ancestors.indexOf(node) === -1) {
        ancestors.push(node);
        walk(node.children, node, nodePath.concat('children'), depth + 1);
        ancestors.pop();
      }
    }
  }
  walk(views, null, ['views'], 1);
}
function flattenViews(views) {
  var out = [];
  walkViewNodes(views, function (node) { out.push(node); });
  return out;
}
function leafViews(views) {
  return flattenViews(views).filter(function (node) { return !node || node.kind !== 'container'; });
}
/** Measured by callers after normalization; a bounded kind walk chooses the same cap everywhere. */
function specByteLimit(spec) {
  var composition = false;
  walkViewNodes(spec && spec.views, function (node) {
    if (node && (node.kind === 'container' || node.kind === 'atom')) composition = true;
  });
  return composition ? LIMITS.compositionSpecBytes : LIMITS.specBytes;
}
function normContainer(v, at, env, ctx) {
  var bad = onlyKeys(v, at, ['id', 'kind', 'title', 'direction', 'frame', 'children', 'sub', 'badge', 'gap', 'hideSubtitle', 'hideBadge', 'distribution']);
  if (bad) return bad;
  bad = badNodeId(v.id, at, 'container id');
  if (bad) return bad;
  var title = normLayoutText(v.title, at + '/title', LIMITS.title, true);
  if (!title.ok) return title;
  if (!inList(['row', 'column'], v.direction)) return fail(at + '/direction', 'a container direction is row or column');
  if (!inList(LAYOUT_FRAMES, v.frame)) return fail(at + '/frame', 'unknown container frame');
  if (!Array.isArray(v.children) || !v.children.length) return fail(at + '/children', 'a saved container needs at least one element');
  if (v.children.length > LIMITS.containerChildren) return fail(at + '/children', 'a container holds at most ' + LIMITS.containerChildren + ' elements');
  var out = { id: v.id, kind: 'container', title: title.out, direction: v.direction, frame: v.frame, children: [] };
  if (has(v, 'sub')) {
    var sub = normLayoutText(v.sub, at + '/sub', LIMITS.support, false);
    if (!sub.ok) return sub;
    out.sub = sub.out;
  }
  if (has(v, 'badge')) {
    var badge = normLayoutBadge(v.badge, at + '/badge', ctx, env.compositionBudget);
    if (!badge.ok) return badge;
    out.badge = badge.out;
  }
  if (has(v, 'gap')) {
    if (!inList(['tight', 'compact', 'normal', 'relaxed'], v.gap)) return fail(at + '/gap', 'container gap is tight, compact, normal or relaxed');
    out.gap = v.gap;
  }
  if (has(v, 'distribution')) {
    if (v.distribution !== 'content') return fail(at + '/distribution', 'column widths fit content; omit for relative shares');
    out.distribution = v.distribution;
  }
  for (var h = 0, hidden = ['hideSubtitle', 'hideBadge']; h < hidden.length; h++) {
    if (has(v, hidden[h])) {
      if (v[hidden[h]] !== true) return fail(at + '/' + hidden[h], hidden[h] + ' is sparse true; omit it to show the content');
      out[hidden[h]] = true;
    }
  }
  for (var i = 0; i < v.children.length; i++) {
    if (has(v.children[i] || {}, 'besideNext')) return fail(at + '/children/' + i, 'a container arranges its children; use its direction instead of besideNext');
    var child = normView(v.children[i], at + '/children/' + i, env, ctx);
    if (!child.ok) return child;
    out.children.push(child.out);
  }
  return { ok: true, out: out };
}
function normAtom(v, at, env, ctx) {
  var bad = onlyKeys(v, at, ['id', 'kind', 'brick']);
  if (bad) return bad;
  bad = badNodeId(v.id, at, 'element id');
  if (bad) return bad;
  env.compositionBudget.bricks++;
  if (env.compositionBudget.bricks > LIMITS.compositionAtoms) return fail(at, 'a widget holds at most ' + LIMITS.compositionAtoms + ' small blocks');
  var brick = normLayoutBrick(v.brick, at + '/brick', ctx, env.compositionBudget);
  return brick.ok ? { ok: true, out: { id: v.id, kind: 'atom', brick: brick.out } } : brick;
}
function normView(v, at, env, ctx) {
  var bad = obj(v, at, 'a view');
  if (bad) return bad;
  if (!inList(VIEW_KINDS, v.kind)) return fail(at, 'unknown view kind "' + show(v.kind) + '"');
  var budget = env.compositionBudget;
  budget.nodes++;
  budget.depth++;
  if (budget.nodes > LIMITS.compositionNodes) return fail(at, 'a widget holds at most ' + LIMITS.compositionNodes + ' elements');
  if (budget.depth > LIMITS.compositionDepth) return fail(at, 'containers nest at most ' + LIMITS.compositionDepth + ' levels');
  if (v.kind !== 'container' && v.kind !== 'atom') {
    budget.views++;
    if (budget.views > LIMITS.views) return fail(at, 'a widget holds at most ' + LIMITS.views + ' data views');
  }
  var beside = false;
  var body = Object.create(null);
  for (var k in v) if (has(v, k) && k !== 'besideNext' && k !== 'span') body[k] = v[k];
  if (has(v, 'besideNext')) {
    if (v.besideNext !== true) return fail(at, 'besideNext is stored only when it is true; a view that does not share a row carries no such key');
    beside = true;
  }
  if (has(v, 'span') && v.span !== null && (typeof v.span !== 'number' || !isFinite(v.span) || v.span <= 0 || v.span > LIMITS.layoutSpan)) {
    return fail(at + '/span', 'span is null or a positive finite number up to ' + LIMITS.layoutSpan);
  }
  var r = v.kind === 'container' ? normContainer(body, at, env, ctx)
    : v.kind === 'atom' ? normAtom(body, at, env, ctx) : normViewBody(body, at, env, ctx);
  budget.depth--;
  if (r.ok && has(v, 'span')) r.out.span = v.span;
  if (r.ok && beside) r.out.besideNext = true;
  return r;
}

/** The kind branches, behind normView's three guards. */
function normViewBody(v, at, env, ctx) {
  if (v.kind === 'chart') return normChartView(v, at, env, ctx);
  if (v.kind === 'table') return normTableView(v, at, env, ctx);
  if (v.kind === 'kpi') return normKpiView(v, at, env, ctx);
  if (v.kind === 'pie') return normPieView(v, at, env, ctx);
  if (v.kind === 'layout') return normLayoutView(v, at, ctx);
  // Compare takes no `ctx`: it is private like the four above, it resolves against controls[],
  // and nothing in it asks the host a question — no dimension key, no canonical metric.
  if (v.kind === 'compare') return normCompareView(v, at, env);
  // Unreachable while VIEW_KINDS lists only the kinds with a branch above — and this line is
  // what KEEPS it unreachable: a kind added to the list without its normalizer rejects here
  // instead of being read as a chart and stored as one.
  return fail(at, 'the "' + show(v.kind) + '" view has no normalizer');
}

/**
 * THE spec-wide value walk (Table I) — every place a Table B value is STORED, and nowhere else.
 * Runs over the NORMALIZED controls and views, so every shape below is guaranteed and each entry
 * carries the pointer its slot sits at: `{ value, at }`.
 *
 * Seven slots, six of them under views[] (enumerated once, in `pushViewValues` below, which
 * `specWantsCm` reads too): series `value`, series `guide.value`, column `value`, KPI `value`,
 * KPI `target.value`, pie `value` — and the seventh under controls[]: a metric
 * switch's option values. That seventh one is why this is a WALK and not a views scan: a bound
 * series consumes CM through an OPTION, with no 'cm' anywhere in views[], so a views-only walk
 * would refuse a CM360 widget whose only CM is a bound option. (It used to be wrong in the other
 * direction too, when the direct rail still refused a cm value on a delivery dataset; that rail
 * is gone, and the option slots stay in the walk for the converse rail and the value count.)
 *
 * THREE readers share it, all in normReport's cross-object pass: reachability's bound scan (6c),
 * the converse rail that a CM360 dataset needs a CM consumer (6d), and the 48-value count (6e).
 * The first of those looks like a views question and is not: a `bound` value is legal in exactly
 * the four element slots below, and normControl refuses a bound OPTION, so scanning this walk for
 * one is the same set of values as walking the views — with no second walk to drift from this one.
 *
 * It is NOT optionValues: that EXPANDS one element into the values its switch can take, so
 * reading it here would count a bound element once per option and still miss the options of a
 * switch nothing binds to. One slot is one value, bound or fixed.
 *
 * Takes no `at`: the two roots are constants (normControls' precedent), and every pointer beneath
 * them is composed from those. Returns { ok: true, entries } or a rejection.
 *
 * THE INDEX BASE DIFFERS from normControls'. A `/spec/controls/N` raised in there counts the list
 * the CLIENT SENT; every one raised out here — this walk, and 6c's reachability — counts the
 * STORED CONTROL_TYPES order, because that is the list the cross-object pass is
 * handed. The two agree whenever the author sent them in that order and not otherwise. Naming the
 * control, which both do, is what makes the refusal unambiguous either way.
 */
function walkValues(controls, views) {
  var entries = [];
  var i;
  var j;
  for (i = 0; i < views.length; i++) {
    var vAt = '/spec/views/' + i;
    if (!pushViewValues(views[i], vAt, entries)) {
      // A compare view stores no value — it names two controls, and the switch's options are
      // counted once, under controls[]. Anything ELSE is a kind added to VIEW_KINDS and to
      // normView without its slots declared in pushViewValues: it would count as zero values,
      // and the 48-value cap would quietly stop counting the widget it is meant to bound.
      // normView ends in the same refusal for the same reason.
      return fail(vAt, 'the "' + show(views[i] && views[i].kind) + '" view has no value slots declared');
    }
  }
  for (i = 0; i < controls.length; i++) {
    if (controls[i].type !== 'metric') continue;
    for (j = 0; j < controls[i].options.length; j++) {
      entries.push({ value: controls[i].options[j].value, at: '/spec/controls/' + i + '/options/' + j + '/value' });
    }
  }
  return { ok: true, entries: entries };
}

/**
 * Table I's VIEW slots, including the optional table share value, pushed onto `entries`.
 * Returns false for a view kind that declares
 * none — which the strict walk above turns into a refusal and the tolerant reader below simply
 * skips.
 *
 * It is ONE enumeration on purpose: an eighth slot added to the grammar has to be seen by the
 * value count, by the converse CM rail AND by `specWantsCm`, and a second copy of this list is
 * how a slot comes to be counted by one reader and missed by another. The COLUMN TARGET (§5.2,
 * section-widget parity 2026-09-04) is the seventh, and it arrived a fix round late: the count
 * read a table of 12 columns each carrying a plan as 12 values rather than 24, and a plan that
 * named the ad-server side reached the read path with no fetch behind it.
 *
 * Every read is array- and object-guarded even though normReport hands it NORMALIZED views,
 * where each shape is already guaranteed. The guards are no-ops there, by construction, and
 * they are what lets `specWantsCm` answer for a DRAFT mid-edit without a throw.
 */
function pushViewValues(v, vAt, entries) {
  var j;
  if (!v || typeof v !== 'object') return false;
  if (v.kind === 'container') {
    var children = Array.isArray(v.children) ? v.children : [];
    for (j = 0; j < children.length; j++) if (!pushViewValues(children[j], vAt + '/children/' + j, entries)) return false;
    return true;
  }
  if (v.kind === 'atom') return true; // brick bindings use their own shared, bounded grammar
  if (v.kind === 'chart') {
    var series = Array.isArray(v.series) ? v.series : [];
    for (j = 0; j < series.length; j++) {
      var s = series[j];
      // Table I: a calc series holds NO value and contributes none. Written as a positive test
      // on the kind that HAS one, so a third series kind can never reach the push below and be
      // read for a `value` it does not carry.
      if (!s || s.kind !== 'value') continue;
      entries.push({ value: s.value, at: vAt + '/series/' + j + '/value' });
      if (has(s, 'guide') && s.guide && has(s.guide, 'value')) entries.push({ value: s.guide.value, at: vAt + '/series/' + j + '/guide/value' });
    }
    return true;
  }
  if (v.kind === 'table') {
    if (v.share && has(v.share, 'value')) entries.push({ value: v.share.value, at: vAt + '/share/value' });
    var columns = Array.isArray(v.columns) ? v.columns : [];
    for (j = 0; j < columns.length; j++) {
      if (!columns[j]) continue;
      entries.push({ value: columns[j].value, at: vAt + '/columns/' + j + '/value' });
      // The plan under the totals cell holds a value of its own, exactly as a KPI's target
      // does two branches down.
      if (has(columns[j], 'target') && columns[j].target) {
        entries.push({ value: columns[j].target.value, at: vAt + '/columns/' + j + '/target/value' });
      }
    }
    return true;
  }
  if (v.kind === 'kpi') {
    entries.push({ value: v.value, at: vAt + '/value' });
    if (has(v, 'target') && v.target) entries.push({ value: v.target.value, at: vAt + '/target/value' });
    return true;
  }
  if (v.kind === 'pie') {
    entries.push({ value: v.value, at: vAt + '/value' });
    return true;
  }
  return v.kind === 'compare' || v.kind === 'layout';
}

/**
 * A cm-bearing expression inside a HIGHLIGHT rule (spec 2026-09-16 §2.8). Deliberately NOT
 * part of `pushViewValues`: a highlight holds no value slot, and that one enumeration feeds
 * the 48-value cap and rail 6d as well as this predicate. Counted there, a rule would move
 * the cap, and rail 6d would read a widget that only PAINTS with CM360 as one that shows it.
 *
 * Four expression slots per rule — input, guard, and both thresholds — which is exactly what
 * `checkAlerts` judges. Whole-identifier scan, because this file parses no formula content.
 */
function anyCmHighlight(v) {
  if (!v || typeof v !== 'object') return false;
  var owners = [v];
  var lists = [v.columns, v.series];
  var i;
  var j;
  var k;
  for (i = 0; i < lists.length; i++) {
    var list = Array.isArray(lists[i]) ? lists[i] : [];
    for (j = 0; j < list.length; j++) if (list[j] && typeof list[j] === 'object') owners.push(list[j]);
  }
  for (i = 0; i < owners.length; i++) {
    var rules = Array.isArray(owners[i].highlights) ? owners[i].highlights : [];
    for (j = 0; j < rules.length; j++) {
      var r = rules[j];
      if (!r || typeof r !== 'object') continue;
      var c = r.condition && typeof r.condition === 'object' ? r.condition : {};
      var slots = [r.input, r.guard, c.threshold, c.upper];
      for (k = 0; k < slots.length; k++) {
        var s = slots[k];
        if (s && typeof s === 'object' && typeof s.expr === 'string' && CM_EXPR_RE.test(s.expr)) return true;
      }
    }
  }
  return false;
}

/**
 * specWantsCm(spec) → does this spec hold a `source:'cm'` value ANYWHERE a value lives?
 *
 * Two readers, and they are the same question asked from opposite ends:
 *   · the READ PATH's fetch gate — `useReportCm360` pulls the cm360 file and builds the
 *     comparison for a widget that wants CM, whatever its dataset says (spec 2026-08-25 §3);
 *   · widgets-validate's `CM_NO_ENTITY_SCOPE` rail — the one widget-level fact the join
 *     cannot survive, applied where the outer scope and the spec are both in hand.
 * One predicate, so a tile that fetches and a save that is refused can never disagree about
 * which specs carry CM.
 *
 * The CONTROL options are walked with the views, and that is the whole reason this is a walk:
 * a bound series consumes CM through an OPTION with no 'cm' anywhere in views[], and the
 * viewer can move the switch onto it — so a widget whose only cm value is a switch option
 * still fetches, and still refuses an entity scope.
 *
 * TOLERANT by contract, because the builder calls it on a DRAFT: anything that is not a spec,
 * and any slot whose shape is not there yet, answers false rather than throwing. It never
 * validates — `normReport` is the authority on whether a cm value is legal where it sits.
 */
function specWantsCm(spec) {
  if (!spec || typeof spec !== 'object') return false;
  var views = Array.isArray(spec.views) ? spec.views : [];
  // The bricks first, over `flattenViews` and not over the `leafViews` list the value walk
  // below uses: `leafViews` drops containers, and a container's badge is one of the six brick
  // slots that can read CM360 (§2.7). Three roots, because those are the three places the
  // grammar puts a brick: an atom's `brick`, a Layout view's `rows`, a container's `badge`.
  var nodes = flattenViews(views);
  for (var b = 0; b < nodes.length; b++) {
    var node = nodes[b];
    if (!node || typeof node !== 'object') continue;
    if (anyCmBrickExpr(node.brick) || anyCmBrickExpr(node.rows) || anyCmBrickExpr(node.badge)) return true;
    // …and the rules ON those bricks, over the same three roots. THIS reader counts them and
    // rail 6d does not (§2.8): a rule reading `cmIm` cannot paint until the file is fetched,
    // but it draws no number, so it is not a consumer. Second predicate, second answer.
    if (anyCmBrickHighlight(node.brick) || anyCmBrickHighlight(node.rows)
      || anyCmBrickHighlight(node.badge)) return true;
  }
  var controls = Array.isArray(spec.controls) ? spec.controls : [];
  var entries = [];
  var i;
  var j;
  var leaves = leafViews(views);
  for (i = 0; i < leaves.length; i++) pushViewValues(leaves[i], '', entries);
  // A highlight is scanned on its own (§2.8): it holds no value slot, so `entries` — which
  // the 48-value cap and rail 6d also read — must never learn about it.
  for (i = 0; i < leaves.length; i++) if (anyCmHighlight(leaves[i])) return true;
  for (i = 0; i < controls.length; i++) {
    var c = controls[i];
    if (!c || c.type !== 'metric' || !Array.isArray(c.options)) continue;
    for (j = 0; j < c.options.length; j++) {
      if (c.options[j]) entries.push({ value: c.options[j].value, at: '' });
    }
  }
  for (i = 0; i < entries.length; i++) {
    var v = entries[i].value;
    if (!v || typeof v !== 'object') continue;
    if (v.kind === 'metric' && v.source === 'cm') return true;
    // …and the second shape (§2.10): a formula naming cmIm / cmCl / cmCo reads the same aux
    // file through the same join, so the tile that draws it has to FETCH the file and the
    // save that carries it has to refuse an entity scope. One predicate for both readers, so
    // a tile that fetches and a save that is refused cannot disagree about which specs carry
    // CM — that is the whole reason this function exists.
    if (exprIsCmBearing(v)) return true;
  }
  return false;
}

/**
 * Table H — the declared cross-view wiring (§5.6). A tupleFocus runs compare → chart INSIDE one
 * widget: focusing a Compare row filters the chart beside it.
 *
 * Takes no `at`: interactions sit at exactly one place in the grammar, so the pointer root is a
 * constant here (normControls' precedent). `views` is the NORMALIZED list, and its ids are
 * already known unique (normReport's pass 6a runs first) — which is what makes "the view named
 * v1" one view rather than two.
 */
function normInteractions(list, views) {
  var at = '/spec/interactions';
  if (!Array.isArray(list)) return fail(at, 'interactions must be an array');
  // A DoS rail, not a modelling cap: 6 views give at most 9 distinct legal pairs, so this can
  // never bind on a widget anyone can draw. It is FIRST so a 10,000-entry array is refused before
  // the reference loop runs it.
  if (list.length > LIMITS.interactions) {
    return fail(at, 'a widget declares at most ' + LIMITS.interactions + ' interactions');
  }
  var out = [];
  var seenId = {};
  var seenPair = {};
  for (var i = 0; i < list.length; i++) {
    var iAt = at + '/' + i;
    var it = list[i];
    var bad = obj(it, iAt, 'an interaction');
    if (bad) return bad;
    bad = onlyKeys(it, iAt, ['id', 'type', 'sourceViewId', 'targetViewId']);
    if (bad) return bad;
    bad = badNodeId(it.id, iAt, 'interaction id');
    if (bad) return bad;
    if (has(seenId, it.id)) return fail(iAt, 'duplicate interaction id "' + show(it.id) + '"');
    seenId[it.id] = true;
    if (!inList(INTERACTION_TYPES, it.type)) {
      return fail(iAt, 'unknown interaction type "' + show(it.type) + '"; a widget wires ' + INTERACTION_TYPES.join(', '));
    }
    // The two ends are checked by KIND, not merely by existence: §5.6 wires a Compare view to a
    // Chart, and that also makes the two ends distinct without a rule of its own — one view
    // cannot be both kinds.
    var src = byId(views, it.sourceViewId);
    if (!src || src.kind !== 'compare') {
      return fail(iAt, 'sourceViewId "' + show(it.sourceViewId) + '" names no compare view of this widget; a tupleFocus runs compare → chart');
    }
    var tgt = byId(views, it.targetViewId);
    if (!tgt || tgt.kind !== 'chart') {
      return fail(iAt, 'targetViewId "' + show(it.targetViewId) + '" names no chart view of this widget; a tupleFocus runs compare → chart');
    }
    // §5.6: one wire per pair. A repeat is not additive — it is the same wire declared twice, and
    // the second carries nothing the first does not. NodeIds hold no '>', so the joined key is
    // one pair and never two (and no NodeId is '__proto__', which is why plain objects are safe
    // as seen-maps here).
    var pair = src.id + '>' + tgt.id;
    if (has(seenPair, pair)) {
      return fail(iAt, 'view "' + src.id + '" is already wired to view "' + tgt.id + '"');
    }
    seenPair[pair] = true;
    // `type` is stored from the INPUT, which is what makes the membership check above load-
    // bearing: storing the literal would rewrite any type to tupleFocus if that check ever went.
    out.push({ id: it.id, type: it.type, sourceViewId: src.id, targetViewId: tgt.id });
  }
  return { ok: true, out: out };
}

/**
 * Table H — the dataset. `spec.dataset.type` is the ONE source of the widget's datasetType;
 * nothing is derived from the content, so a CM360 widget cannot declare itself delivery. The
 * fixed mapping id is SHAPE-checked only (§9: an external ref is never proved to exist at save
 * time; a missing one renders a named disconnected state).
 */
function normDataset(d, at) {
  var bad = obj(d, at, 'a dataset');
  if (bad) return bad;
  if (!inList(DATASET_TYPES, d.type)) return fail(at, 'unknown dataset "' + show(d.type) + '"; a widget reads delivery or deliveryCm360');
  if (d.type === 'delivery') {
    bad = onlyKeys(d, at, ['type']);
    if (bad) return bad;
    return { ok: true, out: { type: 'delivery' } };
  }
  bad = onlyKeys(d, at, ['type', 'mapping']);
  if (bad) return bad;
  var mAt = at + '/mapping';
  bad = obj(d.mapping, mAt, 'a mapping');
  if (bad) return bad;
  if (!inList(MAPPING_MODES, d.mapping.mode)) return fail(mAt, 'unknown mapping mode "' + show(d.mapping.mode) + '"; a mapping is runtime or fixed');
  if (d.mapping.mode === 'runtime') {
    bad = onlyKeys(d.mapping, mAt, ['mode']);
    if (bad) return bad;
    return { ok: true, out: { type: 'deliveryCm360', mapping: { mode: 'runtime' } } };
  }
  bad = onlyKeys(d.mapping, mAt, ['mode', 'id']);
  if (bad) return bad;
  if (typeof d.mapping.id !== 'string') return fail(mAt, 'a fixed mapping names an id');
  var id = d.mapping.id.trim();
  if (!id || id.length > LIMITS.mappingId || /[\u0000-\u001f]/.test(id)) {
    return fail(mAt, 'a mapping id is 1 to ' + LIMITS.mappingId + ' characters and carries no control characters, not "' + show(d.mapping.id) + '"');
  }
  return { ok: true, out: { type: 'deliveryCm360', mapping: { mode: 'fixed', id: id } } };
}

/**
 * The spec root (Table H) — the whole grammar, in the ONE order in which each pass can read what
 * the pass before it produced. The order is normative, and every step says what it depends on:
 *
 *   1. the object and closed-key guards;
 *   2. `dataset` — every CM360 fork below reads it;
 *   3. `period` — a RangeValue or null, and the key must be PRESENT;
 *   4. `controls`, then the control⇄dataset couplings (Table C): a CM360 widget carries no period
 *      control and no spec period, and a breakdown control is CM360-only. The fourth of them
 *      needs no dataset: a Period switch and a spec period are mutually exclusive, because §6's
 *      precedence makes the second one dead. Before the views, because a compare view NAMES
 *      controls and a bound value RESOLVES through one;
 *   5. `views`, each with `env = {controls, datasetType}` — the two facts a view cannot see from
 *      inside itself; then the ONE rule that is about the LIST rather than about a view: a
 *      `besideNext` on the LAST view names a next view that is not there;
 *   6. the CROSS-OBJECT pass, the only place that sees the spec as a whole:
 *      a. view-id uniqueness — FIRST, because an interaction resolves a view BY id and a repeat
 *         would make "the view named v1" two views;
 *      b. `interactions`, which need the view KINDS from (5);
 *      c. reachability — a metric or breakdown control nobody consumes rejects (no silent dead
 *         config); a period control is always reachable, being the widget's own chip row;
 *      d. the converse CM rail — a CM360 dataset that consumes no CM data rejects;
 *      e. the 48-value count.
 *
 * (c), (d) and (e) share ONE walk — walkValues, over Table I's seven value slots. Its docblock
 * says why a views-only walk would be wrong.
 *
 * Returns `{ ok: true, out }` — `out` being the canonical-order spec to STORE, not the input — or
 * `{ ok: false, detail }`, whose detail always opens with a `/spec/...` pointer. The caller
 * prepends the widget id, exactly once.
 *
 * What is NOT here, because the spec cannot see past itself. All six belong to the CALLER, in
 * widgets-validate.mjs, which is also the only side that can name the widget in a refusal:
 *   - the `scope.time === 'absolute'` half of the period coupling (Table C rule 2);
 *   - an outer `scope` at all on a deliveryCm360 widget (Table A);
 *   - an outer ENTITY scope on a widget that holds a cm value (CM_NO_ENTITY_SCOPE, over this
 *     file's `specWantsCm`);
 *   - the profile rules — non-section profiles hold one view, Layout is card/section, and a
 *     CM360 widget is section-only;
 *   - the stored `datasetType` discriminator must equal `spec.dataset.type` (derivedDatasetType
 *     is what it is compared against, so there is one source and no second derivation);
 *   - the byte cap, `LIMITS.specBytes`, measured on the normalized output.
 *
 * PUBLIC, so it obj-guards its own input: `{schemaVersion:2, spec:null}` must reject as a 400,
 * and widgets-validate.mjs:654-657 turns any throw from in here into a 500.
 */
function normReport(spec, ctx) {
  var at = '/spec';
  var i;
  var j;
  var bad = obj(spec, at, 'a spec');
  if (bad) return bad;
  bad = onlyKeys(spec, at, ['dataset', 'period', 'controls', 'views', 'interactions', 'formatDefaultsVersion']);
  if (bad) return bad;
  if (has(spec, 'formatDefaultsVersion') && spec.formatDefaultsVersion !== 1) {
    return fail(at + '/formatDefaultsVersion', 'unknown format defaults version');
  }

  var ds = normDataset(spec.dataset, at + '/dataset');
  if (!ds.ok) return ds;
  // ABSENT is not null: null is the widget saying "follow the dashboard filter", and a missing
  // key is a client that forgot to say. §9 fills nothing in.
  if (!has(spec, 'period')) return fail(at, 'period is required; null means the widget follows the dashboard filter');
  if (spec.period !== null && !inList(RANGE_VALUES, spec.period)) {
    return fail(at + '/period', 'unknown period "' + show(spec.period) + '"; a period is null or one of ' + RANGE_VALUES.join(', '));
  }
  var controls = normControls(spec.controls, ctx);
  if (!controls.ok) return controls;

  // Table C's two control⇄dataset couplings. §6's precedence line is the source of the first:
  // the Period switch stores the viewer's selection in `display.widgetRanges`, and that lane
  // refuses a CM360 widget — shipping both as written would be a control whose selection cannot
  // persist. The `scope.time === 'absolute'` half of the same rule is the caller's.
  var isCm = ds.out.type === 'deliveryCm360';
  var hasPeriodCtl = false;
  var hasBreakdownCtl = false;
  for (i = 0; i < controls.out.length; i++) {
    if (controls.out[i].type === 'period') hasPeriodCtl = true;
    if (controls.out[i].type === 'breakdown') hasBreakdownCtl = true;
  }
  if (isCm && hasPeriodCtl) {
    return fail(at + '/controls', 'a CM360 widget has no period of its own, so it carries no period control');
  }
  if (isCm && spec.period !== null) {
    return fail(at + '/period', CM_NO_SPEC_PERIOD);
  }
  if (!isCm && hasBreakdownCtl) {
    return fail(at + '/controls', 'a breakdown control picks mapping dimensions; it needs a deliveryCm360 dataset');
  }
  // …and the third PERIOD rule, the one that needs no dataset at all: §6's precedence says
  // the switch beats the window, so a window BESIDE a switch is a stored range nothing can
  // read. It is placed LAST of this block's four couplings so every sentence the three above
  // already answer with is unmoved: a CM360 widget returns on its own two rules before
  // reaching this one, and a delivery widget carrying a breakdown control still hears about
  // the breakdown control first.
  if (hasPeriodCtl && spec.period !== null) {
    return fail(at + '/period', SWITCH_NO_SPEC_PERIOD);
  }

  if (!Array.isArray(spec.views)) return fail(at + '/views', 'views must be an array');
  if (!spec.views.length) return fail(at + '/views', 'a widget draws at least one view');
  if (spec.views.length > LIMITS.views) return fail(at + '/views', 'a widget holds at most ' + LIMITS.views + ' views');
  // What a view cannot see from inside itself: the switch its bound values follow, and the
  // dataset its kind may require.
  var env = { controls: controls.out, datasetType: ds.out.type, compositionBudget: { nodes: 0, depth: 0, views: 0, bricks: 0, bindings: 0, bindingLimit: LIMITS.compositionBindings } };
  var views = [];
  for (i = 0; i < spec.views.length; i++) {
    var r = normView(spec.views[i], at + '/views/' + i, env, ctx);
    if (!r.ok) return r;
    views.push(r.out);
  }

  // The one rule `besideNext` has beyond «true or absent», and the only one the list can
  // answer (section view rows, spec 2026-08-27 §2): a mark says «this view and the next one
  // share a row», so the LAST view is the one place it can name nothing. Every other marked
  // view has a next by construction, which is why this is one read and not a loop.
  //
  // A hand-made spec is what it refuses. Inside the builder the MUTATORS own it: removing or
  // moving a view drops a mark whose next has gone, in the same edit, so no author can steer
  // a draft into this refusal by dragging a card.
  var lastView = views[views.length - 1];
  if (has(lastView, 'besideNext')) {
    return fail(at + '/views/' + (views.length - 1), 'view "' + lastView.id +
      '" is marked to share a row, but ' + BESIDE_NO_NEXT + '; move it up, or take the mark off');
  }

  var allViews = flattenViews(views);
  // References name nodes across the whole tree. Keep the actual pointer for a
  // duplicate nested id so the editor selects the element that must be repaired.
  var seenView = {};
  var duplicate = null;
  walkViewNodes(views, function (node, info) {
    if (duplicate) return;
    if (has(seenView, node.id)) duplicate = fail('/spec/' + info.path.join('/'), 'duplicate view id "' + show(node.id) + '"');
    seenView[node.id] = true;
  });
  if (duplicate) return duplicate;

  // Layout v1 is deliberately Delivery/global-only. These are reciprocal grammar rails, not
  // editor conveniences: no write order may persist a half-scoped Layout.
  var hasLayout = false;
  for (i = 0; i < allViews.length; i++) if (allViews[i].kind === 'layout') hasLayout = true;
  if (hasLayout) {
    if (isCm) return fail(at + '/dataset', LAYOUT_DELIVERY_ONLY);
    if (spec.period !== null) return fail(at + '/period', LAYOUT_GLOBAL_PERIOD_ONLY);
    if (hasPeriodCtl) return fail(at + '/controls', LAYOUT_NO_PERIOD_CONTROL);
  }
  // (6b)
  var interactions = normInteractions(spec.interactions, allViews);
  if (!interactions.ok) return interactions;

  // (6c)(6d)(6e) share this one walk.
  var walk = walkValues(controls.out, views);
  if (!walk.ok) return walk;

  // (6c) REACHABILITY (Table C). A switch nothing follows is a control the viewer can move with
  // no effect, which is the silent dead config §9 refuses. A compare view reaches its two
  // controls BY ID; a bound value reaches THE metric switch BY TYPE, because Table B stores no
  // control reference on it — at most one switch exists, so there is nothing to name.
  var reached = {};
  for (i = 0; i < allViews.length; i++) {
    // A DIMENSION control is reached by any slot that names it — a chart's axis, a table's
    // rows, a pie's slices. Read off the normalized views, so a slot whose reference did not
    // resolve is not here to reach anything (normXAxis/normRows/normPieView refused it).
    if (allViews[i].kind === 'chart' && allViews[i].x.type === 'control') reached[allViews[i].x.controlId] = true;
    if (allViews[i].kind === 'chart') {
      for (j = 0; j < allViews[i].series.length; j++) {
        var rs = allViews[i].series[j];
        if (rs.kind === 'calc' && rs.calc === 'projection' && has(rs, 'modeControlId')) {
          reached[rs.modeControlId] = true;
        }
        if (rs.guide && rs.guide.calc === 'projection' && has(rs.guide, 'modeControlId')) {
          reached[rs.guide.modeControlId] = true;
        }
      }
    }
    if (allViews[i].kind === 'table' && allViews[i].rows.type === 'control') reached[allViews[i].rows.controlId] = true;
    if (allViews[i].kind === 'pie' && has(allViews[i].sliceBy, 'controlId')) reached[allViews[i].sliceBy.controlId] = true;
    if (allViews[i].kind !== 'compare') continue;
    reached[allViews[i].metricControlId] = true;
    reached[allViews[i].breakdownControlId] = true;
  }
  // Read off the ONE walk rather than a second pass over the views. A switch cannot reach itself
  // through its own options: normControl refuses a `bound` option, which is what keeps the option
  // slots in that walk from answering this question.
  var hasBoundValue = false;
  for (i = 0; i < walk.entries.length; i++) {
    if (walk.entries[i].value.kind === 'bound') hasBoundValue = true;
  }
  // The `/spec/controls/N` below counts the stored CONTROL_TYPES order, not the
  // order the client sent — walkValues' docblock has the whole note. The refusal names the
  // control, so it reads the same either way.
  for (i = 0; i < controls.out.length; i++) {
    var ctl = controls.out[i];
    // A period control is ALWAYS reachable — it is the widget's own chip row and has no in-spec
    // consumer, which is why it is never in `reached`.
    if (ctl.type === 'period') continue;
    if (has(reached, ctl.id)) continue;
    if (ctl.type === 'metric' && hasBoundValue) continue;
    var howReached = 'a breakdown control is named by a compare view';
    if (ctl.type === 'metric') howReached = 'a metric switch drives a bound value, or a compare view names it';
    if (ctl.type === 'dimension') howReached = 'a dimension switch cuts a chart axis, a table\'s rows or a pie\'s slices';
    if (ctl.type === 'projection') howReached = 'a projection calculation names its mode control';
    return fail(at + '/controls/' + i, 'nothing reaches the ' + ctl.type + ' control "' + ctl.id + '"; ' +
      howReached + '; use it or delete it');
  }

  // (6d) The CONVERSE CM rail (Table H). Its twin, the DIRECT rail, is GONE: it refused any
  // `source:'cm'` value on a delivery dataset, and phase 1 of widget value sources (spec
  // 2026-08-25) removed it, so a cm value is exactly as legal on a delivery dataset as it has
  // always been on deliveryCm360. There is ONE slot-legality table now, read by both datasets —
  // the pie still refuses cm, CM_FIELDS still caps the metric set at three counts, a formula
  // still carries no source — and the DATASET decides only how a number is fetched, read and
  // joined. Every other dataset rule in this function (the period pair, the breakdown control,
  // Layout) is keyed on `isCm` and stays that way: none of them may start reading cm presence.
  //
  // Its OTHER neighbour, added with phase 1, is not in this function at all: an entity scope
  // (lis / channels / dims) on a widget that holds a cm value is refused with
  // CM_NO_ENTITY_SCOPE, because a CM360 row carries no line item and that scope could only
  // ever reach the delivery half. `scope` lives outside the spec, so — like LAYOUT_NO_SCOPE
  // and the `scope.time` half of the period coupling — the sentence is declared up top and
  // widgets-validate.mjs applies it, over this file's own `specWantsCm`. There is one
  // predicate for it and for the read path's fetch gate, so the tile that fetches CM and the
  // save that refuses a scope cannot disagree about which specs carry CM.
  if (isCm) {
    // A widget that fetches CM360 data and shows none of it is the same silent dead config as an
    // unreachable control. Five consumer kinds below, any one of them enough: a cm value (two
    // branches — a bound metric on the cm source, and a cm-bearing formula), a compare view, a
    // Δ% column and a Δ-vs-other-source line are the four the refusal sentence names; the
    // fifth is a Layout brick/rows/badge printing a CM360 number (see the note below), which
    // the sentence does not name but this walk still counts.
    var consumes = false;
    for (i = 0; i < walk.entries.length; i++) {
      var cv = walk.entries[i].value;
      if (cv.kind === 'metric' && cv.source === 'cm') consumes = true;
      // A cm-bearing value formula SHOWS a CM360 number, so it is what the dataset is being
      // read for (§2.10). A highlight is deliberately not a consumer: it paints a cell, it
      // shows no number, and a widget whose only CM360 is a colour is still the silent dead
      // config this rail exists to refuse.
      if (exprIsCmBearing(cv)) consumes = true;
    }
    for (i = 0; i < allViews.length; i++) {
      var view = allViews[i];
      // A block printing a CM360 number is a consumer, by the same predicate the fetch gate
      // uses. Bricks never enter `walk.entries` above, so a widget whose only CM360 is an
      // atom's bigStat would otherwise be refused for showing none of the data it reads.
      // A highlight is NOT one: it paints, it shows no number (§2.8), and `anyCmBrickExpr`
      // is the reader that leaves highlights out. `anyCmBrickHighlight` exists and is
      // deliberately not asked here — it belongs to the fetch gate alone.
      if (anyCmBrickExpr(view.brick) || anyCmBrickExpr(view.rows) || anyCmBrickExpr(view.badge)) consumes = true;
      if (view.kind === 'compare') consumes = true;
      if (view.kind === 'kpi' && view.deltaVsOtherSource) consumes = true;
      if (view.kind !== 'table') continue;
      for (j = 0; j < view.columns.length; j++) {
        if (view.columns[j].kind === 'delta') consumes = true;
      }
    }
    if (!consumes) {
      return fail(at + '/dataset', 'this widget reads the CM360 dataset and shows none of it; a compare view, ' +
        'a cm value, a Δ% column or a Δ-vs-other-source line has to use it');
    }
  }

  // (6e) The spec-WIDE value count. One slot is one value, bound or fixed.
  if (walk.entries.length > LIMITS.values) {
    return fail(at, 'a widget stores at most ' + LIMITS.values + ' values, and this one stores ' + walk.entries.length +
      '; a series, a guide, a column, a KPI, a target, a pie and a switch option each hold one');
  }

  var out = {
    dataset: ds.out, period: spec.period, controls: controls.out, views: views, interactions: interactions.out
  };
  // Preserve an author's Integer choice after the old Standard defaults upgrade.
  if (has(spec, 'formatDefaultsVersion')) out.formatDefaultsVersion = spec.formatDefaultsVersion;
  return { ok: true, out: out };
}

/**
 * The widget's dataset type, from the ONE place it is stored (Table H). It exists as a named
 * export so the caller never reaches into the shape, and so the "one source of truth, no content
 * derivation" decision has a place to live: rev 1 derived this fact twice, and the two copies
 * could disagree — a widget could declare `datasetType:'delivery'` while its dataset was
 * deliveryCm360, which silently defeated the widgetRanges rule.
 *
 * Call it on `r.out` ONLY, never on a raw request body: it is an accessor, not a guard, and on a
 * malformed spec `spec.dataset.type` THROWS — the 500 this file's header forbids everywhere else.
 */
function derivedDatasetType(spec) {
  return spec.dataset.type;
}

/**
 * The builder's newborn — a widget body VALID FROM BIRTH, minus the two facts the caller
 * owns (`id` and `title`). `Bricks.emptyComposite` is the precedent, and so is its reason:
 * a constructor that starts from an empty shell offers a first save the validator refuses,
 * and the author sees a rejection before they have done anything. This one previews
 * immediately too — one date chart, one impressions line.
 *
 * `normReport(emptyReport(p).spec, ctx).ok` is TRUE, and the spec is already in canonical
 * stored order, so normalizing it moves no byte: the draft the builder holds and the spec
 * PG hands back are the same string, which is what the drawer's dirty check compares.
 *
 * The label is EMPTY beside `labelAuto: true` — normLabel's rule, and the design's: the
 * caption is written from the value at render time ('Impressions'), so changing the metric
 * renames the series instead of stranding a name the author never typed.
 *
 * `profile` belongs to the Widget envelope, but its epoch-1 vocabulary is owned here so client,
 * server and layout read one list. Anything outside that list falls back to `section` rather
 * than being carried
 * through to a rejection the author cannot read. A fresh tree every call: the builder
 * mutates its draft, and a shared literal would let one newborn write into the next.
 */
function emptyReport(profile) {
  return {
    kind: 'composite',
    profile: inList(WIDGET_PROFILES, profile) ? profile : 'section',
    schemaVersion: 2,
    // The ONE stored discriminator, and it must equal derivedDatasetType(spec) — the
    // caller's rule (widgets-validate), stated here so the newborn cannot be born failing it.
    datasetType: 'delivery',
    spec: {
      dataset: { type: 'delivery' },
      // null, not a range: a new widget follows the dashboard filter until its author says
      // otherwise. A private period is a decision, and §9 fills none in.
      period: null,
      controls: [],
      views: [{
        id: 'chart1', kind: 'chart', title: '', x: { type: 'date' }, orientation: 'vertical',
        series: [{
          id: 's1', kind: 'value', label: '', labelAuto: true,
          value: { kind: 'metric', metric: 'im', source: 'bq', unitFamily: 'count' },
          style: { type: 'line', width: 'normal', curve: 'smooth', points: false },
          axis: 'auto', color: 'auto', dashed: false, valuesOnChart: false,
          accumulate: 'daily', hidden: false
        }],
        formats: { left: 'kilo', right: 'number' }
      }],
      interactions: [],
      formatDefaultsVersion: 1
    }
  };
}

// The export list is exactly what the plan names. An internal table — VALUE_KINDS, SOURCES,
// INTERACTION_TYPES — earns a line here when a real consumer lands, and not before: a surface
// that grows on speculation is one nobody can close later.
// VIEW_KINDS, ADDITIVE_FAMILIES, BASIS_FAMILY and COLOR_SLOTS earned theirs on that rule
// (P2 Task 0): the read path dispatches a view on its kind, decides whether a series may
// accumulate, reads a calc series' unit family and picks a palette slot — all four against
// the SAME tables the validator accepted the spec with. ROW_SORT_KEY earned its line the
// same way (P2 Task 6): the table model translates the authored sort onto the engine and
// the renderer sorts on a header click, and both have to name the row itself the way the
// stored spec does — a second spelling of '__row__' would sort by a column nobody has.
// `emptyReport` earned its line the same way (P3 Task 0): the builder's newborn is minted
// HERE, beside the normalizer that has to accept it, so the client cannot offer a first
// save the server refuses.
// CONTROL_TYPES earned its line the same way (P3 Task 2): the STORED order of the control
// list is this array's order, and the builder writes its draft in it — a draft that carried
// the author's order would come back re-ordered from PG and read as dirty the moment it was
// saved. The one list, in the one place, for both sides.
// The CHART's eleven vocabularies earned theirs in P3 Task 6, on the same rule and all at
// once: the chart card and its two popovers FILL every one of their pickers from these
// arrays — the X grains, the orientation toggle, the two axis scales, the axis sides, the
// daily/cumulative pair, the three style types with their per-type settings, and the two
// calculations. A list re-typed in the builder would offer a value `normChartView` refuses
// (or miss one it accepts) and the author would read the refusal after the save, not before
// the pick. Keeping authoring and normalization on this one exported vocabulary prevents drift.
// The TABLE's four earned theirs in P3 Task 7, on the same rule: the table card's Rows map is
// ROW_TYPES filtered (which is what keeps `dateLi` on it and off the chart's X), its `Δ%` row
// is enabled by DELTA_ROW_TYPES — decision 12's whitelist, so a grain restored there restores
// the affordance with it — its column rows read COLUMN_KINDS, and its sort chip offers
// SORT_DIRS beside ROW_SORT_KEY, which was already exported for the read path.
var ReportV2 = {
  LIMITS: LIMITS,
  HIGHLIGHT_OPS: HIGHLIGHT_OPS, HIGHLIGHT_COLORS: HIGHLIGHT_COLORS, HIGHLIGHT_SCOPES: HIGHLIGHT_SCOPES,
  HIGHLIGHT_STROKE_WIDTHS: HIGHLIGHT_STROKE_WIDTHS, HIGHLIGHT_OWNER_TYPES: HIGHLIGHT_OWNER_TYPES,
  highlightStyleKeys: highlightStyleKeys, normHighlight: normHighlight, normHighlights: normHighlights,
  walkViewNodes: walkViewNodes, flattenViews: flattenViews, leafViews: leafViews, specByteLimit: specByteLimit,
  CM_NO_SPEC_PERIOD: CM_NO_SPEC_PERIOD,
  SWITCH_NO_SPEC_PERIOD: SWITCH_NO_SPEC_PERIOD,
  CM_NO_ENTITY_SCOPE: CM_NO_ENTITY_SCOPE,
  BESIDE_NO_NEXT: BESIDE_NO_NEXT,
  POINTER_SEP: POINTER_SEP,
  UNIT_FAMILIES: UNIT_FAMILIES,
  CM_FIELDS: CM_FIELDS,
  RANGE_VALUES: RANGE_VALUES,
  PERIOD_CHOICES: PERIOD_CHOICES,
  WIDGET_PROFILES: WIDGET_PROFILES,
  CONTROL_TYPES: CONTROL_TYPES,
  PROJECTION_MODES: PROJECTION_MODES,
  PROJECTION_BASES: PROJECTION_BASES,
  PROJECTION_OUTPUTS: PROJECTION_OUTPUTS,
  GUIDE_MODES: GUIDE_MODES,
  CELL_FORMATS: CELL_FORMATS,
  FORMATS_BY_FAMILY: FORMATS_BY_FAMILY,
  VIEW_KINDS: VIEW_KINDS,
  ADDITIVE_FAMILIES: ADDITIVE_FAMILIES,
  BASIS_FAMILY: BASIS_FAMILY,
  COLOR_SLOTS: COLOR_SLOTS,
  ROW_SORT_KEY: ROW_SORT_KEY,
  FLOW_FIELDS: FLOW_FIELDS,
  NODE_ID_RE: NODE_ID_RE,
  X_TYPES: X_TYPES,
  ORIENTATIONS: ORIENTATIONS,
  CHART_FORMATS: CHART_FORMATS,
  DATE_DOMAINS: DATE_DOMAINS,
  EMPTY_BEHAVIORS: EMPTY_BEHAVIORS,
  GUIDE_LABEL_PLACEMENTS: GUIDE_LABEL_PLACEMENTS,
  AXES: AXES,
  ACCUMULATE_MODES: ACCUMULATE_MODES,
  STYLE_TYPES: STYLE_TYPES,
  STROKE_WIDTHS: STROKE_WIDTHS,
  EXACT_STROKE_WIDTHS: EXACT_STROKE_WIDTHS,
  DASH_PATTERNS: DASH_PATTERNS,
  SEMANTIC_PAINTS: SEMANTIC_PAINTS,
  CURVES: CURVES,
  AREA_FILLS: AREA_FILLS,
  BAR_MODES: BAR_MODES,
  CALC_KINDS: CALC_KINDS,
  CALC_BASES: CALC_BASES,
  LAYOUT_BRICK_TYPES: LAYOUT_BRICK_TYPES,
  LAYOUT_FRAMES: LAYOUT_FRAMES,
  LAYOUT_CANON_SERIES: LAYOUT_CANON_SERIES,
  LAYOUT_CANON_SOURCES: LAYOUT_CANON_SOURCES,
  LAYOUT_CANON_NOTES: LAYOUT_CANON_NOTES,
  LAYOUT_DOMAIN_READINGS: LAYOUT_DOMAIN_READINGS,
  LAYOUT_DELIVERY_UNITS: LAYOUT_DELIVERY_UNITS,
  LAYOUT_RATE_UNITS: LAYOUT_RATE_UNITS,
  LAYOUT_HEADER_CONTENTS: LAYOUT_HEADER_CONTENTS,
  LAYOUT_MONEY_ROLES: LAYOUT_MONEY_ROLES,
  LAYOUT_KV_EMPHASIS: LAYOUT_KV_EMPHASIS,
  LAYOUT_STATROW_LAYOUTS: LAYOUT_STATROW_LAYOUTS,
  LAYOUT_PILL_VARIANTS: LAYOUT_PILL_VARIANTS,
  LAYOUT_BADGE_WORDS: LAYOUT_BADGE_WORDS,
  LAYOUT_DELIVERY_ONLY: LAYOUT_DELIVERY_ONLY,
  LAYOUT_GLOBAL_PERIOD_ONLY: LAYOUT_GLOBAL_PERIOD_ONLY,
  LAYOUT_NO_PERIOD_CONTROL: LAYOUT_NO_PERIOD_CONTROL,
  LAYOUT_NO_SCOPE: LAYOUT_NO_SCOPE,
  ROW_TYPES: ROW_TYPES,
  DELTA_ROW_TYPES: DELTA_ROW_TYPES,
  COLUMN_KINDS: COLUMN_KINDS,
  COLUMN_ZERO_AS: COLUMN_ZERO_AS,
  SORT_DIRS: SORT_DIRS,
  KPI_BASES: KPI_BASES, KPI_DENSITIES: KPI_DENSITIES, TARGET_BANDS: TARGET_BANDS,
  METRIC_DEFAULT_BY: METRIC_DEFAULT_BY, COLUMN_BUY_UNITS: COLUMN_BUY_UNITS, TABLE_BASES: TABLE_BASES,
  isNodeId: isNodeId,
  formatLegal: formatLegal,
  specWantsCm: specWantsCm,
  anyCmBrickExpr: anyCmBrickExpr,
  // §2.8's highlight scan, exported for one reader: `report-render.js`'s `viewHoldsCm`,
  // which publishes `cmPlan` for a view whose only CM360 expression is a rule (§2.8). Same
  // four slots, same whole-identifier test as the fetch gate — so the renderer asks the
  // grammar instead of growing a second walk of the same shape that can drift from it.
  anyCmHighlight: anyCmHighlight,
  exprIsCmBearing: exprIsCmBearing,
  normValue: normValue,
  normLabel: normLabel,
  normControls: normControls,
  normLayoutView: normLayoutView,
  normReport: normReport,
  derivedDatasetType: derivedDatasetType,
  emptyReport: emptyReport
};
// Later tasks add their exports INSIDE the literal above. An assignment after this line
// throws from in here ("use strict"); from a sloppy-mode consumer the same write silently
// does nothing — which is the point: nobody bolts a normalizer on from outside.
Object.freeze(ReportV2);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportV2;
} else {
  root.ReportV2 = ReportV2;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
