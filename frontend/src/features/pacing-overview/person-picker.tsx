/**
 * Picking a person out of the organisation.
 *
 * SEARCHABLE, not a dropdown. There are 655 people in this organisation and fourteen of them are
 * called Daria; scrolling a native select past six hundred names to find one is not a choice
 * anybody can make reliably. Filtering happens in the browser: the roster is one small request for
 * the whole screen, so a search box that costs a round-trip per keystroke would be slower AND more
 * fragile than one that does not.
 *
 * WHO IT OFFERS is not this component's judgement: `assignable-owners` returns exactly the people
 * the caller's Pacing scope already lets them see, and Pacing checks again on whatever act follows.
 * So a refusal after a pick means the two disagreed - worth showing, not designing around.
 *
 * Opens CLOSED and fetches nothing until it does. Somebody scrolling two hundred rows should not
 * pay for a roster they never open.
 *
 * Extracted from the reassignment picker when delegations needed the same control (§12). Both
 * screens choose a colleague out of the same roster, and the alternative was a second list that
 * searches differently, answers an empty roster differently, and drifts from this one - which is
 * exactly what the native select in the delegation form was doing.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatError } from "../../shared/format/error";
import { SearchIcon } from "../../shared/ui/icons/icons";
import type { AssignableOwnerV1 } from "./types";
import { useAssignableOwners } from "./hooks";
import "./person-picker.css";

/** Matches a person by name or email, so "daria" and "daria.f@" both narrow the same list. */
function matches(owner: AssignableOwnerV1, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return (
    owner.name.toLowerCase().includes(needle) || (owner.email ?? "").toLowerCase().includes(needle)
  );
}

export interface PersonPickerProps {
  /** What the closed control shows. */
  trigger: ReactNode;
  /** Class for the trigger button - a link in a table row, a field in a form. */
  triggerClassName?: string;
  /** Names the trigger for a screen reader, when what it displays is a value rather than a label.
   *  Say the label AND the value: a button reading only "Dasha" says nothing about what she is. */
  triggerLabel?: string;
  /** Names the search box for a screen reader; it is the only label the popover has. */
  searchLabel: string;
  /** Shown instead of the list when the roster comes back empty. */
  emptyNote?: string;
  /** True while the act that follows a pick is in flight - disables the list rather than closing it. */
  busy?: boolean;
  /** A note under the list while busy, e.g. "Reassigning…". */
  busyNote?: string;
  /** A refusal from whatever the pick triggered. Keeps the popover open: closing on an error would
   *  leave the old value on screen and read as success. */
  error?: string | null;
  /**
   * Called with the chosen person's Pacing user id.
   *
   * The picker closes once this settles. Return false - or reject - to keep it open, which is what a
   * caller whose act was refused wants: closing would leave the old value on screen and read as
   * success. Pass the reason back through `error` and the list stays put beneath it.
   */
  onPick: (pacingUserId: string) => void | boolean | Promise<void | boolean>;
  /** Called when the popover opens, for a caller that wants to clear a previous error. */
  onOpen?: () => void;
}

