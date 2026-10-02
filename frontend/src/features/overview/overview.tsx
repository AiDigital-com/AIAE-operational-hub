import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAgencyList, useAgencySearch } from "../agencies/hooks";
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { SearchIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import { MultiSelect, type MultiSelectOption } from "../../shared/ui/multi-select/multi-select";
import { useToast } from "../../shared/ui/toast/toast";
import { isAdminUser, useCurrentUser } from "../rbac/hooks";
import { fmtBudget } from "../pacing/mock/format";
// The one delete confirmation in the product (typed-name friction and all) and the one revalidate
// modal, owned by the Pacing admin screen - reused rather than grown again here.
import { DeletePacingModal } from "../pacing-admin/pacing-admin-delete-modals";
import { RevalidatePacingModal } from "../pacing-admin/pacing-admin-revalidate-modal";
import { triggerPacingRefresh } from "../pacing-dashboard/api";
import { emptyScopeCopy } from "../pacing-overview/empty-scope";
import { usePacingOverview } from "../pacing-overview/hooks";
import { pacingRoute } from "../pacing-overview/navigation";
import type { PacingRowV1 } from "../pacing-overview/types";
import { RefreshLandingWatch } from "./refresh-watch";

// The Create Pacing modal pulls in the whole review panel - code-split so the Overview's own chunk
// does not carry it for the majority of visits that never create anything.
const CreatePacingModal = lazy(() =>
  import("../pacing-create/create-pacing-modal").then((m) => ({ default: m.CreatePacingModal }))
);
// §12, and the NetSuite diff sheet (§13): both arrived here when the `/pacing` screen was retired -
// it was the only place either could be reached. Code-split for the same reason as the modal above:
// most visits open neither.
const DelegationsPanel = lazy(() =>
  import("../pacing-overview/delegations-panel").then((m) => ({ default: m.DelegationsPanel }))
);
const PacingNsDiffSheet = lazy(() =>
  import("../campaigns/tabs/pacing-ns-diff-sheet").then((m) => ({ default: m.PacingNsDiffSheet }))
);
import {
  buildOwnerGroups,
  compareOverviewRows,
  matchesAgencyFilter,
  matchesOverviewSearch,
  rowLiCount,
  type OverviewSort,
  type OverviewSortField,
} from "./owner-groups";
import { OwnerSection } from "./owner-section";
import "./overview.css";

const SEARCH_DEBOUNCE_MS = 300;
const ALL = "all";

/**
 * Pacing refuses a second refresh of the same pacing within two minutes (its double-launch guard).
 * Held here too, so a refresh this screen just triggered greys its own menu item out for the same
 * window instead of letting the user earn a 429 to find out.
 */
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

/** One segmented-filter option over the pacing lifecycle statuses. `value` is the exact Pacing
 *  status string ("" = no filter). */
interface StatusSegment {
  key: string;
  label: string;
  value: string;
}

/**
 * The pacing lifecycle vocabulary as segmented-filter options — Pacing's own four statuses, not the
 * NetSuite campaign set this page filtered by before the owner-grouped rebuild. "All" hides
 * Archive; picking "Archived" explicitly is how an archived pacing stays findable (§9, US-128 —
 * same rule as `/pacing`).
 */
export const OVERVIEW_STATUS_SEGMENTS: StatusSegment[] = [
  { key: "all", label: "All", value: "" },
  { key: "live", label: "Live", value: "Live" },
  { key: "paused", label: "Paused", value: "Paused" },
  { key: "complete", label: "Complete", value: "Complete" },
  { key: "archive", label: "Archived", value: "Archive" },
];

/**
 * Reads the agency filter out of the URL, keeping only what could be an agency id.
 *
 * Validated rather than trusted: the query string is user-editable, and a non-numeric id would
 * travel into the filter as a value that matches nothing while looking like a filter that does.
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
 * Reads the sort out of the URL, accepting only a column the group tables actually offer.
 *
 * @param raw the `FIELD:DIRECTION` pair from the query string
 * @returns the sort, or null for the default status-priority order
 */
function parseSort(raw: string | null): OverviewSort | null {
  const [field, direction] = (raw ?? "").split(":");
  const fields: OverviewSortField[] = ["NAME", "STATUS", "BUDGET", "MARGIN", "PACING", "FLIGHT", "LINE_ITEMS"];
  if (!fields.includes(field as OverviewSortField)) return null;
  return { field: field as OverviewSortField, direction: direction === "DESC" ? "DESC" : "ASC" };
}

/**
 * Reads the status segment out of the URL, accepting only a key the segmented control offers.
 *
 * @param raw the segment key from the query string
 * @returns the key, or "all" when it is not one
 */
function parseStatusKey(raw: string | null): string {
  return OVERVIEW_STATUS_SEGMENTS.some((segment) => segment.key === raw) ? (raw as string) : ALL;
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
 * with pacings silently missing and no clue why, and one that outlives the *account* does it to whoever
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

/**
 * The Overview at `/`: every pacing the signed-in user is entitled to see, grouped by owner exactly
 * as Pacing's own retired Overview grouped them (§4's owner-grouped rebuild) — group cards with
 * under/over badges, rows that expand into per-line-item health with the 7-day delivery heatmap and
 * KPI sparklines, off-pace row washes, delegation pills and period-scope markers.
 *
 * One request for the whole scoped list (`usePacingOverview`); status, agency, search and sort all
 * run against the loaded set. The filter toolbar keeps its URL + sessionStorage memory from the
 * previous campaign-based Overview (PDI_097).
 */
export function Overview() {
  const navigate = useNavigate();
  const overview = usePacingOverview();

  // Filters live in the URL so a filtered view can be sent to someone and restored by the back button, and
  // in session storage so returning by any other route restores them too - the sidebar's "Overview" link
  // and the logo both navigate to a bare "/", which is how the filters were being lost (PDI_097).
  const [params, setParams] = useSearchParams();
  // Read from the cache the app shell has already filled; `false` keeps this from being a second request
  // for the profile, and leaves the value undefined where nothing has loaded one.
  const currentUser = useCurrentUser(false).data;
  const rememberedFor = currentUser?.user_id;
  // Read once, on mount: after that the state below is the truth and the URL is written from it.
  const [initialParams] = useState(() => initialFilterParams(params, rememberedFor));
  const [searchInput, setSearchInput] = useState(() => initialParams.get("q") ?? "");
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS).trim().toLowerCase();
  const [status, setStatus] = useState<string>(() => parseStatusKey(initialParams.get("status")));
  const [agencyIds, setAgencyIds] = useState<number[]>(() => parseAgencyIds(initialParams.get("agency")));
  const [sort, setSort] = useState<OverviewSort | null>(() => parseSort(initialParams.get("sort")));
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // Row kebab menu state. Deleting and re-validating are admin-only on the Hub
  // (PacingAdminController#requireAdmin) and on Pacing itself, so a non-admin is not shown those two
  // items rather than being offered an action that can only come back 403. Refreshing and
  // transferring are not privileged and stay on every row.
  const isAdmin = isAdminUser(currentUser);
  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<PacingRowV1 | null>(null);
  const [revalidateTarget, setRevalidateTarget] = useState<PacingRowV1 | null>(null);
  // When each pacing's refresh cooldown runs out, by pacing id. `nowMs` ticks once a second while
  // any is running so the menu item counts DOWN rather than showing whatever second it was opened on.
  const [cooldownUntil, setCooldownUntil] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Slugs whose just-triggered refresh is being watched until the build lands - one watcher per
  // refreshed pacing, never a poller for rows nobody refreshed.
  const [watchSlugs, setWatchSlugs] = useState<string[]>([]);
  // Whether the Create Pacing modal is open. Mounted only while open, so every opening starts the
  // two-step flow fresh at step 1.
  const [createOpen, setCreateOpen] = useState(false);
  const [delegationsOpen, setDelegationsOpen] = useState(false);
  const [nsDiffTarget, setNsDiffTarget] = useState<PacingRowV1 | null>(null);

  // Ticks only while a cooldown is actually running - an interval that never stops would re-render
  // the whole grouped list once a second for as long as the page is open.
  useEffect(() => {
    const anyRunning = Object.values(cooldownUntil).some((until) => until > Date.now());
    if (!anyRunning) return undefined;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil, nowMs]);

  /** Seconds left on this row's refresh cooldown, or 0 when it may be refreshed now. */
  function cooldownSecondsFor(rowId: string): number {
    const until = cooldownUntil[rowId];
    if (until == null) return 0;
    return Math.max(0, Math.ceil((until - nowMs) / 1000));
  }

  /**
   * Triggers Pacing's own on-demand build for one row (US-119). Fire-and-forget upstream: a success
   * here means "queued", never "done" - the per-row watcher below re-pulls the lists once the build
   * actually lands. A refusal inside the two-minute window is not an error to dwell on: it comes
   * back as the remaining seconds, which go straight into this row's countdown.
   */
  const refreshRow = useCallback(
    async (row: PacingRowV1) => {
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
        const slug = row.dashSlug;
        if (slug) setWatchSlugs((current) => (current.includes(slug) ? current : [...current, slug]));
        toast.showSuccess(`Refresh started for "${row.name}". New data lands in a few minutes.`);
      } catch (error) {
        toast.showError(formatError(error));
      }
    },
    [toast]
  );

  const askRevalidate = useCallback((row: PacingRowV1) => setRevalidateTarget(row), []);
  const askDelete = useCallback((row: PacingRowV1) => setDeleteTarget(row), []);
  const retireWatch = useCallback(
    (slug: string) => setWatchSlugs((current) => current.filter((watched) => watched !== slug)),
    []
  );

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

  // Ascending, then descending, then back to the status-priority order.
  const cycleSort = useCallback((field: OverviewSortField) => {
    setSort((current) => {
      if (current?.field !== field) return { field, direction: "ASC" };
      return current.direction === "ASC" ? { field, direction: "DESC" } : null;
    });
  }, []);

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

  const rows = useMemo(() => overview.data?.pacings ?? [], [overview.data]);
  const scope = overview.data?.scope;

  const filtered = useMemo(() => {
    const statusValue = OVERVIEW_STATUS_SEGMENTS.find((segment) => segment.key === status)?.value ?? "";
    let next = rows;
    // §9, US-128: an archived pacing drops out of the default view but stays findable — picking
    // "Archived" explicitly still shows it; only the unfiltered "All" view hides it.
    if (!statusValue) next = next.filter((row) => row.status !== "Archive");
    else next = next.filter((row) => row.status === statusValue);
    if (agencyIds.length > 0) next = next.filter((row) => matchesAgencyFilter(row, agencyIds));
    if (search) next = next.filter((row) => matchesOverviewSearch(row, search));
    return next;
  }, [rows, status, agencyIds, search]);

  const summary = useMemo(() => {
    let lineItems = 0;
    let budget = 0;
    for (const row of filtered) {
      lineItems += rowLiCount(row);
      budget += row.budgetTotal ?? 0;
    }
    return { pacings: filtered.length, lineItems, budget };
  }, [filtered]);

  const compare = useMemo(
    () => (sort ? (a: PacingRowV1, b: PacingRowV1) => compareOverviewRows(a, b, sort) : undefined),
    [sort]
  );
  const groups = useMemo(
    () => buildOwnerGroups(filtered, currentUser?.full_name, compare),
    [filtered, currentUser?.full_name, compare]
  );

  const toggleRow = useCallback((pacingId: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(pacingId)) next.delete(pacingId);
      else next.add(pacingId);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((pacingIds: string[], expand: boolean) => {
    setOpenIds((current) => {
      const next = new Set(current);
      for (const id of pacingIds) {
        if (expand) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const allExpanded = filtered.length > 0 && filtered.every((row) => openIds.has(row.id));
  function toggleExpandAll() {
    setOpenIds((current) => {
      if (allExpanded) return new Set<string>();
      const next = new Set(current);
      for (const row of filtered) next.add(row.id);
      return next;
    });
  }

  const openPacing = useCallback(
    (row: PacingRowV1) => {
      const target = pacingRoute(row);
      if (target) navigate(target.path, { state: target.state });
    },
    [navigate]
  );

  function clearFilters() {
    setSearchInput("");
    setStatus(ALL);
    setAgencyIds([]);
  }

  const hasActiveFilters = status !== ALL || agencyIds.length > 0 || Boolean(search);

  return (
    <section className="overview">
      <div className="overview__head">
        <h1 className="overview__title">Overview</h1>
        {/* §8's second entry point: create a pacing without first navigating into a campaign,
            in a modal right here - no route, no URL change. Gated on the same resolved
            `can_create` the campaign tab's button reads; with no route of its own, this gate is
            the whole gate. */}
        <div className="overview__head-actions">
          {/* §12. Delegations belong beside the list they affect: what a delegation does is add
              somebody else's pacings to this very page, or hand yours to them. Gated on
              `can_create` (owner decision 2026-10-02), the same gate Create pacing carries: without
              it a person owns no pacings to hand over, so the panel could only ever report. The
              RECEIVING half is not lost with the button — every delegated row names its grantor on
              the row itself, as the "← name" pill owner-section draws. */}
          {scope?.can_create && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDelegationsOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={delegationsOpen}
            >
              Delegations
            </button>
          )}
          {scope?.can_create && (
            <button type="button" className="button" onClick={() => setCreateOpen(true)}>
              Create pacing
            </button>
          )}
        </div>
      </div>

      {overview.isPending && <LoadingBlock label="Loading overview" />}

      {overview.isError && (
        <p className="form-error">
          {overview.error instanceof ApiError && overview.error.status === 409
            ? "Your account isn't synced to Pacing yet. This usually clears up after the next user sync — ask an admin if it persists."
            : formatError(overview.error)}
        </p>
      )}

      {overview.isSuccess && (
        <>
          <div className="overview__summary">
            <div className="overview__stat">
              <span className="overview__stat-label">Pacings</span>
              <span className="overview__stat-value">{summary.pacings}</span>
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
                placeholder="Search pacings, owners, campaigns, agencies…"
                aria-label="Search pacings"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <div className="overview__seg" role="group" aria-label="Filter by status">
              {OVERVIEW_STATUS_SEGMENTS.map((segment) => (
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
              {allExpanded ? "Collapse All" : "Expand All"}
            </button>
          </div>

          {rows.length === 0 && (
            <div className="overview__empty">
              {(() => {
                const { title, body } = emptyScopeCopy(scope);
                return (
                  <>
                    <p className="overview__empty-title">{title}</p>
                    <p className="overview__empty-body">{body}</p>
                  </>
                );
              })()}
            </div>
          )}

          {rows.length > 0 && filtered.length === 0 && (
            <div className="overview__empty">
              <p className="overview__empty-title">No pacings match your filters</p>
              <p className="overview__empty-body">
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

          <div className="overview__groups">
            {groups.map((group) => (
              <OwnerSection
                key={group.owner}
                group={group}
                openIds={openIds}
                onToggleRow={toggleRow}
                onToggleGroup={toggleGroup}
                onOpen={openPacing}
                sort={sort}
                onSort={cycleSort}
                isAdmin={isAdmin}
                cooldownSecondsFor={cooldownSecondsFor}
                onRefresh={refreshRow}
                onRevalidate={askRevalidate}
                onDelete={askDelete}
                onOpenNsDiff={setNsDiffTarget}
              />
            ))}
          </div>

          {/* One watcher per just-refreshed pacing: re-pulls the lists when its build lands, then
              retires. Renders nothing. */}
          {watchSlugs.map((slug) => (
            <RefreshLandingWatch key={slug} slug={slug} onDone={retireWatch} />
          ))}

          {deleteTarget && (
            <DeletePacingModal
              row={deleteTarget}
              onClose={() => setDeleteTarget(null)}
              // The Overview is not scoped to any campaign, so a pacing spanning several is worth
              // spelling out - deleting it removes it from every one of them, journal and dashboard
              // file included.
              note={
                (deleteTarget.campaigns ?? []).length > 1
                  ? `This pacing covers ${(deleteTarget.campaigns ?? [])
                      .map((campaign) => campaign.name)
                      .join(", ")} — deleting it removes it from all of them.`
                  : undefined
              }
            />
          )}

          {revalidateTarget && (
            <RevalidatePacingModal row={revalidateTarget} onClose={() => setRevalidateTarget(null)} />
          )}
        </>
      )}

      {createOpen && (
        <Suspense fallback={null}>
          <CreatePacingModal open onClose={() => setCreateOpen(false)} />
        </Suspense>
      )}

      {delegationsOpen && (
        <Suspense fallback={null}>
          <DelegationsPanel open onClose={() => setDelegationsOpen(false)} />
        </Suspense>
      )}

      {nsDiffTarget && (
        <Suspense fallback={null}>
          <PacingNsDiffSheet row={nsDiffTarget} onClose={() => setNsDiffTarget(null)} />
        </Suspense>
      )}
    </section>
  );
}
