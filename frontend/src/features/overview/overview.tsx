import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAgencyList, useAgencySearch } from "../agencies/hooks";
import { useCampaignSetup } from "../campaigns/hooks";
import type { CampaignSearchRequestV1, CampaignV1 } from "../campaigns/types";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { BranchIcon, ChevronRightIcon, SearchIcon, SortIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock, LoadingOverlay, LoadingSpinner } from "../../shared/ui/loading-spinner/loading-spinner";
import { MultiSelect, type MultiSelectOption } from "../../shared/ui/multi-select/multi-select";
import {
  CAMPAIGN_STATUS_SEGMENTS,
  StatusBadge,
  displayStatusLabel,
  resolveStatusStyle,
} from "../../shared/ui/status-badge/status-badge";
import { useCurrentUser } from "../rbac/hooks";
import { fmtBudget, fmtDate } from "../pacing/mock/format";
import { useOverviewPacing } from "../pacing/mock/hooks";
import type { LineItem, OwnerCampaign } from "../pacing/mock/types";
import "./overview.css";

const SEARCH_DEBOUNCE_MS = 300;
const ALL = "all";

/**
 * Reads the agency filter out of the URL, keeping only what could be an agency id.
 *
 * Validated rather than trusted: the query string is user-editable, and a non-numeric id would travel to
 * the backend as a filter value that matches nothing while looking like a filter that does.
 *
 * @param raw the comma-separated ids from the query string
 * @returns the ids, or an empty list when there are none to read
 */
function parseAgencyIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

/**
 * Reads the sort out of the URL, accepting only a column this table actually offers.
 *
 * @param raw the `FIELD:DIRECTION` pair from the query string
 * @returns the sort, or null for the default flight-phase order
 */
function parseSort(raw: string | null): OverviewSort | null {
  const [field, direction] = (raw ?? "").split(":");
  const fields: OverviewSortField[] = ["NAME", "STATUS", "START_DATE"];
  if (!fields.includes(field as OverviewSortField)) return null;
  return { field: field as OverviewSortField, direction: direction === "DESC" ? "DESC" : "ASC" };
}

/** Where the last filter set is kept, so returning to the Overview by any route restores it. */
const REMEMBERED_FILTERS_KEY = "overview-filters";

/** The query-string keys the Overview owns, so a URL carrying none of them can be told from a filtered one. */
const FILTER_PARAM_KEYS = ["q", "status", "agency", "sort"] as const;

/**
 * The filters to open with: whatever the URL asks for, or the last set this session remembered.
 *
 * The URL wins when it carries any filter of its own - it is what a shared link and the browser's back
 * button both express, and honouring it is the difference between opening the view someone sent you and
 * opening your own. A URL with none of them is not a request for an unfiltered Overview, though: it is what
 * the sidebar's "Overview" link and the logo produce, and following those out of a filtered view is how the
 * filters were being lost (PDI_097).
 *
 * Remembered per session and per user, not forever: a filter that outlives the tab greets the next visit
 * with campaigns silently missing and no clue why, and one that outlives the *account* does it to whoever
 * signs in next at that desk.
 *
 * @param params  the current query string
 * @param userId  the signed-in Clerk user id, or undefined before the profile is in cache
 * @returns the query string to read the initial filters from
 */
function initialFilterParams(params: URLSearchParams, userId: string | undefined): URLSearchParams {
  if (FILTER_PARAM_KEYS.some((key) => params.get(key))) {
    return params;
  }
  try {
    const stored = sessionStorage.getItem(REMEMBERED_FILTERS_KEY);
    if (!stored) return params;
    const { user, filters } = JSON.parse(stored) as { user?: string; filters?: string };
    if (!filters || user !== userId) return params;
    return new URLSearchParams(filters);
  } catch {
    // A blocked or corrupt store is not a reason to open a broken page; opening unfiltered is fine.
    return params;
  }
}

/**
 * Records the filter set so the next visit can restore it.
 *
 * @param filters the serialised filters, in the same shape the URL carries them
 * @param userId  the signed-in Clerk user id, or undefined before the profile is in cache
 */
