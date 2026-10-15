// workspace/src/pages/Dashboard/components/Settings/Widgets/ShareEntryDialog.jsx
//
// The add-a-group / add-a-layout dialog (phase 4 T8; its own module since the
// post-release UX round, 2026-08-16, when the Display tab's Groups section became
// its second caller — one dialog, one wording, wherever a block or layout entry
// is shared from). Visibility, name and an optional description in the lib-form
// grid, the note ALWAYS present (a sometimes-note would move the fields above
// it), Share disabled while the name is blank, Enter commits under the same
// guard. ConfirmModal owns Escape while open.
//
// It renders and reports: the CALLER owns the fields' state and the write —
// LayoutMode shares through its session's tiles, the Groups section through the
// store's persisted display — so nothing here knows where the entry comes from.
//
// ONE exception, and the reason is the entry (spec 2026-09-04, private library
// entries): the visibility is a fact of the ROW being created, not of the thing
// it is created from, so it is held here and handed to `onShare`. Every caller
// then sends the same field to the same route instead of each keeping its own
// copy of a default nobody typed.
import { useId, useState } from 'react';
import ConfirmModal from '../ConfirmModal.jsx';

// The two visibilities, in the order the dialog offers them. Team leads and is
// preselected: it is what every entry was before this choice existed, so a
// reader who ignores the row gets today's behaviour.
export const VISIBILITIES = [['team', 'Team'], ['private', 'Only me']];

/**
 * The sentence under the title when Only me is chosen. It replaces the "everyone
 * in the company can add this" one, which is the half that stops being true —
 * and it says the half that does NOT change: a tile added from a private entry
 * still renders for everyone who can open that pacing (spec §5).
 */
export const ONLY_ME_NOTE = 'Only you see this in the library. Pacings you add it to show it to everyone who can open them.';

/**
 * One sentence out of a set, in a box as tall as the TALLEST of them.
 *
 * A note that follows the visibility choice is chosen by clicking a pill sitting
 * right under it, and the two wordings are not the same length: the short one
 * shrank the dialog, ConfirmModal re-centres its box, and the pill the reader had
 * just pressed slid out from under the pointer (measured on the built app: the
 * widget dialog 428.9 → 408.9px, every control below it 10px up). Both sentences
 * live in ONE grid cell, so the cell reserves the taller of the two and nothing
 * above or below it moves when the choice changes.
 *
 * The unchosen one is `aria-hidden` as well as invisible: `visibility: hidden`
 * takes it off the screen, and this text is what the dialog's `aria-describedby`
 * points at, so a reader would otherwise hear both answers at once.
 */
export function SteadyNote({ value, options }) {
  return (
    <span style={{ display: 'grid' }}>
      {options.map(([key, text]) => (
        <span
          key={key}
          style={{ gridArea: '1 / 1', visibility: value === key ? 'visible' : 'hidden' }}
          aria-hidden={value === key ? undefined : 'true'}
        >
          {text}
        </span>
      ))}
    </span>
  );
}

/**
 * The visibility choice, as the first row of the lib-form grid: the `.blib-pills`
 * radiogroup the Library's shelf and kind filters already wear, with its own
 * stacked label so the row keeps the grid's rhythm (label above, control below)
 * rather than standing a bare pill row beside label-stacked fields.
 *
 * A radiogroup, not a tablist, for the reason the shelf pills give: a `tab` with
 * no `tabpanel` to point at is half an ARIA pattern, and this is one-of-N.
 *
 * Exported because the widget share dialog (WidgetLinkMenu) asks the same
 * question of the same route: two pill rows would be two chances to drift.
 */
export function VisibilityPills({ value, onChange }) {
  const uid = useId();
  return (
    <>
      <span className="lib-form-l" id={`${uid}-vis`}>Visibility</span>
      <div className="blib-pills" role="radiogroup" aria-labelledby={`${uid}-vis`}>
        {VISIBILITIES.map(([key, label]) => (
          <button
            key={key} type="button" role="radio" aria-checked={value === key}
            className={`blib-pill${value === key ? ' blib-pill--on' : ''}`}
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

export default function ShareEntryDialog({
  mode, name, description, busy, onChange, onShare, onCancel,
}) {
  // Local, and unmounted with the dialog: every caller renders this on a
  // condition, so closing and reopening it starts from Team again — which is the
  // preselected answer, not a remembered one.
  const [visibility, setVisibility] = useState('team');
  // Enter commits, guarded by the same condition as the dialog's Share button:
  // a dialog whose button is disabled must not submit from the keyboard.
  const onKey = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!busy && name.trim()) onShare(visibility);
  };
  return (
    <ConfirmModal
      title={mode === 'block' ? 'Add group to the library' : 'Add layout to the library'}
      // The note follows the choice: the "everyone in the company" sentence is
      // the one Only me makes false, so it is the one that is replaced. The note
      // at the foot of the form is true either way and stays put. Through
      // SteadyNote, so the swap does not resize the dialog under the pointer.
      message={(
        <SteadyNote
          value={visibility}
          options={[
            ['team', mode === 'block'
              ? 'Everyone in the company can add this group to their own pacings. Each add creates independent copies — it is a snapshot, not a link to this pacing.'
              : 'Everyone in the company can apply this arrangement to their own pacings. Applying replaces their arrangement with independent copies — it is a snapshot, not a link to this pacing.'],
            ['private', ONLY_ME_NOTE],
          ]}
        />
      )}
      confirmLabel="Share"
      confirmColor="var(--accent)"
      loading={busy}
      disabled={busy || !name.trim()}
      onConfirm={() => onShare(visibility)}
      onCancel={onCancel}
    >
      <div className="lib-form">
        {/* No VisibilityPills here: this app has no "only me" library entries, every entry is
            visible to everyone (owner decision 2026-10-14), so the choice stays `team`. */}
        <label className="lib-form-l" htmlFor="lm-share-name">Name</label>
        <input
          id="lm-share-name" className="sp-inp sp-inp--sans" type="text" autoFocus maxLength={80}
          value={name}
          placeholder={mode === 'block'
            ? 'A name for the shared block' : 'A name for the shared layout'}
          onChange={(e) => onChange({ name: e.target.value })}
          onKeyDown={onKey}
        />
        <label className="lib-form-l" htmlFor="lm-share-desc">
          Description <span className="lib-form-opt">optional</span>
        </label>
        <input
          id="lm-share-desc" className="sp-inp sp-inp--sans" type="text" maxLength={240}
          value={description}
          placeholder="What is it for?"
          onChange={(e) => onChange({ description: e.target.value })}
          onKeyDown={onKey}
        />
        <p className="lib-form-note">
          Every Widget is snapshotted as it is, without this pacing’s line-item and
          dimension filters — they mean nothing on another campaign. Applying the
          snapshot never creates a live link back to this pacing.
        </p>
      </div>
    </ConfirmModal>
  );
}
