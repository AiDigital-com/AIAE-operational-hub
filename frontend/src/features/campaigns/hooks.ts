import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { ADD_LINE_RESOLVE_DEBOUNCE_MS, ADD_LINE_RESOLVE_PAGE_SIZE } from "./constants/add-line";
import { DEFAULT_DIMS, DEFAULT_METRICS } from "../pacing/mock/reports";
import {
  applyConversionAdjustments,
  createDashboard,
  createDashboardDataSource,
  createReportView,
  deleteDashboard,
  deleteReportView,
  duplicateDashboard,
  duplicateReportView,
  getCampaign,
  listCampaignInsertionOrders,
  listCampaignReportRows,
  listConstructedEntities,
  listConversionBreakdown,
  listDashboardDatasetDistinctValues,
  listDashboardDatasetRows,
  listDashboards,
  listReportRowDistinctValues,
  listReportViews,
  previewConstructedIds,
  previewDashboardDataset,
  removeDashboardDataSource,
  saveReportRowAdjustments,
  updateDashboard,
  updateReportView,
  uploadBulkAdjustments,
  uploadConversionAdjustments,
} from "./api";
import { toSetupModel } from "./setup";
import type {
  CampaignV1,
  ConstructedEntityLevelEnumV1,
  ConversionAdjustmentRowV1,
  ConversionBreakdownRequestV1,
  DashboardDatasetFilterV1,
  DashboardV1,
  DirectionEnumV1,
  ReportConfig,
  ReportRowAdjustmentsRequestV1,
  ReportRowFilterFieldEnumV1,
  ReportRowFilterV1,
  ReportRowSortFieldEnumV1,
  ReportView,
  ReportViewUpsertV1,
  ReportViewV1,
} from "./types";

const REPORT_ROWS_PAGE_SIZE = 25;
const REPORT_VIEWS_PAGE_SIZE = 25;
const DASHBOARDS_PAGE_SIZE = 25;
export const DASHBOARD_DATASET_PAGE_SIZE = 25;
const NO_FILTERS: ReportRowFilterV1[] = [];
const NO_GROUPING: ReportRowFilterFieldEnumV1[] = [];
const NO_DASHBOARD_FILTERS: DashboardDatasetFilterV1[] = [];

/**
 * An inclusive delivery-date window, as the two `yyyy-MM-dd` strings a native date input produces.
 * An empty string is an unset bound, i.e. open-ended on that side.
 */
export interface DateWindow {
  from: string;
  to: string;
}

export const NO_DATE_WINDOW: DateWindow = { from: "", to: "" };

/**
 * One campaign by id — the canonical owner of `["campaigns", "detail", campaignId]`.
 *
 * Only for entry paths that have no campaign to hand: opening the workspace from a list carries the
 * campaign along in router state, and re-fetching it there would be a duplicate request for data the
 * caller already has. Pass that already-known campaign as `known` and no request is made.
 *
 * @param campaignId the campaign id from the route
 * @param known      the campaign already carried in via router state, if any
 */
