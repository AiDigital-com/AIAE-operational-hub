import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { campaignDisplayName } from "../../../shared/format/names";
import { cn } from "../../../shared/style/cn";
import { ChevronDownIcon } from "../../../shared/ui/icons/icons";
import { LoadingBlock } from "../../../shared/ui/loading-spinner/loading-spinner";
import { MarginCell } from "../../../shared/ui/margin-cell/margin-cell";
import { StatusBadge } from "../../../shared/ui/status-badge/status-badge";
// Money/date string helpers, shared with the Pacing Overview (§4) so the same figures read
// identically on both screens.
import { fmtBudget, fmtDate } from "../../pacing/mock/format";
import { ALERT_SEVERITY_ORDER, PACE_STATUS_COLOR, PACE_STATUS_LABEL, PACING_STATUS_STYLE, groupAlertsBySeverity } from "../../pacing-overview/format";
import { useCampaignPacings } from "../../pacing-overview/hooks";
import type { OpenPacingState } from "../../pacing-overview/navigation";
import { AlertsBlock } from "../../pacing-overview/alerts-block";
import type { PacingRowV1 } from "../../pacing-overview/types";
import { PacingDashboard } from "../../pacing-dashboard/pacing-dashboard";
import { CreatePacingPanel } from "../../pacing-create/create-pacing-panel";
import type { CampaignTabContext } from "../campaign-workspace";
import "./pacing-tab.css";

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
}: {
  row: PacingRowV1;
  currentCampaignId: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenDashboard: () => void;
  itemRef?: React.Ref<HTMLLIElement>;
}) {
  const statusStyle = PACING_STATUS_STYLE[row.status] ?? { color: "var(--muted)" };
  const paceStatus = row.paceStatus ?? "no_data";
  const alerts = row.alerts;
  const alertsBySeverity = groupAlertsBySeverity(alerts);
  // "Also covers" is every campaign on this pacing OTHER than the one whose tab we're already on —
  // not "everything after the first": the pacing can list this campaign in any position.
  const otherCampaigns = (row.campaigns ?? []).filter((campaign) => Number(campaign.id) !== currentCampaignId);

  return (
    <li className={cn("pacing-tab__item", expanded && "pacing-tab__item--open")} ref={itemRef}>
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
        <span className="pacing-tab__item-owner">{row.ownerName ?? "—"}</span>
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

  const rows = pacingsQuery.data?.pacings ?? [];
  const [openDashboardId, setOpenDashboardId] = useState<string | null>(null);
  const openDashboardRow = rows.find((row) => row.id === openDashboardId);
  // §8 (Create Pacing): swaps the list for the review/create panel in place, same pattern as
  // openDashboardRow above - "Back to pacings" returns to exactly the list the user left.
  const [creating, setCreating] = useState(false);
  // The pacing just created from this tab, if any. Its first refresh runs fire-and-forget after
  // create, so its dashboard can open before any data exists and should wait for that first build.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const canCreate = pacingsQuery.data?.scope.can_create ?? false;

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
            />
          ))}
        </ul>
      )}
    </section>
  );
}
