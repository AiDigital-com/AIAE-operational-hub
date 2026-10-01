// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/ValueRow.jsx
//
// THE VALUE ROW of a panel that owns ONE value (widget-builder v2 §2, mockup §2): the
// select a KPI and a pie pick their number in, and the ƒx door beside it where a formula
// is legal.
//
// It is one component rather than two copies because the two panels ask one question and
// differ in three answers — which anchor judges the pick, whether an expression may fill
// the slot, and what to say when it may not. `SeriesPopover` and `ColumnPopover` still
// carry their own copies of this row: those are T6's and T7's files, and the four become
// one the day a task owns all of them.
//
// Two rules shape it, and both are the reason it takes an `items` list rather than building
// one:
//
//   · THE SELECT AND THE MAP JUDGE THE SAME PICK. Both are filled from `spotlightItems` on
//     the same anchor and the same env, so a metric the map offers is one the select offers
//     — T6 shipped two judgings of one slot and fixed it in `47ac1c1`.
//   · NOTHING IS HIDDEN (§1.1.3). Every entry is listed; the ones that cannot be picked here
//     are disabled AND carry the reason in their own label, because a picker that quietly
//     shortened its list is what makes people believe a metric does not exist.
import { useId, useRef } from 'react';
import { CATALOG, entryOf, mintValue } from '../metric-catalog.js';
import { datasetTypeOf } from '../report-draft.js';
import { sourceOptions, sourcesFor } from '../spotlight-items.js';
import { PopRow, Seg, optionGroups } from './rows.jsx';

const arr = (v) => (Array.isArray(v) ? v : []);
/** A panel rendered with no store under it knows nothing about the pacing, and «nothing
 *  known» is the safe answer: cm stays unpickable, exactly as it was before the pacing's
 *  own facts reached the builder. */
const EMPTY_ENV = {};
/** The switch option, first in the list when the widget has one. */
const BOUND_OPTION = 'Metric switch ⇄';
/** The two words the Data chips already wear for a source, so one pill means one thing. */
const SOURCE_WORD = { __proto__: null, bq: 'BQ', cm: 'CM' };
/** §6's own sentence for a bound element, in the words the mockup prints under the panel. */
const FOLLOWS = 'Follows the Metric switch.';

/**
 * WHERE this value is read from (§2 / Table B) — the row that sits under the Value select in
 * all four panels that own one (a series, a column, a KPI, a pie).
 *
 * One component rather than four copies of eleven lines: the four asked the same question
 * with the same words, the same `sourcesFor` list and the same `[s, SOURCE_WORD[s]]` pairs,
 * and a fifth panel would have made a fifth. The MUTATOR stays the caller's, because it
 * differs per slot and this row has no business knowing which — but the VALUE is minted
 * here, and `onPick` is handed the finished value rather than a source string, exactly as
 * `ValueRow` below hands its caller `mintValue(...)` rather than a catalog id.
 *
 * MINTED, NEVER SPREAD, and that is the whole reason this row shapes the write. On a CM360
 * widget the two sources spell the same field DIFFERENTLY — `im` on the delivery side,
 * `impressions` through the join (metric-catalog's `mintValue`, report-render's `cmFeedOf`)
 * — so `{...value, source: 'cm'}` carried the delivery spelling into the CM source and
 * stored `{metric:'im', source:'cm'}`, which the grammar refuses BY NAME («a cm source
 * carries only impressions, clicks, completions — not "im"»). The pick is legal; only the
 * spelling was not, and the catalog is the one place that knows it.
 *
 * A PICK OF THE SOURCE THE VALUE ALREADY READS WRITES NOTHING. A radiogroup fires on the
 * answer it already holds (`Seg` has no «already chosen» guard, and it should not: it is a
 * choice, not a toggle), and re-minting there would rewrite a value nobody asked to change
 * — `{metric:'im', source:'bq'}` on a CM360 widget is the ENGINE's own delivery count, and
 * minting it again would silently turn it into the join-fed half of a comparison, which is
 * a different number.
 *
 * It renders nothing for a value that has no source to choose: a formula and a bound value
 * are read through something else, and a row offering one answer is not a choice.
 *
 * `entry` may be null (a value the catalog does not carry). The value's OWN source is then
 * the whole list, which has one member: nothing to mint from and nowhere to move to. So the
 * row is NOT rendered — a single segment already chosen, with no second answer and nothing
 * to explain, is a dead affordance and not a choice. The null case still writes nothing
 * rather than falling back to a spread, which is what the paragraph above is about.
 *
 * SINCE WIDGET VALUE SOURCES PHASE 1 (spec 2026-08-25 §4) both segments are offered on a
 * DELIVERY widget too, once this pacing is in conversation with CM360 at all — it has CM360
 * configured, the widget reads it by dataset, or the panel opened on a value that already
 * reads it. On those, cm is offered and refused-with-its-reason wherever the pacing cannot
 * serve it yet: `Seg`'s own third member, printed under the segments and pointed at by the
 * refused button, exactly as `AxisRow` and `DeltaRow` do it. `env` is what makes that
 * judgement possible: `{sourceFacts, mappings, anchor}` from the card. With none — a panel
 * driven with no store under it — the pacing is out of the conversation, so there is no cm
 * segment and, over an ordinary bq value, no row at all (owner ruling 2026-09-02; the same
 * ruling that took the permanent grey CM pill off the metric map).
 *
 * `held` is the source the value read WHEN THE PANEL OPENED, and it is why a slot that
 * already reads CM360 keeps offering CM360: a picker that refused the source a stored value
 * is drawing from would re-mint it onto the delivery side on the next edit, which is a
 * different number from an edit that was about something else. Captured at open rather than
 * read live — see the note on the ref below.
 */
