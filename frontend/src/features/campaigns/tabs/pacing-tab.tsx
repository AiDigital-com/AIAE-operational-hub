import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Link, useLocation, useOutletContext, useSearchParams } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { campaignDisplayName } from "../../../shared/format/names";
import { cn } from "../../../shared/style/cn";
import { MoreVerticalIcon } from "../../../shared/ui/icons/icons";
import { LoadingBlock } from "../../../shared/ui/loading-spinner/loading-spinner";
import { useToast } from "../../../shared/ui/toast/toast";
import { MarginCell } from "../../../shared/ui/margin-cell/margin-cell";
import { StatusBadge } from "../../../shared/ui/status-badge/status-badge";
// Money string helper, shared with the Pacing Overview (§4) so the same figures read identically on
// both screens.
import { fmtBudget } from "../../pacing/mock/format";
import { ALERT_SEVERITY_ORDER, PACE_STATUS_COLOR, PACING_STATUS_STYLE, groupAlertsBySeverity } from "../../pacing-overview/format";
import { OwnerPicker } from "../../pacing-overview/owner-picker";
import { netSuiteLeadMismatch } from "../../pacing-overview/format";
import { useCampaignPacings } from "../../pacing-overview/hooks";
import type { OpenPacingState } from "../../pacing-overview/navigation";
import type { PacingRowV1 } from "../../pacing-overview/types";
import { PacingDashboard } from "../../pacing-dashboard/pacing-dashboard";
import { triggerPacingRefresh } from "../../pacing-dashboard/api";
import { clearFilterParams } from "../../pacing-dashboard/filters/use-url-filters";
import { CreatePacingPanel } from "../../pacing-create/create-pacing-panel";
// The one delete confirmation in the product (typed-name friction and all), owned by the Pacing
// admin screen - this tab reuses it rather than growing a second, gentler way to delete a pacing.
import { DeletePacingModal } from "../../pacing-admin/pacing-admin-delete-modals";
import { RevalidatePacingModal } from "../../pacing-admin/pacing-admin-revalidate-modal";
import { isAdminUser, useCurrentUser } from "../../rbac/hooks";
import type { CampaignTabContext } from "../campaign-workspace";
import { PacingNsDiffSheet } from "./pacing-ns-diff-sheet";
import "./pacing-tab.css";

/** Width the row menu is laid out at, so its fixed position can be computed before it mounts. */
const ROW_MENU_WIDTH = 210;

/**
 * Pacing refuses a second refresh of the same pacing within two minutes (its double-launch guard).
 * Held here too, so a refresh this tab just triggered greys its own menu item out for the same window
 * instead of letting the user earn a 429 to find out.
 */
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Roughly how tall the open menu gets (three items plus the "not Live" note). Only used to decide
 * whether it still fits below the trigger - the placement itself never relies on this number, so an
 * estimate that is a little off cannot misplace the panel.
 */
const ROW_MENU_MAX_HEIGHT = 200;

/**
 * Where the fixed-position row menu is pinned. Either hangs from its top edge below the trigger, or -
 * when the row sits too near the bottom of the window - from its bottom edge just above it. Anchoring
 * the flipped case by `bottom` keeps it exact: no guess at the panel's own height is involved.
 */
type MenuAnchor = { left: number; top: number; bottom?: undefined } | { left: number; bottom: number; top?: undefined };

/** Statuses a re-validate is not offered for - there is nothing to re-seed on an archived pacing. */
const ARCHIVED_STATUSES = new Set(["Archive", "Archived"]);

/**
 * Every campaign on this pacing OTHER than the one whose tab we are on — not "everything after the
 * first": the pacing can list this campaign in any position.
 */
function otherCampaignsOf(row: PacingRowV1, currentCampaignId: number) {
  return (row.campaigns ?? []).filter((campaign) => Number(campaign.id) !== currentCampaignId);
}

/**
 * One pacing on this campaign's tab: a summary row that reads like an Overview row, and picks the
 * pacing whose dashboard shows below the list.
 *
 * It used to expand in place - flight/line-item detail, the alert text, an "Open full dashboard"
 * button - and opening that dashboard then replaced the whole list. Two steps to reach one pacing and
 * two more to reach the next. The row is now a selector, like Reporting's report rows: one click, and
 * §6's dashboard renders under the list with the same figures the expanded block used to repeat.
 */
