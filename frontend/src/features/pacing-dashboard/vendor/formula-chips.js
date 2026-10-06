/**
 * formula-chips.js — the chip catalogue (docs/2026-10-01-formula-chips.md §2, §3) and the
 * shape check of a stored chip map. Dependency-free UMD: read by dash-gate (through the
 * injected ctx.normChips of shared/report-v2.js), by the workspace (@shared/formula-chips)
 * and by host tests. It parses NO arithmetic: the client's parser is the syntax gate.
 *
 * ES5 SYNTAX BY CONVENTION, like shared/report-v2.js.
 * Browser/Vite: globalThis.FormulaChips; Node: module.exports.
 */
(function (root) {
"use strict";

var LIMITS = { chips: 24, chipWhere: 4, n: 90 };
// The one sentence every engine door prints for a chip holder it cannot evaluate yet
// (docs/2026-10-01-formula-chips.md section 7, P1): a sentence, never a zero.
var CHIP_NOT_YET = 'This chip is not available yet';
var REF_RE = /(^|[^A-Za-z0-9_])(_c\d{1,2})(?![A-Za-z0-9_])/g;
var BARE_ID_RE = /(^|[^A-Za-z0-9_.])([A-Za-z][A-Za-z0-9_]*)(?![A-Za-z0-9_])/g;
var ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// The stored key order of a chip. `norm` writes keys in this order whatever order they arrived in.
var SETTING_ORDER = ['base', 'period', 'skipEmpty', 'lines', 'money', 'source', 'span', 'unit',
  'basis', 'count', 'type', 'reading', 'upTo', 'to', 'through', 'weight', 'of', 'clamp', 'metric',
  'reference', 'windowEnd', 'rateDays', 'runRate', 'state', 'window', 'countDays', 'key', 'where'];

var PERIOD_KINDS = ['widget', 'lastDay', 'lastDays', 'lastDataDays', 'flightToDate', 'previous', 'monthToDate',
  'wholeMonth', 'previousMonth', 'sinceDate', 'custom'];
// `cpi` is OURS: the reference has no CPI rate type, so its catalogue names three units and an
// install-paced line can be asked about only through `all`. Listed last in both so every stored
// chip keeps the option order it was written against.
var LINES_FACT = ['all', 'impressionPaced', 'cpm', 'cpc', 'cpv', 'video', 'audio', 'running', 'withConversions', 'cpvBasis', 'vcrBasis', 'cpi'];
var LINES_RATE = ['impressionPaced', 'cpm', 'all', 'running', 'cpc', 'cpv', 'video', 'audio', 'cpvBasis', 'vcrBasis', 'cpi'];
var MONEY = ['media', 'clientNet', 'clientGross'];
var MONEY_PLAN = ['cost', 'clientNet', 'clientGross'];
var SOURCES = ['bq', 'bqMatched', 'cm360'];
var SPAN = ['wholePlan', 'toDate', 'wholeMonth', 'monthToDate', 'previousMonth', 'widgetPeriod', 'widgetToDate'];
var WHERE_OPS = ['lt', 'gt', 'eq', 'le', 'ge'];

function opt(options, def) { return { options: options, def: def }; }
var S = {
  period: { kinds: PERIOD_KINDS, def: 'widget' },
  skipEmpty: opt([false, true], false),
  days: opt(['campaign', 'row'], 'campaign'),
  linesFact: opt(LINES_FACT, 'all'),
  linesRate: function (def) { return opt(LINES_RATE, def); },
  money: opt(MONEY, 'media'),
  moneyPlan: opt(MONEY_PLAN, 'cost'),
  source: opt(SOURCES, 'bq'),
  span: opt(SPAN, 'wholePlan')
};

function sum(name, legacy, extra) {
  var settings = { period: S.period, skipEmpty: S.skipEmpty, lines: S.linesFact, source: S.source };
  var k;
  for (k in (extra || {})) settings[k] = extra[k];
  return { name: name, unit: 'count', family: 'sum', legacy: legacy, settings: settings };
}
function rate(name, unit, def, extra) {
  var settings = { period: S.period, lines: S.linesRate(def), money: S.money };
  var k;
  for (k in (extra || {})) settings[k] = extra[k];
  return { name: name, unit: unit, family: 'rate', legacy: null, settings: settings };
}

var CATALOG = {
  impressions: sum('Impressions', 'im'),
  clicks: sum('Clicks', 'cl'),
  linkClicks: sum('Link clicks', 'lc'),
  completes: sum('Completes', 'co', { basis: opt(['completes', 'viewsVolume', 'vcrBasis'], 'completes') }),
  // Default `all`, the legacy reading of st/q1/q2/q3 (every line's record carries them), so the
  // migrated chip and every other spelling sum the same lines.
  videoStarts: sum('Video starts', 'st', { lines: opt(['all', 'videoAndAudio', 'video'], 'all') }),
  firstQuartiles: sum('First quartiles', 'q1', { lines: opt(['all', 'videoAndAudio', 'video'], 'all') }),
  midpoints: sum('Midpoints', 'q2', { lines: opt(['all', 'videoAndAudio', 'video'], 'all') }),
  thirdQuartiles: sum('Third quartiles', 'q3', { lines: opt(['all', 'videoAndAudio', 'video'], 'all') }),
  reach: { name: 'Reach', unit: 'count', family: 'sum', legacy: 'rc', settings: { period: S.period, skipEmpty: S.skipEmpty } },
  viewableImpressions: { name: 'Viewable impressions', unit: 'count', family: 'source', legacy: 'vi', settings: { period: S.period } },
  delivered: sum('Delivered', null, { unit: opt(['buyUnit', 'impressions', 'clicks', 'views'], 'buyUnit') }),
  conversions: sum('Conversions', 'cv', { count: opt(['primary', 'platform', 'all'], 'primary'), type: opt(['all', 'pc', 'pv'], 'all'),
    lines: opt(['all', 'withConversions'], 'all') }),
  sourceMetric: { name: 'Source metric', unit: 'count', family: 'source', legacy: null, settings: { period: S.period, key: opt(['m1', 'm2', 'm3', 'm4'], 'm1') } },
  spend: { name: 'Spend', unit: 'money', family: 'sum', legacy: 'sp',
    settings: { money: S.money, period: S.period, skipEmpty: S.skipEmpty, lines: S.linesFact } },
  avgCpm: rate('Avg CPM', 'money', 'impressionPaced'),
  avgCpc: rate('Avg CPC', 'money', 'cpc'),
  avgCpv: rate('Avg CPV', 'money', 'cpv'),
  ctr: { name: 'CTR', unit: 'percent', family: 'rate', legacy: 'ctr', settings: { period: S.period, lines: opt(LINES_FACT, 'all') } },
  vcr: { name: 'VCR', unit: 'percent', family: 'rate', legacy: 'vcr', settings: { period: S.period, lines: opt(['vcrBasis', 'video', 'all'], 'vcrBasis') } },
  acr: { name: 'ACR', unit: 'percent', family: 'rate', legacy: 'acr', settings: { period: S.period, lines: opt(['audio', 'all'], 'audio') } },
  cpa: { name: 'CPA', unit: 'money', family: 'rate', legacy: null, settings: { money: opt(MONEY, 'clientNet'), period: S.period,
    count: opt(['primary', 'platform', 'all'], 'primary'), type: opt(['all', 'pc', 'pv'], 'all'), lines: opt(['all', 'withConversions'], 'all') } },
  discrepancy: { name: 'Discrepancy %', unit: 'percent', family: 'rate', legacy: null, settings: { period: S.period,
    metric: opt(['impressions', 'clicks', 'completions'], 'impressions'), reference: opt(['delivery', 'cm360'], 'delivery'),
    windowEnd: opt(['lastDataDay', 'cmLastDay'], 'lastDataDay') } },
  budget: { name: 'Budget', unit: 'money', family: 'plan', legacy: null, settings: { money: S.moneyPlan, span: S.span, lines: opt(['all', 'running'], 'all') } },
  plannedUnits: { name: 'Planned units', unit: 'count', family: 'plan', legacy: null, settings: { unit: opt(['impressions', 'clicks', 'views', 'buyUnit'], 'impressions'), span: S.span, lines: opt(['withPlan', 'all'], 'withPlan') } },
  planCpm: { name: 'Plan CPM', unit: 'money', family: 'plan', legacy: 'tgtCpm', settings: { money: S.moneyPlan, lines: opt(['cpm', 'impressionPaced'], 'cpm') } },
  planCpc: { name: 'Plan CPC', unit: 'money', family: 'plan', legacy: null, settings: { money: S.moneyPlan } },
  planCpv: { name: 'Plan CPV', unit: 'money', family: 'plan', legacy: null, settings: { money: S.moneyPlan } },
  ctrTarget: { name: 'CTR target', unit: 'percent', family: 'plan', legacy: 'ctrT', settings: {} },
  vcrTarget: { name: 'VCR target', unit: 'percent', family: 'plan', legacy: 'vcrT', settings: {} },
  acrTarget: { name: 'ACR target', unit: 'percent', family: 'plan', legacy: 'acrT', settings: {} },
  marginTarget: { name: 'Margin target', unit: 'percent', family: 'plan', legacy: 'mTgt', settings: { weight: opt(['clientBudget', 'clientCostDelivered', 'remainingClientBudget'], 'clientBudget') } },
  remaining: { name: 'Remaining', unit: 'money', family: 'plan', legacy: null, settings: { of: opt(['clientBudget', 'costBudget', 'units'], 'costBudget'),
    lines: opt(['running', 'paused', 'ended', 'all'], 'running'), clamp: opt([true, false], true) } },
  expected: { name: 'Expected', unit: 'count', family: 'expected', legacy: null, settings: { unit: opt(['buyUnit', 'impressions', 'clicks', 'clickPaced', 'views', 'cost', 'mixed'], 'buyUnit'),
    reading: opt(['total', 'cumulative', 'perDay'], 'total'), upTo: opt(['lastDataDay', 'windowEnd'], 'lastDataDay') } },
  paceIndex: { name: 'Pace index', unit: 'percent', family: 'expected', legacy: null, settings: { reading: opt(['expected', 'plan'], 'expected'),
    unit: opt(['buyUnit', 'impressions'], 'buyUnit'), weight: opt(['clientBudget', 'planUnits', 'remainingCostBudget', 'equal'], 'clientBudget') } },
  neededPerDay: { name: 'Needed per day', unit: 'count', family: 'expected', legacy: null, settings: { unit: opt(['impressions', 'clicks', 'views', 'buyUnit', 'spend'], 'impressions'),
    rateDays: opt([2, 3, 7], 2), money: S.money } },
  projected: { name: 'Projected', unit: 'count', family: 'expected', legacy: null, settings: { unit: opt(['impressions', 'clicks', 'views', 'buyUnit', 'spend', 'conversions'], 'spend'),
    runRate: opt([3, 7, 14, 'flight'], 7), to: opt(['endOfFlight', 'endOfMonth'], 'endOfFlight'), lines: opt(['running', 'all'], 'running'), money: S.money } },
  daysLeft: { name: 'Days left', unit: 'number', family: 'days', legacy: 'daysLeft', settings: { to: opt(['lastLine', 'own', 'endOfMonth', 'endOfPeriod'], 'lastLine'), lines: opt(['all', 'running'], 'all') } },
  daysPassed: { name: 'Days passed', unit: 'number', family: 'days', legacy: 'daysPassed', settings: { through: opt(['flight', 'window', 'period'], 'flight') } },
  daysWithData: { name: 'Days with data', unit: 'number', family: 'days', legacy: null, settings: { window: opt(['widget', 'flight'], 'widget'), countDays: opt(['calendar', 'lineDays'], 'calendar') } },
  lineStatus: { name: 'Line status', unit: 'number', family: 'days', legacy: null, settings: { state: opt(['running', 'paused', 'ended', 'notStarted'], 'running') } },
  countLines: { name: 'Count of lines', unit: 'number', family: 'aggregate', legacy: null, settings: { lines: opt(['running', 'all'], 'running'), where: { where: true } } },
  sumLines: { name: 'Sum over lines', unit: 'number', family: 'aggregate', legacy: null, settings: { of: { holder: true }, lines: opt(['running', 'all'], 'all'), where: { where: true } } },
  avgLines: { name: 'Avg over lines', unit: 'number', family: 'aggregate', legacy: null, settings: { of: { holder: true }, weight: opt(['equal', 'clientBudget', 'planUnits'], 'equal'), lines: opt(['running', 'all'], 'all'), where: { where: true } } },
  minLines: { name: 'Min over lines', unit: 'number', family: 'aggregate', legacy: null, settings: { of: { holder: true }, lines: opt(['running', 'all'], 'all'), where: { where: true } } },
  maxLines: { name: 'Max over lines', unit: 'number', family: 'aggregate', legacy: null, settings: { of: { holder: true }, lines: opt(['running', 'all'], 'all'), where: { where: true } } },
  rank: { name: 'Rank', unit: 'number', family: 'aggregate', legacy: null, settings: { of: { holder: true } } },
  share: { name: 'Share of table total', unit: 'percent', family: 'aggregate', legacy: null, settings: { of: { holder: true } } },
  tableTotal: { name: 'Table total', unit: 'number', family: 'aggregate', legacy: null, settings: { of: { holder: true } } }
};

// The two rules shared/report-v2.js RESTATES (it cannot import this file): which chip reads
// CM360, and which one-chip holder is a bare flow field. tests pin the restatements to these.
function chipIsCm(chip) {
  return !!chip && (chip.source === 'cm360' || chip.source === 'bqMatched' || chip.base === 'discrepancy');
}
function anyCm(chips) {
  var k;
  if (!chips || typeof chips !== 'object') return false;
  for (k in chips) if (Object.prototype.hasOwnProperty.call(chips, k) && chipIsCm(chips[k])) return true;
  return false;
}
function onlyBase(chip) {
  var k, n = 0;
  for (k in chip) if (Object.prototype.hasOwnProperty.call(chip, k)) { if (k !== 'base') return false; n++; }
  return n === 1;
}
function legacyFieldOf(expr, chips) {
  var ref = typeof expr === 'string' ? expr.replace(/^\s+|\s+$/g, '') : '';
  if (!/^_c\d{1,2}$/.test(ref) || !chips || !chips[ref]) return '';
  var chip = chips[ref];
  var def = CATALOG[chip.base];
  if (!def || !def.legacy || !onlyBase(chip)) return '';
  return def.legacy;
}
function info(chips) {
  var out = { cm: false, cv: false, fact: false, plan: false, bases: [] };
  var k, chip, def;
  for (k in chips) {
    if (!Object.prototype.hasOwnProperty.call(chips, k)) continue;
    chip = chips[k]; def = CATALOG[chip && chip.base];
    if (!def) continue;
    out.bases.push(chip.base);
    if (chipIsCm(chip)) out.cm = true;
    if (chip.base === 'conversions' || chip.base === 'cpa' || (chip.base === 'projected' && chip.unit === 'conversions')) out.cv = true;
    if (def.family === 'plan' || def.family === 'days') out.plan = true; else out.fact = true;
    if (chip.base === 'expected' || chip.base === 'paceIndex' || chip.base === 'neededPerDay' || chip.base === 'projected') out.plan = true;
  }
  return out;
}

function fail(at, detail) { return { ok: false, detail: at + ': ' + detail }; }
function show(v) { return v === undefined ? 'undefined' : JSON.stringify(v); }
function inList(list, v) { return list.indexOf(v) !== -1; }
function refsOf(expr) {
  var out = [], m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(expr)) !== null) if (out.indexOf(m[2]) === -1) out.push(m[2]);
  return out;
}
var FUNCTION_WORDS = ['cumsum', 'rolling', 'shift', 'min', 'max', 'abs', 'round', 'if', 'and', 'or'];
function bareIdentifiersOf(expr) {
  var out = [], m;
  BARE_ID_RE.lastIndex = 0;
  while ((m = BARE_ID_RE.exec(expr)) !== null) if (!inList(FUNCTION_WORDS, m[2]) && out.indexOf(m[2]) === -1) out.push(m[2]);
  return out;
}