export function SourceRow({ value, entry, datasetType, env = EMPTY_ENV, onPick }) {
  const uid = useId();
  // The source the value read WHEN THIS PANEL OPENED, captured once and held for the panel's
  // whole life. `held` is what keeps cm in the list on a pacing that cannot otherwise serve
  // it, so reading it off the LIVE value made the row erase itself under the click that had
  // just used it: open on a cm value, press BQ, and cm left the list, the row fell to one
  // dead segment and unmounted — the affordance and its sentence gone together, every row
  // below jumping up under the pointer, and focus dropped onto <body> inside a trapped
  // drawer. Captured, the choice the panel opened with stays a choice until it is closed:
  // the author can go bq → cm → bq as many times as they like, and only the NEXT opening
  // re-asks the question against what the pacing now holds.
  const openedOn = useRef(value && value.kind === 'metric' ? value.source : null);
  const held = openedOn.current;
  if (!value || value.kind !== 'metric') return null;
  const judged = sourceOptions(entry || { sources: [value.source] },
    { ...env, datasetType, held });
  // At most one: `bq` is never refused, so the row's note is the cm sentence or nothing.
  const refused = judged.find((o) => o.disabled) || null;
  // A choice of one with nothing to explain is not a choice — the row exists to move a value
  // between sources or to say why it cannot move yet, and with neither it says nothing at
  // all (the same rule the seam and the source step follow: no dead affordances).
  if (judged.length < 2 && !refused) return null;
  const whyId = refused ? `${uid}-src-why` : undefined;
  return (
    <PopRow label="Source" note={refused ? refused.reason : null} noteId={whyId}>
      <Seg
        label="Source"
        value={value.source}
        options={judged.map((o) => [o.source, SOURCE_WORD[o.source], o.disabled ? o.reason : null])}
        describedBy={whyId}
        onPick={(s) => {
          if (s === value.source || !entry) return;
          onPick(mintValue(entry, { source: s, datasetType }));
        }}
      />
    </PopRow>
  );
}

/** …and the standing note under a panel whose value follows the switch — §6's own sentence,
 *  said once for the same reason the row above is one component. */
export function FollowsNote({ value }) {
  return value && value.kind === 'bound' ? <div className="sp-pop-note">{FOLLOWS}</div> : null;
}