export function useCampaign(campaignId: number | undefined, known: CampaignV1 | undefined) {
  const query = useQuery({
    queryKey: ["campaigns", "detail", campaignId],
    queryFn: () => getCampaign(campaignId as number),
    enabled: known === undefined && campaignId !== undefined && Number.isFinite(campaignId),
    staleTime: 60_000,
  });
  return {
    campaign: known ?? query.data,
    isPending: known === undefined && query.isPending,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * A single real campaign's per-day, per-line-item delivery/actuals rows, read from
 * `platform_mart_adjustments_view_op_hub` (see 01-MIGRATION-PLAN.md §0b). Real data — unlike the
 * campaign's mock pacing overlay, this is not seeded/generated.
 *
 * Paginated (25 rows/page): a campaign with a long flight and many line items can produce thousands of
 * rows, so the initial load only fetches page one; callers page further in via `fetchNextPage()`. Every
 * page carries the same full-dataset totals/date-range/line-item-count (computed server-side over the
 * requested filters), so those stay stable regardless of how many pages have loaded.
 *
 * Grouping, sorting and filtering are all applied server-side (never re-applied to only the loaded
 * rows) - changing `sortField`/`sortDirection`/`filters`/`groupBy` changes the query key, so it starts
 * a fresh fetch from page one.
 *
 * @param sortField     the dimension to sort by, or `null` for the server's default order
 * @param sortDirection the direction applied to `sortField`; ignored while `sortField` is `null`
 * @param filters       multi-value dimension filters applied additively (AND); defaults to none
 * @param groupBy       the dimensions to aggregate by - one row per distinct combination, with every
 *                      metric summed/averaged over it. Defaults to none, i.e. the raw ungrouped rows
 */
export function useReportRows(
  campaignId: number | undefined,
  sortField: ReportRowSortFieldEnumV1 | null = null,
  sortDirection: DirectionEnumV1 = "ASC",
  filters: ReportRowFilterV1[] = NO_FILTERS,
  groupBy: ReportRowFilterFieldEnumV1[] = NO_GROUPING,
  dateWindow: DateWindow = NO_DATE_WINDOW
) {
  return useInfiniteQuery({
    queryKey: [
      "campaigns", "report-rows", campaignId, sortField, sortDirection, filters, groupBy,
      dateWindow.from, dateWindow.to,
    ],
    queryFn: ({ pageParam }) =>
      listCampaignReportRows(campaignId as number, pageParam, REPORT_ROWS_PAGE_SIZE, {
        filters,
        groupBy,
        // Empty means open-ended, and the contract wants the bound absent rather than blank
        dateFrom: dateWindow.from || undefined,
        dateTo: dateWindow.to || undefined,
        sortField: sortField ?? undefined,
        sortDirection: sortField ? sortDirection : undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNext ? lastPage.pageNumber + 1 : undefined),
    enabled: campaignId != null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/**
 * A dimension's distinct, non-null values (capped server-side at 500) - populates a report-rows column's
 * filter popover. Fetched only while that popover is open (`enabled`), never preloaded for every column
 * up front.
 *
 * @param field   the dimension to list values for, or `undefined` before a popover has picked one
 * @param enabled whether the owning popover is currently open
 */
export function useReportRowDistinctValues(
  campaignId: number | undefined,
  field: ReportRowFilterFieldEnumV1 | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["campaigns", "report-rows", "distinct-values", campaignId, field],
    queryFn: () => listReportRowDistinctValues(campaignId as number, field as ReportRowFilterFieldEnumV1),
    enabled: enabled && campaignId != null && field != null,
    staleTime: 5 * 60_000,
  });
}

/**
 * Appends staged report-row adjustments (inline edits and/or manually-added rows) for one campaign. On
 * success, invalidates every cached report-rows query for that campaign (any loaded sort/filter/page
 * combination) so the table re-reads the merged view - the server is the source of truth after save, not
 * a client-side merge. Distinct-values queries are left alone: an edit to a metric cannot change a
 * dimension's own value set.
 */
export function useSaveReportRowAdjustments(campaignId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportRowAdjustmentsRequestV1) => saveReportRowAdjustments(campaignId as number, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns", "report-rows", campaignId] });
    },
  });
}

/**
 * Resolves one constructed-name level's typed name against the campaign's own mart data - PDI_117 mode
 * A's identity resolution (the name stays a free-text cell; only the id is resolved instead of typed).
 * Disabled until the owning added row is in edit mode; the name itself is debounced
 * ({@link ADD_LINE_RESOLVE_DEBOUNCE_MS}) so settling on a value issues one request, not one per keystroke,
 * and the query key carries the debounced term, so re-rendering mid-type does not refetch.
 *
 * @param campaignId the campaign id
 * @param level      the constructed-name level to resolve at
 * @param platform   the row's current platform, or empty for every platform
 * @param accountId  the row's current platform account id, or empty for every account
 * @param name       the raw (not yet debounced) typed constructed name
 * @param enabled    whether the owning row is in edit mode and in mode A
 */
export function useResolveConstructedName(
  campaignId: number | undefined,
  level: ConstructedEntityLevelEnumV1,
  platform: string,
  accountId: string,
  name: string,
  enabled: boolean
) {
  const debouncedName = useDebounce(name, ADD_LINE_RESOLVE_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["campaigns", "constructed-entities", campaignId, level, platform, accountId, debouncedName],
    queryFn: ({ signal }) =>
      listConstructedEntities(
        campaignId as number, level, platform || undefined, accountId || undefined, debouncedName || undefined,
        1, ADD_LINE_RESOLVE_PAGE_SIZE, signal
      ),
    enabled: enabled && campaignId != null && debouncedName !== "",
    staleTime: 60_000,
  });
}