function rememberFilters(filters: URLSearchParams, userId: string | undefined): void {
  try {
    sessionStorage.setItem(REMEMBERED_FILTERS_KEY, JSON.stringify({ user: userId, filters: filters.toString() }));
  } catch {
    // Private-mode or quota failures cost the convenience, not the page.
  }
}

/** The columns of the campaign table that can be ordered by, named as the sort contract names them. */
type OverviewSortField = "NAME" | "STATUS" | "START_DATE";

interface OverviewSort {
  field: OverviewSortField;
  direction: "ASC" | "DESC";
}

/**
 * A column header that orders the table by its own column.
 *
 * Three states, not two: ascending, descending, and off. Off matters more than it looks - it is how a user
 * gets back to the default order (live, then upcoming, then finished) without reloading the page, and that
 * order is the one worth returning to.
 */
function SortableHeader({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string;
  field: OverviewSortField;
  sort: OverviewSort | null;
  onSort: (field: OverviewSortField) => void;
  className?: string;
}) {
  const direction = sort?.field === field ? sort.direction : null;
  return (
    <th className={className} aria-sort={direction === "ASC" ? "ascending" : direction === "DESC" ? "descending" : "none"}>
      <button type="button" className={cn("overview__sort", direction && "overview__sort--active")} onClick={() => onSort(field)}>
        <span className="overview__sort-label">
          {label}
        </span>
        <SortIcon active={direction === "ASC" ? "asc" : direction === "DESC" ? "desc" : undefined} />
      </button>
    </th>
  );
}

/**
 * Builds the server-side search request from the Overview's controls: search, status, and agency all
 * move the filtering into BigQuery (see 01-MIGRATION-PLAN.md O1). Status filters on the exact real
 * NetSuite status string (EQUALS, case-insensitive) - a CONTAINS match on the segment's own label
 * (e.g. "complete") would never match the real value ("Finished").
 *
 * The search box uses SEARCH rather than NAME: it matches the campaign, client or agency name, since
 * people looking for a campaign here name it by whichever of the three they deal with (PDI_085).
 */
function buildOverviewSearchBody(
  search: string,
  statusKey: string,
  agencyIds: number[],
  sort: OverviewSort | null
): CampaignSearchRequestV1 {
  const statusValue = CAMPAIGN_STATUS_SEGMENTS.find((segment) => segment.key === statusKey)?.value ?? "";
  const filters = [
    ...(search
      ? [{ field: "SEARCH" as const, value: search, operation: "CONTAINS" as const, caseSensitive: false }]
      : []),
    ...(statusValue
      ? [{ field: "STATUS" as const, value: statusValue, operation: "EQUALS" as const, caseSensitive: false }]
      : []),
    // One filter per selected agency: the backend ORs repeated AGENCY_ID filters into a single IN
    // (see CampaignSearchRequestV1's description), intersected with the caller's own visibility.
    ...agencyIds.map((agencyId) => ({
      field: "AGENCY_ID" as const,
      value: String(agencyId),
      operation: "EQUALS" as const,
      caseSensitive: false,
    })),
  ];
  // No sorting field at all when the user has not chosen one, rather than a name sort: the server reads
  // its absence as "order by what is happening to each campaign" - live, then upcoming, then finished.
  return sort ? { filters, sorting: sort } : { filters };
}

/**
 * The operational pacing overview at `/`: a rollup summary and every accessible campaign. Entities are
 * real and RBAC-scoped; pacing is mocked on top of them (see 01-MIGRATION-PLAN.md O1).
 *
 * Campaigns load paginated (infinite scroll, like the Reporting tab) with search/status/agency filters
 * applied server-side via the same `searchCampaigns` the Campaigns page uses - never "all at once".
 */
