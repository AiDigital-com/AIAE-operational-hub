// workspace/src/lib/dashboard/chips/info.js — ONE reader for «what does this formula holder
// read». A holder is legacy text (`'sp / im'`) or `{ expr, chips }` (docs/2026-10-01-formula-chips.md
// §3). Every scanner that used to test the text asks this instead, so a chip holder is never
// read as a zero by a reader that did not know the map existed.
import FormulaChips from '@shared/formula-chips';
import { identifiersOf, FIELDS_PLAN, FIELDS_EXPECTED } from '../widget-formula.js';

const CV_FIELDS = new Set(['cv', 'pc', 'pv']);
const CM_ID_RE = /\bcm(?:Im|Cl|Co)\b/;

/** The sentence a tile prints when a chip holder reaches an engine that cannot read it yet
 *  (phase P0: no chip evaluator ships). Never a zero. */
export const CHIPS_NOT_READABLE = "This value's settings cannot be read here";

export const isChipHolder = (h) => !!h && typeof h === 'object' && !!h.chips && typeof h.chips === 'object';
export const exprOf = (h) => (typeof h === 'string' ? h : h && typeof h.expr === 'string' ? h.expr : '');

export function holderInfo(holder) {
  if (isChipHolder(holder)) {
    const i = FormulaChips.info(holder.chips);
    return { chips: true, cm: i.cm, cv: i.cv, fact: i.fact, plan: i.plan,
      legacyField: FormulaChips.legacyFieldOf(holder.expr, holder.chips), identifiers: [], refusal: CHIPS_NOT_READABLE };
  }
  const expr = exprOf(holder);
  const ids = identifiersOf(expr);
  const trimmed = expr.trim();
  return {
    chips: false,
    cm: CM_ID_RE.test(expr),
    cv: ids.some((k) => CV_FIELDS.has(k)),
    fact: ids.some((k) => !FIELDS_PLAN.has(k) && !FIELDS_EXPECTED.has(k)),
    plan: ids.some((k) => FIELDS_PLAN.has(k) || FIELDS_EXPECTED.has(k)),
    legacyField: /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : '',
    identifiers: ids,
    refusal: null,
  };
}

/** A chip's printed face: its name and the settings that differ from the default. */
export function chipFace(chip) {
  const def = FormulaChips.CATALOG[chip && chip.base];
  if (!def) return String(chip && chip.base);
  const parts = [];
  for (const key of FormulaChips.SETTING_ORDER) {
    if (key === 'base' || !(key in chip) || !(key in def.settings)) continue;
    const st = def.settings[key];
    const v = chip[key];
    if (key === 'period') { if (v.kind !== 'widget') parts.push(periodWord(v)); continue; }
    if (key === 'where') { parts.push(whereWord(v)); continue; }
    if (st.options && v !== st.def) parts.push(OPTION_WORDS[`${key}:${v}`] || OPTION_WORDS[String(v)] || String(v));
  }
  return parts.length ? `${def.name} · ${parts.join(' · ')}` : def.name;
}
export const OPTION_WORDS = Object.freeze({
  __proto__: null,
  all: 'All lines', impressionPaced: 'Impression-paced', cpm: 'CPM lines', cpc: 'CPC lines', cpv: 'CPV lines',
  cpi: 'CPI lines', video: 'Video', audio: 'Audio',
  running: 'Running', withConversions: 'With conversion data', cpvBasis: 'CPV basis', vcrBasis: 'VCR basis',
  media: 'Media', clientNet: 'Client net', clientGross: 'Client gross', cost: 'Cost plan',
  bq: 'BQ', bqMatched: 'Matched to CM360', cm360: 'CM360',
  wholePlan: 'Whole plan', toDate: 'To date', wholeMonth: 'Whole month', monthToDate: 'Month to date', previousMonth: 'Previous month',
  widgetPeriod: 'Widget period', widgetToDate: 'Widget period to date',
  'type:pc': 'Post-click', 'type:pv': 'Post-view', 'count:platform': 'Platform total', 'count:all': 'All conversions',
  'basis:viewsVolume': 'Views volume', 'basis:vcrBasis': 'VCR basis',
  'unit:mixed': 'Mixed units', 'unit:impressions': 'Impressions', 'unit:clicks': 'Clicks', 'unit:clickPaced': 'Clicks (click-paced)', 'unit:views': 'Views', 'unit:cost': 'Cost', 'unit:spend': 'Spend',
  'reading:cumulative': 'Cumulative', 'reading:perDay': 'Per day', 'to:own': "Line's own end", 'to:endOfMonth': 'End of month',
  'days:row': 'own days', 'skipEmpty:true': 'with data', 'key:m2': 'm2', 'key:m3': 'm3', 'key:m4': 'm4',
  // The rest of spec §2.2, setting by setting: the settings panel prints EVERY option, defaults
  // included, so each one needs its word here (chipFace only ever printed the non-defaults).
  'type:all': 'All', 'count:primary': 'Primary where chosen', 'key:m1': 'm1',
  'unit:buyUnit': "Line's buy unit", 'unit:conversions': 'Conversions',
  'lines:videoAndAudio': 'Video and audio', 'lines:withPlan': 'With a plan', 'lines:paused': 'Paused', 'lines:ended': 'Ended',
  'basis:completes': 'Completes',
  'metric:impressions': 'Impressions', 'metric:clicks': 'Clicks', 'metric:completions': 'Completions',
  'reference:delivery': 'Delivery', 'reference:cm360': 'CM360',
  'windowEnd:lastDataDay': 'Last data day', 'windowEnd:cmLastDay': "CM360's last day",
  'upTo:lastDataDay': 'Last data day', 'upTo:windowEnd': 'End of chip window',
  'reading:total': 'Total', 'reading:expected': '% of expected to date', 'reading:plan': 'Pacing (pp of plan)',
  'weight:clientBudget': 'Client budget', 'weight:clientCostDelivered': 'Client cost delivered', 'weight:remainingClientBudget': 'Remaining client budget',
  'weight:planUnits': 'Plan units', 'weight:remainingCostBudget': 'Remaining cost budget', 'weight:equal': 'Equal',
  'of:clientBudget': 'Client budget', 'of:costBudget': 'Cost budget', 'of:units': 'Units',
  'clamp:true': 'Yes', 'clamp:false': 'No',
  'rateDays:2': 'Last 2 days with data', 'rateDays:3': 'Last 3 days with data', 'rateDays:7': 'Last 7 days with data',
  'runRate:3': 'Last 3 days with data', 'runRate:7': 'Last 7 days with data', 'runRate:14': 'Last 14 days with data', 'runRate:flight': 'Flight average',
  'to:endOfFlight': 'End of flight', 'to:lastLine': "Last line's end", 'to:endOfPeriod': 'End of selected period',
  'through:flight': 'Flight', 'through:window': 'Widget window', 'through:period': 'Selected period',
  'window:widget': 'Widget period', 'window:flight': 'Flight',
  'countDays:calendar': 'Calendar days with delivery', 'countDays:lineDays': 'Line-days',
  'state:running': 'Running', 'state:paused': 'Paused', 'state:ended': 'Ended', 'state:notStarted': 'Not started',
});
function periodWord(p) {
  const n = p.n;
  switch (p.kind) {
    case 'lastDay': return 'Last day with data';
    case 'lastDays': return `${n} days`;
    case 'lastDataDays': return `${n} days with data${p.days === 'row' ? ' · own days' : ''}`;
    case 'flightToDate': return 'Flight to date';
    case 'previous': return 'Previous period';
    case 'monthToDate': return 'Month to date';
    case 'wholeMonth': return 'Whole month';
    case 'previousMonth': return 'Previous month';
    case 'sinceDate': return `Since ${p.date}`;
    case 'custom': return `${p.from} – ${p.to}`;
    default: return '';
  }
}
function whereWord(rows) { return rows.length ? rows.map((r) => `${chipFace(r.of.chips[r.of.expr.trim()] || { base: '?' })} ${({ lt: '<', gt: '>', eq: '=', le: '≤', ge: '≥' })[r.op]} ${r.value}`).join(' and ') : 'any line'; }

