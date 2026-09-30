import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { MoreVerticalIcon } from "../../shared/ui/icons/icons";
import { OwnerPicker } from "../pacing-overview/owner-picker";
import type { PacingRowV1 } from "../pacing-overview/types";

/** Width the row menu is laid out at, so its fixed position can be computed before it mounts. */
const ROW_MENU_WIDTH = 210;

/**
 * Roughly how tall the open menu gets (four items plus the "not Live" note). Only used to decide
 * whether it still fits below the trigger - the placement itself never relies on this number, so an
 * estimate that is a little off cannot misplace the panel.
 */
const ROW_MENU_MAX_HEIGHT = 220;

/**
 * Where the fixed-position row menu is pinned. Either hangs from its top edge below the trigger, or -
 * when the row sits too near the bottom of the window - from its bottom edge just above it. Anchoring
 * the flipped case by `bottom` keeps it exact: no guess at the panel's own height is involved.
 */
type MenuAnchor = { left: number; top: number; bottom?: undefined } | { left: number; bottom: number; top?: undefined };

/**
 * The Overview row's kebab menu: Refresh data / NetSuite diff / Revalidate from NS / Transfer owner /
 * Delete. Same mechanics as the campaign Pacing tab's row menu (fixed panel anchored off the
 * trigger's rect, closed by outside click / Escape / scroll), mirrored rather than extracted because
 * the two menus carry different item sets — this one has Transfer owner, which the tab's rows offer
 * inline instead.
 *
 * NetSuite diff arrived here when the `/pacing` screen was retired: that table was the only place a
 * drift could be seen across pacings, so its column moved onto this row and its sheet behind this
 * item.
 *
 * Transfer owner IS the shared {@link OwnerPicker} — never a second reassignment UI — rendered as a
 * menu item whose click opens the same portal popover the owner cell on `/pacing` opens. It is not
 * permission-gated here: Pacing itself allows the move when both owners sit in the caller's scope,
 * and the picker's roster is already scope-filtered, so a refusal surfaces as the picker's own error
 * rather than being guessed at client-side.
 */
export function OverviewRowMenu({
  row,
  isAdmin,
  refreshCooldownSeconds,
  onRefresh,
  onRevalidate,
  onDelete,
  onOpenNsDiff,
}: {
  row: PacingRowV1;
  isAdmin: boolean;
  refreshCooldownSeconds: number;
  onRefresh: (row: PacingRowV1) => void;
  onRevalidate: (row: PacingRowV1) => void;
  onDelete: (row: PacingRowV1) => void;
  onOpenNsDiff: (row: PacingRowV1) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  // Pacing refuses a refresh for anything but a Live pacing (400 pacing_not_live), so the item is
  // offered but disabled rather than firing a request that can only come back an error.
  const isLive = row.status === "Live";
  const inCooldown = refreshCooldownSeconds > 0;
  // Nothing to re-seed on an archived pacing — hidden, like the campaign tab's own gate.
  const canRevalidate = isAdmin && row.status !== "Archive";

  // An open menu closes on an outside click, on Escape, and on any scroll or resize — it is
  // positioned fixed from the trigger's rect, so a scrolled page would leave it hanging over a row
  // it does not belong to. The PersonPicker popover (`.opick`, portalled to body) counts as INSIDE:
  // it is this menu's Transfer-owner flow, and closing the menu under it would unmount it mid-pick.
  useEffect(() => {
    if (!open) return undefined;
    function closeMenu() {
      setOpen(false);
      setAnchor(null);
    }
    function onMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".overview__menu-wrap, .overview__menu, .opick")) closeMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      // While the person picker is open, its own capture-phase Escape handler stops the event dead,
      // so this never fires — first Escape closes the picker, the second closes the menu.
      if (event.key === "Escape") closeMenu();
    }
    function onScroll(event: Event) {
      // Scrolling the person picker's own list must not tear the menu down beneath it.
      if ((event.target as HTMLElement | null)?.closest?.(".opick")) return;
      closeMenu();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [open]);

  function toggleMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    // The trigger sits inside the clickable row: without this the click would also toggle the row's
    // expansion underneath the menu.
    event.stopPropagation();
    if (open) {
      setOpen(false);
      setAnchor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(16, rect.right - ROW_MENU_WIDTH);
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpen(true);
    setAnchor(
      spaceBelow < ROW_MENU_MAX_HEIGHT && rect.top > spaceBelow
        ? { left, bottom: window.innerHeight - rect.top + 6 }
        : { left, top: rect.bottom + 6 }
    );
  }

  function close() {
    setOpen(false);
    setAnchor(null);
  }

  return (
    // Clicks anywhere in the wrap (trigger or panel) stay out of the row's expand/collapse.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span className="overview__menu-wrap" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="overview__kebab"
        aria-label={`Actions for ${row.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <MoreVerticalIcon />
      </button>
      {/* Positioned fixed, from the trigger's own rect: an absolutely positioned panel on the last
          row of a group would be clipped by the card. Same approach as the campaign Pacing tab. */}
      {open && (
        <div className="overview__menu" role="menu" style={anchor ?? undefined}>
          <button
            type="button"
            role="menuitem"
            disabled={!isLive || inCooldown}
            onClick={() => {
              close();
              onRefresh(row);
            }}
          >
            {inCooldown ? `Refresh data (${refreshCooldownSeconds}s)` : "Refresh data"}
          </button>
          {/* Said where the user is looking: a greyed-out item with no reason reads as broken. */}
          {!isLive && <p className="overview__menu-note">Only a Live pacing can be refreshed.</p>}
          {/* §13, US-136: a read-only check against NetSuite, so not admin-gated — anyone who can see
              this pacing may look at its drift, unlike Revalidate below which writes back to it.
              Same sheet the campaign Pacing tab opens; the column to the left is the count. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onOpenNsDiff(row);
            }}
          >
            NetSuite diff
          </button>
          {canRevalidate && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onRevalidate(row);
              }}
            >
              Revalidate from NS
            </button>
          )}
          <OwnerPicker
            pacingId={row.id}
            currentOwnerName={row.ownerName ?? null}
            trigger="Transfer owner"
            triggerClassName="overview__menu-transfer"
            // A successful transfer moves the row to another owner's group (or out of scope
            // entirely) - the list invalidation re-groups it; this menu must not outlive the row.
            onDone={close}
          />
          {isAdmin && (
            <button
              type="button"
              role="menuitem"
              className="overview__menu-danger"
              onClick={() => {
                close();
                onDelete(row);
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </span>
  );
}