function normPeriod(p, at, chip) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return fail(at, 'a period is an object');
  if (!inList(PERIOD_KINDS, p.kind)) return fail(at + '/kind', 'unknown period kind ' + show(p.kind));
  // One reading has one stored form (plan decision e): a sum over the last days with data is
  // spelled lastDays + skipEmpty, a rate over them is spelled lastDataDays. lastDay is the last
  // day WITH data on both families.
  var fam = CATALOG[chip && chip.base] ? CATALOG[chip.base].family : null;
  if (fam === 'sum' && p.kind === 'lastDataDays') return fail(at + '/kind', 'a sum chip says lastDays with skipEmpty, not lastDataDays');
  if (fam === 'rate' && p.kind === 'lastDays') return fail(at + '/kind', 'a rate chip counts days with data, so it says lastDataDays, not lastDays');
  var out = { kind: p.kind }, k, allowed = ['kind'];
  if (p.kind === 'lastDays' || p.kind === 'lastDataDays') {
    allowed.push('n');
    if (typeof p.n !== 'number' || p.n !== Math.floor(p.n) || p.n < 1 || p.n > LIMITS.n) return fail(at + '/n', 'n is a whole number from 1 to ' + LIMITS.n);
    out.n = p.n;
  }
  if (p.kind === 'lastDataDays' || p.kind === 'lastDay') {
    allowed.push('days');
    if (p.days !== undefined) {
      if (!inList(S.days.options, p.days)) return fail(at + '/days', 'days is campaign or row');
      out.days = p.days;
    }
  }
  if (p.kind === 'previous') {
    allowed.push('of');
    var inner = normPeriod(p.of, at + '/of', chip);
    if (!inner.ok) return inner;
    if (inner.out.kind === 'previous') return fail(at + '/of', 'a previous period cannot be of a previous period');
    out.of = inner.out;
  }
  if (p.kind === 'sinceDate') {
    allowed.push('date');
    if (typeof p.date !== 'string' || !ISO_DATE_RE.test(p.date)) return fail(at + '/date', 'date is YYYY-MM-DD');
    out.date = p.date;
  }
  if (p.kind === 'custom') {
    allowed.push('from', 'to');
    if (typeof p.from !== 'string' || !ISO_DATE_RE.test(p.from)) return fail(at + '/from', 'from is YYYY-MM-DD');
    if (typeof p.to !== 'string' || !ISO_DATE_RE.test(p.to)) return fail(at + '/to', 'to is YYYY-MM-DD');
    if (p.to < p.from) return fail(at + '/to', 'to is not before from');
    out.from = p.from; out.to = p.to;
  }
  allowed.push('end');
  if (p.end !== undefined) {
    if (p.end !== 'cmLastDay') return fail(at + '/end', 'end is cmLastDay');
    // Only a chip that reads CM360 has a CM360 last day to end on (spec section 3).
    if (!chipIsCm(chip)) return fail(at + '/end', 'end: cmLastDay belongs to a CM360 chip');
    out.end = p.end;
  }
  for (k in p) if (Object.prototype.hasOwnProperty.call(p, k) && !inList(allowed, k)) return fail(at + '/' + k, 'unknown period key');
  return { ok: true, out: out };
}