/**
 * Whether the campaign has any level-1 mart data at all - a lightweight, campaign-scoped probe (not a
 * per-row read: every added row's empty-state check shares this one cached query) used to explain and
 * steer to Add Line mode B when a brand-new campaign has no platform data yet.
 *
 * @param campaignId the campaign id
 * @param enabled    whether at least one added row is currently open in mode A
 */
export function useCampaignHasConstructedEntities(campaignId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["campaigns", "constructed-entities", "any", campaignId],
    queryFn: ({ signal }) =>
      listConstructedEntities(campaignId as number, "LVL1", undefined, undefined, undefined, 1, 1, signal),
    enabled: enabled && campaignId != null,
    staleTime: 5 * 60_000,
    select: (data) => data.content.length > 0,
  });
}

/**
 * Previews the constructed ids Add Line mode B would generate/reuse for the given names, so the row can
 * show the resolved value before Save. Disabled until mode B is active and every level has a typed name -
 * a preview of a blank or partial name is not meaningful and {@link saveReportRowAdjustments} would
 * recompute it server-side regardless.
 *
 * @param campaignId the campaign id
 * @param name       the level-1 typed constructed name
 * @param nameLvl2   the level-2 typed constructed name
 * @param nameLvl3   the level-3 typed constructed name
 * @param enabled    whether the owning row is currently in mode B
 */
export function useConstructedIdsPreview(
  campaignId: number | undefined,
  name: string,
  nameLvl2: string,
  nameLvl3: string,
  enabled: boolean
) {
  const debouncedName = useDebounce(name, ADD_LINE_RESOLVE_DEBOUNCE_MS);
  const debouncedNameLvl2 = useDebounce(nameLvl2, ADD_LINE_RESOLVE_DEBOUNCE_MS);
  const debouncedNameLvl3 = useDebounce(nameLvl3, ADD_LINE_RESOLVE_DEBOUNCE_MS);
  const everyNamePresent = debouncedName !== "" && debouncedNameLvl2 !== "" && debouncedNameLvl3 !== "";
  return useQuery({
    queryKey: [
      "campaigns", "constructed-ids-preview", campaignId, debouncedName, debouncedNameLvl2, debouncedNameLvl3,
    ],
    queryFn: ({ signal }) =>
      previewConstructedIds(
        campaignId as number,
        {
          constructed_name: debouncedName,
          constructed_name_lvl2: debouncedNameLvl2,
          constructed_name_lvl3: debouncedNameLvl3,
        },
        signal
      ),
    enabled: enabled && campaignId != null && everyNamePresent,
    staleTime: 30_000,
  });
}

/**
 * Applies an uploaded bulk-adjustment spreadsheet for one campaign (the "Bulk manual adjustment"
 * download-edit-reupload round trip). On success, invalidates that campaign's report-rows query - same
 * boundary as {@link useSaveReportRowAdjustments} - so the table re-reads the merged view; distinct-values
 * queries are left alone. Returns the applied-row count for the caller's success toast.
 */
export function useUploadBulkAdjustments(campaignId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadBulkAdjustments(campaignId as number, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["campaigns", "report-rows", campaignId] });
    },
  });
}

/**
 * Applies an uploaded conversions spreadsheet for one campaign. Invalidates the same report-rows queries
 * as the delivery upload does, and for the same reason: the report reads its conversions from the
 * conversions mart through a join, so a conversions edit changes what the table shows even though no
 * delivery row was touched.
 */
/**
 * The conversions behind one report row's Conversions cell, loaded only once that cell is opened.
 *
 * Keyed by the row's identity, so opening the same cell twice costs one request and two different cells
 * never share an answer. Disabled while `query` is null - the whole point of the panel is that a report
 * of a thousand rows does not fetch a thousand breakdowns.
 *
 * @param campaignId the campaign the row belongs to
 * @param query      the report row's identity, or `null` while no cell is open
 */