export function Overview() {
  const navigate = useNavigate();

  // Filters live in the URL so a filtered view can be sent to someone and restored by the back button, and
  // in session storage so returning by any other route restores them too - the sidebar's "Overview" link
  // and the logo both navigate to a bare "/", which is how the filters were being lost (PDI_097).
  const [params, setParams] = useSearchParams();
  // Read from the cache the app shell has already filled; `false` keeps this from being a second request
  // for the profile, and leaves the value undefined where nothing has loaded one.
  const rememberedFor = useCurrentUser(false).data?.user_id;
  // Read once, on mount: after that the state below is the truth and the URL is written from it.
  const [initialParams] = useState(() => initialFilterParams(params, rememberedFor));
  const [searchInput, setSearchInput] = useState(() => initialParams.get("q") ?? "");
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [status, setStatus] = useState<string>(() => initialParams.get("status") ?? ALL);
  const [agencyIds, setAgencyIds] = useState<number[]>(() => parseAgencyIds(initialParams.get("agency")));
  const [sort, setSort] = useState<OverviewSort | null>(() => parseSort(initialParams.get("sort")));
  const [expandAll, setExpandAll] = useState(false);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());

  // Written from the debounced search rather than the raw input: a history entry per keystroke would make
  // the back button walk letter by letter out of a search nobody typed on purpose. `replace` for the same
  // reason - changing a filter is not a place you navigated to, but leaving the page has to remember it.
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status !== ALL) next.set("status", status);
    if (agencyIds.length > 0) next.set("agency", agencyIds.join(","));
    if (sort) next.set("sort", `${sort.field}:${sort.direction}`);
    setParams(next, { replace: true });
    rememberFilters(next, rememberedFor);
  }, [search, status, agencyIds, sort, setParams, rememberedFor]);

  // Ascending, then descending, then back to the default order.
  const cycleSort = useCallback((field: OverviewSortField) => {
    setSort((current) => {
      if (current?.field !== field) return { field, direction: "ASC" };
      return current.direction === "ASC" ? { field, direction: "DESC" } : null;
    });
  }, []);

  const searchBody = useMemo(
    () => buildOverviewSearchBody(search, status, agencyIds, sort),
    [search, status, agencyIds, sort]
  );
  const overview = useOverviewPacing(searchBody);

  // Agency filter options. The unsearched list shares the sidebar's own cache entry, so opening the
  // dropdown costs no request at all; typing runs the same server-side search the sidebar uses, which
  // is what makes every agency reachable rather than only a preloaded first slice.
  const [agencySearchInput, setAgencySearchInput] = useState("");
  const agencySearch = useDebounce(agencySearchInput, SEARCH_DEBOUNCE_MS).trim();
  const agencyList = useAgencyList();
  const agencySearchQuery = useAgencySearch(agencySearch);
  const agencyQuery = agencySearch ? agencySearchQuery : agencyList;
  const agencyOptions = useMemo<MultiSelectOption[]>(
    () =>
      (agencyQuery.data?.pages.flatMap((page) => page.content) ?? []).map((agency) => ({
        id: agency.id,
        label: agency.name,
      })),
    [agencyQuery.data]
  );

  const campaigns = overview.data?.campaigns ?? [];
  const summary = overview.data?.summary;
  const tableReloading = overview.isFetching && !overview.isPending && !overview.isFetchingNextPage;
  // Real campaigns, keyed by id as a string to match OwnerCampaign.id - lets an expanded row fetch its
  // real line items (useCampaignSetup) instead of the mock pacing overlay's own synthetic ones.
  const campaignsById = useMemo(
    () => new Map((overview.campaigns ?? []).map((c) => [String(c.id), c])),
    [overview.campaigns]
  );

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && overview.hasNextPage && !overview.isFetchingNextPage) {
          overview.fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // The sentinel <div> only mounts once `summary` is truthy (it's nested inside that gate below) -
    // without depending on it here too, a render where `hasNextPage` flips true before `summary` does
    // leaves this effect observing a stale (still-null) ref forever, since none of the other deps
    // change again afterwards.
  }, [overview.hasNextPage, overview.isFetchingNextPage, overview.fetchNextPage, Boolean(summary)]);

  function isOpen(campaignId: string): boolean {
    return expandAll || expandedCampaigns.has(campaignId);
  }

  // Stable identity (useCallback) so the memoized CampaignRows below can be passed this directly as a
  // prop instead of a fresh per-row closure, letting React.memo actually skip unaffected rows.
  const toggleCampaign = useCallback((campaignId: string) => {
    setExpandedCampaigns((current) => {
      const next = new Set(current);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }, []);

  function toggleExpandAll() {
    setExpandAll((current) => !current);
    setExpandedCampaigns(new Set());
  }

  const openCampaign = useCallback(
    (row: OwnerCampaign) => {
      const realCampaign = overview.campaigns?.find((c) => String(c.id) === row.id);
      // W1 (not built yet) adds a "/pacing" sub-route; navigate to the existing campaign page for now.
      navigate(`/campaigns/${row.id}`, {
        state: {
          campaign: realCampaign,
          agencyId: realCampaign?.agency_id,
          agencyName: row.agency,
          clientId: realCampaign?.client_id,
          clientName: row.client,
        },
      });
    },
    [overview.campaigns, navigate]
  );

  return (
    <section className="overview">
      <div className="overview__head">
        <h1 className="overview__title">Overview</h1>
      </div>

      {overview.isPending && <LoadingBlock label="Loading overview" />}
      {overview.isError && <p className="form-error">{formatError(overview.error)}</p>}

      {overview.isPending === false && overview.isError === false && summary && (
        <>
          <div className="overview__summary">
            <div className="overview__stat">
              <span className="overview__stat-label">Campaigns</span>
              <span className="overview__stat-value">{overview.totalElements}</span>
            </div>
            <div className="overview__stat">
              <span className="overview__stat-label">Line items</span>
              <span className="overview__stat-value">{summary.lineItems}</span>
            </div>
            <div className="overview__stat">
              <span className="overview__stat-label">Budget</span>
              <span className="overview__stat-value">{fmtBudget(summary.budget)}</span>
            </div>
          </div>

          <div className="overview__filters">
            <label className="overview__search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search campaigns, clients, agencies…"
                aria-label="Search campaigns"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <div className="overview__seg" role="group" aria-label="Filter by status">
              {CAMPAIGN_STATUS_SEGMENTS.map((segment) => (
                <button
                  key={segment.key}
                  type="button"
                  className={cn("overview__seg-btn", status === segment.key && "overview__seg-btn--active")}
                  onClick={() => setStatus(segment.key)}
                >
                  {segment.label}
                </button>
              ))}
            </div>
            <MultiSelect
              label="All agencies"
              options={agencyOptions}
              selected={agencyIds}
              onChange={setAgencyIds}
              search={agencySearchInput}
              onSearchChange={setAgencySearchInput}
              searchPlaceholder="Search agencies…"
              isPending={agencyQuery.isPending}
              error={agencyQuery.isError ? agencyQuery.error : undefined}
              hasMore={agencyQuery.hasNextPage}
              isLoadingMore={agencyQuery.isFetchingNextPage}
              onLoadMore={agencyQuery.fetchNextPage}
            />
            <button type="button" className="button button--ghost button--sm" onClick={toggleExpandAll}>
              {expandAll ? "Collapse All" : "Expand All"}
            </button>
          </div>

          <div className="overview__groups">
            {campaigns.length === 0 && (
              <p className="overview__empty">No campaigns match the current filters.</p>
            )}
            {campaigns.length > 0 && (
              <div className="overview__owner" aria-busy={tableReloading}>
                {tableReloading && <LoadingOverlay label="Updating campaigns" className="overview__reload-overlay" />}
                <table className="overview__camp-table">
                  <thead>
                    <tr>
                      <SortableHeader label="Campaign" field="NAME" sort={sort} onSort={cycleSort} />
                      <SortableHeader label="Status" field="STATUS" sort={sort} onSort={cycleSort} />
                      <th className="overview__camp-table-num">Budget</th>
                      <SortableHeader label="Flight" field="START_DATE" sort={sort} onSort={cycleSort} />
                      <th className="overview__camp-table-num">LINE ITEMS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((campaign) => (
                      <CampaignRows
                        key={campaign.id}
                        campaign={campaign}
                        realCampaign={campaignsById.get(campaign.id)}
                        open={isOpen(campaign.id)}
                        onToggle={toggleCampaign}
                        onOpen={openCampaign}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {overview.hasNextPage && (
              <div ref={sentinelRef} className="overview__load-more">
                {overview.isFetchingNextPage && <LoadingSpinner label="Loading more campaigns" size="sm" />}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Memoized so an Overview re-render (search keystroke, unrelated group's expand/collapse) only
 * reconciles rows whose own props actually changed. Effective only because `onToggle`/`onOpen` are
 * passed straight through as stable (`useCallback`'d) references from the parent rather than
 * per-row closures - each row applies its own `campaign` argument when calling them.
 */
const CampaignRows = memo(function CampaignRows({
  campaign,
  realCampaign,
  open,
  onToggle,
  onOpen,
}: {
  campaign: OwnerCampaign;
  realCampaign: CampaignV1 | undefined;
  open: boolean;
  onToggle: (campaignId: string) => void;
  onOpen: (campaign: OwnerCampaign) => void;
}) {
  const statusStyle = resolveStatusStyle(campaign.status);
  return (
    <>
      <tr className="overview__camp" onClick={() => onOpen(campaign)}>
        <td>
          <div className="overview__camp-name">
            <button
              type="button"
              className={cn("overview__exp", open && "overview__exp--open")}
              aria-label={open ? `Collapse ${campaign.name}` : `Expand ${campaign.name}`}
              aria-expanded={open}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(campaign.id);
              }}
            >
              <ChevronRightIcon />
            </button>
            <div>
              <div className="overview__camp-title">{campaign.name}</div>
              <div className="overview__camp-sub">{campaign.agency} · {campaign.client}</div>
            </div>
          </div>
        </td>
        <td><StatusBadge label={displayStatusLabel(campaign.status)} color={statusStyle.color} glow={statusStyle.glow} /></td>
        <td className="overview__camp-table-num overview__camp-budget">{fmtBudget(campaign.budget)}</td>
        <td className="overview__flight">
          {campaign.flight}<span className="overview__days">{campaign.days}</span>
        </td>
        <td className="overview__camp-table-num overview__camp-budget">{campaign.li}</td>
        <td>
          <div className="overview__actions">
            <button
              type="button"
              className="overview__open"
              title="Open"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(campaign);
              }}
            >
              <ChevronRightIcon />
            </button>
          </div>
        </td>
      </tr>
      {open && <ExpandedLineItems campaign={realCampaign} />}
    </>
  );
});

/**
 * The expanded campaign row's real line items - fetched (not mocked) via the same
 * `["campaigns", "insertion-orders", campaignId]` query the Setup tab owns, only mounted while its
 * parent row is open so a page of collapsed campaigns never pays for their line-item data.
 */
const ExpandedLineItems = memo(function ExpandedLineItems({ campaign }: { campaign: CampaignV1 | undefined }) {
  const setup = useCampaignSetup(campaign);

  if (setup.isPending) {
    return (
      <tr className="overview__li">
        <td colSpan={6} className="overview__li-loading">
          <LoadingSpinner label="Loading line items" size="sm" />
        </td>
      </tr>
    );
  }
  if (setup.isError) {
    return (
      <tr className="overview__li">
        <td colSpan={6} className="form-error">{formatError(setup.error)}</td>
      </tr>
    );
  }
  const lineItems = (setup.data?.ios ?? []).flatMap((io) => io.lis);
  return <>{lineItems.map((li) => <LineItemRow key={li.id} li={li} />)}</>;
});

const LineItemRow = memo(function LineItemRow({ li }: { li: LineItem }) {
  return (
    <tr className="overview__li">
      <td className="overview__li-name">
        <BranchIcon className="overview__li-branch" />
        <div>
          <div className="overview__li-title">LI {li.id}</div>
          <div className="overview__camp-sub">
            {li.channel}{li.rateType ? ` · ${li.rateType}` : ""} · {fmtDate(li.start)} – {fmtDate(li.end)}
          </div>
        </div>
      </td>
      <td />
      <td className="overview__camp-table-num overview__camp-budget">{fmtBudget(li.budget)}</td>
      <td />
      <td />
      <td />
    </tr>
  );
});
