import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatError } from "../../shared/format/error";
import { campaignDisplayName } from "../../shared/format/names";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { BranchIcon, ChevronRightIcon, SearchIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock, LoadingOverlay, LoadingSpinner } from "../../shared/ui/loading-spinner/loading-spinner";
import {
  CAMPAIGN_STATUS_SEGMENTS,
  StatusBadge,
  displayStatusLabel,
  resolveStatusStyle,
} from "../../shared/ui/status-badge/status-badge";
import { useCampaignSetup } from "./hooks";
import { toPacingCampaign } from "../pacing/mock/adapter";
import { fmtBudget, fmtDate } from "../pacing/mock/format";
import { useCampaignPacing } from "../pacing/mock/hooks";
import { campPacing } from "../pacing/mock/pacing";
import type { LineItem } from "../pacing/mock/types";
import { searchCampaigns } from "./api";
import type { CampaignSearchRequestV1, CampaignV1 } from "./types";
// Reuses Overview's campaign/LI table style (see 01-MIGRATION-PLAN.md C1) so the two pages share one
// visual table, instead of maintaining two near-duplicate stylesheets.
import "../overview/overview.css";
import "./campaigns.css";

const PAGE_SIZE = 16;
const SEARCH_DEBOUNCE_MS = 300;
const CLIENT_WITHOUT_NAME = "Client without name";

function cleanClientName(value?: string | null): string {
  const trimmed = (value ?? "").trim();
  const lower = trimmed.toLowerCase();
  return !trimmed || trimmed === "-" || lower === "null" ? "" : trimmed;
}

function cleanApiClientName(value?: string | null): string {
  const cleaned = cleanClientName(value);
  return cleaned.toLowerCase() === CLIENT_WITHOUT_NAME.toLowerCase() ? "" : cleaned;
}

function selectedClientScope(searchClientName: string | null, stateClientName: string | undefined, clientId: number | undefined): string {
  const fromSearch = cleanClientName(searchClientName);
  if (fromSearch) return fromSearch;
  if (clientId === 0) return cleanClientName(stateClientName) || CLIENT_WITHOUT_NAME;
  return "";
}

/** Exact (case-insensitive) match against the segment's real NetSuite status - see CAMPAIGN_STATUS_SEGMENTS. */
function matchesStatusSegment(realStatus: string, segmentKey: string): boolean {
  if (segmentKey === "all") return true;
  const value = CAMPAIGN_STATUS_SEGMENTS.find((segment) => segment.key === segmentKey)?.value ?? "";
  return realStatus.toLowerCase() === value.toLowerCase();
}

interface CampaignsLocationState {
  clientName?: string;
  agencyId?: number;
  agencyName?: string;
}