export function useConversionBreakdown(
  campaignId: number | undefined,
  query: ConversionBreakdownRequestV1 | null
) {
  return useQuery({
    queryKey: ["campaigns", "conversion-breakdown", campaignId, query],
    queryFn: () => listConversionBreakdown(campaignId as number, query as ConversionBreakdownRequestV1),
    enabled: campaignId != null && query != null,
    staleTime: 0,
  });
}

/**
 * Applies conversions edited in the report itself.
 *
 * Invalidates the report rows, so the edited cell shows its new figure, and the breakdowns, so reopening
 * the cell shows what was actually stored rather than what was typed.
 *
 * @param campaignId the campaign the rows belong to
 */
export function useApplyConversionAdjustments(campaignId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rows: ConversionAdjustmentRowV1[]) =>
      applyConversionAdjustments(campaignId as number, { rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", "report-rows", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaigns", "conversion-breakdown", campaignId] });
    },
  });
}

export function useUploadConversionAdjustments(campaignId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadConversionAdjustments(campaignId as number, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns", "report-rows", campaignId] }),
  });
}

const DEFAULT_REPORT_CONFIG: ReportConfig = {
  dimensions: [...DEFAULT_DIMS],
  metrics: [...DEFAULT_METRICS],
  filters: [],
};

function createUpsert(name: string, note?: string): ReportViewUpsertV1 {
  return {
    name,
    note: note || undefined,
    type: "basic",
    status: "draft",
    dimensions: [...DEFAULT_REPORT_CONFIG.dimensions],
    metrics: [...DEFAULT_REPORT_CONFIG.metrics],
    filters: [],
  };
}

function toReportView(dto: ReportViewV1): ReportView {
  return {
    id: String(dto.id),
    name: dto.name,
    type: dto.type,
    status: dto.status,
    note: dto.note ?? undefined,
    created: dto.created,
    edited: dto.edited ?? null,
    config: {
      dimensions: dto.dimensions ?? [],
      metrics: dto.metrics ?? [],
      filters: dto.filters ?? [],
      // Left undefined rather than defaulted to a list: absent is what says "canonical order".
      columnOrder: dto.columnOrder,
    },
  };
}

function toUpsert(view: Pick<ReportView, "name" | "type" | "status" | "note" | "config">): ReportViewUpsertV1 {
  return {
    name: view.name,
    type: view.type,
    status: view.status,
    note: view.note,
    dimensions: view.config.dimensions,
    metrics: view.config.metrics,
    filters: view.config.filters,
    columnOrder: view.config.columnOrder,
  };
}

/**
 * A single real campaign's saved report views: a campaign-shared, durable Postgres-backed paged list
 * (`hub_report_views`), not per-user. Reads `/report-views` page-by-page; create/rename/duplicate/delete/
 * save are mutations that invalidate only this campaign's report-views query (per frontend rules: no
 * broad invalidation) so the picker always reflects the server's own state after a write without ever
 * loading an unbounded report list.
 *
 * Keeps the historic mock hook's shape so the Reporting tab is a drop-in consumer:
 * `createReport`/`duplicateReport` resolve to the new view asynchronously (a real mutation, unlike the
 * old mock's synchronous return), and `saveReport` takes the config directly so status+config commit in
 * one PUT instead of two separate writes. Every mutation returns its promise (not fire-and-forget) so the
 * consumer can catch and surface a failure - mirroring `useSaveReportRowAdjustments`'s own contract.
 */