export function PersonPicker({
  trigger,
  triggerClassName = "opick__open",
  triggerLabel,
  searchLabel,
  emptyNote = "Nobody to choose from — the Hub has no one in your scope synced with Pacing yet.",
  busy = false,
  busyNote,
  error,
  onPick,
  onOpen,
}: PersonPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const owners = useAssignableOwners(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(
    () => (owners.data?.owners ?? []).filter((owner) => matches(owner, search)),
    [owners.data, search]
  );

  // Close on Escape or a click outside, the same way MultiSelect does — a popover that only closes
  // by its own button strands anybody who opened it by accident.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape dismisses THIS, and only this. Taken in the capture phase and stopped dead, because
      // the picker can sit inside a sheet whose own Escape handler is on the same document node -
      // and one keypress that dismissed the picker AND threw away the half-filled form behind it is
      // not what anybody pressing Escape meant.
      event.stopImmediatePropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  /**
   * Where the popover goes.
   *
   * Measured against the VIEWPORT and rendered in a portal, because the thing it belongs to may sit
   * inside something that scrolls: anything positioned within that gets clipped at its edge, and
   * the last row's popover — the one this existed to fix — was cut off entirely.
   *
   * Flips above the trigger when there is not room below, so the bottom row opens upward instead of
   * off-screen. Measured in a layout effect so the first paint is already in the right place; a
   * popover that appears low and jumps up is worse than one that never moved.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const POPOVER_HEIGHT = 320;
    const GAP = 4;
    const roomBelow = window.innerHeight - rect.bottom;
    const top = roomBelow < POPOVER_HEIGHT && rect.top > roomBelow
      ? Math.max(8, rect.top - POPOVER_HEIGHT - GAP)
      : rect.bottom + GAP;
    // Keep it on screen horizontally too: a trigger near the right edge would otherwise open past it.
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - 288);
    setPlace({ top, left });
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // A narrowed list whose highlight sat on row 12 would point at nothing, or worse at somebody the
  // user never looked at. Back to the top on every keystroke.
  useEffect(() => setHighlight(0), [search]);

  async function pick(pacingUserId: string) {
    try {
      if ((await onPick(pacingUserId)) === false) return;
    } catch {
      // The caller reports the reason through `error`; staying open keeps it beside the list, where
      // the person can pick again without reopening anything.
      return;
    }
    setOpen(false);
    setSearch("");
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && visible[highlight]) {
      event.preventDefault();
      void pick(visible[highlight].pacingUserId);
    }
  }

  // The trigger stays mounted while the popover is open: it is what the popover is measured
  // against, and it keeps the layout from collapsing under an open picker.
  const triggerNode = (
    <button
      ref={triggerRef}
      type="button"
      className={triggerClassName}
      aria-label={triggerLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      onClick={() => {
        onOpen?.();
        setSearch("");
        setOpen((current) => !current);
      }}
    >
      {trigger}
    </button>
  );

  if (!open || !place) return triggerNode;

  const popover = (
    <div className="opick" ref={rootRef} style={{ top: place.top, left: place.left }}>
      <div className="opick__search">
        <SearchIcon />
        <input
          ref={searchRef}
          type="text"
          className="opick__search-input"
          placeholder="Search by name or email…"
          value={search}
          disabled={busy}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={onSearchKeyDown}
          aria-label={searchLabel}
        />
      </div>

      {owners.isPending && <p className="opick__note">Loading people…</p>}
      {owners.isError && <p className="opick__error">{formatError(owners.error)}</p>}

      {owners.data && owners.data.owners.length === 0 && (
        // Not a permission answer: an empty roster means the §2 user sync has not reached anybody in
        // this person's scope yet, which an admin has to fix. Saying "nobody" without saying why
        // sends them looking in the wrong place.
        <p className="opick__note">{emptyNote}</p>
      )}

      {owners.data && owners.data.owners.length > 0 && (
        <>
          <ul className="opick__list" role="listbox">
            {visible.map((owner, index) => (
              <li key={owner.pacingUserId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  className={`opick__option${index === highlight ? " opick__option--on" : ""}`}
                  disabled={busy}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => void pick(owner.pacingUserId)}
                >
                  <span className="opick__option-name">{owner.name}</span>
                  {/* The email is what tells two colleagues with one name apart, so it is always
                      shown rather than kept for a tooltip. */}
                  {owner.email && <span className="opick__option-email">{owner.email}</span>}
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 && <p className="opick__note">Nobody matches “{search}”.</p>}
          {busy && busyNote && <p className="opick__note">{busyNote}</p>}
        </>
      )}

      {error && <p className="opick__error">{error}</p>}
    </div>
  );

  return (
    <>
      {triggerNode}
      {createPortal(popover, document.body)}
    </>
  );
}
