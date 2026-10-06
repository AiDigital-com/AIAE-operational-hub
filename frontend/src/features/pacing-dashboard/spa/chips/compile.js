// workspace/src/lib/dashboard/chips/compile.js — what the server cannot know about a chip holder
// (spec §3, Client) and which stored form a slot gets (P1-editor decision h).
import FormulaChips from '@shared/formula-chips';
import { compileHolder } from './strict.js';
import { chipNotYet, CHIP_NO_DATE_AXIS } from './resolve.js';
import { chipFace } from './info.js';
import { tokensFromHolder, legacyTextOf, cleanChip } from './tokens.js';
import { validate, NO_CM_JOIN } from '../widget-formula.js';

const { CATALOG } = FormulaChips;
const ROWLESS = new Set(['value', 'target', 'guide', 'bind', 'option', 'pie', 'miniSeries', 'columnTarget']);
export const GRAIN_WORDS = Object.freeze({
  agg: 'the aggregate', date: 'date', dateLi: 'date and line item', li: 'line item', dim: 'dimension', control: 'dimension', ds: 'source', aux: 'source',
});
const SLOT_WORDS = Object.freeze({ highlight: 'in a highlight', series: 'in a chart series', pie: 'in a pie', miniSeries: 'in a mini-chart line', option: 'in a switch option', share: 'in a row share' });

/** The slots the P1 engine evaluates (plan P1-engine Task 6): the aggregate doors and li columns. */
export function SLOT_SERVED(slot, grain) {
  if (slot === 'column') return grain === 'li';
  return ['value', 'target', 'guide', 'columnTarget', 'bind'].includes(slot) && grain === 'agg';
}
const whereWord = (slot, grain) => SLOT_WORDS[slot] || `on ${GRAIN_WORDS[grain] || grain} rows`;
const isDateGrain = (grain) => grain === 'date' || grain === 'dateLi';
// `placement.cm` carries two questions. The served-slot gate asks whether the FORMULA reads CM360
// at all (`placement.cm` or any CM chip in the holder): the engine serves no CM360 chip, so such a
// holder is text-bound. The legacy map is read with `cm` = «the stored TEXT names a CM360 field»,
// which only a `source: 'cm360'` chip does (cmIm / cmCl / cmCo are the CM legacy names, every one
// a cm360 chip): a legacy text spells `im` as Impressions · Matched to CM360 only beside one of
// those (CM_ID_RE), so a holder whose only CM chip is bqMatched has no text spelling and is refused
// with that chip named, never stored as a plain `im` that reads back as BQ Impressions. writerForm
// decides the map's flag from the holder itself; judgeChip sees one chip, so its `placement.cm` IS
// the text rule (the field passes «a cm360 chip in the holder», not anyCm).
const withCm = (placement, cm) => (!!placement.cm === cm ? placement : { ...placement, cm });
const namesCm = (tokens) => tokens.some((tk) => tk.t === 'chip' && tk.chip.source === 'cm360');

/** compileClient(holder, placement, slot) → { ok } | { ok: false, errors: [{ ref, message }] }.
 *  `placement` = { grain, role, cm, cmJoin, cmRefusal?, fieldSet? }: `cmJoin` is whether the SLOT
 *  joins CM360 (formula-scope's `cm`); `cm` is read by judgeChip and writerForm, see above. */
export function compileClient(holder, placement, slot) {
  const errors = [];
  const c = compileHolder(holder);
  if (c.error) return { ok: false, errors: [{ ref: null, message: c.error }] };
  if (c.windowed && !isDateGrain(placement.grain)) errors.push({ ref: null, message: CHIP_NO_DATE_AXIS });
  for (const ref of c.refs) {
    const chip = holder.chips && holder.chips[ref];
    if (!chip) {
      // A bare word: the validator's own sentence and hint, the field set being the slot's.
      const v = validate(ref, isDateGrain(placement.grain) ? 'ts' : 'agg', placement.fieldSet || new Set(), { cm: placement.cmJoin || null, cmRefusal: placement.cmRefusal || NO_CM_JOIN });
      errors.push({ ref: null, message: v.ok ? `Unknown field "${ref}"` : [v.error, v.hint].filter(Boolean).join('; ') });
      continue;
    }
    const def = CATALOG[chip.base];
    if (!def) { errors.push({ ref, message: `Unknown chip ${chip.base}` }); continue; }
    if (chip.period && chip.period.days === 'row' && placement.grain !== 'li' && placement.grain !== 'dateLi') errors.push({ ref, message: 'Own days belong to a line item row' });
    if (FormulaChips.chipIsCm(chip) && !placement.cmJoin) errors.push({ ref, message: placement.cmRefusal || NO_CM_JOIN });
    if (def.family === 'aggregate' && ROWLESS.has(slot)) errors.push({ ref, message: `${def.name} reads a table and cannot stand in a ${slot === 'columnTarget' ? 'target' : slot}` });
    if (chip.where) errors.push({ ref, message: 'Where rows arrive with the row aggregates' });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** judgeChip(chip, placement, slot) → the sentence this chip is dimmed with here, or null.
 *  `placement.cm` is the text rule: the holder this chip would join names a CM360 field. */
export function judgeChip(chip, placement, slot) {
  const clean = cleanChip(chip);
  if (FormulaChips.chipIsCm(clean) && !placement.cmJoin) return placement.cmRefusal || NO_CM_JOIN;
  if (SLOT_SERVED(slot, placement.grain) && !placement.cm) return chipNotYet(clean);
  const text = legacyTextOf(tokensFromHolder({ expr: '_c1', chips: { _c1: clean } }, placement), placement);
  return text ? null : `${chipFace(clean)} cannot be stored ${whereWord(slot, placement.grain)} yet`;
}

/** writerForm(holder, placement, slot) → { form: 'chips', holder } | { form: 'text', holder } | { form: 'refused', ref, message }.
 *  The served-slot gate reads whether the formula reads CM360 at all; the legacy map is read with
 *  the text rule, decided from the holder's own chips (see above). */
export function writerForm(holder, placement, slot) {
  if (!holder || !holder.chips) return { form: 'text', holder: { expr: holder && typeof holder.expr === 'string' ? holder.expr : '' } };
  const cm = !!placement.cm || FormulaChips.anyCm(holder.chips);
  if (SLOT_SERVED(slot, placement.grain) && !cm) return { form: 'chips', holder };
  let tokens = tokensFromHolder(holder, placement);
  const p = withCm(placement, namesCm(tokens));
  if (p !== placement) tokens = tokensFromHolder(holder, p);
  const text = legacyTextOf(tokens, p);
  if (text != null) return { form: 'text', holder: { expr: text } };
  const ref = Object.keys(holder.chips).find((r) => !legacyTextOf(tokensFromHolder({ expr: r, chips: { [r]: holder.chips[r] } }, p), p));
  return { form: 'refused', ref, message: `${chipFace(holder.chips[ref])} cannot be stored ${whereWord(slot, placement.grain)} yet` };
}