/** The label of every setting key, the words the settings panel's rows and the chip's hover list
 *  share (spec §6.3, §6.4). */
export const SETTING_LABELS = Object.freeze({
  __proto__: null,
  period: 'Period', skipEmpty: 'Skip days without delivery', lines: 'Lines', money: 'Money', source: 'Source', span: 'Span',
  unit: 'Unit', basis: 'Basis', count: 'Count', type: 'Type', reading: 'Reading', upTo: 'Up to', to: 'To', through: 'Through',
  weight: 'Weight', of: 'Of', clamp: 'Clamp', metric: 'Metric', reference: 'Reference', windowEnd: 'Window end', rateDays: 'Rate days',
  runRate: 'Run rate', state: 'State', window: 'Window', countDays: 'Count days', key: 'Key', where: 'Where',
});
const optionWord = (key, v) => OPTION_WORDS[`${key}:${v}`] || OPTION_WORDS[String(v)] || String(v);
// The period in the hover list: the face's word, with what the face leaves out (the widget period
// by name; the period a `previous` is of; a period that ends on CM360's last day).
function periodLine(p) {
  // The catalogue's default is the kind's name (`'widget'`), a chip's period is an object.
  if (!p || typeof p !== 'object' || p.kind === 'widget') return `Widget period${p && p.end ? `, ending on ${optionWord('windowEnd', p.end)}` : ''}`;
  const base = p.kind === 'previous' && p.of && p.of.kind !== 'widget' ? `Previous of ${periodWord(p.of)}` : periodWord(p);
  return p.end ? `${base}, ending on ${optionWord('windowEnd', p.end)}` : base;
}
/** The chip's hover list (the owner's decision 2026-10-01: the face shows the non-default
 *  settings, the full list shows on hover): the chip's name, then every setting its catalogue
 *  entry has, one per line, as `Label: value`, defaults included, in the panel's own words. */
export function chipTip(chip) {
  const def = FormulaChips.CATALOG[chip && chip.base];
  if (!def) return String(chip && chip.base);
  const lines = [def.name];
  for (const key of FormulaChips.SETTING_ORDER) {
    if (key === 'base' || !(key in def.settings)) continue;
    const st = def.settings[key];
    const has = key in chip;
    const v = has ? chip[key] : st.def;
    let text;
    if (key === 'period') text = periodLine(v);
    else if (key === 'skipEmpty') text = v ? 'On' : 'Off';
    else if (key === 'where') text = whereWord(Array.isArray(v) ? v : []);
    else if (st.holder) { if (!has) continue; text = holderFace(v); }
    else if (v === undefined) continue;
    else text = optionWord(key, v);
    lines.push(`${SETTING_LABELS[key] || key}: ${text}`);
  }
  return lines.join('\n');
}

/** The face of a one-chip holder, or the chip faces joined around the operators of a longer one. */
export function holderFace(holder) {
  if (!isChipHolder(holder)) return exprOf(holder);
  return holder.expr.replace(FormulaChips.REF_RE, (m, lead, ref) => lead + chipFace(holder.chips[ref] || { base: ref }));
}