function normWhere(rows, at, depth) {
  if (!Array.isArray(rows)) return fail(at, 'where is a list');
  if (rows.length > LIMITS.chipWhere) return fail(at, 'at most ' + LIMITS.chipWhere + ' conditions');
  var out = [], i, row, of;
  for (i = 0; i < rows.length; i++) {
    row = rows[i];
    if (!row || typeof row !== 'object') return fail(at + '/' + i, 'a condition is an object');
    if (!row.of || typeof row.of !== 'object' || typeof row.of.expr !== 'string') return fail(at + '/' + i + '/of', 'a condition reads a value');
    of = normHolder(row.of.expr, row.of.chips, at + '/' + i + '/of', depth);
    if (!of.ok) return of;
    if (!inList(WHERE_OPS, row.op)) return fail(at + '/' + i + '/op', 'op is one of ' + WHERE_OPS.join(', '));
    if (typeof row.value !== 'number' || !isFinite(row.value)) return fail(at + '/' + i + '/value', 'value is a finite number');
    out.push({ of: of.out, op: row.op, value: row.value });
  }
  return { ok: true, out: out };
}

// A holder inside a chip (a where row's value, an aggregate's `of`). Legacy text is a bare
// field the client migrates; it is held to the grammar's own two rules (non-blank, 500).
function normHolder(expr, chips, at, depth) {
  if (typeof expr !== 'string' || !expr.replace(/\s/g, '')) return fail(at + '/expr', 'formula is empty');
  if (expr.length > 500) return fail(at + '/expr', 'formula is over 500 characters');
  if (chips === undefined) return { ok: true, out: { expr: expr } };
  var r = norm(chips, expr, at + '/chips', 'where', depth + 1);
  if (!r.ok) return r;
  return { ok: true, out: { expr: expr, chips: r.out } };
}

