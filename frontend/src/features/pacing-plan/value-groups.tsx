/**
 * Value groups (Pacing spec 2026-10-02) - the reference's `ValueGroupsBlock` and `GroupEditor`
 * (`PacingTab.jsx`). Several delivered values of one naming dimension read as one named value, so
 * one dim split carries a shared target for them. The dictionary is the line item's own; the block
 * lists it, the editor changes it, and both live in the plan draft until Save.
 *
 * Every rule is the reference's, taken over unchanged in `spa/dim-groups-editor.js` (what the editor
 * lists, ticks and refuses - judged by the same `validateLine` dash-gate runs on save).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import Popover from "../pacing-dashboard/spa/Popover.jsx";
import {
  applyGroup,
  editorValues,
  groupNameProblem,
  groupProblem,
  keepOrder,
  pinnedNotices,
  sameNameNotice,
  typedValueProblem,
  usedBy,
  valuesLabel,
} from "../pacing-dashboard/spa/dim-groups-editor.js";
import { foldValue, GROUP_DIM_KEYS } from "../pacing-dashboard/spa/dim-value-groups.js";
import type { RawSplits } from "./container-editor";
import { DIM_LABELS, type PacingContainer } from "./containers";
import type { DimGroup } from "./line-item-fields";

/** A chip's key: one group per dimension and name on a line. */
export const chipKey = (g: DimGroup) => `${g.dim_key}:${String(g.name).toLowerCase()}`;

/** The line's groups as chips. A line without groups renders no block: the first group is made from
 *  "+ Add dim split" → "Group values…". */