export function useReports(campaign: CampaignV1 | undefined) {
  const campaignId = campaign?.id;
  const queryClient = useQueryClient();
  const key = ["campaigns", "report-views", campaignId];

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => listReportViews(campaignId as number, pageParam, REPORT_VIEWS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pageNumber < lastPage.totalPages ? lastPage.pageNumber + 1 : undefined,
    enabled: campaignId != null,
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const views = query.data?.pages.flatMap((page) => page.content.map(toReportView)) ?? [];
  const current = (id: string) => views.find((view) => view.id === id);

  const createMut = useMutation({
    mutationFn: ({ name, note }: { name: string; note?: string }) =>
      createReportView(campaignId as number, createUpsert(name, note)),
    onSuccess: invalidate,
  });
  const renameMut = useMutation({
    mutationFn: ({ id, name, note }: { id: string; name: string; note?: string }) => {
      const view = current(id);
      return updateReportView(campaignId as number, Number(id), toUpsert({ ...(view as ReportView), name, note }));
    },
    onSuccess: invalidate,
  });
  const saveMut = useMutation({
    mutationFn: ({ id, config, name }: { id: string; config: ReportConfig; name?: string }) => {
      const view = current(id);
      return updateReportView(
        campaignId as number,
        Number(id),
        toUpsert({ ...(view as ReportView), name: name ?? (view as ReportView).name, status: "saved", config })
      );
    },
    onSuccess: invalidate,
  });
  // Deliberately not `saveMut` with a doctored config. That one commits the whole staged report and stamps
  // it "saved"; this one writes a single field of the report as it is already stored, so rearranging columns
  // cannot promote a draft to saved, and cannot smuggle staged dimensions or metrics into the stored view
  // behind the Apply the user has not pressed.
  const columnOrderMut = useMutation({
    mutationFn: ({ id, columnOrder }: { id: string; columnOrder: string[] }) => {
      const view = current(id) as ReportView;
      return updateReportView(
        campaignId as number,
        Number(id),
        toUpsert({ ...view, config: { ...view.config, columnOrder } })
      );
    },
    onSuccess: invalidate,
  });
  const duplicateMut = useMutation({
    mutationFn: (id: string) => duplicateReportView(campaignId as number, Number(id)),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteReportView(campaignId as number, Number(id)),
    onSuccess: invalidate,
  });

  return {
    views,
    total: query.data?.pages[0]?.totalElements ?? views.length,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    createReport: async (name: string, note?: string): Promise<ReportView> =>
      toReportView(await createMut.mutateAsync({ name, note })),
    renameReport: (id: string, name: string, note?: string): Promise<unknown> =>
      renameMut.mutateAsync({ id, name, note }),
    duplicateReport: async (id: string): Promise<ReportView> => toReportView(await duplicateMut.mutateAsync(id)),
    deleteReport: (id: string): Promise<unknown> => deleteMut.mutateAsync(id),
    saveReport: (id: string, config: ReportConfig, name?: string): Promise<unknown> =>
      saveMut.mutateAsync({ id, config, name }),
    saveColumnOrder: (id: string, columnOrder: string[]): Promise<unknown> =>
      columnOrderMut.mutateAsync({ id, columnOrder }),
  };
}

/**
 * A single real campaign's IO/LI tree, read from NetSuite (`listCampaignInsertionOrders`, adapted via
 * `toSetupModel`).
 *
 * Read-only, deliberately. Setup used to let an order be added by hand (US-013), staged into a
 * client-only cache entry and merged over the base - but nothing ever wrote it anywhere, so it survived
 * exactly until the page was reloaded. An add that quietly forgets is worse than no add at all, so the
 * whole overlay went with the button. If Setup gets a write path, it comes back with one.
 *
 * This is the real read-path owner of `["campaigns", "insertion-orders", campaignId]` - the mock
 * pacing path's own `buildSetup` (still used by the Overview/Pacing rollups) is untouched by this hook.
 */
export function useCampaignSetup(campaign: CampaignV1 | undefined) {
  const campaignId = campaign?.id;

  const baseQuery = useQuery({
    queryKey: ["campaigns", "insertion-orders", campaignId],
    queryFn: async () => toSetupModel(await listCampaignInsertionOrders(campaignId as number)),
    enabled: campaign != null,
    staleTime: 60_000,
  });

  return {
    data: baseQuery.data,
    isPending: baseQuery.isPending,
    isError: baseQuery.isError,
    error: baseQuery.error,
  };
}


/**
 * One campaign's dashboards and their BigQuery data sources (US-017, US-019, US-020, US-021).
 *
 * Shaped after `useReports`: a paged Postgres-backed list, campaign-shared rather than per-user, with every
 * mutation invalidating only this campaign's dashboards query and returning its promise so the tab can
 * surface a failure instead of swallowing it.
 *
 * `preview` is deliberately not part of this hook's query - it runs a BigQuery count, so it is asked for
 * per dashboard, only while its panel is open (see `useDashboardPreview`).
 *
 * @param campaign the campaign whose dashboards to load
 */
export function useDashboards(campaign: CampaignV1 | undefined) {
  const campaignId = campaign?.id;
  const queryClient = useQueryClient();
  const key = ["campaigns", "dashboards", campaignId];

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => listDashboards(campaignId as number, pageParam, DASHBOARDS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pageNumber < lastPage.totalPages ? lastPage.pageNumber + 1 : undefined,
    enabled: campaignId != null,
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const invalidateDashboardDataset = (id: number) => {
    queryClient.invalidateQueries({ queryKey: ["campaigns", "dashboard-preview", campaignId, id] });
    queryClient.invalidateQueries({ queryKey: ["campaigns", "dashboard-dataset-rows", campaignId, id] });
  };
  const dashboards: DashboardV1[] = query.data?.pages.flatMap((page) => page.content) ?? [];

  const createMut = useMutation({
    mutationFn: ({ name, optionalColumns }: { name: string; optionalColumns: string[] }) =>
      createDashboard(campaignId as number, { name, type: "basic", optionalColumns, filters: [] }),
    onSuccess: invalidate,
  });
  const updateMut = useMutation({
    mutationFn: ({
      id,
      name,
      optionalColumns,
      columnOrder,
      filters,
      dateWindow,
      displayCampaignName,
    }: {
      id: number;
      name: string;
      optionalColumns: string[];
      columnOrder: string[];
      filters: DashboardDatasetFilterV1[];
      dateWindow: DateWindow;
      displayCampaignName?: string;
    }) =>
      updateDashboard(campaignId as number, id, {
        name,
        optionalColumns,
        columnOrder,
        filters,
        dateFrom: dateWindow.from || undefined,
        dateTo: dateWindow.to || undefined,
        displayCampaignName,
      }),
    // Only the list. Both dataset queries carry everything they answer under in their own keys - the kept
    // columns, the filters, the date window - so a save that changes one of those re-reads by minting a new
    // key, and a save that changes none of them (a rename, a column rearrangement) must not re-read at all.
    // Invalidating them here spent two BigQuery jobs on every dragged column.
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteDashboard(campaignId as number, id),
    onSuccess: invalidate,
  });
  const duplicateMut = useMutation({
    mutationFn: (id: number) => duplicateDashboard(campaignId as number, id),
    onSuccess: invalidate,
  });
  const createSourceMut = useMutation({
    mutationFn: ({ id, displayCampaignName }: { id: number; displayCampaignName: string }) =>
      createDashboardDataSource(campaignId as number, id, displayCampaignName),
    onSuccess: (_data, variables) => {
      invalidate();
      // The row count the panel shows comes from the preview, which the write has just made stale.
      invalidateDashboardDataset(variables.id);
    },
  });
  const removeSourceMut = useMutation({
    mutationFn: (id: number) => removeDashboardDataSource(campaignId as number, id),
    onSuccess: invalidate,
  });

  return {
    dashboards,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    createDashboard: (name: string, optionalColumns: string[]): Promise<DashboardV1> =>
      createMut.mutateAsync({ name, optionalColumns }),
    updateDashboard: (
      id: number,
      name: string,
      optionalColumns: string[],
      columnOrder: string[],
      filters: DashboardDatasetFilterV1[],
      dateWindow: DateWindow,
      displayCampaignName?: string
    ): Promise<DashboardV1> =>
      updateMut.mutateAsync({
        id, name, optionalColumns, columnOrder, filters, dateWindow, displayCampaignName,
      }),
    duplicateDashboard: (id: number): Promise<DashboardV1> => duplicateMut.mutateAsync(id),
    deleteDashboard: (id: number): Promise<unknown> => deleteMut.mutateAsync(id),
    createDataSource: (id: number, displayCampaignName: string): Promise<DashboardV1> =>
      createSourceMut.mutateAsync({ id, displayCampaignName }),
    isCreatingDataSource: createSourceMut.isPending,
    removeDataSource: (id: number): Promise<DashboardV1> => removeSourceMut.mutateAsync(id),
  };
}

/**
 * How many rows one dashboard's data source would contain today (US-019).
 *
 * Its own query rather than a field on the list: this one runs a BigQuery count, so it is asked for only
 * while a dashboard's dataset panel is open, and re-asked when something that shapes the figure changes.
 *
 * Everything the server counts under is in the key - the kept columns, the saved filters, the saved date
 * window - so this query re-reads on its own when one of them changes and needs no invalidation from the
 * update mutation. Which is the point: the alternative is invalidating on every save, and then renaming a
 * dashboard or rearranging its preview columns spends a BigQuery job on a figure that cannot have moved.
 *
 * The values must be the *saved* ones, not what is staged on screen: the count is taken server-side from
 * the stored dashboard, so a key built from a draft would label one figure with another's inputs.
 *
 * @param campaignId      the campaign id
 * @param dashboardId     the dashboard whose dataset to count, or undefined while no panel is open
 * @param optionalColumns the saved optional-column selection
 * @param filters         the saved dataset filters
 * @param dateWindow      the saved date window
 */
export function useDashboardPreview(
  campaignId: number | undefined,
  dashboardId: number | undefined,
  optionalColumns: string[] = [],
  filters: DashboardDatasetFilterV1[] = NO_DASHBOARD_FILTERS,
  dateWindow: DateWindow = NO_DATE_WINDOW
) {
  return useQuery({
    queryKey: [
      "campaigns",
      "dashboard-preview",
      campaignId,
      dashboardId,
      optionalColumns.join(","),
      filters,
      dateWindow.from,
      dateWindow.to,
    ],
    queryFn: () => previewDashboardDataset(campaignId as number, dashboardId as number),
    enabled: campaignId != null && dashboardId != null,
    staleTime: 60_000,
  });
}

/**
 * One dashboard dataset preview page, read from the same BigQuery query that creates the ClicData table.
 *
 * Filters are applied server-side against the output aliases, not against whatever rows have already been
 * loaded in the browser. The optional column selection is part of the key because it changes the source
 * query shape and must invalidate an old preview page immediately.
 */
export function useDashboardDatasetRows(
  campaignId: number | undefined,
  dashboardId: number | undefined,
  optionalColumns: string[] = [],
  filters: DashboardDatasetFilterV1[] = NO_DASHBOARD_FILTERS,
  dateWindow: DateWindow = NO_DATE_WINDOW
) {
  return useInfiniteQuery({
    queryKey: [
      "campaigns",
      "dashboard-dataset-rows",
      campaignId,
      dashboardId,
      optionalColumns.join(","),
      filters,
      dateWindow.from,
      dateWindow.to,
    ],
    queryFn: ({ pageParam }) =>
      listDashboardDatasetRows(
        campaignId as number,
        dashboardId as number,
        pageParam,
        DASHBOARD_DATASET_PAGE_SIZE,
        { filters, dateFrom: dateWindow.from || undefined, dateTo: dateWindow.to || undefined }
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPageParam < (lastPage.totalPages ?? 0) ? lastPageParam + 1 : undefined,
    enabled: campaignId != null && dashboardId != null,
    // Every filter and date change mints a new key, so without this the preview empties to nothing while
    // BigQuery is read and the row count loses the figure it was showing. Keeping the previous page means
    // the rows stay put under a loading overlay instead, as the Reporting tab's own rows do.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/**
 * Distinct values for one dashboard preview output column, loaded only while its filter popover is open.
 */
export function useDashboardDatasetDistinctValues(
  campaignId: number | undefined,
  dashboardId: number | undefined,
  field: string | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["campaigns", "dashboard-dataset-distinct-values", campaignId, dashboardId, field],
    queryFn: () =>
      listDashboardDatasetDistinctValues(campaignId as number, dashboardId as number, field as string),
    enabled: enabled && campaignId != null && dashboardId != null && field != null,
    staleTime: 5 * 60_000,
  });
}