// The slots with no rows under them: an aggregate (a chip that reads a table's rows) cannot stand there.
var SLOTS_WITHOUT_ROWS = ['value', 'target', 'guide', 'bind', 'option', 'pie', 'miniSeries'];
var REF_NAME_RE = /^_c([1-9]|1\d|2[0-4])$/;

/**
 * norm(chips, expr, at, slot) → { ok, out } | { ok, detail }. `slot` is where the holder
 * lives: value | target | guide | column | share | highlight | bind | miniSeries | option |
 * where. The aggregates (chips that read a table's rows) are refused in a slot with no rows
 * under it, and inside another aggregate: row aggregates nest one level (spec section 3).
 * `depth` is internal: 0 for the stored holder, 1 for a where row or an `of`.
 */
function norm(chips, expr, at, slot, depth) {
  depth = depth || 0;
  if (!chips || typeof chips !== 'object' || Array.isArray(chips)) return fail(at, 'chips is an object');
  if (typeof expr !== 'string') return fail(at, 'a chip map needs an expression');
  var refs = refsOf(expr), keys = [], k, i, ref, chip, def, out = {}, settings, st, val, r, chipOut, j;
  for (k in chips) if (Object.prototype.hasOwnProperty.call(chips, k)) keys.push(k);
  if (keys.length === 0) return fail(at, 'a chip map names at least one chip');
  if (keys.length > LIMITS.chips) return fail(at, 'at most ' + LIMITS.chips + ' chips');
  for (i = 0; i < refs.length; i++) {
    if (!REF_NAME_RE.test(refs[i])) return fail(at, refs[i] + ' is not a chip ref (_c1 to _c24)');
    // Refs are numbered in order of first appearance, so two authors of one formula store one text.
    if (refs[i] !== '_c' + (i + 1)) return fail(at, 'chip refs are numbered in order of first appearance; expected _c' + (i + 1) + ', found ' + refs[i]);
    if (keys.indexOf(refs[i]) === -1) return fail(at, 'the expression names ' + refs[i] + ' and the map has no such chip');
  }
  for (i = 0; i < keys.length; i++) if (refs.indexOf(keys[i]) === -1) return fail(at + '/' + keys[i], 'this chip is not used by the expression');
  var bare = bareIdentifiersOf(expr);
  if (bare.length) return fail(at, 'a chip formula names no bare field; found ' + bare[0]);
  for (i = 0; i < refs.length; i++) {
    ref = refs[i]; chip = chips[ref];
    if (!chip || typeof chip !== 'object' || Array.isArray(chip)) return fail(at + '/' + ref, 'a chip is an object');
    def = CATALOG[chip.base];
    if (!def) return fail(at + '/' + ref + '/base', 'unknown chip ' + show(chip.base));
    if (def.family === 'aggregate' && inList(SLOTS_WITHOUT_ROWS, slot)) return fail(at + '/' + ref, def.name + ' reads a table and cannot stand in a ' + slot);
    if (def.family === 'aggregate' && depth > 0) return fail(at + '/' + ref, def.name + ' cannot read another aggregate');
    settings = def.settings;
    for (k in chip) {
      if (!Object.prototype.hasOwnProperty.call(chip, k) || k === 'base') continue;
      if (!Object.prototype.hasOwnProperty.call(settings, k)) return fail(at + '/' + ref + '/' + k, def.name + ' has no setting ' + k);
    }
    chipOut = { base: chip.base };
    for (j = 0; j < SETTING_ORDER.length; j++) {
      k = SETTING_ORDER[j];
      if (k === 'base' || !Object.prototype.hasOwnProperty.call(chip, k)) continue;
      st = settings[k]; val = chip[k];
      if (k === 'period') { r = normPeriod(val, at + '/' + ref + '/period', chip); if (!r.ok) return r; chipOut.period = r.out; continue; }
      if (st.where) { r = normWhere(val, at + '/' + ref + '/where', depth); if (!r.ok) return r; chipOut.where = r.out; continue; }
      if (st.holder) {
        if (!val || typeof val !== 'object' || typeof val.expr !== 'string') return fail(at + '/' + ref + '/of', 'of reads a value');
        r = normHolder(val.expr, val.chips, at + '/' + ref + '/of', depth); if (!r.ok) return r; chipOut.of = r.out; continue;
      }
      if (!inList(st.options, val)) return fail(at + '/' + ref + '/' + k, 'unknown ' + k + ' ' + show(val));
      chipOut[k] = val;
    }
    out[ref] = chipOut;
  }
  return { ok: true, out: out };
}

