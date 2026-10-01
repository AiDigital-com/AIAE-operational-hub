// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/cards/column-format.js
//
// What a value slot PRINTS: which formats it may be given (`formatsFor`), and which one it
// takes when its value changed (`formatFor`) — widget-builder v2 §5.2/§5.3/§5.4 + §1.1.4.
// Pure, and it lives beside the cards rather than inside one because the three slots that
// store a CELL format all ask it: a table column, a KPI and a pie.
//
// The rule is §1.1.4's, in one line: automation fills an EMPTY default and never overwrites
// a choice. A format the new family still prints is a choice, and it is kept — `auto`
// included, which is the author saying «you pick». A format the new family CANNOT print is
// not a choice anybody can keep: `badCellFormat` refuses the whole save by name
// («column "c1" stores format "int", which does not print the percent family»), so it takes
// the new metric's own default instead of leaving the draft broken behind a value pick.
import { CELL_FORMATS, FORMATS_BY_FAMILY, formatLegal, flattenViews } from '../report-v2.js';
import { familyOf, entryOf } from '../metric-catalog.js';
import { setViewFormat, setViewValue } from '../report-draft.js';

/**
 * Product words for the closed cell-format vocabulary.
 *
 * They are here because `CELL_FORMATS` is the grammar's STORAGE vocabulary: `pp`,
 * `number2`, `money4` are what the spec holds, and §1.1.6 says a simple widget is built
 * «without knowing formulas or grammar internals». A picker printing `pp` beside a
 * neighbouring one printing `Points (pp)` is two vocabularies in one window.
 *
 * The coverage test walks CELL_FORMATS, so a new storage value cannot appear blank here.
 */
const FORMAT_LABEL = {
  __proto__: null,
  auto: 'Auto', int: 'Integer', count1: 'Count · 1 decimal', money: 'Money', money4: 'Money ×4dp',
  percent: 'Percent', percent2: 'Percent 2dp', pp: 'Points (pp)', number2: 'Number 2dp',
  plain2: 'Plain 2dp',
};

/** One format, in words. A key nobody worded still reads as itself rather than as nothing —
 *  a stored format outside the table is exactly what the validator names by hand. */
export const formatWord = (f) => (typeof f === 'string' && FORMAT_LABEL[f]) || f || '';

/**
 * formatFor(current, entry) → the format to store with the new value.
 *
 * Catalog choices use their own default. Formula and switch choices use formatForValue
 * below, which checks declared units and every switch option before changing the format.
 */
export function formatFor(current, entry) {
  if (!entry) return current;
  return formatLegal(entry.unitFamily, current) ? current : entry.defaultFormat;
}

/** A formula's declared unit and every option of a switch follow the same format rule. */
export function formatForValue(current, value, spec, autoOk = false) {
  const families = familyOf(value, spec);
  if (!families.length) return current;
  const legal = CELL_FORMATS.filter((format) => (autoOk || format !== 'auto')
    && families.every((family) => formatLegal(family, format)));
  if (!legal.length || legal.includes(current)) return current;
  const entry = entryOf(value, spec?.dataset?.type);
  const preferred = entry?.defaultFormat || ({ count: 'int', money: 'money', percent: 'percent', number: 'number2' })[families[0]];
  return legal.includes(preferred) ? preferred : legal[0];
}

/**
 * pickViewValue(spec, viewId, value, entry) — a VIEW's own value written together with the
 * format §1.1.4 lets it take. One function because the pair used to be composed inline at
 * three call sites (the KPI card's ƒx door, the KPI panel, the pie panel) and the rule that
 * pairs them is exactly the rule that must not be applied in two-and-a-half places.
 *
 * A column writes its two keys in ONE `patchColumn`, so it keeps its own line; there is no
 * `pickColumnValue` because there is nothing to compose there.
 */
export function pickViewValue(spec, viewId, value, entry) {
  const list = flattenViews(spec?.views);
  const view = list.find((v) => v && v.id === viewId) || null;
  const format = entry ? formatFor(view?.format, entry) : formatForValue(view?.format, value, spec);
  return setViewFormat(setViewValue(spec, viewId, value), viewId, format);
}

/**
 * formatsFor(value, spec, current, autoOk) → the formats this slot may be given, in the
 * grammar's own order.
 *
 * The list is `badCellFormat`'s own rule read forwards: for a bound value EVERY family the
 * switch can show has to accept the format, so it is the intersection; a bound value with no
 * switch left to resolve answers no family at all, and the whole vocabulary is offered rather
 * than an empty picker on a draft the Save gate is already blocking by name.
 *
 * `autoOk` is the one difference between the three slots, and it is `badCellFormat`'s own
 * argument: a table cell may say «you pick», a KPI and a pie name what they print (§5.3/§5.4).
 *
 * `current` is what the slot STORES, and it is in the list even when the family cannot print
 * it — last, so the legal ones read as the answer and picking any of them takes the stored
 * one out of the list with it. That state is reachable without a single illegal edit: bind a
 * column to the switch on `int`, then add a percent option to the switch, and count ∩ percent
 * leaves `auto` alone. Dropping the stored format would leave a control with NOTHING selected
 * while the Save gate names that exact value.
 */
export function formatsFor(value, spec, current, autoOk) {
  const families = familyOf(value, spec);
  const all = !families.length ? CELL_FORMATS : families.slice(1).reduce(
    (list, fam) => list.filter((f) => formatLegal(fam, f)),
    FORMATS_BY_FAMILY[families[0]] || CELL_FORMATS,
  );
  const legal = autoOk ? all : all.filter((f) => f !== 'auto');
  return current && !legal.includes(current) ? [...legal, current] : legal;
}