export function ValueGroupsBlock({
  groups,
  containers,
  editingIndex,
  onOpen,
  onRemove,
  focusKey,
  onFocused,
}: {
  groups: DimGroup[];
  containers: PacingContainer[];
  editingIndex: number | null;
  onOpen: (index: number, anchor: HTMLElement) => void;
  onRemove: (index: number) => void;
  /** The chip to focus after a change (the renamed one, or the next one after a removal). */
  focusKey: string | null;
  onFocused: () => void;
}) {
  const refs = useRef(new Map<string, HTMLElement>());
  const keep = (key: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
  useEffect(() => {
    if (!focusKey) return;
    refs.current.get(focusKey)?.focus({ preventScroll: true });
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return (
    <div className="pplan__subsection">
      <div className="pplan__subsection-head">Value groups ({groups.length})</div>
      <div className="pplan-vg__list">
        {groups.map((g, i) => {
          const used = usedBy(containers, g) as string | null;
          return (
            <div
              key={chipKey(g)}
              ref={keep(chipKey(g))}
              className="pplan-vg__chip"
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              aria-expanded={editingIndex === i}
              title={`${DIM_LABELS[g.dim_key] || g.dim_key}: ${g.name} = ${g.values.join(", ")}`}
              onClick={(e) => onOpen(i, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onOpen(i, e.currentTarget);
                }
              }}
            >
              <span className="pplan-vg__chip-dim">{DIM_LABELS[g.dim_key] || g.dim_key}</span>
              <span className="pplan-vg__chip-name">{g.name}</span>
              <span className="pplan-vg__chip-n">{valuesLabel(g.values.length)}</span>
              <button
                type="button"
                className="pplan-vg__chip-x"
                disabled={!!used}
                title={used ? `Used by a dim split in ${used}` : "Remove group"}
                aria-label={`Remove group ${g.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(i);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button type="button" className="pplan__add-btn" aria-haspopup="dialog" onClick={(e) => onOpen(-1, e.currentTarget)}>
          + Add group
        </button>
      </div>
    </div>
  );
}

/** The dimension a new group starts on: the first one this line has delivered values for. */
function firstGroupDim(rawSplits: RawSplits | null | undefined, liId: string): string {
  return GROUP_DIM_KEYS.find((k: string) => (rawSplits?.[k]?.[liId] || []).length > 0) || GROUP_DIM_KEYS[0];
}

interface EditorRow {
  value: string;
  checked: boolean;
  typed: boolean;
  disabled: string | null;
}

/**
 * The group editor, in the moved `Popover` (it owns placement, focus and Escape). `editingIndex` -1
 * is a new group. "Done" hands back the line's groups and containers as they would be saved: a
 * rename takes the line's splits on the old name with it.
 */
export function GroupEditor({
  anchorRef,
  liId,
  rawSplits,
  groups,
  containers,
  widgets,
  editingIndex,
  onDone,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  liId: string;
  rawSplits: RawSplits | null | undefined;
  groups: DimGroup[];
  containers: PacingContainer[];
  widgets: unknown[] | undefined;
  editingIndex: number;
  onDone: (next: { groups: DimGroup[]; containers: PacingContainer[] }) => void;
  onClose: () => void;
}) {
  const previous = editingIndex >= 0 ? groups[editingIndex] : null;
  const [draft, setDraft] = useState<DimGroup>(() =>
    previous
      ? { dim_key: previous.dim_key, name: previous.name, values: [...previous.values] }
      : { dim_key: firstGroupDim(rawSplits, liId), name: "", values: [] }
  );
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  // A sentence about an empty name before the user has done anything reads as an error on open.
  const [touched, setTouched] = useState(false);
  const [typedNote, setTypedNote] = useState<string | null>(null);
  const change = (next: DimGroup) => {
    setTouched(true);
    setDraft(next);
  };

  // Ticked first as the editor opened, then fixed: a tick must not move rows under the pointer. A
  // new group's dimension change starts the order over.
  const orderRef = useRef<{ dim: string | null; order: string[] | null }>({ dim: null, order: null });
  if (orderRef.current.dim !== draft.dim_key) orderRef.current = { dim: draft.dim_key, order: null };
  const ordered = keepOrder(editorValues(rawSplits, liId, groups, containers, draft, editingIndex), orderRef.current.order) as {
    rows: EditorRow[];
    order: string[];
  };
  orderRef.current.order = ordered.order;
  const rows = ordered.rows;
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.value.toLowerCase().includes(q)) : rows;
  const ticked = draft.values.length;
  const problem = touched ? (groupProblem(groups, containers, draft, editingIndex) as string | null) : null;
  const blocked = !!groupProblem(groups, containers, draft, editingIndex) || ticked === 0;
  const nameBad = touched && !!groupNameProblem(groups, containers, draft, editingIndex);
  const notices = [sameNameNotice(rawSplits, liId, draft) as string | null, ...((pinnedNotices as (w: unknown, d: DimGroup, p: DimGroup | null) => string[])(widgets, draft, previous))].filter(
    (t): t is string => !!t
  );

  const toggle = (value: string) => {
    const f = foldValue(value);
    change({
      ...draft,
      values: draft.values.some((v) => foldValue(v) === f) ? draft.values.filter((v) => foldValue(v) !== f) : [...draft.values, value],
    });
  };
  const addTyped = () => {
    const value = typed.trim();
    if (!value) return;
    const why = typedValueProblem(rawSplits, liId, groups, containers, draft, editingIndex, value) as string | null;
    if (why) {
      setTypedNote(why);
      return;
    }
    const row = rows.find((r) => foldValue(r.value) === foldValue(value));
    if (!draft.values.some((v) => foldValue(v) === foldValue(value))) {
      change({ ...draft, values: [...draft.values, row ? row.value : value] });
    }
    setTyped("");
    setTypedNote(null);
  };

  return (
    <Popover id={undefined} anchorRef={anchorRef} open onClose={onClose} title="Value group" width={340} align="start" initialFocus=".pplan-vg__name">
      <div className="pplan-vg__editor">
        <div className="pplan__field-row">
          <label className="pplan__field">
            <span className="pplan__field-label">Dimension</span>
            <select
              className="pplan__select"
              aria-label="Dimension"
              disabled={!!previous}
              value={draft.dim_key}
              onChange={(e) => change({ ...draft, dim_key: e.target.value, values: [] })}
            >
              {GROUP_DIM_KEYS.map((k: string) => (
                <option key={k} value={k}>{DIM_LABELS[k] || k}</option>
              ))}
            </select>
          </label>
          <label className="pplan__field">
            <span className="pplan__field-label">Name</span>
            <input
              type="text"
              className={`pplan__input pplan-vg__name${nameBad ? " pplan__input--invalid" : ""}`}
              aria-label="Group name"
              maxLength={80}
              value={draft.name}
              onChange={(e) => change({ ...draft, name: e.target.value })}
            />
          </label>
        </div>
        {problem && (
          <p className="pplan__hint pplan__hint--warn" role="alert">
            ⚠ {problem}
          </p>
        )}
        <div className="pplan__field">
          <span className="pplan__field-label">Values ({ticked})</span>
          <div className="pplan-vg__box">
            <input
              type="text"
              className="pplan-vg__search"
              placeholder="Search values"
              aria-label="Search values"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {shown.map((r) => {
              const note = r.disabled || (r.typed ? "not delivered yet" : null);
              // A ticked row stays untickable even when it breaks a rule: that is the way out.
              const locked = !!r.disabled && !r.checked;
              return (
                <label key={r.value} className="pplan-vg__opt" aria-disabled={locked ? "true" : undefined}>
                  <input type="checkbox" checked={r.checked} disabled={locked} onChange={() => toggle(r.value)} />
                  <span className="pplan-vg__opt-value" title={r.value}>{r.value}</span>
                  {note && <span className="pplan-vg__opt-why">{note}</span>}
                </label>
              );
            })}
            {shown.length === 0 && (
              <div className="pplan-vg__empty">
                {rows.length ? "No value matches the search." : "Nothing delivered on this dimension yet. Add the values below."}
              </div>
            )}
          </div>
        </div>
        <div className="pplan-vg__addrow">
          <input
            type="text"
            className="pplan__input"
            maxLength={300}
            placeholder="Add a value that has not delivered yet"
            aria-label="Add a value that has not delivered yet"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setTypedNote(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTyped();
              }
            }}
          />
          <button type="button" className="button button--ghost button--sm" disabled={!typed.trim()} onClick={addTyped}>
            Add
          </button>
        </div>
        {typedNote && (
          <p className="pplan__hint pplan__hint--warn" role="alert">
            ⚠ {typedNote}
          </p>
        )}
        {notices.map((text) => (
          <p key={text} className="pplan__hint">{text}</p>
        ))}
        <div className="pplan__dialog-actions">
          <button type="button" className="button button--ghost button--sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={blocked}
            onClick={() => onDone(applyGroup(groups, containers, draft, editingIndex) as { groups: DimGroup[]; containers: PacingContainer[] })}
          >
            Done
          </button>
        </div>
      </div>
    </Popover>
  );
}