// name → function(placement) → chip. `placement` = { grain, role, cm }. A null answer means
// «not served on this placement». The settings written are exactly what the grain read
// today (docs/2026-10-01-formula-chips.md §2.2, last column); a default is left OUT so the
// face stays bare where nothing differs.
function rowOf(p) { return p.role === 'total' ? 'total' : 'row'; }
function isRowGrain(p) { return (p.grain === 'li' || p.grain === 'dateLi') && rowOf(p) === 'row'; }
function isDateGrain(p) { return p.grain === 'date' || p.grain === 'dateLi'; }
function withSource(chip, p) { if (p.cm) chip.source = 'bqMatched'; return chip; }
function sumRule(base, extra) {
  return function (p) {
    var chip = { base: base }, k;
    for (k in (extra || {})) chip[k] = extra[k];
    if (p.cm) {
      if (base !== 'impressions' && base !== 'clicks' && base !== 'completes') return null;
      if (extra) return null;
      return withSource(chip, p);
    }
    return chip;
  };
}
function cmRule(base) { return function () { return { base: base, source: 'cm360' }; }; }
function rateRule(base, aggLines, rowLines) {
  return function (p) {
    if (p.cm) return null;
    var lines = (isRowGrain(p) || ((p.grain === 'date' || p.grain === 'dim' || p.grain === 'control' || p.grain === 'ds' || p.grain === 'aux') && rowOf(p) === 'row')) ? rowLines : aggLines;
    var chip = { base: base };
    if (lines !== CATALOG[base].settings.lines.def) chip.lines = lines;
    return chip;
  };
}
function planRule(chip) { return function () { var out = {}, k; for (k in chip) out[k] = chip[k]; return out; }; }
function expectedRule(unit) {
  return function (p) {
    var chip = { base: 'expected' };
    if (unit !== 'buyUnit') chip.unit = unit;
    if (isDateGrain(p) && rowOf(p) === 'row') chip.reading = 'cumulative';
    return chip;
  };
}
var LEGACY = {
  im: sumRule('impressions'), cl: sumRule('clicks'), co: sumRule('completes'), sp: sumRule('spend'),
  dc: sumRule('spend', { money: 'clientNet' }), lc: sumRule('linkClicks'), rc: sumRule('reach'),
  st: sumRule('videoStarts'), q1: sumRule('firstQuartiles'), q2: sumRule('midpoints'), q3: sumRule('thirdQuartiles'),
  imV: sumRule('impressions', { lines: 'vcrBasis' }), coV: sumRule('completes', { basis: 'vcrBasis' }),
  coViews: sumRule('completes', { basis: 'viewsVolume' }),
  cv: sumRule('conversions'), pc: sumRule('conversions', { type: 'pc' }), pv: sumRule('conversions', { type: 'pv' }),
  cmIm: cmRule('impressions'), cmCl: cmRule('clicks'), cmCo: cmRule('completes'),
  ctr: function (p) { return p.cm ? null : { base: 'ctr' }; },
  vcr: function (p) { if (p.cm) return null; return isRowGrain(p) ? { base: 'vcr', lines: 'all' } : { base: 'vcr' }; },
  acr: function (p) { if (p.cm) return null; return isRowGrain(p) ? { base: 'acr', lines: 'all' } : { base: 'acr' }; },
  cpm: rateRule('avgCpm', 'impressionPaced', 'all'),
  cpc: function (p) { return p.cm ? null : { base: 'avgCpc', lines: 'all' }; },
  cpv: function (p) { if (p.cm) return null; return isRowGrain(p) ? { base: 'avgCpv', lines: 'all' } : { base: 'avgCpv', lines: 'cpvBasis' }; },
  budget: planRule({ base: 'budget', money: 'clientNet', span: 'widgetPeriod' }),
  budgetTotal: planRule({ base: 'budget', money: 'clientNet' }),
  budgetToDate: planRule({ base: 'budget', money: 'clientNet', span: 'widgetToDate' }),
  costBud: planRule({ base: 'budget', span: 'widgetToDate' }),
  costBudTotal: planRule({ base: 'budget' }),
  planImpr: planRule({ base: 'plannedUnits', span: 'widgetPeriod' }), planImprTotal: planRule({ base: 'plannedUnits' }),
  // Keys in SETTING_ORDER (span before unit), the order norm and the editor write, so a migrated chip and a typed one are one byte string.
  planClicks: planRule({ base: 'plannedUnits', span: 'widgetPeriod', unit: 'clicks' }), planClicksTotal: planRule({ base: 'plannedUnits', unit: 'clicks' }),
  planViews: planRule({ base: 'plannedUnits', span: 'widgetPeriod', unit: 'views' }), planViewsTotal: planRule({ base: 'plannedUnits', unit: 'views' }),
  tgtCpm: planRule({ base: 'planCpm' }), mTgt: planRule({ base: 'marginTarget' }),
  ctrT: planRule({ base: 'ctrTarget' }), vcrT: planRule({ base: 'vcrTarget' }), acrT: planRule({ base: 'acrTarget' }),
  expIm: expectedRule('mixed'), imprExpected: expectedRule('impressions'), expCo: expectedRule('cost'),
  expCl: expectedRule('clicks'), clExpected: expectedRule('clickPaced'), expVw: expectedRule('views'),
  daysLeft: function (p) { return isRowGrain(p) ? { base: 'daysLeft', to: 'own' } : { base: 'daysLeft' }; },
  daysPassed: function () { return { base: 'daysPassed' }; },
  m1: planRule({ base: 'sourceMetric' }), m2: planRule({ base: 'sourceMetric', key: 'm2' }),
  m3: planRule({ base: 'sourceMetric', key: 'm3' }), m4: planRule({ base: 'sourceMetric', key: 'm4' }),
  vi: planRule({ base: 'viewableImpressions' })
};
function chipForLegacy(name, placement) {
  var rule = Object.prototype.hasOwnProperty.call(LEGACY, name) ? LEGACY[name] : null;
  return rule ? rule(placement || {}) : null;
}

var api = {
  CATALOG: CATALOG, SETTING_ORDER: SETTING_ORDER, LIMITS: LIMITS, CHIP_NOT_YET: CHIP_NOT_YET, REF_RE: REF_RE, PERIOD_KINDS: PERIOD_KINDS,
  norm: norm, anyCm: anyCm, chipIsCm: chipIsCm, legacyFieldOf: legacyFieldOf, info: info,
  chipForLegacy: chipForLegacy
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.FormulaChips = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