function PacingListItem({
  row,
  currentCampaignId,
  selected,
  onSelect,
  itemRef,
  canDelete,
  canRevalidate,
  refreshCooldownSeconds,
  menuOpen,
  menuAnchor,
  onToggleMenu,
  onRefresh,
  onRevalidate,
  onDelete,
  onOpenNsDiff,
}: {
  row: PacingRowV1;
  currentCampaignId: number;
  selected: boolean;
  onSelect: () => void;
  itemRef?: React.Ref<HTMLLIElement>;
  canDelete: boolean;
  canRevalidate: boolean;
  refreshCooldownSeconds: number;
  menuOpen: boolean;
  menuAnchor: MenuAnchor | null;
  onToggleMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRefresh: () => void;
  onRevalidate: () => void;
  onDelete: () => void;
  onOpenNsDiff: () => void;
}) {
  const statusStyle = PACING_STATUS_STYLE[row.status] ?? { color: "var(--muted)" };
  const paceStatus = row.paceStatus ?? "no_data";
  const alerts = row.alerts;
  const alertsBySeverity = groupAlertsBySeverity(alerts);
  const otherCampaigns = otherCampaignsOf(row, currentCampaignId);
  const netSuiteLead = netSuiteLeadMismatch(row.ownerName ?? null, row.campaigns ?? null);
  // Pacing refuses a refresh for anything but a Live pacing (400 pacing_not_live), so the item is
  // offered but disabled rather than firing a request that can only come back an error.
  const isLive = row.status === "Live";
  const inCooldown = refreshCooldownSeconds > 0;

  return (
    <li className={cn("pacing-tab__item", selected && "pacing-tab__item--selected")} ref={itemRef}>
      <div className="pacing-tab__item-row">
        <div className="pacing-tab__item-head">
          {/* The row's click target is an overlay that covers the head, NOT the head itself. The head
              holds the owner cell, and that cell holds a reassign button - a button inside a button
              is invalid markup, and the browser repairs it by splitting the row open, which is how
              the owner picker ends up outside the row it belongs to. An empty button under the cells
              keeps the markup legal and the whole row clickable; `aria-label` names it, since there
              is no longer any text inside it to read.

              `aria-current`, not `aria-expanded`: the row no longer opens anything, it picks which
              pacing the dashboard below the list is showing. */}
          <button
            type="button"
            className="pacing-tab__item-pick"
            onClick={onSelect}
            aria-label={row.name}
            aria-current={selected ? "true" : undefined}
          />
          {/* Fills the grid's first track, which the chevron used to hold - dropping the cell instead
              would move every column left on this row only. A dot, not a rail down the row's edge:
              side stripes are banned project-wide. */}
          <span className="pacing-tab__item-dot" aria-hidden="true" />
          <span className="pacing-tab__item-name">
            {row.name}
            {otherCampaigns.length > 0 && (
              <span className="pacing-tab__item-multi">
                +{otherCampaigns.length} other campaign{otherCampaigns.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <StatusBadge label={row.status} color={statusStyle.color} glow={statusStyle.glow} />
          {/* Sits ABOVE the row's click overlay (z-index in the stylesheet), which is what makes its
              picker reachable. It no longer has to stop a click from bubbling: the overlay is a
              sibling now, not an ancestor. */}
          <span className="pacing-tab__item-owner">
              <span className="pacing-tab__item-owner-name" title={row.ownerName ?? undefined}>
                {row.ownerName ?? "—"}
              </span>
              {/* §11, US-132: the same disagreement the Overview shows. Owner is visible on both
                  screens, so the flag belongs on both — seeing it in one place and not the other is
                  how somebody concludes it was already dealt with. */}
              {netSuiteLead && (
                <span
                  className="pacing-tab__item-owner-ns"
                  title={`NetSuite records ${netSuiteLead} as running this campaign. Pacing's owner still decides who can see it — one of the two is out of date.`}
                >
                  NetSuite: {netSuiteLead}
                </span>
              )}
              {/* §11, US-131: reassignment is offered here as well as on the Overview. The same
                  component, so the two cannot end up offering different people. */}
              <OwnerPicker pacingId={row.id} currentOwnerName={row.ownerName ?? null} />
          </span>
          <MarginCell
            actual={row.marginActualPct ?? null}
            target={row.marginTargetPct ?? 0}
            className="pacing-tab__item-margin"
          />
          {row.pacingDeviationPct == null ? (
            <span className="pacing-tab__item-pace pacing-tab__item-pace--na">—</span>
          ) : (
            <span className="pacing-tab__item-pace" style={{ color: PACE_STATUS_COLOR[paceStatus] }}>
              {row.pacingDeviationPct > 0 ? "+" : ""}
              {row.pacingDeviationPct.toFixed(1)}pp
            </span>
          )}
          <span className="pacing-tab__item-budget">{fmtBudget(row.budgetTotal ?? 0)}</span>
          {alerts.length > 0 ? (
            <span className="pacing-tab__item-alerts">
              {ALERT_SEVERITY_ORDER.filter((severity) => alertsBySeverity[severity]?.length).map((severity) => (
                <span
                  key={severity}
                  className={cn("pacing-tab__alert-badge", `pacing-tab__alert-badge--${severity}`)}
                >
                  {alertsBySeverity[severity].length}
                </span>
              ))}
            </span>
          ) : (
            <span className="pacing-tab__item-alerts pacing-tab__item-alerts--none" />
          )}
        </div>

        <div className="pacing-tab__menu-wrap">
          <button
            type="button"
            className="pacing-tab__kebab"
            aria-label={`Actions for ${row.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
          >
            <MoreVerticalIcon />
          </button>
          {/* Positioned fixed, from the trigger's own rect: the row card clips its overflow, so an
              absolutely positioned panel would be cut off at the card's bottom edge. Same approach
              as the Dashboards tab's row menu. */}
          {menuOpen && (
            <div className="pacing-tab__menu" role="menu" style={menuAnchor ?? undefined}>
              <button type="button" role="menuitem" onClick={onRefresh} disabled={!isLive || inCooldown}>
                {inCooldown ? `Refresh data (${refreshCooldownSeconds}s)` : "Refresh data"}
              </button>
              {/* Said where the user is looking: a greyed-out item with no reason reads as broken. */}
              {!isLive && <p className="pacing-tab__menu-note">Only a Live pacing can be refreshed.</p>}
              {/* §13, US-136: a read-only check against NetSuite, not admin-gated - anyone who can see
                  this pacing may look for a drift, unlike Revalidate below which also writes back to
                  it. Kept in the same menu as Refresh (also not admin-only) rather than moved next to
                  the admin-only actions. */}
              <button type="button" role="menuitem" onClick={onOpenNsDiff}>
                NetSuite diff
              </button>
              {canRevalidate && (
                <button type="button" role="menuitem" onClick={onRevalidate}>
                  Revalidate from NS
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  role="menuitem"
                  className="pacing-tab__menu-danger"
                  onClick={onDelete}
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>

    </li>
  );
}

/**
 * US-113's "this pacing also covers …" notice, for the selected pacing. It sits with the dashboard
 * below the list rather than inside the row: every row is now the same height, and this names what
 * the panel underneath is showing. Each campaign is a link that opens the SAME pacing on that
 * campaign's own Pacing tab. Renders nothing when the pacing covers only this campaign.
 */
function AlsoCoversNotice({ row, currentCampaignId }: { row: PacingRowV1; currentCampaignId: number }) {
  const otherCampaigns = otherCampaignsOf(row, currentCampaignId);
  if (otherCampaigns.length === 0) return null;
  return (
    <p className="pacing-tab__notice">
      This pacing also covers{" "}
      {otherCampaigns.map((campaign, index) => {
        const campaignId = Number(campaign.id);
        const state: OpenPacingState = { openPacingId: row.id };
        return (
          <span key={campaign.id}>
            {index > 0 && ", "}
            {Number.isFinite(campaignId) ? (
              <Link to={`/campaigns/${campaignId}/pacing`} state={state}>
                {campaignDisplayName(campaign.name)}
              </Link>
            ) : (
              campaignDisplayName(campaign.name)
            )}
          </span>
        );
      })}
      .
    </p>
  );
}

/**
 * A campaign's Pacing tab (§5 of the migration plan, US-112/US-113): every pacing whose stored
 * campaign set contains this campaign, over the selected one's full dashboard (§6).
 *
 * The list and the dashboard are on screen together, the way the Reporting tab shows its report list
 * over the selected report (`reporting-tab.tsx`, the `selected` fallback and the panel it gates).
 * Switching pacings is one click and the list never leaves. Before, the row expanded to a summary,
 * "Open full dashboard" REPLACED the list with the dashboard, and getting to the next pacing meant
 * going back and doing both again.
 *
 * Arriving from the Overview with a pacing to open (`location.state.openPacingId`) selects and
 * scrolls to that one instead of the first.
 */
export function PacingTab() {
  const { campaign, agencyName, clientName } = useOutletContext<CampaignTabContext>();
  const location = useLocation();
  const navState = location.state as OpenPacingState | null;
  const openPacingId = navState?.openPacingId;
  const openJustCreated = navState?.justCreated === true;
  const pacingsQuery = useCampaignPacings(campaign.id);
  // What the user has picked, which is NOT the same as what is showing: until they pick anything this
  // stays null and the first row is shown (see `selectedRow` below). Reporting does the same.
  const [pickedId, setPickedId] = useState<string | null>(openPacingId ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  // The pacing just created - from this tab's own panel, or carried in by the Overview's Create
  // Pacing modal's navigation (`OpenPacingState.justCreated`). Its first refresh runs fire-and-forget
  // after create, so its dashboard can open before any data exists and should wait for that first
  // build instead of rendering empty.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(openJustCreated ? (openPacingId ?? null) : null);
  const highlightedRef = useRef<HTMLLIElement | null>(null);
  // Reuses the same ["auth", "me"] cache app-shell.tsx already populated - never a second fetch.
  // Deleting and re-validating are admin-only on the Hub (PacingAdminController#requireAdmin) and on
  // Pacing itself, so a non-admin is not shown those two items rather than being offered an action
  // that can only come back 403. Refreshing is not privileged and stays on every row.
  const currentUser = useCurrentUser(true);
  const isAdmin = isAdminUser(currentUser.data);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PacingRowV1 | null>(null);
  const [revalidateTarget, setRevalidateTarget] = useState<PacingRowV1 | null>(null);
  const [nsDiffTarget, setNsDiffTarget] = useState<PacingRowV1 | null>(null);
  // When each pacing's refresh cooldown runs out, by pacing id. `nowMs` ticks once a second while any
  // is running so the menu item counts DOWN rather than showing whatever second it was opened on.
  const [cooldownUntil, setCooldownUntil] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const toast = useToast();

  // A fresh navigation (Overview, its Create Pacing modal, or an "also covers" link from
  // another campaign's tab) always wins over whatever was selected before — including re-selecting the
  // SAME pacing after following a link back and forth between two campaigns it covers.
  useEffect(() => {
    if (openPacingId) {
      setPickedId(openPacingId);
      if (openJustCreated) setJustCreatedId(openPacingId);
    }
  }, [openPacingId, openJustCreated]);

  useEffect(() => {
    if (pickedId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [pickedId, pacingsQuery.data]);

  // An open row menu closes on an outside click, on Escape, and on any scroll or resize — it is
  // positioned fixed from the trigger's rect, so a scrolled page would leave it hanging over a row
  // it does not belong to.
  useEffect(() => {
    if (openMenuFor == null) return undefined;
    function closeMenu() {
      setOpenMenuFor(null);
      setMenuAnchor(null);
    }
    function onMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".pacing-tab__menu-wrap, .pacing-tab__menu")) closeMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [openMenuFor]);

  // Ticks only while a cooldown is actually running - an interval that never stops would re-render
  // this whole list once a second for as long as the tab is open.
  useEffect(() => {
    const anyRunning = Object.values(cooldownUntil).some((until) => until > Date.now());
    if (!anyRunning) return undefined;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil, nowMs]);

  function toggleRowMenu(event: ReactMouseEvent<HTMLButtonElement>, rowId: string) {
    // The trigger sits next to the row head, not inside it: without this the click would also toggle
    // the row open/closed underneath the menu.
    event.stopPropagation();
    if (openMenuFor === rowId) {
      setOpenMenuFor(null);
      setMenuAnchor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(16, rect.right - ROW_MENU_WIDTH);
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenMenuFor(rowId);
    setMenuAnchor(
      spaceBelow < ROW_MENU_MAX_HEIGHT && rect.top > spaceBelow
        ? { left, bottom: window.innerHeight - rect.top + 6 }
        : { left, top: rect.bottom + 6 }
    );
  }

  function closeMenu() {
    setOpenMenuFor(null);
    setMenuAnchor(null);
  }

  function askDelete(row: PacingRowV1) {
    closeMenu();
    setDeleteTarget(row);
  }

  function askRevalidate(row: PacingRowV1) {
    closeMenu();
    setRevalidateTarget(row);
  }

  function askNsDiff(row: PacingRowV1) {
    closeMenu();
    setNsDiffTarget(row);
  }

  /**
   * Triggers Pacing's own on-demand build for one row (US-119). Fire-and-forget upstream: a success
   * here means "queued", never "done", which is what the toast says. A refusal inside the two-minute
   * window is not an error to dwell on - it comes back as the remaining seconds, which go straight
   * into this row's countdown.
   */
  async function refreshRow(row: PacingRowV1) {
    closeMenu();
    try {
      const outcome = await triggerPacingRefresh(row.id);
      // One timestamp for both the deadline and the clock it is measured against, so the countdown
      // starts on the exact second asked for instead of a millisecond past it.
      const startedAt = Date.now();
      setNowMs(startedAt);
      if (outcome.status === "cooldown") {
        setCooldownUntil((current) => ({ ...current, [row.id]: startedAt + outcome.retryAfterSeconds * 1000 }));
        toast.showError(`"${row.name}" was refreshed moments ago — try again in ${outcome.retryAfterSeconds}s.`);
        return;
      }
      setCooldownUntil((current) => ({ ...current, [row.id]: startedAt + REFRESH_COOLDOWN_MS }));
      toast.showSuccess(`Refresh started for "${row.name}". New data lands in a few minutes.`);
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  /**
   * Seconds left on this row's refresh cooldown, or 0 when it may be refreshed now.
   */
  function cooldownSecondsFor(rowId: string): number {
    const until = cooldownUntil[rowId];
    if (until == null) return 0;
    return Math.max(0, Math.ceil((until - nowMs) / 1000));
  }

  const rows = pacingsQuery.data?.pacings ?? [];
  // The first row when nothing has been picked, and again whenever the pick no longer exists (it was
  // deleted, or the campaign's list changed under it) - so the panel below is never blank while there
  // are pacings to show. Reporting resolves its selection the same way (`reporting-tab.tsx`).
  //
  // The one case that must NOT fall back is a pick that is still on its way: creating a pacing picks
  // it and invalidates this list, and React Query serves the previous list until the refetch lands.
  // Falling back there would flash the first pacing's dashboard - and fetch its data - for the one
  // render before the new pacing appears.
  const picked = pickedId != null ? rows.find((row) => row.id === pickedId) : undefined;
  const awaitingPick = pickedId != null && picked === undefined && pacingsQuery.isFetching;
  const selectedRow = picked ?? (awaitingPick ? undefined : rows[0]);
  const selectedId = selectedRow?.id ?? null;

  /**
   * Picks a pacing, and drops the dashboard filters on the way.
   *
   * The filters live only in the query string, with no pacing in the key, and the dashboard below is
   * no longer torn down between pacings. Left alone, the channels, labels and line-item selection
   * chosen for one pacing would still be applied to the next - where they match nothing, so a
   * perfectly healthy pacing would open empty. `replace` so this does not add a history entry per
   * click.
   */
  function selectRow(rowId: string) {
    if (rowId === selectedId) return;
    setPickedId(rowId);
    const next = new URLSearchParams(searchParams);
    clearFilterParams(next);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }

  // §8 (Create Pacing): swaps the list for the review/create panel in place. Kept as it was - creating
  // is a one-off errand with its own two steps, not something the user flips between, and the list is
  // no use while filling the form in (owner, 2026-09-30).
  const [creating, setCreating] = useState(false);
  // `?.` on scope as well as on data. Optional chaining short-circuits the whole
  // chain only when the value it is attached to is nullish, so `data?.scope.can_create`
  // still throws when the response arrives without a scope — and an uncaught
  // TypeError in render unmounts the tree, which is why a 404 from this endpoint
  // showed up as a blank page rather than an error state.
  const canCreate = pacingsQuery.data?.scope?.can_create ?? false;

  if (creating) {
    return (
      <CreatePacingPanel
        campaignId={campaign.id}
        campaignName={campaignDisplayName(campaign.name)}
        agencyName={agencyName ?? campaign.agency_name ?? undefined}
        clientName={clientName ?? campaign.client_name ?? undefined}
        onClose={() => setCreating(false)}
        onCreated={(pacingId) => {
          setCreating(false);
          // Selects it, so the new pacing's dashboard is what the list drops the user back onto.
          setPickedId(pacingId);
          setJustCreatedId(pacingId);
        }}
      />
    );
  }

  return (
    <section className="pacing-tab">
      {/* Reporting's two-edge head, same shape and same values, because these two tabs sit one click
          apart and a list titled on one and untitled on the other reads as an oversight. The heading
          renders in EVERY state - loading, empty, error - while the button stays behind `canCreate`:
          the whole block used to hang on that permission, so a user who may not create a pacing got
          no heading either, and the blank half of the row was the thing being complained about.
          `h2` under the campaign's own `h1` in campaign-workspace.tsx. */}
      <div className="pacing-tab__head">
        <div>
          <h2 className="pacing-tab__title">Pacings</h2>
          {/* Only once the list is in. Rendering it earlier would print "0 pacings" and then correct
              itself; the row keeps its height through CSS, so nothing shifts when the count lands. */}
          <div className="pacing-tab__sub">
            {pacingsQuery.isSuccess && `${rows.length} pacing${rows.length === 1 ? "" : "s"}`}
          </div>
        </div>
        {pacingsQuery.isSuccess && canCreate && (
          <button type="button" className="button button--sm" onClick={() => setCreating(true)}>
            Create Pacing
          </button>
        )}
      </div>

      {pacingsQuery.isPending && <LoadingBlock label="Loading pacings" />}

      {pacingsQuery.isError && <p className="form-error">{formatError(pacingsQuery.error)}</p>}

      {pacingsQuery.isSuccess && rows.length === 0 && (
        <div className="pacing-tab__empty">
          <p className="pacing-tab__empty-title">No pacings yet</p>
          <p className="pacing-tab__empty-body">
            No pacing has been created for this campaign in Pacing yet.
            {canCreate && " Use “Create Pacing” above to onboard it."}
          </p>
        </div>
      )}

      {pacingsQuery.isSuccess && rows.length > 0 && (
        <ul className="pacing-tab__list">
          {rows.map((row) => (
            <PacingListItem
              key={row.id}
              row={row}
              currentCampaignId={campaign.id}
              selected={selectedId === row.id}
              onSelect={() => selectRow(row.id)}
              itemRef={selectedId === row.id ? highlightedRef : undefined}
              canDelete={isAdmin}
              canRevalidate={isAdmin && !ARCHIVED_STATUSES.has(row.status)}
              refreshCooldownSeconds={cooldownSecondsFor(row.id)}
              menuOpen={openMenuFor === row.id}
              menuAnchor={openMenuFor === row.id ? menuAnchor : null}
              onToggleMenu={(event) => toggleRowMenu(event, row.id)}
              onRefresh={() => refreshRow(row)}
              onRevalidate={() => askRevalidate(row)}
              onDelete={() => askDelete(row)}
              onOpenNsDiff={() => askNsDiff(row)}
            />
          ))}
        </ul>
      )}

      {/* §6's dashboard for the selected pacing, under the list rather than instead of it.
          `key` matters: the dashboard holds its own state (settings drawer, refresh cooldown, the
          first-data watch), and carrying one pacing's into the next is how a drawer stays open over
          somebody else's plan. Remounting per pacing also keeps its data hooks honest. */}
      {selectedRow && (
        <div className="pacing-tab__detail">
          <div className="pacing-tab__detail-sep" />
          <AlsoCoversNotice row={selectedRow} currentCampaignId={campaign.id} />
          {selectedRow.dashSlug ? (
            <PacingDashboard
              key={selectedRow.id}
              row={selectedRow}
              watchFirstData={selectedRow.id === justCreatedId}
            />
          ) : (
            // Pacing has not resolved this row's dash_slug yet (see PacingRowV1.dashSlug). Said here
            // rather than left blank: an empty panel under a selected row reads as a broken screen.
            <p className="pacing-tab__detail-empty">
              This pacing has no dashboard yet — its first data build has not produced one.
            </p>
          )}
        </div>
      )}

      <PacingNsDiffSheet row={nsDiffTarget} onClose={() => setNsDiffTarget(null)} />

      {deleteTarget && (
        <DeletePacingModal
          row={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          // A pacing is not owned by the campaign it is being deleted from - it can cover several,
          // and this delete removes it from all of them. Said here, where the click happens, because
          // the campaign tab is the one place the pacing looks like it belongs to one campaign.
          note={
            otherCampaignsOf(deleteTarget, campaign.id).length > 0
              ? `This pacing also covers ${otherCampaignsOf(deleteTarget, campaign.id)
                  .map((other) => campaignDisplayName(other.name))
                  .join(", ")} — deleting it removes it there too.`
              : undefined
          }
        />
      )}

      {revalidateTarget && (
        <RevalidatePacingModal row={revalidateTarget} onClose={() => setRevalidateTarget(null)} />
      )}
    </section>
  );
}
