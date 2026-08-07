import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAgencyList, useAgencySearch } from "../agencies/hooks";
import { useCampaignSetup } from "../campaigns/hooks";
import type { CampaignSearchRequestV1, CampaignV1 } from "../campaigns/types";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { BranchIcon, ChevronRightIcon, SearchIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock, LoadingSpinner } from "../../shared/ui/loading-spinner/loading-spinner";
import { MultiSelect, type MultiSelectOption } from "../../shared/ui/multi-select/multi-select";
import {
  CAMPAIGN_STATUS_SEGMENTS,
  StatusBadge,
  displayStatusLabel,
  resolveStatusStyle,
} from "../../shared/ui/status-badge/status-badge";
import { fmtBudget, fmtDate } from "../pacing/mock/format";
import { useOverviewPacing } from "../pacing/mock/hooks";
import type { LineItem, OwnerCampaign } from "../pacing/mock/types";
import "./overview.css";

const SEARCH_DEBOUNCE_MS = 300;
const ALL = "all";

/**
 * Builds the server-side search request from the Overview's controls: search, status, and agency all
 * move the filtering into BigQuery (see 01-MIGRATION-PLAN.md O1). Status filters on the exact real
 * NetSuite status string (EQUALS, case-insensitive) - a CONTAINS match on the segment's own label
 * (e.g. "complete") would never match the real value ("Finished").
 *
 * The search box uses SEARCH rather than NAME: it matches the campaign, client or agency name, since
 * people looking for a campaign here name it by whichever of the three they deal with (PDI_085).
 */
function buildOverviewSearchBody(search: string, statusKey: string, agencyIds: number[]): CampaignSearchRequestV1 {
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
  return { filters, sorting: { field: "NAME", direction: "ASC" } };
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

  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [status, setStatus] = useState<string>(ALL);
  const [agencyIds, setAgencyIds] = useState<number[]>([]);
  const [expandAll, setExpandAll] = useState(false);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());

  const searchBody = useMemo(
    () => buildOverviewSearchBody(search, status, agencyIds),
    [search, status, agencyIds]
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
              <div className="overview__owner">
                <table className="overview__camp-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th className="overview__camp-table-num">Budget</th>
                      <th>Flight</th>
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
