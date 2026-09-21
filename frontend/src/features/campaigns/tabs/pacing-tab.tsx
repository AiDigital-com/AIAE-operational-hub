import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { campaignDisplayName } from "../../../shared/format/names";
import { cn } from "../../../shared/style/cn";
import { ChevronDownIcon, MoreVerticalIcon } from "../../../shared/ui/icons/icons";
import { LoadingBlock } from "../../../shared/ui/loading-spinner/loading-spinner";
import { useToast } from "../../../shared/ui/toast/toast";
import { MarginCell } from "../../../shared/ui/margin-cell/margin-cell";
import { StatusBadge } from "../../../shared/ui/status-badge/status-badge";
// Money/date string helpers, shared with the Pacing Overview (§4) so the same figures read
// identically on both screens.
import { fmtBudget, fmtDate } from "../../pacing/mock/format";
import { ALERT_SEVERITY_ORDER, PACE_STATUS_COLOR, PACE_STATUS_LABEL, PACING_STATUS_STYLE, groupAlertsBySeverity } from "../../pacing-overview/format";
import { OwnerPicker } from "../../pacing-overview/owner-picker";
import { netSuiteLeadMismatch } from "../../pacing-overview/format";
import { useCampaignPacings } from "../../pacing-overview/hooks";
import type { OpenPacingState } from "../../pacing-overview/navigation";
import { AlertsBlock } from "../../pacing-overview/alerts-block";
import type { PacingRowV1 } from "../../pacing-overview/types";
import { PacingDashboard } from "../../pacing-dashboard/pacing-dashboard";
import { triggerPacingRefresh } from "../../pacing-dashboard/api";
import { CreatePacingPanel } from "../../pacing-create/create-pacing-panel";
// The one delete confirmation in the product (typed-name friction and all), owned by the Pacing
// admin screen - this tab reuses it rather than growing a second, gentler way to delete a pacing.
import { DeletePacingModal } from "../../pacing-admin/pacing-admin-delete-modals";
import { RevalidatePacingModal } from "../../pacing-admin/pacing-admin-revalidate-modal";
import { isAdminUser, useCurrentUser } from "../../rbac/hooks";
import type { CampaignTabContext } from "../campaign-workspace";
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
 * One pacing on this campaign's tab. Collapsed, it reads like an Overview row; expanded ("shows its
 * detail in place", US-112) it adds flight/line-item detail, the full alert text, an "Open full
 * dashboard" action into §6's detail view, and — when this pacing covers more than one campaign
 * (US-113) — a notice naming the others, each a link that opens the SAME pacing on that campaign's own
 * Pacing tab.
 */
function PacingListItem({
  row,
  currentCampaignId,
  expanded,
  onToggle,
  onOpenDashboard,
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
}: {
  row: PacingRowV1;
  currentCampaignId: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenDashboard: () => void;
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
    <li className={cn("pacing-tab__item", expanded && "pacing-tab__item--open")} ref={itemRef}>
      <div className="pacing-tab__item-row">
        <button
          type="button"
          className="pacing-tab__item-head"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <ChevronDownIcon className={cn("pacing-tab__chevron", expanded && "pacing-tab__chevron--open")} />
          <span className="pacing-tab__item-name">
            {row.name}
            {otherCampaigns.length > 0 && (
              <span className="pacing-tab__item-multi">
                +{otherCampaigns.length} other campaign{otherCampaigns.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <StatusBadge label={row.status} color={statusStyle.color} glow={statusStyle.glow} />
          <span
              className="pacing-tab__item-owner"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              role="presentation"
            >
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
                  className={cn("pacing-overview__alert-badge", `pacing-overview__alert-badge--${severity}`)}
                >
                  {alertsBySeverity[severity].length}
                </span>
              ))}
            </span>
          ) : (
            <span className="pacing-tab__item-alerts pacing-tab__item-alerts--none" />
          )}
        </button>

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

      {expanded && (
        <div className="pacing-tab__item-body">
          <dl className="pacing-tab__detail-grid">
            <div className="pacing-tab__detail-cell">
              <dt>Flight</dt>
              <dd>
                {row.flightStart ? fmtDate(row.flightStart) : "—"} – {row.flightEnd ? fmtDate(row.flightEnd) : "—"}
              </dd>
            </div>
            <div className="pacing-tab__detail-cell">
              <dt>Line items</dt>
              <dd>{row.lineItemCount}</dd>
            </div>
            <div className="pacing-tab__detail-cell">
              <dt>Pace</dt>
              <dd>{PACE_STATUS_LABEL[paceStatus]}</dd>
            </div>
            <div className="pacing-tab__detail-cell">
              <dt>Margin target</dt>
              <dd>{row.marginTargetPct != null ? `${row.marginTargetPct}%` : "—"}</dd>
            </div>
          </dl>

          {/* §6 of the migration plan: the full health/financial/charts/widget-library view. Only
              reachable when Pacing has resolved this row's dash_slug (see PacingRowV1.dashSlug's own
              doc comment on when that can be absent). */}
          {row.dashSlug && (
            <button type="button" className="button button--sm pacing-tab__open-dashboard" onClick={onOpenDashboard}>
              Open full dashboard
            </button>
          )}

          <AlertsBlock alerts={alerts} />

          {otherCampaigns.length > 0 && (
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
          )}
        </div>
      )}
    </li>
  );
}