/**
 * ValueRow — what this view draws.
 *
 *   spec        the draft spec (the metric switch and the dataset are read off it)
 *   items       `spotlightItems(anchor, env)` — the judged map for THIS slot
 *   value       the value the view stores
 *   valueRef    where focus lands when the panel opens (§3)
 *   note        the sentence under the row, or null. The pie's «no formula here» is one:
 *               a door that is absent has to say so, or it reads as one somebody forgot
 *   onFormula   open the Spotlight on this slot (the ƒx door), or null for no door at all
 *   env         `{sourceFacts, mappings, anchor}` — the same pick env the map above was
 *               judged in, so the source a metric change lands on is chosen by the same
 *               rule the map printed its pills by
 *   onPick(value, entry)   the caller writes it — with the format rule, which only the
 *               caller's slot knows the vocabulary of
 */
export default function ValueRow({ spec, items, value, valueRef, note, env = EMPTY_ENV, onFormula, onPick }) {
  const datasetType = datasetTypeOf(spec);
  const hasSwitch = arr(spec && spec.controls).some((c) => c && c.type === 'metric');
  const isFormula = !!value && value.kind === 'formula';
  const entry = entryOf(value, datasetType);
  const groups = optionGroups(items);
  const cur = value && value.kind === 'bound' ? 'bound' : (isFormula ? 'formula' : (entry && entry.id) || '');
  // A stored reading may still render where the catalog cannot mint a replacement
  // (for example a raw delivery count in a CM360 pie). Keep its closed label readable;
  // the original refused option and its full explanation remain in the opened list.
  const heldOption = entry && items?.some((row) => row?.id === cur && row.disabled);
  const selected = heldOption ? `stored:${cur}` : cur;

  const onChange = (next) => {
    if (next === 'formula') return;   // the ƒx button owns that door
    // A bound value carries no ONE family, so the caller is handed no entry: the format
    // stays as it is and the validator names it if an option of the switch cannot print it.
    if (next === 'bound') { onPick({ kind: 'bound' }, null); return; }
    // A REFUSED row writes nothing, the guard `DeltaValueRow` already has. `<option disabled>`
    // is a browser's promise and not this component's: a driven select, a restored form state
    // or a future combobox would hand the value straight through, and the pick it names is one
    // the map beside it prints a refusal for.
    const row = items && items.find((it) => it && it.id === next);
    if (row && row.disabled) return;
    const picked = CATALOG.find((e) => e.id === next);
    if (!picked) return;
    // The source this view already reads, when the new metric is also read from it —
    // switching Impressions for Clicks on a CM360 widget must not move the value back to
    // the delivery side on its own. `held` is what carries that across the judgement: on a
    // delivery widget a cm value stays cm even where a fresh pick could not choose it.
    const sources = sourcesFor(picked, { ...env, datasetType, held: value && value.source });
    const source = value && sources.includes(value.source) ? value.source : sources[0];
    onPick(mintValue(picked, { source, datasetType }), picked);
  };

  return (
    <PopRow label="Value" note={note}>
      <select
        ref={valueRef}
        className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
        aria-label="Value"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
      >
        {!cur ? <option value="" disabled>Choose a value</option> : null}
        {heldOption ? <option value={selected} hidden>{entry.label}</option> : null}
        {hasSwitch ? <option value="bound">{BOUND_OPTION}</option> : null}
        {/* A formula is in no catalog and cannot be, so it shows as its own option — and a
            picker must show what is stored, even where this slot may not be given one. */}
        {isFormula ? <option value="formula">{`ƒ ${value.expr}`}</option> : null}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.rows.map((row) => (
              <option key={row.id} value={row.id} disabled={!!row.disabled}>
                {row.disabled && row.reason ? `${row.label} · ${row.reason}` : row.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {onFormula ? (
        <button type="button" className="sp-pop-fx" title="Custom formula" aria-label="Custom formula" onClick={onFormula}>ƒx</button>
      ) : null}
    </PopRow>
  );
}
