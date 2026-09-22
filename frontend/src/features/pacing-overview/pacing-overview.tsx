import { memo, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { SearchIcon, SortIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import { MarginCell } from "../../shared/ui/margin-cell/margin-cell";
import { StatusBadge } from "../../shared/ui/status-badge/status-badge";
import { Tooltip } from "../../shared/ui/tooltip/tooltip";
// Formatting only (money/date string helpers), ported verbatim from Pacing's own retired front end so
// numbers read identically across both Overview screens. Not the mock overlay itself — this screen's
// data is the real Pacing service response, never mocked.
import { fmtBudget, fmtDate } from "../pacing/mock/format";
import {
  ALERT_SEVERITY_ORDER,
  PACE_STATUS_COLOR,
  PACE_STATUS_LABEL,
  PACING_STATUS_STYLE,
  groupAlertsBySeverity,
  netSuiteLeadMismatch,
  nsDiffBreakdownLines,
  totalNsDiffCount,
} from "./format";
import { usePacingOverview } from "./hooks";
import { OwnerPicker } from "./owner-picker";
import { pacingRoute } from "./navigation";
import type { PacingRowV1, PacingScopeV1 } from "./types";
import "./pacing-overview.css";

const ALL = "all";
const SEARCH_DEBOUNCE_MS = 300;

type SortField = "NAME" | "STATUS" | "OWNER" | "MARGIN" | "PACING" | "BUDGET" | "FLIGHT" | "LINE_ITEMS" | "NS_DIFF";

interface SortState {
  field: SortField;
  direction: "ASC" | "DESC";
}

/** Matches the search box against everything a person would plausibly name a pacing by: its own
 *  name, its owner, and any campaign it belongs to — not just the primary one. */
function matchesSearch(row: PacingRowV1, term: string): boolean {
  if (!term) return true;
  if (row.name.toLowerCase().includes(term)) return true;
  if ((row.ownerName ?? "").toLowerCase().includes(term)) return true;
  return (row.campaigns ?? []).some((campaign) => campaign.name.toLowerCase().includes(term));
}

function compareRows(a: PacingRowV1, b: PacingRowV1, sort: SortState): number {
  const dir = sort.direction === "ASC" ? 1 : -1;
  switch (sort.field) {
    case "NAME":
      return dir * a.name.localeCompare(b.name);
    case "STATUS":
      return dir * a.status.localeCompare(b.status);
    case "OWNER":
      return dir * (a.ownerName ?? "").localeCompare(b.ownerName ?? "");
    case "MARGIN":
      return dir * ((a.marginActualPct ?? -Infinity) - (b.marginActualPct ?? -Infinity));
    case "PACING":
      return dir * ((a.pacingDeviationPct ?? -Infinity) - (b.pacingDeviationPct ?? -Infinity));
    case "BUDGET":
      return dir * ((a.budgetTotal ?? 0) - (b.budgetTotal ?? 0));
    case "FLIGHT":
      return dir * (a.flightStart ?? "").localeCompare(b.flightStart ?? "");
    case "LINE_ITEMS":
      return dir * (a.lineItemCount - b.lineItemCount);
    case "NS_DIFF": {
      // A pacing never checked (no nsDiffSummary) sorts lowest, same convention as MARGIN/PACING
      // above - it should never out-rank one confirmed in sync (0 differences).
      const av = a.nsDiffSummary ? totalNsDiffCount(a.nsDiffSummary) : -Infinity;
      const bv = b.nsDiffSummary ? totalNsDiffCount(b.nsDiffSummary) : -Infinity;
      return dir * (av - bv);
    }
    default:
      return 0;
  }
}

/**
 * Why the list is empty, resolved from the scope the Hub asserted rather than guessed from the
 * absence of rows (US-111). A `campaigns` scope with no ids is the expected shape for a Client
 * Services user today — the Hub does not yet resolve which NetSuite campaigns they own — so that
 * case reads as "not wired up yet", not as a broken page.
 */
function emptyScopeCopy(scope: PacingScopeV1 | undefined): { title: string; body: string } {
  if (!scope) {
    return { title: "No pacings", body: "There are no pacings visible to your account yet." };
  }
  if (scope.kind === "campaigns") {
    if (scope.ids.length === 0) {
      return {
        title: "Campaign ownership isn't resolved yet",
        body: "The Hub doesn't yet resolve which NetSuite campaigns you own, so there is nothing to show here — this isn't a bug. Ask an admin if you expect to see campaigns.",
      };
    }
    return {
      title: "No pacings for your campaigns",
      body: "None of the campaigns assigned to you have a pacing set up in Pacing yet.",
    };
  }
  if (scope.kind === "owners") {
    if (scope.ids.length === 0) {
      return {
        title: "Nobody in scope yet",
        body: "You have no pacings of your own, and no direct or indirect reports with any either.",
      };
    }
    return {
      title: "No pacings yet",
      body: "No pacing has been created for you or your team yet.",
    };
  }
  return { title: "No pacings yet", body: "There are no pacings in Pacing yet." };
}

/**
 * Who owns this pacing, and where NetSuite disagrees (§11, US-132).
 *
 * Shows both names side by side rather than resolving them. Pacing's owner is the one that drives
 * access and grouping; NetSuite's is shown so a reader can decide which of the two is out of date —
 * that judgement is theirs, and neither system is authoritative about the other.
 *
 * Worded as "NetSuite: <name>", never as an error. The two are matched by NAME, a convention people
 * maintain by hand, so a flag here can mean a genuine reassignment OR a spelling that drifted apart
 * (a diacritic, a married name changed in one system only). Calling that "wrong owner" would be a
 * claim this screen cannot support.
 */
function OwnerCell({
  pacingId,
  ownerName,
  campaigns,
}: {
  pacingId: string;
  ownerName: string | null;
  campaigns: PacingRowV1["campaigns"] | null;
}) {
  const netSuiteLead = netSuiteLeadMismatch(ownerName, campaigns);
  return (
    // Stops the click from opening the pacing: the whole row is a link target, and reassigning is
    // not navigating.
    <span
      className="pacing-overview__owner"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      {/* Titles kept even though nothing clips now: the column takes the width it needs, but a
          screen reader still benefits from the NetSuite line saying what the flag actually means. */}
      <span className="pacing-overview__owner-name" title={ownerName ?? undefined}>
        {ownerName ?? "—"}
      </span>
      {netSuiteLead && (
        <span
          className="pacing-overview__owner-ns"
          title={`NetSuite records ${netSuiteLead} as running this campaign. Pacing's owner still decides who can see it — one of the two is out of date.`}
        >
          NetSuite: {netSuiteLead}
        </span>
      )}
      <OwnerPicker pacingId={pacingId} currentOwnerName={ownerName} />
    </span>
  );
}

function SortableHeader({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string;
  field: SortField;
  sort: SortState | null;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const direction = sort?.field === field ? sort.direction : null;
  return (
    <th
      className={className}
      aria-sort={direction === "ASC" ? "ascending" : direction === "DESC" ? "descending" : "none"}
    >
      <button
        type="button"
        className={cn("pacing-overview__sort", direction && "pacing-overview__sort--active")}
        onClick={() => onSort(field)}
      >
        <span className="pacing-overview__sort-label">{label}</span>
        <SortIcon active={direction === "ASC" ? "asc" : direction === "DESC" ? "desc" : undefined} />
      </button>
    </th>
  );
}

/**
 * One pacing row. Memoized so re-sorting/re-filtering only reconciles rows whose own data actually
 * changed identity, not the whole table. Clicking a row opens it (US-113): navigates to the first
 * campaign in its own list with the Pacing tab open — a row with no resolvable campaign (an
 * unresolved/pre-§3 pacing) stays inert rather than routing anywhere.
 */
const PacingTableRow = memo(function PacingTableRow({ row, onOpen }: { row: PacingRowV1; onOpen: (row: PacingRowV1) => void }) {
  const statusStyle = PACING_STATUS_STYLE[row.status] ?? { color: "var(--muted)" };
  const campaigns = row.campaigns ?? [];
  const primaryCampaign = campaigns[0];
  const otherCampaigns = campaigns.slice(1);
  const alerts = row.alerts;
  const alertsBySeverity = groupAlertsBySeverity(alerts);
  const paceStatus = row.paceStatus ?? "no_data";
  const canOpen = pacingRoute(row) !== null;

  return (
    <tr
      className={cn("pacing-overview__row", canOpen && "pacing-overview__row--open")}
      onClick={canOpen ? () => onOpen(row) : undefined}
    >
      <td>
        <div className="pacing-overview__name">{row.name}</div>
        {primaryCampaign ? (
          <div className="pacing-overview__campaign">
            <span>{primaryCampaign.name}</span>
            {/* US-107: the row names the first campaign plus a count of the rest, not every name at
                once — the full list is one hover away rather than crowding the cell. */}
            {otherCampaigns.length > 0 && (
              <Tooltip content={otherCampaigns.map((campaign) => campaign.name).join(", ")}>
                <span className="pacing-overview__campaign-more">+{otherCampaigns.length} more</span>
              </Tooltip>
            )}
          </div>
        ) : (
          <div className="pacing-overview__campaign pacing-overview__campaign--none">No campaign linked</div>
        )}
      </td>
      <td>
        <StatusBadge label={row.status} color={statusStyle.color} glow={statusStyle.glow} />
      </td>
      <td>
        <OwnerCell pacingId={row.id} ownerName={row.ownerName ?? null} campaigns={row.campaigns ?? null} />
      </td>
      <td className="pacing-overview__num">
        <MarginCell actual={row.marginActualPct ?? null} target={row.marginTargetPct ?? 0} />
      </td>
      <td className="pacing-overview__num">
        {row.pacingDeviationPct == null ? (
          <span className="pacing-overview__pace pacing-overview__pace--na">—</span>
        ) : (
          <span className="pacing-overview__pace" style={{ color: PACE_STATUS_COLOR[paceStatus] }}>
            {row.pacingDeviationPct > 0 ? "+" : ""}
            {row.pacingDeviationPct.toFixed(1)}pp
            <span className="pacing-overview__pace-label">{PACE_STATUS_LABEL[paceStatus]}</span>
          </span>
        )}
      </td>
      <td className="pacing-overview__num">{fmtBudget(row.budgetTotal ?? 0)}</td>
      <td className="pacing-overview__flight">
        {row.flightStart ? fmtDate(row.flightStart) : "—"}
        <span className="pacing-overview__flight-sep">–</span>
        {row.flightEnd ? fmtDate(row.flightEnd) : "—"}
      </td>
      <td className="pacing-overview__num">{row.lineItemCount}</td>
      <td className="pacing-overview__num">
        {row.nsDiffSummary == null ? (
          <span className="pacing-overview__no-alerts" title="Not yet checked against NetSuite">
            —
          </span>
        ) : row.nsDiffSummary.inSync ? (
          <span
            className="pacing-overview__ns-diff-ok"
            title={`Checked on ${fmtDate(row.nsDiffSummary.computedAt)} — in sync with NetSuite as of that check.`}
          >
            In sync
          </span>
        ) : (
          <Tooltip
            content={[...nsDiffBreakdownLines(row.nsDiffSummary), `checked on ${fmtDate(row.nsDiffSummary.computedAt)}`].join(
              " · "
            )}
          >
            <span className="pacing-overview__ns-diff-badge">{totalNsDiffCount(row.nsDiffSummary)}</span>
          </Tooltip>
        )}
      </td>
      <td>
        {alerts.length === 0 ? (
          <span className="pacing-overview__no-alerts">—</span>
        ) : (
          <div className="pacing-overview__alerts">
            {ALERT_SEVERITY_ORDER.filter((severity) => alertsBySeverity[severity]?.length).map((severity) => (
              <Tooltip key={severity} content={alertsBySeverity[severity].map((alert) => alert.text).join(" · ")}>
                <span className={cn("pacing-overview__alert-badge", `pacing-overview__alert-badge--${severity}`)}>
                  {alertsBySeverity[severity].length}
                </span>
              </Tooltip>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
});

/**
 * The Pacing Overview (§4 of the migration plan, US-109/110/111): every pacing the signed-in user is
 * entitled to see, in one request, with the figures needed to triage — status, owner, margin,
 * pacing deviation, budget, flight and line-item count — plus alert badges from Pacing's own alert
 * detectors. Filters, search and sort all run against the already-loaded set; nothing here re-fetches
 * per interaction. Grouping by assignee is deferred to §11.
 */
export function PacingOverview() {
  const navigate = useNavigate();
  const overview = usePacingOverview();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS).trim().toLowerCase();
  const [status, setStatus] = useState<string>(ALL);
  const [campaignId, setCampaignId] = useState<string>(ALL);
  const [sort, setSort] = useState<SortState | null>(null);

  const rows = useMemo(() => overview.data?.pacings ?? [], [overview.data]);
  const scope = overview.data?.scope;

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.status))).sort(),
    [rows]
  );

  const campaignOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      for (const campaign of row.campaigns ?? []) {
        if (!byId.has(campaign.id)) byId.set(campaign.id, campaign.name);
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filteredRows = useMemo(() => {
    let next = rows;
    // §9, US-128: an archived pacing drops out of the default view but stays findable - picking
    // "Archive" explicitly (or any other single status) still shows it; only the unfiltered "All
    // statuses" view hides it, the same way a "done" item recedes from a default task list.
    if (status === ALL) next = next.filter((row) => row.status !== "Archive");
    else next = next.filter((row) => row.status === status);
    if (campaignId !== ALL) next = next.filter((row) => (row.campaigns ?? []).some((c) => c.id === campaignId));
    if (search) next = next.filter((row) => matchesSearch(row, search));
    if (sort) next = [...next].sort((a, b) => compareRows(a, b, sort));
    return next;
  }, [rows, status, campaignId, search, sort]);

  function cycleSort(field: SortField) {
    setSort((current) => {
      if (current?.field !== field) return { field, direction: "ASC" };
      return current.direction === "ASC" ? { field, direction: "DESC" } : null;
    });
  }

  function clearFilters() {
    setSearchInput("");
    setStatus(ALL);
    setCampaignId(ALL);
  }

  const hasActiveFilters = status !== ALL || campaignId !== ALL || Boolean(search);

  const openPacing = useCallback(
    (row: PacingRowV1) => {
      const target = pacingRoute(row);
      if (target) navigate(target.path, { state: target.state });
    },
    [navigate]
  );

  return (
    <section className="pacing-overview">
      <div className="pacing-overview__head">
        <h1 className="pacing-overview__title">Pacing</h1>
      </div>

      {overview.isPending && <LoadingBlock label="Loading pacings" />}

      {overview.isError && (
        <p className="form-error">
          {overview.error instanceof ApiError && overview.error.status === 409
            ? "Your account isn't synced to Pacing yet. This usually clears up after the next user sync — ask an admin if it persists."
            : formatError(overview.error)}
        </p>
      )}

      {overview.isSuccess && (
        <>
          <div className="pacing-overview__filters">
            <label className="pacing-overview__search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search pacing, owner, campaign…"
                aria-label="Search pacings"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <span className="select pacing-overview__fsel">
              <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value={ALL}>All statuses</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </span>
            <span className="select pacing-overview__fsel">
              <select
                aria-label="Filter by campaign"
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                disabled={campaignOptions.length === 0}
              >
                <option value={ALL}>All campaigns</option>
                {campaignOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </span>
          </div>

          {rows.length === 0 && (
            <div className="pacing-overview__empty">
              {(() => {
                const { title, body } = emptyScopeCopy(scope);
                return (
                  <>
                    <p className="pacing-overview__empty-title">{title}</p>
                    <p className="pacing-overview__empty-body">{body}</p>
                  </>
                );
              })()}
            </div>
          )}

          {rows.length > 0 && filteredRows.length === 0 && (
            <div className="pacing-overview__empty">
              <p className="pacing-overview__empty-title">No pacings match your filters</p>
              <p className="pacing-overview__empty-body">
                {rows.length} pacing{rows.length === 1 ? "" : "s"} loaded, but none match{" "}
                {hasActiveFilters ? "the current search and filters" : "the current view"}.
              </p>
              {hasActiveFilters && (
                <button type="button" className="button button--ghost button--sm" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {filteredRows.length > 0 && (
            <div className="pacing-overview__table-wrap">
              <table className="pacing-overview__table">
                <thead>
                  <tr>
                    <SortableHeader label="Campaign" field="NAME" sort={sort} onSort={cycleSort} />
                    <SortableHeader label="Status" field="STATUS" sort={sort} onSort={cycleSort} />
                    <SortableHeader label="Owner" field="OWNER" sort={sort} onSort={cycleSort} />
                    <SortableHeader
                      label="Margin"
                      field="MARGIN"
                      sort={sort}
                      onSort={cycleSort}
                      className="pacing-overview__num"
                    />
                    <SortableHeader
                      label="Pacing"
                      field="PACING"
                      sort={sort}
                      onSort={cycleSort}
                      className="pacing-overview__num"
                    />
                    <SortableHeader
                      label="Budget"
                      field="BUDGET"
                      sort={sort}
                      onSort={cycleSort}
                      className="pacing-overview__num"
                    />
                    <SortableHeader label="Flight" field="FLIGHT" sort={sort} onSort={cycleSort} />
                    <SortableHeader
                      label="Line items"
                      field="LINE_ITEMS"
                      sort={sort}
                      onSort={cycleSort}
                      className="pacing-overview__num"
                    />
                    <SortableHeader
                      label="NS diff"
                      field="NS_DIFF"
                      sort={sort}
                      onSort={cycleSort}
                      className="pacing-overview__num"
                    />
                    <th>Alerts</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <PacingTableRow key={row.id} row={row} onOpen={openPacing} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
