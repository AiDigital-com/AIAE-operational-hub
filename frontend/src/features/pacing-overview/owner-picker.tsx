/**
 * Reassigning a pacing (§11 of the migration plan, US-131).
 *
 * One component, used from both places the story asks for — the Overview row and a campaign's
 * Pacing tab — so the two cannot drift into offering different choices or wording the same refusal
 * two ways.
 *
 * SEARCHABLE, not a dropdown. There are 655 people in this organisation and fourteen of them are
 * called Daria; scrolling a native select past six hundred names to find one is not a choice
 * anybody can make reliably. Filtering happens in the browser: the roster is one small request for
 * the whole screen, so a search box that costs a round-trip per keystroke would be slower AND more
 * fragile than one that does not.
 *
 * WHAT IT OFFERS is not this component's judgement: `assignable-owners` returns exactly the people
 * the caller's Pacing scope already lets them see, and Pacing checks the same thing again on the
 * transfer itself. So a refusal here means the two disagreed — worth showing, not designing around.
 *
 * Opens CLOSED and fetches nothing until it does. Somebody scrolling two hundred rows should not
 * pay for a roster they never open.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatError } from "../../shared/format/error";
import { SearchIcon } from "../../shared/ui/icons/icons";
import type { AssignableOwnerV1 } from "./types";
import { useAssignableOwners, useTransferPacingOwner } from "./hooks";
import "./owner-picker.css";

/** Matches a person by name or email, so "daria" and "daria.f@" both narrow the same list. */
function matches(owner: AssignableOwnerV1, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return (
    owner.name.toLowerCase().includes(needle) || (owner.email ?? "").toLowerCase().includes(needle)
  );
}

export function OwnerPicker({
  pacingId,
  currentOwnerName,
  onDone,
}: {
  pacingId: string;
  currentOwnerName: string | null;
  /** Called after a successful transfer, for a caller that wants to close a menu or refocus. */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const owners = useAssignableOwners(open);
  const transfer = useTransferPacingOwner();
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
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /**
   * Where the popover goes.
   *
   * Measured against the VIEWPORT and rendered in a portal, because the row it belongs to sits
   * inside a scrolling table: anything positioned within that table gets clipped at its edge, and
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

  function assign(newOwnerId: string) {
    setError(null);
    transfer.mutate(
      { pacingId, newOwnerId },
      {
        onSuccess: () => {
          setOpen(false);
          setSearch("");
          onDone?.();
        },
        // Stay open with the reason: closing would leave the old owner on screen and read as
        // success.
        onError: (cause) => setError(formatError(cause)),
      }
    );
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
      assign(visible[highlight].pacingUserId);
    }
  }

  // The trigger stays mounted while the popover is open: it is what the popover is measured
  // against, and it keeps the cell's layout from collapsing under an open picker.
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="opick__open"
      aria-expanded={open}
      onClick={() => {
        setError(null);
        setSearch("");
        setOpen((current) => !current);
      }}
    >
      Reassign
    </button>
  );

  if (!open || !place) return trigger;

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
          disabled={transfer.isPending}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={onSearchKeyDown}
          aria-label={`Reassign this pacing${currentOwnerName ? `, currently owned by ${currentOwnerName}` : ""}`}
        />
      </div>

      {owners.isPending && <p className="opick__note">Loading people…</p>}
      {owners.isError && <p className="opick__error">{formatError(owners.error)}</p>}

      {owners.data && owners.data.owners.length === 0 && (
        // Not a permission answer: an empty roster means the §2 user sync has not reached anybody in
        // this person's scope yet, which an admin has to fix. Saying "nobody" without saying why
        // sends them looking in the wrong place.
        <p className="opick__note">
          Nobody to assign to — the Hub has no one in your scope synced with Pacing yet.
        </p>
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
                  disabled={transfer.isPending}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => assign(owner.pacingUserId)}
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
          {transfer.isPending && <p className="opick__note">Reassigning…</p>}
        </>
      )}

      {error && <p className="opick__error">{error}</p>}
    </div>
  );

  return (
    <>
      {trigger}
      {createPortal(popover, document.body)}
    </>
  );
}