/**
 * A campaign's Pacing tab (§5 of the migration plan, US-112/US-113): every pacing whose stored
 * campaign set contains this campaign. Opening one expands it in place; arriving from the Overview
 * with a specific pacing to open (`location.state.openPacingId`, set by US-113's navigation) expands
 * and scrolls to that one automatically.
 */
export function PacingTab() {
  const { campaign, agencyName, clientName } = useOutletContext<CampaignTabContext>();
  const location = useLocation();
  const openPacingId = (location.state as OpenPacingState | null)?.openPacingId;
  const pacingsQuery = useCampaignPacings(campaign.id);
  const [expandedId, setExpandedId] = useState<string | null>(openPacingId ?? null);
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
  // When each pacing's refresh cooldown runs out, by pacing id. `nowMs` ticks once a second while any
  // is running so the menu item counts DOWN rather than showing whatever second it was opened on.
  const [cooldownUntil, setCooldownUntil] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const toast = useToast();

  // A fresh navigation (Overview, or an "also covers" link from another campaign's tab) always wins
  // over whatever was expanded before — including re-opening the SAME pacing after following a link
  // back and forth between two campaigns it covers.
  useEffect(() => {
    if (openPacingId) setExpandedId(openPacingId);
  }, [openPacingId]);

  useEffect(() => {
    if (expandedId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [expandedId, pacingsQuery.data]);

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
  const [openDashboardId, setOpenDashboardId] = useState<string | null>(null);
  const openDashboardRow = rows.find((row) => row.id === openDashboardId);
  // §8 (Create Pacing): swaps the list for the review/create panel in place, same pattern as
  // openDashboardRow above - "Back to pacings" returns to exactly the list the user left.
  const [creating, setCreating] = useState(false);
  // The pacing just created from this tab, if any. Its first refresh runs fire-and-forget after
  // create, so its dashboard can open before any data exists and should wait for that first build.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  // `?.` on scope as well as on data. Optional chaining short-circuits the whole
  // chain only when the value it is attached to is nullish, so `data?.scope.can_create`
  // still throws when the response arrives without a scope — and an uncaught
  // TypeError in render unmounts the tree, which is why a 404 from this endpoint
  // showed up as a blank page rather than an error state.
  const canCreate = pacingsQuery.data?.scope?.can_create ?? false;

  // §6: opening a full dashboard replaces this tab's list in place (no route change) - "Back to
  // pacings" returns to exactly the list/expansion state the user left, since it's all still here.
  if (openDashboardRow) {
    return (
      <PacingDashboard
        row={openDashboardRow}
        watchFirstData={openDashboardRow.id === justCreatedId}
        onBack={() => setOpenDashboardId(null)}
      />
    );
  }

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
          setExpandedId(pacingId);
          setJustCreatedId(pacingId);
        }}
      />
    );
  }

  return (
    <section className="pacing-tab">
      {pacingsQuery.isSuccess && canCreate && (
        <div className="pacing-tab__actions">
          <button type="button" className="button button--sm" onClick={() => setCreating(true)}>
            Create Pacing
          </button>
        </div>
      )}

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
              expanded={expandedId === row.id}
              onToggle={() => setExpandedId((current) => (current === row.id ? null : row.id))}
              onOpenDashboard={() => setOpenDashboardId(row.id)}
              itemRef={expandedId === row.id ? highlightedRef : undefined}
              canDelete={isAdmin}
              canRevalidate={isAdmin && !ARCHIVED_STATUSES.has(row.status)}
              refreshCooldownSeconds={cooldownSecondsFor(row.id)}
              menuOpen={openMenuFor === row.id}
              menuAnchor={openMenuFor === row.id ? menuAnchor : null}
              onToggleMenu={(event) => toggleRowMenu(event, row.id)}
              onRefresh={() => refreshRow(row)}
              onRevalidate={() => askRevalidate(row)}
              onDelete={() => askDelete(row)}
            />
          ))}
        </ul>
      )}

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