export function Campaigns() {
  const { agencyId: routeAgencyId, clientId: routeClientId } = useParams<{ agencyId: string; clientId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as CampaignsLocationState | null) ?? {};
  const clientId = routeClientId ? Number(routeClientId) : undefined;
  const agencyId = routeAgencyId ? Number(routeAgencyId) : undefined;

  const [searchParams, setSearchParams] = useSearchParams();
  const searchInput = searchParams.get("q") ?? "";
  const selectedAgencyId =
    agencyId != null && Number.isFinite(agencyId) ? agencyId : state.agencyId;
  const selectedClientName = selectedClientScope(searchParams.get("clientName"), state.clientName, clientId);
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("all");
  const [expandAll, setExpandAll] = useState(false);
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<number>>(new Set());

  // A new search resets to the first page — derived synchronously during render (not in an effect
  // reacting to `search`) so the query key never briefly pairs the stale page with the new search.
  const [lastSearch, setLastSearch] = useState(search);
  if (search !== lastSearch) {
    setLastSearch(search);
    setPage(1);
  }

  function onSearchChange(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("q", value);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  }

  function buildBody(): CampaignSearchRequestV1 {
    const filters = [
      ...(clientId != null
        ? [{ field: "CLIENT_ID" as const, value: String(clientId), operation: "EQUALS" as const, caseSensitive: false }]
        : []),
      ...(selectedAgencyId != null
        ? [{ field: "AGENCY_ID" as const, value: String(selectedAgencyId), operation: "EQUALS" as const, caseSensitive: false }]
        : []),
      ...(selectedClientName
        ? [{ field: "CLIENT_NAME" as const, value: selectedClientName, operation: "EQUALS" as const, caseSensitive: false }]
        : []),
      ...(search
        ? [{ field: "NAME" as const, value: search, operation: "CONTAINS" as const, caseSensitive: false }]
        : []),
    ];
    return { filters, sorting: { field: "NAME", direction: "ASC" } };
  }

  const campaignsQuery = useQuery({
    queryKey: ["campaigns", "client", clientId, selectedAgencyId, selectedClientName, page, search],
    queryFn: () => searchCampaigns(page, PAGE_SIZE, buildBody()),
    enabled: clientId === undefined || Number.isFinite(clientId),
    placeholderData: keepPreviousData,
  });

  const campaigns = campaignsQuery.data?.content ?? [];
  const totalPages = campaignsQuery.data?.totalPages ?? 1;
  const totalElements = campaignsQuery.data?.totalElements ?? 0;
  const refreshing = campaignsQuery.isFetching && !campaignsQuery.isPending;

  // Treat blank/"null" strings from BigQuery as absent so they never surface in the UI.
  const clientName = selectedClientName || (campaigns.map((c) => cleanApiClientName(c.client_name)).find(Boolean) ?? "");
  const title = clientId != null ? clientName || CLIENT_WITHOUT_NAME : "Campaigns";
  const industry = campaigns.map((campaign) => cleanClientName(campaign.industry_vertical)).find(Boolean) ?? "";

  // Line items + budget are rolled up from the mock pacing overlay of only the currently loaded page
  // (the campaign list itself is server-paginated) — see 01-MIGRATION-PLAN.md C1.
  const { lineItemTotal, budgetTotal } = useMemo(() => {
    let li = 0;
    let budget = 0;
    for (const campaign of campaigns) {
      const pacing = campPacing(toPacingCampaign(campaign));
      li += pacing.li;
      budget += pacing.budget;
    }
    return { lineItemTotal: li, budgetTotal: budget };
  }, [campaigns]);

  const visibleCampaigns = useMemo(
    () => campaigns.filter((c) => matchesStatusSegment(c.status ?? "", status)),
    [campaigns, status]
  );

  function isOpen(campaignId: number): boolean {
    return expandAll || expandedCampaigns.has(campaignId);
  }

  function toggleCampaign(campaignId: number) {
    setExpandedCampaigns((current) => {
      const next = new Set(current);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }

  function toggleExpandAll() {
    setExpandAll((current) => !current);
    setExpandedCampaigns(new Set());
  }

  function openCampaign(campaign: CampaignV1) {
    // W1 (not built yet) adds a "/pacing" sub-route; navigate to the existing campaign page for now.
    navigate(`/campaigns/${campaign.id}`, {
      state: {
        campaign,
        agencyId: selectedAgencyId,
        agencyName: state.agencyName,
        clientId,
        clientName: title,
      },
    });
  }

  return (
    <section className="campaigns">
      <div className="campaigns__crumbs">
        <Link to="/agencies" className="campaigns__crumbs-link">Agencies</Link>
        {state.agencyName && selectedAgencyId != null && (
          <>
            <span className="campaigns__crumbs-sep">›</span>
            <Link
              to={`/agencies/${selectedAgencyId}`}
              state={{ agencyName: state.agencyName }}
              className="campaigns__crumbs-link"
            >
              {state.agencyName}
            </Link>
          </>
        )}
        <span className="campaigns__crumbs-sep">›</span>
        <span className="campaigns__crumbs-cur">{title}</span>
      </div>

      <h1 className="campaigns__page-title">{title}</h1>
      <p className="campaigns__page-sub">
        {campaignsQuery.isSuccess
          ? `${totalElements} campaign${totalElements !== 1 ? "s" : ""} · ${lineItemTotal} line item${lineItemTotal !== 1 ? "s" : ""} · ${fmtBudget(budgetTotal)}${industry ? ` · ${industry}` : ""}`
          : "Select a campaign to manage it."}
      </p>

      <div className="overview__filters">
        <label className="campaigns__search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search campaigns…"
            aria-label="Search campaigns"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
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
        <button type="button" className="button button--ghost button--sm" onClick={toggleExpandAll}>
          {expandAll ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {campaignsQuery.isPending && <LoadingBlock label="Loading campaigns" />}
      {campaignsQuery.isError && <p className="form-error">{formatError(campaignsQuery.error)}</p>}

      {campaignsQuery.isSuccess && campaigns.length === 0 && (
        <p className="campaigns__empty">
          {search ? `No campaigns match "${search}".` : "No campaigns found for this client."}
        </p>
      )}

      {campaignsQuery.isSuccess && campaigns.length > 0 && (
        <>
          <div className="overview__owner" aria-busy={refreshing}>
            {visibleCampaigns.length === 0 && (
              <p className="overview__empty">No campaigns match the current filters.</p>
            )}
            {visibleCampaigns.length > 0 && (
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
                  {visibleCampaigns.map((campaign) => (
                    <CampaignRows
                      key={campaign.id}
                      campaign={campaign}
                      agencyName={state.agencyName}
                      clientName={title}
                      open={isOpen(campaign.id)}
                      onToggle={() => toggleCampaign(campaign.id)}
                      onOpen={() => openCampaign(campaign)}
                    />
                  ))}
                </tbody>
              </table>
            )}
            {refreshing && <LoadingOverlay label="Updating campaigns" />}
          </div>

          {totalPages > 1 && (
            <div className="campaigns__pagination">
              <button
                type="button"
                className="campaigns__page-btn"
                disabled={page === 1 || refreshing}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </button>
              <span className="campaigns__page-info">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalElements)} of {totalElements}
              </span>
              <button
                type="button"
                className="campaigns__page-btn"
                disabled={page >= totalPages || refreshing}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CampaignRows({
  campaign,
  agencyName,
  clientName,
  open,
  onToggle,
  onOpen,
}: {
  campaign: CampaignV1;
  agencyName?: string;
  clientName: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const pacingQuery = useCampaignPacing(campaign);
  const pacing = pacingQuery.data;
  const statusStyle = resolveStatusStyle(campaign.status);
  const name = campaignDisplayName(campaign.name);

  return (
    <>
      <tr className="overview__camp" onClick={onOpen}>
        <td>
          <div className="overview__camp-name">
            <button
              type="button"
              className={cn("overview__exp", open && "overview__exp--open")}
              aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
              aria-expanded={open}
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
            >
              <ChevronRightIcon />
            </button>
            <div>
              <div className="overview__camp-title">{name}</div>
              <div className="overview__camp-sub">{agencyName ?? "—"} · {clientName}</div>
            </div>
          </div>
        </td>
        <td><StatusBadge label={displayStatusLabel(campaign.status)} color={statusStyle.color} glow={statusStyle.glow} /></td>
        <td className="overview__camp-table-num overview__camp-budget">{fmtBudget(pacing?.budget ?? 0)}</td>
        <td className="overview__flight">
          {pacing?.flight}<span className="overview__days">{pacing?.days}</span>
        </td>
        <td className="overview__camp-table-num overview__camp-budget">{pacing?.li ?? 0}</td>
        <td>
          <div className="overview__actions">
            <button
              type="button"
              className="overview__open"
              title="Open"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              <ChevronRightIcon />
            </button>
          </div>
        </td>
      </tr>
      {open && <ExpandedLineItems campaign={campaign} />}
    </>
  );
}

/**
 * The expanded campaign row's real line items - fetched (not mocked) via the same
 * `["campaigns", "insertion-orders", campaignId]` query the Setup tab owns, only mounted while its
 * parent row is open so a page of collapsed campaigns never pays for their line-item data.
 */
function ExpandedLineItems({ campaign }: { campaign: CampaignV1 }) {
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
}

function LineItemRow({ li }: { li: LineItem }) {
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
}
