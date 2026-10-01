// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/SourcePopover.jsx
//
// The CM360 chip's settings (widget-builder v2 §3, §7.7): WHICH mapping this report joins
// the ad server to delivery through, and the door out of the source altogether.
//
// A binding is `{mode:'runtime'}` or `{mode:'fixed', id}` and the difference is a decision,
// not a detail: runtime follows whatever mapping the pacing's own panel is on, so a widget
// shared to another pacing still resolves; fixed names ONE entity and is never substituted
// (§7.7) — a fixed binding whose entity is gone renders a named disconnected state rather
// than quietly reading a different mapping's dimensions.
//
// Both halves are stored SHAPE-only: the grammar checks a mapping id's characters and never
// its existence, because an external reference cannot be proved at save time. So the picker
// offers what this pacing HAS and keeps a stored id that no longer resolves as its own
// option — a picker that dropped it would show the wrong entity selected.
//
// Removing the source is the CALLER's: `onRemove` goes back to the builder, which owns the
// confirm — a Δ%, a cm value, a Δ-vs-CM360 line, a compare view and the breakdown switch all
// go with it, and a confirm has to name them before it happens.
import Popover from '../Popover.jsx';
import { dimensionMappings } from '../spotlight-items.js';
import { PopRow } from './rows.jsx';

const RUNTIME = 'Runtime (first available)';
/** §7.7's own rule, said where the choice is made rather than in the state it produces. */
const NOTE = 'Runtime follows this pacing\'s own mapping. Fixed names one and is never substituted.';

/**
 * SourcePopover — the CM360 source of one report.
 *
 *   dataset    the draft's `spec.dataset` (its `mapping` is the whole subject)
 *   mappings   `store.mappingsV3` — every entity, filtered here to the dimensions kind
 *   anchorRef  the chip this panel hangs from
 *   firstRef   where focus lands on open (§3) — the mapping picker
 *   onPick     `(mapping) => …` — the builder writes it through `setDataset`
 *   onRemove   ask the BUILDER to drop the source; it names what goes first
 */
export default function SourcePopover({
  dataset, mappings, anchorRef, firstRef, onPick, onRemove, onClose,
}) {
  const binding = (dataset && dataset.mapping) || { mode: 'runtime' };
  const entities = dimensionMappings(mappings);
  const fixedId = binding.mode === 'fixed' ? binding.id : '';
  // A fixed binding whose entity this pacing no longer carries keeps its own row, named by
  // id: the select must show what is STORED, or it would report a mapping nobody chose.
  const orphan = fixedId && !entities.some((m) => m.id === fixedId);

  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="CM360 source" initialFocus={firstRef}>
      <PopRow label="Mapping" note={NOTE}>
        <select
          ref={firstRef}
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
          aria-label="Mapping"
          value={fixedId}
          onChange={(e) => {
            const id = e.target.value;
            onPick(id ? { mode: 'fixed', id } : { mode: 'runtime' });
          }}
        >
          <option value="">{RUNTIME}</option>
          {entities.map((m) => (
            <option key={m.id} value={m.id}>{`Fixed: ${m.name || m.id}`}</option>
          ))}
          {orphan ? <option value={fixedId}>{`Fixed: ${fixedId} (not on this pacing)`}</option> : null}
        </select>
      </PopRow>

      <button type="button" className="sp-pop-rm" onClick={() => { onClose(); onRemove(); }}>
        Remove the CM360 source
      </button>
    </Popover>
  );
}
