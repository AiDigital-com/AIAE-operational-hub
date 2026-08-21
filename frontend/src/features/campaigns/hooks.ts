import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_DIMS, DEFAULT_METRICS } from "../pacing/mock/reports";
import {
  applyConversionAdjustments,
  createReportView,
  deleteReportView,
  duplicateReportView,
  getCampaign,
  listCampaignInsertionOrders,
  listCampaignReportRows,
  listConversionBreakdown,
  listReportRowDistinctValues,
  listReportViews,
  saveReportRowAdjustments,
  updateReportView,
  uploadBulkAdjustments,
  uploadConversionAdjustments,
} from "./api";
import { toSetupModel } from "./setup";
import type {
  CampaignV1,
  ConversionAdjustmentRowV1,
  ConversionBreakdownRequestV1,
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
const NO_FILTERS: ReportRowFilterV1[] = [];
const NO_GROUPING: ReportRowFilterFieldEnumV1[] = [];

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns", "report-rows", campaignId] }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns", "report-rows", campaignId] }),
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
  columnOrder: [],
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
    columnOrder: [...DEFAULT_REPORT_CONFIG.columnOrder],
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
      // Absent/empty means the default arrangement - the same thing a report saved before this field
      // existed gets, so it must read exactly the same as an explicit [].
      columnOrder: dto.columnOrder ?? [],
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
