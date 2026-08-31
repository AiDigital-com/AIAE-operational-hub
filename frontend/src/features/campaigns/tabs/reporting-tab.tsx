import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { useDebounce } from "../../../shared/hooks/use-debounce";
import { cn } from "../../../shared/style/cn";
import {
  DataTable,
  DataTableViewControls,
  columnDragCellClass,
  columnDropCellClass,
  columnStyle,
} from "../../../shared/ui/data-table/data-table";
import type { DataTableColumn, DataTableColumnReorder } from "../../../shared/ui/data-table/data-table";
import { DataTableFilterBar } from "../../../shared/ui/data-table/data-table-filter-bar";
import type { AppliedFilter } from "../../../shared/ui/data-table/data-table-filter-bar-model";
import {
  DataTableDateFilterPopover,
  DataTableFieldPickerPopover,
  DataTableValueFilterPopover,
} from "../../../shared/ui/data-table/data-table-popover";
import { insertAtBoundary, withShownColumns, useColumnWidths, useTableExpand } from "../../../shared/ui/data-table/data-table-hooks";
import {
  CloseIcon,
  EditIcon,
  MoreVerticalIcon,
  PlusIcon,
  SearchIcon,
  UndoIcon,
} from "../../../shared/ui/icons/icons";
import { LoadingBlock, LoadingOverlay, LoadingSpinner } from "../../../shared/ui/loading-spinner/loading-spinner";
import { Modal } from "../../../shared/ui/modal/modal";
import { useToast } from "../../../shared/ui/toast/toast";
import { useSidebarCollapse } from "../../layout/app-shell/sidebar-collapse";
import { fmtDate } from "../../pacing/mock/format";
import {
  ADJUSTMENT_KEY_DIM_IDS,
  ADJUSTMENT_WRITE_DIM_IDS,
  DIM_DEFS,
  CONSTRUCTED_NAME_PART_IDS,
  DEFAULT_DIMS,
  METRIC_DEFS,
  PLATFORM_LEVELS,
  constructedNameParts,
  inheritedNamePrefix,
  fmtMetric,
  inheritedDimValues,
  levelDimLabel,
  resolveLevelTerms,
  rowMetricCell,
} from "../../pacing/mock/reports";
import type { Adjustments, DimDef, MetricDef } from "../../pacing/mock/types";
import {
  downloadBulkAdjustmentTemplate,
  downloadConversionAdjustmentTemplate,
  exportReportRows,
} from "../api";
import {
  ADD_LINE_ID_DIM_IDS,
  ADD_LINE_LEVEL_ID_DIM_ID,
  ADD_LINE_LEVEL_NAME_DIM_ID,
  ADD_LINE_SERVER_OWNED_DIM_IDS,
} from "../constants/add-line";
import {
  useReportRowDistinctValues,
  useReportRows,
  useReports,
  useSaveReportRowAdjustments,
  useUploadBulkAdjustments,
  useUploadConversionAdjustments,
  NO_DATE_WINDOW,
} from "../hooks";
import type { DateWindow } from "../hooks";
import type { CampaignTabContext } from "../campaign-workspace";
import { AddLineIdCell } from "./add-line-id-cell";
import type { AddLineLevel } from "../model/add-line";
import type { FilterPopover } from "../model/reporting-filters";
import type {
  DirectionEnumV1,
  ReportConfig,
  ReportRowAdjustmentV1,
  ReportRowFilterFieldEnumV1,
  ReportRowFilterV1,
  ReportRowSortFieldEnumV1,
  ReportRowsPageResponseV1,
  ReportRowTotalsV1,
  ReportRowV1,
} from "../types";
import { ConversionsBreakdown, type ConversionBreakdownTarget } from "./conversions-breakdown";
import { RollbackAdjustmentsModal } from "./rollback-adjustments-modal";
import "./reporting-tab.css";

/** A report row with a stable identity key. A single line item can appear several times on the same date
 * by tactic/account/constructed hierarchy, so date+line_item_id is not unique enough for inline edits. */
type KeyedReportRow = ReportRowV1 & { key: string };

/** One undo step: the staged batch as it was just before `cellId`'s first edit in its current streak -
 * further keystrokes on the same cell don't push another entry, so one Undo reverts the whole edit. */
interface HistoryEntry {
  cellId: string;
  snapshot: Adjustments<KeyedReportRow>;
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

// The ASCII Unit Separator (0x1F): a non-printable control character that never occurs in ad-ops
// metadata, so joining the identity fields with it can't collide the way two fields' values
// concatenated with a printable delimiter could.
const ROW_KEY_FIELD_SEPARATOR = String.fromCharCode(31);

function rowKey(row: ReportRowV1): string {
  return [
    row.date,
    row.platform,
    row.account,
    row.account_id,
    row.line_item_name,
    row.line_item_id,
    row.insertion_order_name,
    row.insertion_order_id,
    row.campaign_constructed_name,
    row.campaign_constructed_id,
    row.agency_id,
    row.client,
    row.industry_code,
    row.campaign_name,
    row.channel,
    row.tactic,
    row.buying_model,
    row.audience,
    row.unique_line_item_id,
    row.other,
    row.geo,
    row.creative_tag,
    row.message,
    row.keyword_group,
    row.flight_identifier,
    row.language,
    row.rate_type,
    row.line_item_description,
  ]
    .map((value) => String(value ?? ""))
    .join(ROW_KEY_FIELD_SEPARATOR);
}

function withKey(row: ReportRowV1): KeyedReportRow {
  return { ...row, key: rowKey(row) };
}

/** Identifies one row+metric cell, for tracking which cells currently hold unparsable input and which
 * already have an undo snapshot for their current edit streak. */
function cellKey(key: string, metricId: string): string {
  return `${key}::${metricId}`;
}

/** Whether a manually-added row still holds only what `addRow` seeded — the inherited campaign
 * fields and the naming-convention prefix. Blank/undefined values count as unset on both sides,
 * because `parseMetricInput` stores `undefined` for a metric the user typed into and then cleared. */
function isPristineAddedRow(
  row: KeyedReportRow,
  inheritedFields: Partial<KeyedReportRow>,
  namePrefix: string
): boolean {
  const seed: Partial<Record<string, unknown>> = { ...inheritedFields, line_item_name: namePrefix };
  const isUnset = (value: unknown) => value == null || value === "";
  for (const field of Object.keys(row)) {
    if (field === "key") continue;
    const rowValue = row[field as keyof KeyedReportRow];
    if (isUnset(rowValue)) continue;
    const seedValue = seed[field];
    if (isUnset(seedValue)) return false;
    if (String(rowValue) !== String(seedValue)) return false;
  }
  return true;
}

function dimColClass(id: string): string {
  return cn(
    "reporting-tab__dim-col",
    id === "date" && "reporting-tab__dim-col--date",
    id === "line_item_id" && "reporting-tab__dim-col--line-item"
  );
}

function metricColClass(id: string): string {
  return cn(
    "reporting-tab__num",
    "reporting-tab__metric-col",
    (id === "spend" ||
      id === "dynamic_cost" ||
      id === "dynamic_rate" ||
      id === "avg_dynamic_rate_by_date_tactic" ||
      id === "cpm") &&
      "reporting-tab__metric-col--money"
  );
}

function dimCell(id: string, row: ReportRowV1): ReactNode {
  const value = row[id as keyof ReportRowV1];
  if (id === "date" && value) return fmtDate(String(value));
  if ((id === "created_at" || id === "last_modified_at") && value) return fmtDate(String(value));
  // The level-1 id reads as the row's identity, so it carries the weight the other dimensions don't.
  // Deliberately just the id: the constructed name it used to sit above is a column of its own when a
  // report wants it, and repeating it under every id cost two lines per row to say nothing new.
  if (id === "line_item_id") {
    return <span className="reporting-tab__li-id">{value == null ? "—" : String(value)}</span>;
  }
  return value == null ? "—" : String(value);
}

/** Stored metrics an inline edit or bulk adjustment may change. CPM/CTR/AVCR are deliberately absent -
 * they are not stored anywhere, recomputed live from the edited stored fields, and never writable (see
 * ReportRowAdjustmentV1, which has no field for them at all). dynamic_rate/avg_dynamic_rate_by_date_tactic
 * are absent for the same reason: they only exist on the read view, not on the write table, so the
 * contract has no field for them either. */
/** The delivery metrics an adjustment can write. The three conversion columns are absent: a report's
 *  conversions come from the conversions mart, so a value written to the delivery table would never be
 *  shown - they are edited through the conversions pair instead. */
const EDITABLE_METRIC_IDS = new Set([
  "impressions", "clicks", "spend", "starts", "first_quartiles", "midpoints", "third_quartiles",
  "completes", "dynamic_cost", "link_clicks",
]);

/** Integer (int64) metrics — BigQuery rejects a fractional value for these columns, so the frontend
 *  validates `Number.isInteger` before allowing Save. Matches the OpenAPI `format: int64` declarations. */
const INTEGER_METRIC_IDS = new Set([
  "impressions", "clicks", "starts", "first_quartiles", "midpoints", "third_quartiles",
  "completes", "link_clicks",
]);

/** Validates a raw metric input string, returning a specific error message or `null` when valid.
 *  Blank is valid (an unset value, not an edit). Enforces: finite, non-negative, integer for int64
 *  metrics — all things BigQuery would reject on INSERT, caught here so the user never sees an OPH_027. */
function metricValidationError(raw: string, metricId: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Not a number";
  if (n < 0) return "Must be ≥ 0";
  if (INTEGER_METRIC_IDS.has(metricId) && !Number.isInteger(n)) return "Must be a whole number";
  return null;
}

/** Parses a metric input for staging. Non-finite values (including `Number("abc") === NaN`) become
 *  `undefined` rather than `NaN` — React would otherwise render the literal string "NaN" in the cell
 *  and the user would have to select-all to clear it. */
function parseMetricInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Display value for an editable metric cell. Never surfaces `NaN` (see {@link parseMetricInput}). */
function editableMetricDisplay(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

/** The identity (non-metric) fields an adjustment carries - everything ReportRowAdjustmentV1 accepts
 * except the metrics themselves; client/campaign identity is sent from the mart row, while the four audit
 * stamps and `adjusted_metrics` are server-owned and never sent - none of the five are even fields of
 * ReportRowAdjustmentV1, so there is nothing here for a client value to overwrite.
 * rate_type/line_item_description are read-only display columns (not in ReportRowAdjustmentV1) for the
 * same reason the metrics above are excluded - no column for them on the write table.
 *
 * Wider than the edit guard's own key (see `missingEditDims`): the CNB_* half of this is written but
 * never read back by the view, so a grouped read leaving it null costs nothing. Only the key has to be
 * on screen for a save to land. */
function identityFields(row: ReportRowV1): Partial<ReportRowAdjustmentV1> {
  const fields: Record<string, unknown> = {};
  for (const id of ADJUSTMENT_WRITE_DIM_IDS) {
    fields[id] = row[id];
  }
  return fields as Partial<ReportRowAdjustmentV1>;
}

/**
 * The same identity, with hand-typed text trimmed.
 *
 * Every comparison the reporting spreadsheets make on these names wraps both sides in TRIM, so a key typed
 * with a stray space is one they would call equal and an exact-key write would not: the row lands in the
 * write table and then matches nothing on read. Typed rows only - a value read back from the mart is
 * written exactly as the mart holds it, or an override stops lining up with the row it adjusts.
 */
function typedIdentityFields(row: ReportRowV1): Partial<ReportRowAdjustmentV1> {
  const fields = identityFields(row) as Record<string, unknown>;
  for (const [id, value] of Object.entries(fields)) {
    if (typeof value === "string") fields[id] = value.trim();
  }
  return fields as Partial<ReportRowAdjustmentV1>;
}

interface ReportTypeOption {
  id: string;
  label: string;
  active: boolean;
}

const REPORT_TYPE_MENU: ReportTypeOption[] = [
  { id: "basic", label: "Basic", active: true },
  { id: "conversions", label: "Conversions", active: false },
  { id: "geo", label: "Geo", active: false },
  { id: "keywords", label: "Keywords", active: false },
  { id: "business", label: "Business outcomes", active: false },
  { id: "live-sports", label: "Live Sports", active: false },
  { id: "device", label: "Device", active: false },
  { id: "genre", label: "Genre", active: false },
  { id: "demographics", label: "Demographics", active: false },
];

/** Replaces characters that are unsafe in a downloaded filename with a hyphen. */
function fileSafe(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}

/**
 * A report's created/edited stamp, in the same "Mon D, YYYY" every other date in the tab is written in.
 *
 * The list used to shorten these to `21.07.26`, which is both a different convention from the table
 * directly below it and an ambiguous one - 21.07.26 is the 21st of July to a European reader and
 * nothing at all to an American one, on a screen whose every other date reads "Jul 21, 2026".
 *
 * Only the date half of the timestamp: the list answers which day a report was saved, and the time of
 * day was never what anyone came to it for.
 */
function fmtStamp(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? fmtDate(iso.slice(0, 10)) : iso;
}

const EMPTY_CONFIG: ReportConfig = { dimensions: [], metrics: [], filters: [] };
const PICKER_SEARCH_DEBOUNCE_MS = 300;
const REPORT_NAME_MAX_LENGTH = 50;
/** The Date dimension, whose filter is a window rather than a value list and so is held separately. */
const DATE_DIM_ID = "date";
const CONVERSION_BREAKDOWN_BASE_DIM_IDS = ["date", "line_item_name", "channel"] as const;
const CAMPAIGN_LEVEL_CONVERSION_CHANNELS = new Set(["Google SEM", "Google Search", "YouTube"]);
/** The CNB_* dimensions the view derives by splitting the constructed name, so an added row shows
 * them read-only rather than inviting a value that would be overwritten on read. */
const NAME_DERIVED_DIMS = new Set<string>(CONSTRUCTED_NAME_PART_IDS);
/** The three constructed-id dimensions an added row never lets the user type (PDI_117 D1). */
const ID_DERIVED_DIMS = new Set<string>(ADD_LINE_ID_DIM_IDS);
/** The five server-owned dimensions an added row never lets the user type (PDI_116): the four audit
 * stamps are bound server-side at write time, and `adjusted_metrics` is derived server-side from which
 * metrics an adjustment actually carries a value for (see the backend's `AdjustedMetricsMarker`) - none
 * of the five are even fields of the request contract, so a typed value in any of them is dropped. */
const SERVER_OWNED_DIMS = new Set<string>(ADD_LINE_SERVER_OWNED_DIM_IDS);

/**
 * Puts a report's columns in the order it was saved with, for one group of them (dimensions or metrics).
 *
 * Canonical order is the fallback and the default, not a legacy path: `columnOrder` is absent until someone
 * drags a column, and it must stay absent-meaning-canonical, because the selection lists cannot stand in for
 * it - they carry the order the checkboxes were ticked in.
 *
 * Ids the saved order does not mention fall in behind the ones it does, keeping their canonical order among
 * themselves. That is what happens to a column added after the drag: it appears at the end rather than
 * making the whole arrangement collapse back to canonical.
 *
 * @param defs the group's definitions, in canonical order
 * @param selected the ids selected for the report
 * @param columnOrder the saved column order, or undefined
 * @returns the definitions to render, in display order
 */
function inSavedOrder<T extends { id: string }>(
  defs: readonly T[],
  selected: string[],
  columnOrder: string[] | undefined
): T[] {
  const shown = defs.filter((def) => selected.includes(def.id));
  if (!columnOrder || columnOrder.length === 0) return shown;
  const place = (id: string) => {
    const at = columnOrder.indexOf(id);
    return at === -1 ? columnOrder.length : at;
  };
  return shown
    .map((def, canonical) => ({ def, canonical }))
    .sort((a, b) => place(a.def.id) - place(b.def.id) || a.canonical - b.canonical)
    .map((entry) => entry.def);
}

/** One column of the unified, on-screen order the table renders from - a dimension or a metric, carrying
 *  its own definition so the header, the totals row and the body rows can all tell which cell-rendering
 *  rules apply without a second lookup. Replaces rendering from `dims`/`mets` as two separate lists: those
 *  still say which columns are selected (and, for dimensions, the grouping key), but concatenating them
 *  always puts every dimension before every metric, which is exactly the arrangement a metric dropped
 *  between two dimensions needs to escape. */
type ReportColumn = { kind: "dimension"; dim: DimDef } | { kind: "metric"; met: MetricDef };

/**
 * The full column order a report actually renders, as one interleaved list of ids.
 *
 * `columnOrder` may only cover part of the current selection - a freshly selected column has no place in
 * it yet - so this resolves it into a complete list before anything renders or a drag reorders it: every
 * id `columnOrder` names, in that order (dropping any id that isn't currently selected); then every
 * dimension `columnOrder` doesn't mention, inserted right after the last dimension it does (or at the very
 * start when it names none), so an unlisted dimension still lands among the dimensions rather than at the
 * tail of the whole table; then every metric it doesn't mention, appended at the very end. Absent/empty
 * `columnOrder` reduces to the historic default: every dimension in fallback order, then every metric.
 *
 * @param dimensionIds the currently selected dimension ids, in fallback order
 * @param metricIds    the currently selected metric ids, in fallback order
 * @param columnOrder  the report's saved/dragged arrangement, or `undefined` for a report saved before
 *                      this field existed
 * @returns every selected id exactly once, in the order its column renders
 */
function resolveColumnOrder(
  dimensionIds: string[],
  metricIds: string[],
  columnOrder: string[] | undefined
): string[] {
  const selectedDims = new Set(dimensionIds);
  const selectedMets = new Set(metricIds);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of columnOrder ?? []) {
    if ((selectedDims.has(id) || selectedMets.has(id)) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  let dimInsertAt = ordered.reduce((last, id, index) => (selectedDims.has(id) ? index + 1 : last), 0);
  for (const id of dimensionIds) {
    if (seen.has(id)) continue;
    ordered.splice(dimInsertAt, 0, id);
    seen.add(id);
    dimInsertAt += 1;
  }
  for (const id of metricIds) {
    if (seen.has(id)) continue;
    ordered.push(id);
    seen.add(id);
  }
  return ordered;
}

/** Membership form of the view's adjustment key, for the raw-grain edit guard. */
const ADJUSTMENT_KEY_DIMS = new Set<string>(ADJUSTMENT_KEY_DIM_IDS);

/** A saved report's filters, split into the two shapes the tab holds them in. */
interface HydratedFilters {
  /** Value-list filters by dimension id - every dimension except Date. */
  values: Record<string, string[]>;
  dateWindow: DateWindow;
}

/**
 * Reads a saved report's filters into the tab's state, turning a saved Date filter into the window.
 *
 * Date used to be filtered like any other dimension, a checkbox per distinct delivery date. That column
 * now filters by a From/To window, and its funnel opens the window - so DATE filters only hydrate when
 * they carry the window shape written by {@link savedReportFilters}: [from, to]. Anything else is
 * dropped rather than guessed into a different period.
 *
 * @param filters the saved report's filters
 * @returns the value-list filters and the date window to open with
 */
function hydrateFilters(filters: ReportRowFilterV1[] | undefined): HydratedFilters {
  const values: Record<string, string[]> = {};
  let dateWindow = NO_DATE_WINDOW;
  for (const filter of filters ?? []) {
    const id = filter.field.toLowerCase();
    if (id !== DATE_DIM_ID) {
      values[id] = filter.values;
    } else if (filter.values.length === 2) {
      dateWindow = { from: filter.values[0] ?? "", to: filter.values[1] ?? "" };
    }
  }
  return { values, dateWindow };
}

/**
 * Serializes the tab's current filters back into the report-view shape.
 *
 * Date is held outside {@code activeFilters} because live row reads use the dedicated dateFrom/dateTo
 * request fields. Report views only persist filter arrays today, so the saved view carries Date as a
 * two-value filter: [from, to] - written whenever the window is set (PDI_115 D2), regardless of
 * whether the Date dimension is one of the report's displayed columns.
 *
 * @param activeFilters value-list filters currently applied
 * @param dateWindow    current delivery-date window
 * @returns filters for the saved report view
 */
function savedReportFilters(activeFilters: ReportRowFilterV1[], dateWindow: DateWindow): ReportRowFilterV1[] {
  const filters = activeFilters.filter((filter) => filter.field !== "DATE");
  if (dateWindow.from === "" && dateWindow.to === "") {
    return filters;
  }
  return [...filters, { field: "DATE", values: [dateWindow.from, dateWindow.to] }];
}

/** Reads one metric total from the server's full-dataset totals, never from loaded-page rows alone -
 * a paginated table's totals row must stay stable as more pages load, per 01-MIGRATION-PLAN.md. */
function totalCell(totals: ReportRowTotalsV1 | undefined, id: string): string {
  const value = totals?.[id as keyof ReportRowTotalsV1];
  return value == null ? "—" : fmtMetric(id, Number(value));
}

/** A metric value from a row or an edit, as a number - a cleared cell holds `""` and counts as nothing. */
function metricNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The totals row with the staged, unsaved edits in it.
 *
 * The server totals every matching row, which is always more than the client has loaded, so they cannot
 * be recomputed here from scratch. They can be <em>shifted</em>: an edit is only ever made to a row on
 * screen, so its before and after are both to hand, and adding the difference to the server's total is
 * exact however few pages have arrived. An added row shifts by its whole value.
 *
 * This is what the feature is for. Someone adjusting delivery to land on an agreed number is doing
 * arithmetic against the totals row; if it only answers one save later, the adjusting is done blind.
 *
 * The ratios re-derive from the shifted sums, weighted the way the server weights them. IVT does not:
 * it is modelled from a coefficient table keyed on the impression count, and re-modelling it here would
 * fork that definition into the client, so it stays at the server's figure until the save. Same for
 * dynamic_rate. Neither is editable; both move only as a consequence of what is.
 *
 * @param server   the server's own full-dataset totals
 * @param staged   the unsaved overrides and added rows
 * @param baseByKey the loaded rows an override applies to, by row key
 * @returns the totals to show, or {@code server} unchanged when nothing staged moves a total
 */
function stagedTotals(
  server: ReportRowTotalsV1 | undefined,
  staged: Adjustments<KeyedReportRow>,
  baseByKey: Map<string, KeyedReportRow>
): ReportRowTotalsV1 | undefined {
  if (server == null) return server;
  const delta = new Map<string, number>();
  function shift(id: string, amount: number) {
    if (amount !== 0) delta.set(id, (delta.get(id) ?? 0) + amount);
  }
  for (const [key, changes] of Object.entries(staged.adj)) {
    // One delta per key against the row the save itself will diff against, so the previewed total is
    // the total the save produces rather than one counting a repeated identity twice.
    const base = baseByKey.get(key);
    if (base == null) continue;
    for (const id of EDITABLE_METRIC_IDS) {
      const next = changes[id as keyof KeyedReportRow];
      if (next == null) continue;
      shift(id, metricNumber(next) - metricNumber(base[id as keyof KeyedReportRow]));
    }
  }
  for (const row of staged.added) {
    for (const id of EDITABLE_METRIC_IDS) {
      shift(id, metricNumber(row[id as keyof KeyedReportRow]));
    }
  }
  if (delta.size === 0) return server;

  const shifted = { ...server } as Record<string, number | null | undefined>;
  for (const [id, amount] of delta) {
    shifted[id] = metricNumber(server[id as keyof ReportRowTotalsV1]) + amount;
  }
  const impressions = metricNumber(shifted.impressions);
  const clicks = metricNumber(shifted.clicks);
  const starts = metricNumber(shifted.starts);
  const spend = metricNumber(shifted.spend);
  shifted.cpm = impressions === 0 ? null : (spend / impressions) * 1000;
  shifted.cpc = clicks === 0 ? null : spend / clicks;
  shifted.cpv = starts === 0 ? null : spend / starts;
  shifted.ctr = impressions === 0 ? null : (clicks / impressions) * 100;
  shifted.avcr = impressions === 0 ? null : (metricNumber(shifted.completes) / impressions) * 100;
  return shifted as ReportRowTotalsV1;
}

/** A filter's applied values, in as few words as it takes: the single value, both values joined, or a
 *  count once there are more than that to name (PDI_115 - matches the mock's own chip-text thresholds). */
function filterSummary(values: readonly string[]): string {
  return values.length <= 2 ? values.join(", ") : `${values.length} selected`;
}

/** States a delivery-date window in words, including the open-ended halves. */
function dateWindowSummary(window: DateWindow): string {
  if (window.from !== "" && window.to !== "") return `${fmtDate(window.from)} — ${fmtDate(window.to)}`;
  return window.from !== "" ? `from ${fmtDate(window.from)}` : `up to ${fmtDate(window.to)}`;
}

/**
 * The Reporting tab's reports list + inline master-detail builder (01-MIGRATION-PLAN.md W4):
 * dimension/metric pickers staged into a draft and only reflected in the data table on Apply, mirroring
 * the mockup's own `applyView` staging behavior. "Edit data" (inline cell edits, manually-added rows,
 * bulk adjustment) writes to the real BigQuery adjustments table (§0b) via a local staged overlay -
 * `Adjustments<KeyedReportRow>` - that mirrors the same base⊕adjustments pattern Setup already uses,
 * committed in one batch on Save; the server-merged view is the source of truth afterward, not the
 * client's own overlay.
 */
/**
 * Which spreadsheet or table Edit data is working on. "bulk" and "conversions" are separate modes rather
 * than one file with more columns: a delivery row is one line item on one day, a conversions row is that
 * plus a conversion action, so a conversions figure on a delivery row would have no action to belong to.
 */
type EditMode = "lines" | "bulk" | "conversions";

export function ReportingTab() {
  const { campaign } = useOutletContext<CampaignTabContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const reports = useReports(campaign);
  const saveAdjustments = useSaveReportRowAdjustments(campaign.id);
  const uploadBulk = useUploadBulkAdjustments(campaign.id);
  const uploadConversions = useUploadConversionAdjustments(campaign.id);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadConversionsInputRef = useRef<HTMLInputElement>(null);
  const [sortField, setSortField] = useState<ReportRowSortFieldEnumV1 | null>(null);
  const [sortDirection, setSortDirection] = useState<DirectionEnumV1>("ASC");
  const [filterState, setFilterState] = useState<Record<string, string[]>>({});
  // Dates are a window, not a value list: a quarter would be ninety checkboxes, and the picker's
  // distinct-value list is capped server-side, so on a long flight it could not offer them all.
  const [dateWindow, setDateWindow] = useState<DateWindow>(NO_DATE_WINDOW);
  const [editing, setEditing] = useState(false);
  const [staged, setStaged] = useState<Adjustments<KeyedReportRow>>({ adj: {}, added: [] });
  const [invalidCells, setInvalidCells] = useState<Map<string, string>>(new Map());
  /** In-progress typed text per metric cell. Keeps half-finished/invalid keystrokes visible (and
   *  backspaceable) instead of collapsing them through `Number()` into `NaN` / the literal "NaN". */
  const [metricDrafts, setMetricDrafts] = useState<Map<string, string>>(new Map());
  const [requiredCells, setRequiredCells] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [snapshotted, setSnapshotted] = useState<Set<string>>(new Set());
  // "Latest value" refs so the edit callbacks below can be stable (useCallback, empty deps) without
  // closing over stale state - required for the memoized ReportRow to actually skip unedited rows
  // while typing (see D6, NEW-UX-PLAN/11-REPORTING-TABLE-PERFORMANCE-PLAN.md), and lets the Ctrl+Z
  // listener effect drop `history` from its deps so it binds once instead of on every edit.
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const snapshottedRef = useRef(snapshotted);
  snapshottedRef.current = snapshotted;
  const historyRef = useRef(history);
  historyRef.current = history;

  /** Marks a cell valid/invalid based on whether its value parses as a valid metric (finite, non-negative,
   *  integer for int64 metrics; blank counts as valid - an unset value, not an edit). Stores the specific
   *  error message so the row can show "Must be ≥ 0" vs "Not a number" vs "Must be a whole number".
   *  Bails out to the same `Map` reference when membership doesn't change, so passing `invalidCells` to
   *  the memoized ReportRow below doesn't churn its identity on every keystroke that doesn't actually
   *  flip a cell's validity. */
  const markCellValidity = useCallback((key: string, metricId: string, raw: string) => {
    const error = metricValidationError(raw, metricId);
    setInvalidCells((current) => {
      const id = cellKey(key, metricId);
      const prev = current.get(id) ?? null;
      if (prev === error) return current;
      const next = new Map(current);
      if (error) next.set(id, error);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Pushes an undo snapshot the first time a cell is touched in its current edit streak - further
   * keystrokes on the same cell are absorbed into that one streak, so one Undo reverts the whole edit,
   * not one keystroke. Reads `staged`/`snapshotted` via refs (not directly) so this can be a stable
   * (empty-deps) callback. */
  const snapshotOnce = useCallback((id: string) => {
    if (snapshottedRef.current.has(id)) return;
    setHistory((current) => [...current, { cellId: id, snapshot: stagedRef.current }]);
    setSnapshotted((current) => new Set(current).add(id));
  }, []);

  /** Stages one metric cell's edited value for an existing row, keyed by its stable identity. Stable
   * (useCallback) so the memoized ReportRow below only re-renders the row whose cell actually changed. */
  const updateCell = useCallback(
    (key: string, metricId: string, raw: string) => {
      markCellValidity(key, metricId, raw);
      snapshotOnce(cellKey(key, metricId));
      // Keep the typed draft so a half-finished/invalid keystroke (e.g. "8,") is still visible and
      // backspaceable — storing only `Number(raw)` would collapse invalid input to NaN/"NaN".
      setMetricDrafts((current) => {
        const id = cellKey(key, metricId);
        if (current.get(id) === raw) return current;
        const next = new Map(current);
        next.set(id, raw);
        return next;
      });
      const numeric = parseMetricInput(raw);
      setStaged((current) => ({
        ...current,
        adj: { ...current.adj, [key]: { ...current.adj[key], [metricId]: numeric } },
      }));
    },
    [markCellValidity, snapshotOnce]
  );

  /** Stages one field (identity or metric) of a manually-added row. Stable (useCallback) for the same
   * reason as `updateCell`. */
  const updateAddedRow = useCallback(
    (key: string, field: string, raw: string) => {
      const isMetric = EDITABLE_METRIC_IDS.has(field);
      if (isMetric) {
        markCellValidity(key, field, raw);
        snapshotOnce(cellKey(key, field));
        setMetricDrafts((current) => {
          const id = cellKey(key, field);
          if (current.get(id) === raw) return current;
          const next = new Map(current);
          next.set(id, raw);
          return next;
        });
      }
      const value = isMetric ? parseMetricInput(raw) : raw;
      setStaged((current) => ({
        ...current,
        added: current.added.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
      }));
      // Clear a Required flag once the user fills any write-table REQUIRED key dim (or a metric that
      // was flagged because the row had none).
      if (raw.trim() && (ADJUSTMENT_KEY_DIMS.has(field) || isMetric)) {
        setRequiredCells((current) => {
          const id = cellKey(key, field);
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [markCellValidity, snapshotOnce]
  );

  /** Fills one level's resolved/picked id - the id is never typed (D1); the name cell is untouched.
   *  PDI_117 D2: resolution is per level, so this is the only Add Line identity wiring the parent owns -
   *  each level decides for itself whether it resolved or was generated, with no row-level mode state. */
  const onResolveAddLineId = useCallback(
    (key: string, level: AddLineLevel, id: string) => {
      updateAddedRow(key, ADD_LINE_LEVEL_ID_DIM_ID[level], id);
    },
    [updateAddedRow]
  );

  const [downloading, setDownloading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = reports.views.find((view) => view.id === selectedId) ?? reports.views[0];
  const [draftConfig, setDraftConfig] = useState<ReportConfig>(EMPTY_CONFIG);
  const [appliedConfig, setAppliedConfig] = useState<ReportConfig>(EMPTY_CONFIG);
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [hydratedViewId, setHydratedViewId] = useState<string | null>(null);

  // Loads the selected report's own config into the builder. Done during render rather than in an
  // effect on purpose: the applied dimensions are part of the row query's key now, so hydrating a
  // commit later would fire one BigQuery read for the empty default config and a second for the
  // report's real one. React discards this render and re-runs with the new state before any effect
  // (and therefore before React Query subscribes), so the table only ever reads once.
  if (selected && hydratedViewId !== selected.id) {
    setHydratedViewId(selected.id);
    setDraftConfig(selected.config);
    setAppliedConfig(selected.config);
    const hydrated = hydrateFilters(selected.config.filters);
    setFilterState(hydrated.values);
    // Always set, never left alone: a window is not saved on a report, so switching reports has to
    // start from this report's own period rather than silently inheriting the previous one's.
    setDateWindow(hydrated.dateWindow);
    setNameDraft(selected.name);
    setNameError(null);
    // Same reason as on Apply: the newly opened report need not show the column the table is currently
    // sorted by, and a grouped read cannot order by a dimension it does not group by. Filters/date are
    // unaffected either way (D3) - this only ever drops a stale sort.
    dropSortForDeselectedColumns(selected.config);
  }

  const activeFilters = useMemo<ReportRowFilterV1[]>(
    () =>
      Object.entries(filterState)
        .filter(([, values]) => values.length > 0)
        .map(([id, values]) => ({ field: id.toUpperCase() as ReportRowFilterFieldEnumV1, values })),
    [filterState]
  );
  // Every dimension filter currently in force, listed on the Filters bar rather than only inside the
  // column header it used to open from (PDI_115) - so what the rows have been reduced to is legible
  // without opening a popover to find out, and clearable without opening one either. Date is not among
  // these: the bar's own persistent pill owns it (D2), so it is never pruned here on a column change.
  const filterChips = useMemo<AppliedFilter[]>(
    () =>
      DIM_DEFS.filter((def) => (filterState[def.id]?.length ?? 0) > 0).map((def) => ({
        id: def.id,
        label: def.label,
        summary: filterSummary(filterState[def.id] ?? []),
        // Dashed and explained on the bar rather than pruned away (D3/D4): a filter surviving its
        // dimension's column leaving the report is exactly what this ticket asks for, so the bar has to
        // say so instead of the old code deleting the filter to avoid saying so.
        hiddenColumn: !appliedConfig.dimensions.includes(def.id),
        edit: (anchor: HTMLElement) => openValueFilter(def.id, anchor),
        clear: () => setFilterState((current) => ({ ...current, [def.id]: [] })),
      })),
    [filterState, appliedConfig.dimensions]
  );
  // The applied dimensions ARE the aggregation key (US-027/US-028): the server returns one row per
  // distinct combination with every metric aggregated over it, so narrowing the selection genuinely
  // re-reads coarser rows instead of just hiding columns of an already-loaded raw read. Ordered by
  // DIM_DEFS - the same order the columns render in - because the server selects, orders and tiebreaks
  // the grouped read by its first dimension.
  const appliedGroupBy = useMemo<ReportRowFilterFieldEnumV1[]>(
    () =>
      DIM_DEFS.filter((d) => appliedConfig.dimensions.includes(d.id)).map(
        (d) => d.id.toUpperCase() as ReportRowFilterFieldEnumV1
      ),
    [appliedConfig.dimensions]
  );
  // Reports load from Postgres first (cheap); the BigQuery-backed row data is only fetched once at
  // least one report exists to show it for - a campaign with zero reports would otherwise pay for a
  // multi-second BQ query just to render the "Create your first report" empty state.
  const hasReports = reports.views.length > 0;
  const reportRows = useReportRows(
    hasReports ? campaign.id : undefined,
    sortField,
    sortDirection,
    activeFilters,
    appliedGroupBy,
    dateWindow
  );
  // The saved-report list comes from Postgres and must become interactive as soon as it arrives. The
  // BigQuery row read is deliberately local to the table below, just like the dashboard dataset preview:
  // waiting for it here would hide already-available report metadata and configuration for several seconds.
  // This flag still makes the reports sentinel effect re-run on the render that actually mounts its row.
  const contentShown = !reports.isPending;

  const [dimQuery, setDimQuery] = useState("");
  const [metQuery, setMetQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reportMenuAnchor, setReportMenuAnchor] = useState<DOMRectReadOnly | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameNote, setRenameNote] = useState("");
  const [createDraftOpen, setCreateDraftOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createNote, setCreateNote] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  // Which of the Filters bar's popovers is open - the field picker, a dimension's value popover, or
  // the Date pill's own window popover - and where it hangs from. Replaces the funnel-era
  // `openFilterFor`/`filterAnchor` pair (PDI_115: the funnel itself is gone).
  const [filterPopover, setFilterPopover] = useState<FilterPopover | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("lines");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  // The level-1 campaigns a rollback would touch: the report's own line_item_name filter values - the
  // same names saveReportRowAdjustments writes and rollbackAdjustments deletes by. Not a picker of its
  // own; asking the user to filter by the dimension they mean to roll back keeps this destructive action
  // from ever defaulting to "every campaign in the report".
  const rollbackScopeNames = filterState.line_item_name ?? [];
  const { columnWidths, resizeColumn } = useColumnWidths();
  // Expanding hides everything above the table - the reports list, the builder, the controls - and
  // collapsing puts it all back, which moves the table a screenful or two down the page while the
  // scroll offset stays where it was. So the actions row is what both transitions bring back under the
  // eye; the hook does the scrolling, this ref says to what.
  const actionsRowRef = useRef<HTMLDivElement>(null);
  const sidebar = useSidebarCollapse();
  const { expanded, toggleExpanded } = useTableExpand({ space: sidebar, anchorRef: actionsRowRef });

  /** Toggles a dimension or metric column's sort: a new column starts ascending; the active column flips direction. */
  function toggleSort(columnId: string) {
    const field = columnId.toUpperCase() as ReportRowSortFieldEnumV1;
    if (sortField === field) {
      setSortDirection((direction) => (direction === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortField(field);
      setSortDirection("ASC");
    }
  }

  useEffect(() => {
    if (!menuFor && !createMenuOpen && !filterPopover && !downloadMenuOpen && !editMenuOpen) return undefined;
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".reporting-tab__menu-wrap")) {
        setMenuFor(null);
        setReportMenuAnchor(null);
        setCreateMenuOpen(false);
        setDownloadMenuOpen(false);
        setEditMenuOpen(false);
      }
      // The Filters bar is this page's own, the popover it opens is too - but missing either here does
      // not just fail to close - it closes on pointerdown so the button's own click reopens, and the
      // popover can never be dismissed by the control that opened it.
      if (!target.closest(".data-table__filter-bar") && !target.closest(".data-table__pop")) {
        setFilterPopover(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuFor, createMenuOpen, filterPopover, downloadMenuOpen, editMenuOpen]);

  useEffect(() => {
    if (!menuFor) return undefined;
    const closeReportMenu = () => {
      setMenuFor(null);
      setReportMenuAnchor(null);
    };
    window.addEventListener("resize", closeReportMenu);
    window.addEventListener("scroll", closeReportMenu, true);
    return () => {
      window.removeEventListener("resize", closeReportMenu);
      window.removeEventListener("scroll", closeReportMenu, true);
    };
  }, [menuFor]);

  // Ctrl/Cmd+Z undoes the most recent staged cell edit while in "Adjust individual lines" mode.
  useEffect(() => {
    if (!editing || editMode !== "lines") return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `undo` reads history via `historyRef`, not the `history` state directly, so this listener binds
    // once per edit session instead of re-binding on every staged edit (PERFORMANCE-AUDIT.md Low finding).
  }, [editing, editMode]);

  // Pages arrive already ordered by date then line item (see BigQueryReportRowService), so flattening
  // them in fetch order is enough - no client-side re-sort needed. `rowKey` hashes 28 fields, so keying
  // is cached per page object (React Query keeps already-loaded pages' object identity across
  // `fetchNextPage` - only the outer `pages` array is new): without this, `keyedTableRows` would
  // re-derive from `tableRows` and re-hash every row loaded so far on every page append, making a full
  // scroll O(n^2) (PERFORMANCE-AUDIT.md Medium finding).
  const pageKeyCache = useRef(new WeakMap<ReportRowsPageResponseV1, KeyedReportRow[]>());
  const keyedTableRows = useMemo(() => {
    const pages = reportRows.data?.pages ?? [];
    return pages.flatMap((page) => {
      const cached = pageKeyCache.current.get(page);
      if (cached) return cached;
      const keyed = page.content.map(withKey);
      pageKeyCache.current.set(page, keyed);
      return keyed;
    });
  }, [reportRows.data]);
  // Row identities to render, manually-added rows placed first - purely local, pre-save UI. New rows
  // must be immediately editable without scrolling to the paginated table tail. Deliberately does NOT
  // depend on `staged.adj`: applying a metric edit's override happens per-row inside the memoized
  // ReportRow below (see `override` prop), not by rebuilding this list on every keystroke.
  //
  // The render key is suffixed by each base row's occurrence count (not the array index): a single
  // (date, line_item_id) pair can legitimately repeat by tactic/account grain, and two rows can even
  // share the full 28-field identity, but an index-based key shifts every row below a prepended/sorted
  // row, forcing React to unmount+remount the whole tail instead of just moving nodes (tearing down
  // cell inputs mid-edit - PERFORMANCE-AUDIT.md High finding). Added rows carry their own
  // `added-<uuid>` key so they never affect a base row's occurrence count.
  const orderedRows = useMemo(() => {
    const occurrences = new Map<string, number>();
    function nextRenderKey(key: string): string {
      const count = occurrences.get(key) ?? 0;
      occurrences.set(key, count + 1);
      return count === 0 ? key : `${key}#${count}`;
    }
    return [
      ...staged.added.map((row) => ({ row, isAdded: true as const, renderKey: nextRenderKey(row.key) })),
      ...keyedTableRows.map((row) => ({ row, isAdded: false as const, renderKey: nextRenderKey(row.key) })),
    ];
  }, [staged.added, keyedTableRows]);
  const stagedCount = Object.keys(staged.adj).length + staged.added.length;
  const latestPage = reportRows.data?.pages[reportRows.data.pages.length - 1];
  // What the date pickers clamp to. Remembered from a read with no window applied, because the
  // response's own min/max cover the *filtered* set: once a window narrows them, using them as the
  // bounds would trap the user inside the range they just picked with no way back out.
  const unwindowedDates = useRef({ from: "", to: "" });
  if (!dateWindow.from && !dateWindow.to && latestPage?.min_date && latestPage.max_date) {
    unwindowedDates.current = { from: latestPage.min_date, to: latestPage.max_date };
  }
  // Which loaded row each override applies to, kept off the per-keystroke path: the totals below are
  // re-derived on every edit, and rebuilding this over every row loaded so far each time would make
  // typing cost O(rows loaded). First occurrence wins, matching what `submitSave` diffs against.
  const baseRowsByKey = useMemo(() => {
    const byKey = new Map<string, KeyedReportRow>();
    for (const row of keyedTableRows) {
      if (!byKey.has(row.key)) byKey.set(row.key, row);
    }
    return byKey;
  }, [keyedTableRows]);
  const totals = useMemo(
    () => stagedTotals(latestPage?.totals, staged, baseRowsByKey),
    [latestPage?.totals, staged, baseRowsByKey]
  );
  const distinctLineItemCount = latestPage?.distinct_line_item_count ?? 0;
  // Server-side over the whole filtered dataset, and over the groups rather than the source rows once
  // the report groups - so it says how much there is to scroll through, not how much has arrived.
  const totalRows = latestPage?.total_rows ?? 0;
  const loadedRows = keyedTableRows.length;
  // True only while a fresh page-one fetch is in flight - a sort, filter or regrouping change
  // (keepPreviousData keeps the old rows on screen meanwhile). Excludes fetchNextPage's own in-flight
  // state, which has its own sentinel spinner instead.
  const isReloading = reportRows.isFetching && !reportRows.isFetchingNextPage;
  // A constructed level means different things on different platforms (line item on DV360, campaign on
  // Google Ads, insertion order on Amazon...), so the level columns are named by the platform's own
  // word once the loaded rows agree on one, and by the neutral level name otherwise. Derived from the
  // rows actually in view, so loading a page that introduces a second platform correctly falls back.
  const levelTerms = useMemo(() => {
    const platforms = new Set<string>();
    for (const row of keyedTableRows) {
      if (row.platform) platforms.add(row.platform);
    }
    return resolveLevelTerms([...platforms]);
  }, [keyedTableRows]);

  // An adjustment is matched back to its base row on the view's own key (date, platform, account,
  // account_id + the six constructed columns), and a grouped read leaves every dimension it does not
  // group by null - so an edit made off a grouped row would carry a null in that key and land nowhere.
  // Blocked rather than silently un-grouped: the user asked for this report's shape, so narrowing it
  // back is their call, not ours.
  const missingEditDims = useMemo(
    () => DIM_DEFS.filter((d) => ADJUSTMENT_KEY_DIMS.has(d.id) && !appliedConfig.dimensions.includes(d.id)),
    [appliedConfig.dimensions]
  );
  // The row whose Conversions cell is open, or null. One at a time: the panel is a second grain of the
  // same row, not a second row.
  const [conversionsTarget, setConversionsTarget] = useState<ConversionBreakdownTarget | null>(null);

  /**
   * Persists an arrangement by itself, with none of the staged selection "Save report" would also commit.
   *
   * Called from outside the state updaters that apply the move, never from inside one: React may run an
   * updater more than once, so a write started in there is neither guaranteed nor bounded. The order saved
   * is the one derived from the applied config, which is the arrangement actually on screen.
   *
   * Silent on success. A drag is not an act of saving, and a toast per dragged column would be noise; a
   * failure still surfaces, because then the arrangement on screen is not the one that will come back.
   */
  const persistColumnOrder = useCallback(
    (reorder: (config: ReportConfig) => ReportConfig) => {
      if (!selected) return;
      const moved = reorder(appliedConfig);
      if (moved === appliedConfig || !moved.columnOrder) return;
      reports.saveColumnOrder(selected.id, moved.columnOrder).catch(reportError);
    },
    [appliedConfig, selected, reports]
  );

  /**
   * Moves a column to sit immediately before or after another, named by id and side.
   *
   * Writes both configs: applied, so the move is visible the moment it happens, and draft, so "Save report"
   * keeps it. It deliberately does not touch `appliedGroupBy`, which stays in canonical order - a drag
   * rearranges what you are looking at and must not re-read the table to do it.
   *
   * The arrangement is also saved at once, as the Dashboards preview saves its own: an order is how someone
   * reads the report, and having to press a button to keep it meant every reload undid the reading.
   *
   * Unlike Dashboards, this reporting table has no fixed group boundary to enforce: dimensions and
   * metrics render from one interleaved order (see `orderedColumns`), so a metric may land anywhere in it,
   * including between two dimensions.
   *
   * The first move seeds the order from the columns currently shown, in canonical order, so what gets
   * saved is a complete arrangement rather than one pair of ids the rest has to be guessed around.
   */
  const moveColumn = useCallback((fromId: string, toId: string, side: "before" | "after") => {
    if (fromId === toId) return;
    const reorder = (config: ReportConfig): ReportConfig => {
      const shown = [...DIM_DEFS.map((d) => d.id), ...METRIC_DEFS.map((m) => m.id)].filter(
        (id) => config.dimensions.includes(id) || config.metrics.includes(id)
      );
      // Reconciled, not just seeded: a metric ticked after the last arrangement is not in the saved order,
      // and looking it up there would find nothing and move nothing - a column you can see and cannot move.
      const order = withShownColumns(config.columnOrder ?? [], shown);
      const without = order.filter((id) => id !== fromId);
      const targetIndex = without.indexOf(toId);
      if (targetIndex === -1) return config;
      const boundary = side === "before" ? targetIndex : targetIndex + 1;
      const next = insertAtBoundary(order, fromId, boundary);
      return next === order ? config : { ...config, columnOrder: next };
    };
    setAppliedConfig(reorder);
    setDraftConfig(reorder);
    persistColumnOrder(reorder);
  }, [persistColumnOrder]);

  /**
   * Keyboard equivalent of dragging a header one slot left or right, across the whole interleaved
   * arrangement rather than within its own group - a keyboard user reaches exactly the arrangements a
   * pointer drag can now reach. Uses the same saved order contract as {@link moveColumn}, so keyboard and
   * pointer users end up with the same report payload - including the save, so a keyboard user's
   * arrangement survives a reload exactly as a dragged one does.
   */
  const nudgeColumn = useCallback((id: string, offset: -1 | 1) => {
    const reorder = (config: ReportConfig): ReportConfig => {
      const shown = [...DIM_DEFS.map((d) => d.id), ...METRIC_DEFS.map((m) => m.id)].filter(
        (columnId) => config.dimensions.includes(columnId) || config.metrics.includes(columnId)
      );
      const order = withShownColumns(config.columnOrder ?? [], shown);
      const visible = order.filter((columnId) => shown.includes(columnId));
      const fromVisible = visible.indexOf(id);
      const toVisible = fromVisible + offset;
      if (fromVisible === -1 || toVisible < 0 || toVisible >= visible.length) return config;
      const without = order.filter((existing) => existing !== id);
      const targetIndex = without.indexOf(visible[toVisible]);
      if (targetIndex === -1) return config;
      const boundary = offset === -1 ? targetIndex : targetIndex + 1;
      const next = insertAtBoundary(order, id, boundary);
      return next === order ? config : { ...config, columnOrder: next };
    };
    setAppliedConfig(reorder);
    setDraftConfig(reorder);
    persistColumnOrder(reorder);
  }, [persistColumnOrder]);

  // Off while editing - a table full of inputs is not a table to rearrange, and a stray drag mid-edit
  // would move a column out from under a half-typed value.
  const columnReorder: DataTableColumnReorder = {
    onReorder: moveColumn,
    onNudge: nudgeColumn,
    disabled: editing,
  };
  const openConversions = useCallback((row: KeyedReportRow) => {
    const channel = row.channel ? String(row.channel) : undefined;
    const requiredDimensionIds: string[] = [...CONVERSION_BREAKDOWN_BASE_DIM_IDS];
    if (!channel || !CAMPAIGN_LEVEL_CONVERSION_CHANNELS.has(channel)) {
      requiredDimensionIds.push("campaign_constructed_name");
    }
    const missingDimensions = DIM_DEFS
      .filter((dimension) => requiredDimensionIds.includes(dimension.id) && !appliedConfig.dimensions.includes(dimension.id))
      .map((dimension) => levelDimLabel(dimension.id, dimension.label, levelTerms));
    setConversionsTarget({
      date: String(row.date ?? ""),
      levelOneName: String(row.line_item_name ?? ""),
      levelThreeName: row.campaign_constructed_name ? String(row.campaign_constructed_name) : undefined,
      channel,
      missingDimensions,
      reported: typeof row.conversions === "number" ? row.conversions : null,
    });
  }, [appliedConfig.dimensions, levelTerms]);

  const editBlockedReason = useMemo(() => {
    if (missingEditDims.length === 0) return undefined;
    // Named in full rather than truncated - the key is ten dimensions at most, and "and N more" would
    // leave the user guessing at exactly the step that unblocks them.
    const labels = missingEditDims.map((d) => levelDimLabel(d.id, d.label, levelTerms)).join(", ");
    return `Editing works on ungrouped rows only. Add these dimensions and press Apply: ${labels}.`;
  }, [missingEditDims, levelTerms]);

  // An added line describes delivery within THIS campaign, so its agency/client-scoped fields are
  // inherited from the campaign's own rows and shown read-only - retyping them by hand is busywork and
  // a typo there silently writes an adjustment nobody can match back to the campaign.
  // account/account_id only: every other campaign-scoped field is a segment of the constructed name,
  // and so comes from `namePrefix` below rather than being set beside it.
  const inheritedFields = useMemo(() => {
    const inherited = inheritedDimValues(keyedTableRows);
    return Object.fromEntries(
      Object.entries(inherited).filter(([id]) => !NAME_DERIVED_DIMS.has(id))
    );
  }, [keyedTableRows]);
  const namePrefix = useMemo(() => inheritedNamePrefix(keyedTableRows), [keyedTableRows]);
  const lockedDimIds = useMemo(() => new Set(Object.keys(inheritedFields)), [inheritedFields]);

  /**
   * Removes one manually-added row from the staged batch (see the ✕ rendered by `ReportRow`, next to
   * `updateAddedRow` conceptually - declared here instead because it needs `inheritedFields`/`namePrefix`
   * in its dep array, and both are only defined above this point).
   *
   * Confirms first only when the row is no longer pristine (D5) - a row added by mistake and untouched
   * since must vanish on the first click, while one the user has already filled in is worth asking about.
   *
   * Purges every piece of per-cell state keyed to the row (D3): a stale `invalidCells`/`requiredCells`
   * entry left behind would point `submitSave`'s validation at a row no longer on screen. Also drops the
   * row's own history entries and prunes it out of every surviving snapshot (D4), so Undo can never bring
   * a removed row back.
   *
   * Reads current state through the setter callback form (or `stagedRef`, for the pristine check that has
   * to run before any setter) rather than closing over `staged`/`history`/`snapshotted` directly, so this
   * stays a stable callback for the memoized `ReportRow` despite carrying `inheritedFields`/`namePrefix`
   * in its deps - both are themselves `useMemo`-stable across keystrokes.
   */
  const removeAddedRow = useCallback(
    (key: string) => {
      const prefix = cellKey(key, "");
      const performRemoval = () => {
        setStaged((current) => ({ ...current, added: current.added.filter((row) => row.key !== key) }));
        setInvalidCells((current) => {
          const next = new Map([...current].filter(([id]) => !id.startsWith(prefix)));
          return next.size === current.size ? current : next;
        });
        setMetricDrafts((current) => {
          const next = new Map([...current].filter(([id]) => !id.startsWith(prefix)));
          return next.size === current.size ? current : next;
        });
        setRequiredCells((current) => {
          const next = new Set([...current].filter((id) => !id.startsWith(prefix)));
          return next.size === current.size ? current : next;
        });
        setSnapshotted((current) => {
          const next = new Set([...current].filter((id) => !id.startsWith(prefix)));
          return next.size === current.size ? current : next;
        });
        setHistory((current) => {
          const next = current
            .filter((entry) => !entry.cellId.startsWith(prefix))
            .map((entry) => {
              const prunedAdded = entry.snapshot.added.filter((row) => row.key !== key);
              return prunedAdded.length === entry.snapshot.added.length
                ? entry
                : { ...entry, snapshot: { ...entry.snapshot, added: prunedAdded } };
            });
          return next.length === current.length && next.every((entry, i) => entry === current[i])
            ? current
            : next;
        });
      };

      const row = stagedRef.current.added.find((r) => r.key === key);
      if (!row) return;
      if (isPristineAddedRow(row, inheritedFields, namePrefix)) {
        performRemoval();
        return;
      }
      setConfirmDialog({
        title: "Remove this line?",
        message: "The values you entered on this new line will be lost.",
        confirmLabel: "Remove line",
        onConfirm: performRemoval,
      });
    },
    [inheritedFields, namePrefix]
  );

  // Stable array identity across renders (same `appliedConfig`/platform mix) so passing `dims`/`mets`
  // to the memoized ReportRow below never busts its memo on its own. The level labels are resolved
  // here rather than at each render site, so the column header and the added-row inputs' accessible
  // names can never disagree about what a level is called.
  const dims = useMemo(
    () =>
      inSavedOrder(DIM_DEFS, appliedConfig.dimensions, appliedConfig.columnOrder).map((d) => ({
        ...d,
        label: levelDimLabel(d.id, d.label, levelTerms),
      })),
    [appliedConfig.dimensions, appliedConfig.columnOrder, levelTerms]
  );
  const mets = useMemo(
    () => inSavedOrder(METRIC_DEFS, appliedConfig.metrics, appliedConfig.columnOrder),
    [appliedConfig.metrics, appliedConfig.columnOrder]
  );
  const orderedDimensionIds = useMemo(() => dims.map((dimension) => dimension.id), [dims]);
  const orderedMetricIds = useMemo(() => mets.map((metric) => metric.id), [mets]);

  // The one column list the header, totals row and every data row all render from - a metric can sit
  // between two dimensions here, unlike `dims`/`mets` above, which stay two lists purely because other
  // code (the filter popover lookup, `submitSave`'s required-field check) still keys off "is this id a
  // dimension" and has no reason to care where it currently sits on screen.
  //
  // Stable array identity across renders for the same reason `dims`/`mets` are: it is a prop on the
  // memoized ReportRow below, and `dims`/`mets` are themselves already stable, so this only needs to stay
  // stable across a render where none of its three inputs changed.
  const orderedColumns = useMemo<ReportColumn[]>(() => {
    const dimById = new Map(dims.map((d) => [d.id, d] as const));
    const metById = new Map(mets.map((m) => [m.id, m] as const));
    const ids = resolveColumnOrder(dims.map((d) => d.id), mets.map((m) => m.id), appliedConfig.columnOrder);
    const result: ReportColumn[] = [];
    for (const id of ids) {
      const dim = dimById.get(id);
      if (dim) {
        result.push({ kind: "dimension", dim });
        continue;
      }
      const met = metById.get(id);
      if (met) result.push({ kind: "metric", met });
    }
    return result;
  }, [dims, mets, appliedConfig.columnOrder]);

  // The single interleaved list as the table sees them, each carrying the class that sizes and aligns
  // it. Memoized because the table re-measures its header whenever this array's identity changes, and
  // because a fresh array every render would defeat the row memo below.
  // No `filterable`/`filtered` on either branch (PDI_115): filters and the date window are reachable
  // from the Filters bar now, not from a column header's funnel, and the bar draws its own state from
  // `filterChips` below rather than lighting up a header button.
  const columns = useMemo<DataTableColumn[]>(
    () =>
      orderedColumns.map((col) =>
        col.kind === "dimension"
          ? {
              id: col.dim.id,
              label: col.dim.label,
              title: col.dim.description ? `${col.dim.label} — ${col.dim.description}` : col.dim.label,
              className: dimColClass(col.dim.id),
              sortable: true,
            }
          : {
              id: col.met.id,
              label: col.met.label,
              title: col.met.description ? `${col.met.label} — ${col.met.description}` : col.met.label,
              className: metricColClass(col.met.id),
              agg: col.met.agg,
              sortable: true,
            }
      ),
    [orderedColumns]
  );

  const reportViewsSentinelRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const sentinel = reportViewsSentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && reports.hasNextPage && !reports.isFetchingNextPage) {
          reports.fetchNextPage();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [reports.hasNextPage, reports.isFetchingNextPage, reports.fetchNextPage, contentShown]);

  if (reports.isPending) {
    return <LoadingBlock label="Loading reports" />;
  }
  if (reports.isError) {
    return <p className="form-error">{formatError(reports.error)}</p>;
  }

  /** Reports (create/rename/duplicate/delete/save) are real, request-backed mutations now - a failure
   * (e.g. a duplicate name rejected by the server) must reach the user instead of failing silently. */
  function reportError(error: unknown) {
    toast.showError(formatError(error));
  }

  function validateReportName(name: string): string | null {
    if (!name.trim()) return "Report name is required.";
    if (name.trim().length > REPORT_NAME_MAX_LENGTH) {
      return `Report name must be ${REPORT_NAME_MAX_LENGTH} characters or fewer.`;
    }
    return null;
  }

  function handleCreate(type: ReportTypeOption) {
    if (!type.active) return;
    setCreateName("");
    setCreateNote("");
    setCreateError(null);
    setCreateDraftOpen(true);
    setCreateMenuOpen(false);
  }

  function cancelCreate() {
    setCreateDraftOpen(false);
    setCreateName("");
    setCreateNote("");
    setCreateError(null);
  }

  function submitCreate() {
    const name = createName.trim();
    const error = validateReportName(name);
    if (error) {
      setCreateError(error);
      return;
    }
    reports
      .createReport(name, createNote.trim() || undefined)
      .then((view) => {
        setSelectedId(view.id);
        cancelCreate();
      })
      .catch(reportError);
  }

  function toggleReportMenu(event: ReactMouseEvent<HTMLButtonElement>, viewId: string) {
    const anchor = event.currentTarget.getBoundingClientRect();
    setMenuFor((current) => {
      const next = current === viewId ? null : viewId;
      setReportMenuAnchor(next ? anchor : null);
      return next;
    });
  }

  function commitRename(id: string) {
    const name = renameValue.trim();
    const error = validateReportName(name);
    if (error) {
      toast.showError(error);
      return;
    }
    reports
      .renameReport(id, name, renameNote.trim() || undefined)
      .then(() => {
        setRenamingId(null);
        toast.showSuccess("Report updated.");
      })
      .catch(reportError);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
    setRenameNote("");
  }

  function normalizeSelectedName(): string | null {
    const name = nameDraft.trim();
    const error = validateReportName(name);
    if (error) {
      setNameError(error);
      return null;
    }
    setNameDraft(name);
    setNameError(null);
    return name;
  }

  function toggleDim(id: string, on: boolean) {
    setDraftConfig((current) => ({
      ...current,
      dimensions: on ? [...current.dimensions, id] : current.dimensions.filter((d) => d !== id),
    }));
  }

  function toggleMetric(id: string, on: boolean) {
    setDraftConfig((current) => ({
      ...current,
      metrics: on ? [...current.metrics, id] : current.metrics.filter((m) => m !== id),
    }));
  }

  /**
   * Drops the sort the applied view can no longer express, because the column it named is no longer in
   * the report. Sorting is reached through the column header's chevron, so a column that leaves the
   * report takes the only handle on its sort with it, and a report ordered by a dimension/metric nobody
   * selected comes back in an order that cannot be explained from what is visible. A grouped read cannot
   * even order by a dimension it does not group by - that half of the drop is a server constraint, not
   * a UI one.
   *
   * <p>Filters and the delivery-date window deliberately survive: PDI_115 made them independent of the
   * displayed columns, and the Filters bar above the table keeps every one of them visible and
   * clearable whether or not its dimension is on screen (see D3/D4 in PDI_115-PLAN.md).
   *
   * @param config the selection about to be applied
   */
  function dropSortForDeselectedColumns(config: ReportConfig) {
    const shown = new Set([...config.dimensions, ...config.metrics].map((id) => id.toUpperCase()));
    if (sortField != null && !shown.has(sortField)) {
      setSortField(null);
      setSortDirection("ASC");
    }
  }

  /** Commits the staged dimensions/metrics. The dimensions are the aggregation key, so this re-reads
   * the table at the new grain rather than only re-rendering columns of an already-loaded page. */
  function apply() {
    setAppliedConfig(draftConfig);
    dropSortForDeselectedColumns(draftConfig);
    toast.showSuccess("Changes applied to report view.");
  }

  function saveReport() {
    if (!selected) return;
    const name = normalizeSelectedName();
    if (!name) return;
    const filters = savedReportFilters(activeFilters, dateWindow);
    reports
      .saveReport(selected.id, { ...draftConfig, filters }, name)
      .then(() => {
        setAppliedConfig({ ...draftConfig, filters });
        toast.showSuccess("Report saved.");
      })
      .catch(reportError);
  }

  // Looked up against every dimension, not only `dims` (the currently displayed ones): PDI_115 lets a
  // filter's value popover open on a dimension the table is not showing as a column at all.
  const openFilterDef =
    filterPopover?.stage === "values" ? DIM_DEFS.find((d) => d.id === filterPopover.fieldId) : undefined;

  /** Opens a dimension's value popover, staged with its current selection - the field picker's own
   * handoff after a field is picked, and a chip's label click (D5), both funnel through here. */
  function openValueFilter(fieldId: string, anchor: HTMLElement) {
    setFilterAnchor(anchor);
    setFilterPopover({ stage: "values", fieldId });
  }

  /** Opens the `+ Filter` field picker (stage 1), toggling it closed on a second click of the same
   * button - the same toggle the funnel-era filter button offered. */
  function openFieldPicker(anchor: HTMLElement) {
    setFilterAnchor(anchor);
    setFilterPopover((current) => (current?.stage === "fields" ? null : { stage: "fields" }));
  }

  /** Opens the persistent Date pill's own window popover, toggling closed on a second click. */
  function openDateFilter(anchor: HTMLElement) {
    setFilterAnchor(anchor);
    setFilterPopover((current) => (current?.stage === "date" ? null : { stage: "date" }));
  }

  /** Drops every dimension filter. The date window is not one of them (D2) and survives - pinning that
   * distinction is the point of the dedicated test for it. */
  function clearAllFilters() {
    setFilterState({});
  }

  /** Enters Edit data mode in the given sub-mode - "lines" for per-row inline edits, "bulk" for the
   * offline delivery spreadsheet, "conversions" for the offline conversions spreadsheet. */
  function enterEditMode(mode: EditMode) {
    setFilterPopover(null);
    setFilterAnchor(null);
    setEditMode(mode);
    setEditing(true);
  }

  /** Exits Edit data mode, discarding any staged (unsaved) edits. */
  function discardEdits() {
    setStaged({ adj: {}, added: [] });
    setInvalidCells(new Map());
    setMetricDrafts(new Map());
    setRequiredCells(new Set());
    setHistory([]);
    setSnapshotted(new Set());
    setEditing(false);
  }

  /** Opens the in-app discard confirmation when edits are staged; exits immediately otherwise. */
  function cancelEdit() {
    if (stagedCount === 0) {
      discardEdits();
      return;
    }
    setConfirmDialog({
      title: "Discard unsaved edits?",
      message: "Your unsaved row edits will be lost.",
      confirmLabel: "Discard changes",
      onConfirm: discardEdits,
    });
  }

  /** Reverts the most recent staged cell edit, restoring the batch to its state just before that edit -
   * a further edit to that same cell can snapshot again afterward. Reads `history` via `historyRef` so
   * the Ctrl+Z listener effect above can bind once instead of re-binding on every staged edit. */
  function undo() {
    const currentHistory = historyRef.current;
    if (currentHistory.length === 0) return;
    const last = currentHistory[currentHistory.length - 1];
    setStaged(last.snapshot);
    setHistory((current) => current.slice(0, -1));
    setSnapshotted((current) => {
      const next = new Set(current);
      next.delete(last.cellId);
      return next;
    });
    setMetricDrafts((current) => {
      if (!current.has(last.cellId)) return current;
      const next = new Map(current);
      next.delete(last.cellId);
      return next;
    });
    setInvalidCells((current) => {
      if (!current.has(last.cellId)) return current;
      const next = new Map(current);
      next.delete(last.cellId);
      return next;
    });
  }

  /** Prepends a blank manually-added row; its identity + metrics are filled in inline before Save. */
  function addRow() {
    const blank = {
      key: `added-${crypto.randomUUID()}`,
      ...inheritedFields,
      // The name carries the naming convention, so a new line starts from the part this campaign
      // already fixes - agency, client, industry code, campaign - and the user types the rest.
      line_item_name: namePrefix,
    } as KeyedReportRow;
    setStaged((current) => ({ ...current, added: [blank, ...current.added] }));
  }

  /** Reads the editable-metric values staged on a partial/added row, for building the save payload. */
  function stagedMetrics(source: Partial<KeyedReportRow>): { values: Partial<ReportRowAdjustmentV1>; changed: string[] } {
    const values: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const id of EDITABLE_METRIC_IDS) {
      const value = source[id as keyof KeyedReportRow];
      if (value != null) {
        values[id] = value;
        changed.push(id);
      }
    }
    return { values: values as Partial<ReportRowAdjustmentV1>, changed };
  }

  /** Builds one batch from every staged override + added row and posts it in a single request. */
  async function submitSave() {
    if (invalidCells.size > 0) {
      toast.showError("Fix the invalid metric values before saving.");
      return;
    }
    // BigQuery write-table REQUIRED columns (Mode=REQUIRED) map 1:1 to ADJUSTMENT_KEY_DIM_IDS:
    // platform, account, account_id, date, constructed_name (line_item_name), constructed_id
    // (line_item_id), constructed_name_lvl2/id_lvl2, constructed_name_lvl3/id_lvl3. A blank one
    // fails INSERT with "Required field X cannot be null" — catch that here with inline "Required"
    // on visible cells, and a toast listing dims that are not on screen so the user can add them.
    const missingRequired = new Set<string>();
    const missingMetrics = new Set<string>();
    const hiddenMissingLabels: string[] = [];
    const visibleDimIds = new Set(dims.map((d) => d.id));
    for (const row of staged.added) {
      for (const id of ADJUSTMENT_KEY_DIM_IDS) {
        if (String(row[id as keyof KeyedReportRow] ?? "").trim()) continue;
        if (visibleDimIds.has(id)) {
          missingRequired.add(cellKey(row.key, id));
        } else {
          const def = DIM_DEFS.find((d) => d.id === id);
          if (def && !hiddenMissingLabels.includes(def.label)) hiddenMissingLabels.push(def.label);
        }
      }
      // Metrics are NULLABLE in BQ, but an all-null added row is useless — require at least one.
      const hasAnyMetric = [...EDITABLE_METRIC_IDS].some((id) => row[id as keyof KeyedReportRow] != null);
      if (!hasAnyMetric) {
        const firstEditableMetric = mets.find((m) => EDITABLE_METRIC_IDS.has(m.id))?.id;
        if (firstEditableMetric) missingMetrics.add(cellKey(row.key, firstEditableMetric));
      }
    }
    if (missingRequired.size > 0 || missingMetrics.size > 0 || hiddenMissingLabels.length > 0) {
      setRequiredCells(new Set([...missingRequired, ...missingMetrics]));
      const fieldFromCellKey = (id: string) => id.slice(id.lastIndexOf("::") + 2);
      const labels = [
        ...[...missingRequired].map((id) => {
          const field = fieldFromCellKey(id);
          return DIM_DEFS.find((d) => d.id === field)?.label ?? METRIC_DEFS.find((m) => m.id === field)?.label ?? field;
        }),
        ...[...missingMetrics].map((id) => {
          const field = fieldFromCellKey(id);
          return METRIC_DEFS.find((m) => m.id === field)?.label ?? field;
        }),
        ...hiddenMissingLabels,
      ];
      const unique = [...new Set(labels)];
      toast.showError(
        hiddenMissingLabels.length > 0
          ? `Fill required fields before saving: ${unique.join(", ")}. Hidden ones must be added to the report dimensions.`
          : `Fill required fields before saving: ${unique.join(", ")}.`
      );
      return;
    }
    setRequiredCells(new Set());
    const adjustments: ReportRowAdjustmentV1[] = [];
    for (const [key, changes] of Object.entries(staged.adj)) {
      const base = keyedTableRows.find((row) => row.key === key);
      if (!base) continue;
      const { values, changed } = stagedMetrics(changes);
      if (changed.length === 0) continue;
      adjustments.push({ added: false, ...identityFields(base), ...values });
    }
    for (const row of staged.added) {
      const { values } = stagedMetrics(row);
      // Send the CNB_* split the view will derive from the name anyway, rather than whatever the row
      // object happens to hold - so the write table records the row the report will actually show.
      const identity = {
        ...typedIdentityFields(row),
        ...constructedNameParts(String(row.line_item_name ?? "").trim()),
      };
      adjustments.push({ added: true, ...identity, ...values });
    }
    if (adjustments.length === 0) {
      setEditing(false);
      return;
    }
    try {
      await saveAdjustments.mutateAsync({ adjustments });
      setStaged({ adj: {}, added: [] });
      setInvalidCells(new Map());
      setMetricDrafts(new Map());
      setRequiredCells(new Set());
      setHistory([]);
      setSnapshotted(new Set());
      setEditing(false);
      toast.showSuccess("Edits saved.");
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  /**
   * Says the downloaded file is short of rows.
   *
   * Worth interrupting for: the workbook's Totals sheet covers the whole report while its rows stop at
   * the cap, so a truncated file is one whose own rows cannot be made to add up to its own totals.
   * Anyone reconciling it would be chasing a discrepancy that isn't there.
   */
  /**
   * Warns that the conversions template hit its row cap. Its own message rather than
   * {@link warnTruncated}: that one talks about totals the conversions file does not carry, and offers
   * grouping as a remedy, which does not narrow this read at all. The date window is the only lever.
   */
  function warnConversionsTruncated() {
    toast.showError(
      "This campaign has more conversions rows than one download can carry, so the file is missing some. " +
        "Narrow the date range to get a complete file - uploading this one would leave the rows it omits " +
        "unedited."
    );
  }

  function warnTruncated() {
    toast.showError(
      "This report has more rows than one download can carry, so the file is missing some. Its totals " +
        "still cover every row, so the rows in the file will not add up to them. Narrow the date range " +
        "or group the report to get a complete file."
    );
  }

  /** Downloads the report as .xlsx - "current" honors the table's active filters/sort, "all" exports the
   * full unfiltered dataset regardless of what's currently applied on screen. */
  async function downloadReport(scope: "current" | "all") {
    setDownloading(true);
    try {
      const { blob, truncated } = await exportReportRows(
        campaign.id,
        scope === "current"
          ? {
              filters: activeFilters,
              // Same grouping the table is showing, so the download is the view rather than the raw
              // rows behind it - "current view" would otherwise hand back every row a grouped screen
              // had already collapsed.
              groupBy: appliedGroupBy,
              dateFrom: dateWindow.from || undefined,
              dateTo: dateWindow.to || undefined,
              sortField: sortField ?? undefined,
              sortDirection: sortField ? sortDirection : undefined,
              // Full report export should match the visible table, including a saved/dragged column order.
              // The editable bulk template intentionally keeps its fixed raw round-trip schema below.
              dimensions: orderedDimensionIds,
              metrics: orderedMetricIds,
              // The fully resolved on-screen order, not the possibly-partial saved `columnOrder` - a
              // freshly ticked column has no place in that one yet, and the workbook has to match the
              // screen rather than reproduce the gap.
              columnOrder: orderedColumns.map((col) => (col.kind === "dimension" ? col.dim.id : col.met.id)),
            }
          : {}
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        `${fileSafe(campaign.name)} - ${fileSafe(selected?.name || "report")}${scope === "all" ? " - all" : ""}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      if (truncated) {
        warnTruncated();
      }
    } catch (error) {
      toast.showError(formatError(error));
    } finally {
      setDownloading(false);
    }
  }

  /** Downloads the current view (honoring active filters/sort) as an editable .xlsx bulk-adjustment template. */
  async function downloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const { blob, truncated } = await downloadBulkAdjustmentTemplate(campaign.id, {
        filters: activeFilters,
        // The date window is a filter like any other here, and has to travel with them: the whole point of
        // filtering before downloading is to edit that slice, and a template covering months the screen was
        // not showing is both a surprise and a much larger file than the one asked for.
        dateFrom: dateWindow.from || undefined,
        dateTo: dateWindow.to || undefined,
        sortField: sortField ?? undefined,
        sortDirection: sortField ? sortDirection : undefined,
        // No column selection: this file's schema is fixed by the round trip, not by the report. The
        // endpoint reads raw rows and the assembler writes its own columns, so sending the report's
        // dimensions and metrics only suggested they were honoured. What narrows the rows travels;
        // what shapes them here cannot.
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileSafe(campaign.name)} - ${fileSafe(selected?.name || "report")} - bulk template.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      if (truncated) {
        warnTruncated();
      }
    } catch (error) {
      toast.showError(formatError(error));
    } finally {
      setDownloadingTemplate(false);
    }
  }

  /** Downloads the campaign's conversions (honoring the date window only) as an editable .xlsx. */
  async function downloadConversionsTemplate() {
    setDownloadingTemplate(true);
    try {
      // The date window travels; the report's dimension filters deliberately do not. They describe
      // delivery rows, and the two marts are filled by different pipelines - see the endpoint's contract.
      const { blob, truncated } = await downloadConversionAdjustmentTemplate(campaign.id, {
        dateFrom: dateWindow.from || undefined,
        dateTo: dateWindow.to || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileSafe(campaign.name)} - conversions template.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      if (truncated) {
        warnConversionsTruncated();
      }
    } catch (error) {
      toast.showError(formatError(error));
    } finally {
      setDownloadingTemplate(false);
    }
  }

  /** Sends the chosen edited conversions spreadsheet to the server. */
  async function onUploadConversionsFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const result = await uploadConversions.mutateAsync(file);
      toast.showSuccess(`Applied ${result.applied} conversion adjustment${result.applied === 1 ? "" : "s"}.`);
      setEditing(false);
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  /** Sends the chosen edited spreadsheet to the server; on success the table re-reads the merged view. */
  async function onUploadFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file after fixing an error
    if (!file) return;
    try {
      const result = await uploadBulk.mutateAsync(file);
      toast.showSuccess(`Applied ${result.applied} adjustment${result.applied === 1 ? "" : "s"}.`);
      setEditing(false);
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  // Date range / line-item count are computed server-side over the full dataset (see BigQueryReportRowService),
  // not from tableRows, which only ever holds the pages loaded so far.
  function totDim(id: string): string {
    if (id === "date") {
      return latestPage?.min_date && latestPage.max_date
        ? `${fmtDate(latestPage.min_date)} — ${fmtDate(latestPage.max_date)}`
        : "";
    }
    // Counts distinct level-1 constructed ids. Deliberately not called "line items": level 1 is only
    // the line item on some platforms (DV360, Xandr...) and the campaign or insertion order on others
    // - see DIM_DEFS' level hints.
    if (id === "line_item_id") return `${distinctLineItemCount} value${distinctLineItemCount !== 1 ? "s" : ""}`;
    return "";
  }

  return (
    <div className={cn("reporting-tab", expanded && "reporting-tab--expanded")}>
      <div className="reporting-tab__head">
        <div>
          <h2 className="reporting-tab__title">Reports</h2>
          <div className="reporting-tab__sub">
            {reports.total} saved report{reports.total !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="reporting-tab__head-actions">
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => navigate("../dashboards", { state: location.state })}
          >
            Dashboards →
          </button>
          <div className="reporting-tab__menu-wrap">
            <button
              type="button"
              className="button button--primary button--sm reporting-tab__dropdown-btn"
              onClick={() => setCreateMenuOpen((open) => !open)}
            >
              <PlusIcon />
              Create report
            </button>
            {createMenuOpen && (
              <div className="reporting-tab__menu" role="menu">
                {REPORT_TYPE_MENU.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    role="menuitem"
                    className={cn("reporting-tab__menu-item", !type.active && "reporting-tab__menu-item--disabled")}
                    disabled={!type.active}
                    onClick={() => handleCreate(type)}
                  >
                    {type.label}
                    {!type.active && <span className="reporting-tab__soon">Coming soon</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {reports.views.length === 0 ? (
        <div className="reporting-tab__empty">
          <h3>Create your first report</h3>
          <p>Choose a report type to start analyzing campaign delivery.</p>
          <button type="button" className="button button--primary" onClick={() => handleCreate(REPORT_TYPE_MENU[0])}>
            Create report
          </button>
        </div>
      ) : (
        <div className="reporting-tab__tbl-wrap">
          <table className="reporting-tab__tbl">
            <colgroup>
              <col className="reporting-tab__tbl-col-name" />
              <col className="reporting-tab__tbl-col-type" />
              <col className="reporting-tab__tbl-col-status" />
              <col className="reporting-tab__tbl-col-date" />
              <col className="reporting-tab__tbl-col-date" />
              <col className="reporting-tab__tbl-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last edited</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {reports.views.map((view) => (
                <tr
                  key={view.id}
                  className={cn("reporting-tab__row", selected?.id === view.id && "reporting-tab__row--selected")}
                  onClick={() => setSelectedId(view.id)}
                >
                  <td>
                    {renamingId === view.id ? (
                      <div
                        className="reporting-tab__rename-form"
                        role="group"
                        aria-label={`Rename ${view.name}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          autoFocus
                          className="input reporting-tab__rename-input"
                          aria-label="Rename report name"
                          value={renameValue}
                          maxLength={REPORT_NAME_MAX_LENGTH}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename(view.id);
                            if (event.key === "Escape") cancelRename();
                          }}
                        />
                        <input
                          className="input reporting-tab__rename-input"
                          aria-label="Rename report description"
                          placeholder="Description"
                          value={renameNote}
                          onChange={(event) => setRenameNote(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename(view.id);
                            if (event.key === "Escape") cancelRename();
                          }}
                        />
                        <div className="reporting-tab__rename-actions">
                          <button type="button" className="button button--secondary button--sm" onClick={cancelRename}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="button button--primary button--sm"
                            onClick={() => commitRename(view.id)}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="reporting-tab__view-link" title={view.name}>{view.name}</span>
                        {view.note && <div className="reporting-tab__row-note">{view.note}</div>}
                      </>
                    )}
                  </td>
                  <td><span className="reporting-tab__tag">Basic</span></td>
                  <td>
                    <span className="reporting-tab__status">
                      <span className={cn("reporting-tab__led", view.status === "saved" && "reporting-tab__led--saved")} />
                      {view.status === "saved" ? "Saved" : "Draft"}
                    </span>
                  </td>
                  <td className="reporting-tab__flight">
                    <span className="reporting-tab__flight-text">{fmtStamp(view.created)}</span>
                  </td>
                  <td className="reporting-tab__flight">
                    <span className="reporting-tab__flight-text">{view.edited ? fmtStamp(view.edited) : "—"}</span>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="reporting-tab__menu-wrap">
                      <button
                        type="button"
                        className="reporting-tab__kebab"
                        aria-label={`Actions for ${view.name}`}
                        aria-expanded={menuFor === view.id}
                        onClick={(event) => toggleReportMenu(event, view.id)}
                      >
                        <MoreVerticalIcon />
                      </button>
                      {menuFor === view.id && (
                        <div
                          className="reporting-tab__menu reporting-tab__menu--fixed"
                          role="menu"
                          style={
                            reportMenuAnchor
                              ? {
                                  top: reportMenuAnchor.bottom + 6,
                                  left: Math.max(16, reportMenuAnchor.right - 190),
                                }
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuFor(null);
                              setReportMenuAnchor(null);
                              setRenamingId(view.id);
                              setRenameValue(view.name);
                              setRenameNote(view.note ?? "");
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuFor(null);
                              setReportMenuAnchor(null);
                              reports.duplicateReport(view.id).then((copy) => setSelectedId(copy.id)).catch(reportError);
                            }}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="reporting-tab__menu-danger"
                            onClick={() => {
                              setMenuFor(null);
                              setReportMenuAnchor(null);
                              setConfirmDialog({
                                title: `Delete "${view.name}"?`,
                                message: "This cannot be undone.",
                                confirmLabel: "Delete report",
                                onConfirm: () => {
                                  reports
                                    .deleteReport(view.id)
                                    .then(() => toast.showSuccess("Report deleted."))
                                    .catch(reportError);
                                  if (selectedId === view.id) setSelectedId(null);
                                },
                              });
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {reports.hasNextPage && (
                <tr ref={reportViewsSentinelRef}>
                  <td colSpan={6} className="reporting-tab__report-load-more">
                    {reports.isFetchingNextPage && <LoadingSpinner label="Loading more reports" size="sm" />}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createDraftOpen && (
        <div className="reporting-tab__create-card" role="region" aria-label="Create basic report">
          <div className="reporting-tab__create-fields">
            <label>
              <span>Report name</span>
              <input
                autoFocus
                className="input"
                aria-label="New report name"
                value={createName}
                maxLength={REPORT_NAME_MAX_LENGTH}
                onChange={(event) => {
                  setCreateName(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitCreate();
                  if (event.key === "Escape") cancelCreate();
                }}
              />
            </label>
            <label>
              <span>Description</span>
              <input
                className="input"
                value={createNote}
                onChange={(event) => setCreateNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitCreate();
                  if (event.key === "Escape") cancelCreate();
                }}
              />
            </label>
            {createError && <p className="form-error reporting-tab__create-error">{createError}</p>}
          </div>
          <div className="reporting-tab__create-actions">
            <button type="button" className="button button--secondary button--sm" onClick={cancelCreate}>
              Cancel
            </button>
            <button type="button" className="button button--primary button--sm" onClick={submitCreate}>
              Create Basic report
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="reporting-tab__builder">
          <div className="reporting-tab__builder-sep" />
          <div className="reporting-tab__name-row">
            <input
              className="reporting-tab__name-input"
              aria-label="Report name"
              value={nameDraft}
              maxLength={REPORT_NAME_MAX_LENGTH}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={normalizeSelectedName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span className="reporting-tab__type-badge">Basic</span>
          </div>
          {nameError && <p className="form-error reporting-tab__name-error">{nameError}</p>}

          {editing && (
            <div className="reporting-tab__edit-banner" role="status">
              <EditIcon />
              Editing — adjust metric values inline. Dimensions, metrics &amp; filters are locked; Save or Discard to change them.
            </div>
          )}

          <div className="reporting-tab__controls">
            <Picker
              title="Dimensions"
              defs={DIM_DEFS}
              selected={draftConfig.dimensions}
              query={dimQuery}
              onQuery={setDimQuery}
              onToggle={toggleDim}
              onAll={() => setDraftConfig((c) => ({ ...c, dimensions: DIM_DEFS.map((d) => d.id) }))}
              onClear={() => setDraftConfig((c) => ({ ...c, dimensions: [] }))}
              onDefault={() => setDraftConfig((c) => ({ ...c, dimensions: [...DEFAULT_DIMS] }))}
              defaultHint="Back to the ungrouped grain, where rows can be edited and lines added"
              disabled={editing}
            />
            <Picker
              title="Metrics"
              defs={METRIC_DEFS}
              selected={draftConfig.metrics}
              query={metQuery}
              onQuery={setMetQuery}
              onToggle={toggleMetric}
              onAll={() => setDraftConfig((c) => ({ ...c, metrics: METRIC_DEFS.map((m) => m.id) }))}
              onClear={() => setDraftConfig((c) => ({ ...c, metrics: [] }))}
              disabled={editing}
            />
          </div>

          {!editing && (
            <div className="reporting-tab__ctrl-btns">
              <button
                type="button"
                className="button button--primary"
                onClick={apply}
                disabled={draftConfig.dimensions.length === 0 && draftConfig.metrics.length === 0}
              >
                Apply
              </button>
              <button type="button" className="button button--secondary" onClick={saveReport}>
                Save report
              </button>
            </div>
          )}

          <div className="reporting-tab__actions-row" ref={actionsRowRef}>
            {/* How the table is shown, as opposed to what is done to its data on the right. Outside the
                editing branch on purpose: the expanded view is where inline editing is least cramped,
                and it also carries the only way back out of it. */}
            <DataTableViewControls
              totalRows={totalRows}
              loadedRows={loadedRows}
              isPending={reportRows.isPending}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
            />
            {editing ? (
              <div className="reporting-tab__edit-actions">
                {editMode === "lines" ? (
                  <>
                    <button type="button" className="button button--secondary button--sm" onClick={addRow}>
                      <PlusIcon />
                      Add line
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm reporting-tab__undo-btn"
                      onClick={undo}
                      disabled={history.length === 0}
                    >
                      <UndoIcon />
                      Undo
                    </button>
                    <button type="button" className="button button--secondary button--sm" onClick={cancelEdit}>
                      Discard changes
                    </button>
                    <button
                      type="button"
                      className="button button--primary button--sm"
                      onClick={submitSave}
                      disabled={saveAdjustments.isPending}
                    >
                      {saveAdjustments.isPending
                        ? "Saving…"
                        : `Save changes${stagedCount > 0 ? ` (${stagedCount})` : ""}`}
                    </button>
                  </>
                ) : (
                  <button type="button" className="button button--secondary button--sm" onClick={cancelEdit}>
                    Done
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Sits with Edit data rather than with Expand on the left: the levels it explains are
                    dimension columns, which is what Edit data is about to write to. */}
                <LevelsHint />
                {/* The reason sits on the wrapper, not on the items: a disabled button gets no hover
                    events, so its own title would never show, and the open menu is inside this wrapper. */}
                <div className="reporting-tab__menu-wrap" title={editBlockedReason}>
                  {/* Enabled even when the delivery items are blocked: a grouped report cannot be edited
                      row by row, but the conversions template does not come from these rows at all. */}
                  <button
                    type="button"
                    className="button button--primary reporting-tab__dropdown-btn"
                    onClick={() => setEditMenuOpen((open) => !open)}
                  >
                    Edit data
                  </button>
                  {editMenuOpen && (
                    <div className="reporting-tab__menu reporting-tab__menu--edit-data" role="menu">
                      {/* Spelled out inside the open menu, not left to the wrapper's tooltip: the menu
                          covers the button it would appear over, so two dead items were all the user
                          got. The button itself stays live - the conversions item below works on a
                          grouped report, and killing it would take that away too. */}
                      {editBlockedReason && (
                        <p className="reporting-tab__menu-note">{editBlockedReason}</p>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        disabled={editBlockedReason != null}
                        onClick={() => {
                          setEditMenuOpen(false);
                          enterEditMode("lines");
                        }}
                      >
                        Adjust individual lines
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={editBlockedReason != null}
                        onClick={() => {
                          setEditMenuOpen(false);
                          enterEditMode("bulk");
                        }}
                      >
                        Bulk manual adjustment
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setEditMenuOpen(false);
                          enterEditMode("conversions");
                        }}
                      >
                        Bulk conversions adjustment
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="reporting-tab__menu-danger"
                        onClick={() => {
                          setEditMenuOpen(false);
                          setRollbackModalOpen(true);
                        }}
                      >
                        Roll back adjustments
                      </button>
                    </div>
                  )}
                </div>
                <div className="reporting-tab__menu-wrap">
                  <button
                    type="button"
                    className="button button--secondary reporting-tab__dropdown-btn"
                    onClick={() => setDownloadMenuOpen((open) => !open)}
                    disabled={downloading}
                  >
                    {downloading ? "Downloading…" : "Download"}
                  </button>
                  {downloadMenuOpen && (
                    <div className="reporting-tab__menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setDownloadMenuOpen(false);
                          downloadReport("current");
                        }}
                      >
                        Current view
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setDownloadMenuOpen(false);
                          downloadReport("all");
                        }}
                      >
                        All data
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {editing && editMode === "bulk" && (
            <div className="reporting-tab__bulk-panel">
              <div className="reporting-tab__bulk-text">
                Download the current data as a spreadsheet, adjust values offline, then re-upload to apply changes in bulk.
              </div>
              <div className="reporting-tab__bulk-actions">
                <button
                  type="button"
                  className="button button--secondary reporting-tab__bulk-download"
                  onClick={downloadTemplate}
                  disabled={downloadingTemplate}
                >
                  {downloadingTemplate ? "Preparing…" : "Download data (.xlsx)"}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadBulk.isPending}
                >
                  {uploadBulk.isPending ? "Uploading…" : "Upload adjusted file"}
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="reporting-tab__bulk-file"
                  aria-label="Upload adjusted spreadsheet"
                  onChange={onUploadFileChange}
                />
              </div>
            </div>
          )}

          {conversionsTarget && (
            <ConversionsBreakdown
              campaignId={campaign.id}
              target={conversionsTarget}
              onClose={() => setConversionsTarget(null)}
              onSaved={(applied) =>
                toast.showSuccess(
                  `Applied ${applied} conversion adjustment${applied === 1 ? "" : "s"}.`
                )
              }
            />
          )}

          <RollbackAdjustmentsModal
            open={rollbackModalOpen}
            campaignId={campaign.id}
            campaignConstructedNames={rollbackScopeNames}
            dateWindow={dateWindow}
            onClose={() => setRollbackModalOpen(false)}
            onRolledBack={(result) => {
              setRollbackModalOpen(false);
              toast.showSuccess(
                `Rolled back ${result.deliveryRowsRemoved} delivery and `
                  + `${result.conversionRowsRemoved} conversions adjustment row`
                  + `${result.deliveryRowsRemoved + result.conversionRowsRemoved === 1 ? "" : "s"}.`
              );
            }}
          />

          {editing && editMode === "conversions" && (
            <div className="reporting-tab__bulk-panel">
              <div className="reporting-tab__bulk-text">
                Conversions live at their own grain - one row per day, line item and conversion action - so
                they are adjusted in a spreadsheet of their own. Download it, edit the conversions column,
                then re-upload. Only the date window narrows it; the report's dimension filters do not apply.
              </div>
              <div className="reporting-tab__bulk-actions">
                <button
                  type="button"
                  className="button button--secondary reporting-tab__bulk-download"
                  onClick={downloadConversionsTemplate}
                  disabled={downloadingTemplate}
                >
                  {downloadingTemplate ? "Preparing…" : "Download conversions (.xlsx)"}
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => uploadConversionsInputRef.current?.click()}
                  disabled={uploadConversions.isPending}
                >
                  {uploadConversions.isPending ? "Uploading…" : "Upload adjusted file"}
                </button>
                <input
                  ref={uploadConversionsInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="reporting-tab__bulk-file"
                  aria-label="Upload adjusted conversions spreadsheet"
                  onChange={onUploadConversionsFileChange}
                />
              </div>
            </div>
          )}

          <DataTableFilterBar
            dateLabel={dateWindow.from === "" && dateWindow.to === "" ? "All dates" : dateWindowSummary(dateWindow)}
            onOpenDate={openDateFilter}
            filters={filterChips}
            onOpenFieldPicker={openFieldPicker}
            onClearAll={clearAllFilters}
            disabled={editing}
          />

          <DataTable
            columns={columns}
            rows={orderedRows}
            getRowKey={(item) => item.renderKey}
            renderCells={(item, _index, draggedColumnIndex, dropBoundaryIndex) => (
              <ReportRow
                row={item.row}
                override={item.isAdded ? undefined : staged.adj[item.row.key]}
                isAdded={item.isAdded}
                columns={orderedColumns}
                draggedColumnIndex={draggedColumnIndex}
                dropBoundaryIndex={dropBoundaryIndex}
                editing={editing}
                editMode={editMode}
                invalidCells={invalidCells}
                requiredCells={requiredCells}
                metricDrafts={metricDrafts}
                lockedDimIds={lockedDimIds}
                columnWidths={columnWidths}
                onUpdateCell={updateCell}
                onUpdateAddedRow={updateAddedRow}
                onRemoveAddedRow={removeAddedRow}
                /* Offered on every report, grouped or not. Whether the rows behind the cell
                   are really the rows the panel found is settled by the panel, which can
                   compare their sum against the figure - a check no dimension list can make. */
                onOpenConversions={openConversions}
                campaignId={campaign.id}
                onResolveAddLineId={onResolveAddLineId}
              />
            )}
            renderPinnedCells={(draggedColumnIndex, dropBoundaryIndex) => (
              <>
                {orderedColumns.map((col, index) =>
                  col.kind === "dimension" ? (
                    <td
                      key={col.dim.id}
                      className={cn(
                        dimColClass(col.dim.id),
                        columnDragCellClass(index, draggedColumnIndex),
                        columnDropCellClass(index, dropBoundaryIndex, orderedColumns.length)
                      )}
                      style={columnStyle(columnWidths[col.dim.id])}
                    >
                      {totDim(col.dim.id)}
                    </td>
                  ) : (
                    <td
                      key={col.met.id}
                      className={cn(
                        metricColClass(col.met.id),
                        columnDragCellClass(index, draggedColumnIndex),
                        columnDropCellClass(index, dropBoundaryIndex, orderedColumns.length)
                      )}
                      style={columnStyle(columnWidths[col.met.id])}
                    >
                      {totalCell(totals, col.met.id)}
                    </td>
                  )
                )}
              </>
            )}
            columnWidths={columnWidths}
            onResizeColumn={resizeColumn}
            sortColumnId={sortField}
            sortDirection={sortDirection.toLowerCase() as "asc" | "desc"}
            onSort={toggleSort}
            sortDisabled={isReloading || editing}
            columnReorder={columnReorder}
            hasNextPage={reportRows.hasNextPage}
            isFetchingNextPage={reportRows.isFetchingNextPage}
            fetchNextPage={reportRows.fetchNextPage}
            loadingMoreSlot={<LoadingSpinner label="Loading more rows" size="sm" />}
            statusRow={
              reportRows.isSuccess && orderedRows.length === 0
                ? "No rows match this report."
                : undefined
            }
            expanded={expanded}
            overlay={isReloading && <LoadingOverlay label="Loading rows" />}
          />

          {reportRows.isError && (
            <p className="form-error reporting-tab__table-error">{formatError(reportRows.error)}</p>
          )}

          {filterPopover?.stage === "date" && (
            <DataTableDateFilterPopover
              range={dateWindow}
              hint={
                unwindowedDates.current.from && unwindowedDates.current.to ? (
                  <>
                    Data available {fmtDate(unwindowedDates.current.from)} —{" "}
                    {fmtDate(unwindowedDates.current.to)}. Leave a side empty for open-ended.
                  </>
                ) : undefined
              }
              anchor={filterAnchor}
              onApply={setDateWindow}
              onClose={() => setFilterPopover(null)}
            />
          )}
          {filterPopover?.stage === "fields" && (
            <DataTableFieldPickerPopover
              fields={DIM_DEFS.filter((d) => d.id !== DATE_DIM_ID)}
              filteredIds={filterChips.map((filter) => filter.id)}
              anchor={filterAnchor}
              onPick={(fieldId) => setFilterPopover({ stage: "values", fieldId })}
            />
          )}
          {openFilterDef && (
            <ReportFilterPopover
              campaignId={campaign.id}
              field={openFilterDef.id.toUpperCase() as ReportRowFilterFieldEnumV1}
              label={openFilterDef.label}
              initialSelected={filterState[openFilterDef.id] ?? []}
              anchor={filterAnchor}
              onApply={(values) => setFilterState((current) => ({ ...current, [openFilterDef.id]: values }))}
              onClose={() => setFilterPopover(null)}
            />
          )}
        </div>
      )}
      <Modal
        open={confirmDialog != null}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title ?? ""}
        subtitle={confirmDialog?.message}
        className="reporting-tab__confirm"
      >
        <div className="reporting-tab__confirm-actions">
          <button type="button" className="button button--secondary" onClick={() => setConfirmDialog(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              const action = confirmDialog?.onConfirm;
              setConfirmDialog(null);
              action?.();
            }}
          >
            {confirmDialog?.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </Modal>
	    </div>
	  );
	}

interface ReportRowProps {
  row: KeyedReportRow;
  override: Partial<KeyedReportRow> | undefined;
  isAdded: boolean;
  /** The one on-screen column order - dimensions and metrics interleaved exactly as the header renders
   *  them (see `orderedColumns`), so a metric between two dimensions in the header sees the same metric
   *  between the same two dimensions here. */
  columns: ReportColumn[];
  /** The dragged column's position in `columns`, and the boundary the insertion line sits at - both
   *  `-1` while no drag is in progress. Two plain `number`s rather than one object: this row is memoized,
   *  and an object literal would be a new reference every render, busting that memo on every keystroke
   *  elsewhere on the page rather than only on an actual boundary crossing. */
  draggedColumnIndex: number;
  dropBoundaryIndex: number;
  editing: boolean;
  editMode: EditMode;
  invalidCells: ReadonlyMap<string, string>;
  requiredCells: ReadonlySet<string>;
  /** Typed draft text per metric cell (see parent `metricDrafts`). */
  metricDrafts: ReadonlyMap<string, string>;
  /** Dimensions an added row inherits from the campaign - rendered read-only rather than as inputs. */
  lockedDimIds: ReadonlySet<string>;
  /** Dragged column widths. Body cells have to carry them too: an auto-layout table sizes a column to
   * its widest cell, so pinning only the header lets the content below push it back open. */
  columnWidths: Record<string, number>;
  onUpdateCell: (key: string, metricId: string, raw: string) => void;
  onUpdateAddedRow: (key: string, field: string, raw: string) => void;
  /** Removes this manually-added row from the staged batch. Absent for a rendered existing row - the
   *  ✕ only ever shows on an added one (D1). */
  onRemoveAddedRow?: (key: string) => void;
  /** Opens the row's conversions by action. Absent on a grouped report, where a row is many rows. */
  onOpenConversions?: (row: KeyedReportRow) => void;
  /** The campaign this row belongs to - the Add Line id cells resolve/generate against the campaign's
   *  own mart data (PDI_117), so they need the id regardless of what the row itself carries. */
  campaignId: number;
  /** This row's current Add Line mode (D2) - a plain string, not an object, so it can vary per row
   *  without busting every other row's memo. */
  onResolveAddLineId: (key: string, level: AddLineLevel, id: string) => void;
}

/**
 * One data row's cells, memoized so an unrelated row's re-render (a keystroke elsewhere, a sort-state
 * change, a page arriving) doesn't reconcile every mounted row - only the row whose own props actually
 * changed. Effective only because the parent passes a per-row-stable `override` (from `staged.adj`,
 * a `Record` that keeps other keys' references stable across an edit - see
 * NEW-UX-PLAN/11-REPORTING-TABLE-PERFORMANCE-PLAN.md D5/D6), stable (`useCallback`) edit handlers, and
 * the two drag-state numbers above rather than an object, so a column drag only reconciles this row on a
 * boundary crossing.
 */
const ReportRow = memo(function ReportRow({
  row,
  override,
  isAdded,
  columns,
  draggedColumnIndex,
  dropBoundaryIndex,
  editing,
  editMode,
  invalidCells,
  requiredCells,
  metricDrafts,
  lockedDimIds,
  columnWidths,
  onUpdateCell,
  onUpdateAddedRow,
  onRemoveAddedRow,
  onOpenConversions,
  campaignId,
  onResolveAddLineId,
}: ReportRowProps) {
  const merged = override ? { ...row, ...override } : row;
  const isModified = Boolean(override);
  // A manually added row's CNB_* fields are not stored: the view reads them back out of the
  // constructed name by splitting on "_". So they are shown here as that same split, updating as the
  // name is typed - a value typed into them directly would simply vanish on the next read.
  const nameParts = isAdded ? constructedNameParts(String(merged.line_item_name ?? "")) : undefined;

  /** The dragged/drop-boundary classes for the column at `index` - identical wherever a cell renders,
   *  header, totals or here, so the eye can find the column being carried regardless of where it looks. */
  function dragClass(index: number): string {
    return cn(
      columnDragCellClass(index, draggedColumnIndex),
      columnDropCellClass(index, dropBoundaryIndex, columns.length)
    );
  }

  /** Whether the cell at `index` carries this row's remove control - the leading cell of an added row
   *  while editing. Separate from `removeControl` because the cell itself needs to know: it becomes the
   *  button's containing block and gives up its left padding to it (see `reporting-tab__cell--removable`). */
  function hasRemoveControl(index: number): boolean {
    return index === 0 && isAdded && editing && Boolean(onRemoveAddedRow);
  }

  /** The added row's own remove control. Lives in the row's leading cell rather than a column of its
   *  own: this component renders cells, not the <tr>, and a real column would have to be threaded
   *  through DataTable's header, drag indices, widths and colSpan for one row-level affordance.
   *
   *  Positioned out of the cell's content flow (CSS), not rendered before it inline: a cell clips its
   *  overflow, and an inline button would push the neighbouring `width: 100%` input right by its own
   *  width and get that input's right edge clipped - on the leading date cell, exactly where a native
   *  date input keeps its calendar icon and year segment, which cost the ability to enter the date. */
  function removeControl(index: number) {
    if (!hasRemoveControl(index) || !onRemoveAddedRow) return null;
    return (
      <button
        type="button"
        className="reporting-tab__row-remove"
        aria-label="Remove new line"
        title="Remove this line"
        onClick={() => onRemoveAddedRow(row.key)}
      >
        <CloseIcon />
      </button>
    );
  }

  function renderDim(d: DimDef, index: number) {
    const isRequiredInvalid = requiredCells.has(cellKey(row.key, d.id));
    const isInherited = isAdded && lockedDimIds.has(d.id);
    const isFromName = isAdded && NAME_DERIVED_DIMS.has(d.id);
    // PDI_117: the three constructed ids are never an input at all on an added row - resolved from the
    // (still plain-text) typed name or generated server-side, but never typed (D1). Every other cell,
    // including platform/account/account_id/date and the three name cells, keeps its existing behaviour.
    const isIdDim = isAdded && ID_DERIVED_DIMS.has(d.id);
    const levelForIdDim: AddLineLevel | null =
      d.id === "line_item_id" ? "LVL1" : d.id === "insertion_order_id" ? "LVL2"
        : d.id === "campaign_constructed_id" ? "LVL3" : null;
    // PDI_116: the four audit stamps and the adjusted_metrics marker are written by the server on
    // save, never by the user - an added row renders them read-only, like the id/name-derived cells.
    const isServerOwned = isAdded && SERVER_OWNED_DIMS.has(d.id);
    return (
      <td
        key={d.id}
        className={cn(
          dimColClass(d.id),
          (isFromName || isIdDim || isServerOwned) && editing && "reporting-tab__cell--derived",
          hasRemoveControl(index) && "reporting-tab__cell--removable",
          dragClass(index)
        )}
        style={columnStyle(columnWidths[d.id])}
        title={
          editing && isIdDim
            ? "Selected or generated automatically — never typed"
            : editing && isFromName
              ? "Read from the constructed name — edit the name to change it"
              : editing && isServerOwned
                ? "Written by the server on save — never typed"
                : editing && isInherited
                  ? "Inherited from this campaign"
                  : undefined
        }
      >
        {removeControl(index)}
        {editing && isIdDim && levelForIdDim ? (
          <>
            <AddLineIdCell
              campaignId={campaignId}
              level={levelForIdDim}
              platform={String(merged.platform ?? "")}
              accountId={String(merged.account_id ?? "")}
              typedName={String(merged[ADD_LINE_LEVEL_NAME_DIM_ID[levelForIdDim] as keyof KeyedReportRow] ?? "")}
              currentId={String(merged[d.id as keyof KeyedReportRow] ?? "")}
              nameLvl1={String(merged.line_item_name ?? "")}
              nameLvl2={String(merged.insertion_order_name ?? "")}
              nameLvl3={String(merged.campaign_constructed_name ?? "")}
              onResolved={(level, id) => onResolveAddLineId(row.key, level, id)}
            />
            {isRequiredInvalid && <span className="reporting-tab__cell-error">Required</span>}
          </>
        ) : editing && isAdded && isFromName ? (
          <>
            {nameParts?.[d.id] || "—"}
            {isRequiredInvalid && <span className="reporting-tab__cell-error">Required</span>}
          </>
        ) : editing && isAdded && isServerOwned ? (
          <>
            {dimCell(d.id, merged)}
            {isRequiredInvalid && <span className="reporting-tab__cell-error">Required</span>}
          </>
        ) : editing && isAdded && !isInherited ? (
          <>
            <input
              className={cn(
                "reporting-tab__cell-input",
                isRequiredInvalid && "reporting-tab__cell-input--error"
              )}
              // A date cell gets the calendar, like the report period and the Setup tab's add-line
              // form. Not only to save typing: this value is written to a BigQuery DATE column, and
              // a text box happily accepts "10/22/2025" or "yesterday" for the insert to choke on.
              type={d.id === DATE_DIM_ID ? "date" : "text"}
              aria-label={`${d.label} for new line`}
              aria-invalid={isRequiredInvalid}
              value={String(merged[d.id as keyof KeyedReportRow] ?? "")}
              onChange={(event) => onUpdateAddedRow(row.key, d.id, event.target.value)}
            />
            {isRequiredInvalid && <span className="reporting-tab__cell-error">Required</span>}
          </>
        ) : editing && isAdded && isRequiredInvalid ? (
          <>
            {dimCell(d.id, merged)}
            <span className="reporting-tab__cell-error">Required</span>
          </>
        ) : (
          dimCell(d.id, merged)
        )}
        {d.id === "line_item_id" && isAdded && !editing && (
          <span className="reporting-tab__badge reporting-tab__badge--manual">Manual</span>
        )}
        {d.id === "line_item_id" && !isAdded && isModified && (
          <span className="reporting-tab__badge reporting-tab__badge--modified">Modified</span>
        )}
      </td>
    );
  }

  function renderMet(m: MetricDef, index: number) {
    const id = cellKey(row.key, m.id);
    const cellEditable = editing && editMode === "lines" && EDITABLE_METRIC_IDS.has(m.id);
    const isInvalid = invalidCells.has(id);
    const isMetricRequired = isAdded && requiredCells.has(id);
    const cellModified = !isAdded && override?.[m.id as keyof KeyedReportRow] != null;
    const draft = metricDrafts.get(id);
    const display =
      draft !== undefined
        ? draft
        : editableMetricDisplay(merged[m.id as keyof KeyedReportRow]);
    return (
      <td
        key={m.id}
        className={cn(
          metricColClass(m.id),
          cellModified && "reporting-tab__metric-cell--modified",
          hasRemoveControl(index) && "reporting-tab__cell--removable",
          dragClass(index)
        )}
        style={columnStyle(columnWidths[m.id])}
        title={cellModified ? `Original: ${rowMetricCell(row, m.id)}` : undefined}
      >
        {removeControl(index)}
        {cellEditable ? (
          <input
            className={cn(
              "reporting-tab__cell-input",
              "reporting-tab__cell-input--num",
              (isInvalid || isMetricRequired) && "reporting-tab__cell-input--error"
            )}
            type="text"
            inputMode="decimal"
            aria-label={`${m.label} for ${merged.line_item_id || "new line"}`}
            aria-invalid={isInvalid || isMetricRequired}
            value={display}
            placeholder={!isAdded ? editableMetricDisplay(row[m.id as keyof KeyedReportRow]) : undefined}
            onChange={(event) =>
              isAdded
                ? onUpdateAddedRow(row.key, m.id, event.target.value)
                : onUpdateCell(row.key, m.id, event.target.value)
            }
          />
        ) : m.id === "conversions" && onOpenConversions && !isAdded && merged.conversions != null ? (
          /* Not an input like the delivery metrics: this figure is a sum over conversion actions,
             and a number typed here would have no action to belong to. The button opens the rows
             it is made of, which is where a figure can be edited.

             A blank cell is left alone. It means the join attached nothing here - either no
             conversions match the row, or the row is one of the siblings a campaign-level channel
             deliberately blanks so its total is stated once. Neither has a breakdown to show, and
             offering one would promise rows that are not there. */
          <button
            type="button"
            className="reporting-tab__conv-open"
            aria-label={`Conversions by action for ${merged.line_item_name || merged.line_item_id || "this row"}`}
            onClick={() => onOpenConversions(row)}
          >
            {rowMetricCell(merged, m.id)}
          </button>
        ) : (
          rowMetricCell(merged, m.id)
        )}
        {isMetricRequired && <span className="reporting-tab__cell-error">Required</span>}
        {isInvalid && <span className="reporting-tab__cell-error">{invalidCells.get(id)}</span>}
      </td>
    );
  }

  return (
    <>
      {columns.map((col, index) => (col.kind === "dimension" ? renderDim(col.dim, index) : renderMet(col.met, index)))}
    </>
  );
});

/**
 * The source system's naming-levels table, behind a "?" next to Edit data.
 *
 * The three constructed levels are the report's most confusing columns by far - what level 1 means
 * flips between line item, ad set, campaign and insertion order depending on the row's platform - and
 * the column headers can only ever name one reading at a time. This shows all of them at once.
 *
 * Shown on hover, so glancing at it costs nothing and leaving dismisses it - a reference table read
 * beside the data it explains, not a dialog to open and close. The pointer can travel from the "?"
 * into the table because the popover is a child of the same wrapper (so leaving the button for it is
 * not leaving the hint) and because the popover bridges the gap between the two in CSS.
 *
 * Focus opens it too, and Escape gives up focus, so it is reachable without a pointer.
 */
function LevelsHint() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  return (
    <div
      className="reporting-tab__levels-hint"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="reporting-tab__levels-btn"
        aria-label="What the constructed levels mean"
        aria-expanded={open}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
      >
        ?
      </button>
      {open && (
      <div className="reporting-tab__levels-pop" role="note">
        <h4 className="reporting-tab__levels-title">Constructed naming levels</h4>
        <p className="reporting-tab__levels-lead">
          What each level denotes depends on the platform, so the level columns are named neutrally
          unless every row in view is from one platform.
        </p>
        <div className="reporting-tab__levels-scroll">
          <table className="reporting-tab__levels-tbl">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Level 1</th>
                <th>Level 2</th>
                <th>Level 3</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORM_LEVELS.map((row) => (
                <tr key={row.platform}>
                  <th scope="row">{row.platform}</th>
                  <td>{row.terms.l1}</td>
                  <td>{row.terms.l2}</td>
                  <td>{row.terms.l3}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

interface PickerProps {
  title: string;
  defs: Array<{ id: string; label: string; agg?: "SUM" | "AVG" | "WTD"; description?: string }>;
  selected: string[];
  query: string;
  onQuery: (value: string) => void;
  onToggle: (id: string, on: boolean) => void;
  onAll: () => void;
  onClear: () => void;
  /** Restores the picker's own default selection, when it has one worth returning to. */
  onDefault?: () => void;
  defaultHint?: string;
  disabled?: boolean;
}

function Picker({
  title,
  defs,
  selected,
  query,
  onQuery,
  onToggle,
  onAll,
  onClear,
  onDefault,
  defaultHint,
  disabled = false,
}: PickerProps) {
  const debouncedQuery = useDebounce(query, PICKER_SEARCH_DEBOUNCE_MS);
  const q = debouncedQuery.toLowerCase();
  const items = defs.filter((d) => d.label.toLowerCase().includes(q)).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className={cn("reporting-tab__picker", disabled && "reporting-tab__picker--disabled")}>
      <div className="reporting-tab__picker-head">
        <h4>{title} <span className="reporting-tab__pick-count">{selected.length}</span></h4>
        <div className="reporting-tab__pick-actions">
          {onDefault && (
            <button type="button" onClick={onDefault} disabled={disabled} title={defaultHint}>
              Default
            </button>
          )}
          <button type="button" onClick={onAll} disabled={disabled}>All</button>
          <button type="button" onClick={onClear} disabled={disabled}>Clear</button>
        </div>
      </div>
      <div className="reporting-tab__picker-search">
        <SearchIcon />
        <input
          placeholder={`Search ${title.toLowerCase()}…`}
          aria-label={`Search ${title.toLowerCase()}`}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="reporting-tab__picker-list">
        {items.length === 0 && <div className="reporting-tab__pick-empty">No matches for &ldquo;{query}&rdquo;.</div>}
        {items.map((item) => (
          <label key={item.id} className={cn("reporting-tab__check", disabled && "reporting-tab__check--disabled")}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) => onToggle(item.id, event.target.checked)}
              disabled={disabled}
            />
            <span className="reporting-tab__check-text">
              <span className="reporting-tab__check-label">{item.label}</span>
              {item.description && <span className="reporting-tab__check-desc">{item.description}</span>}
            </span>
            {item.agg && <span className="reporting-tab__agg-badge">{item.agg}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

interface ReportFilterPopoverProps {
  campaignId: number;
  field: ReportRowFilterFieldEnumV1;
  label: string;
  initialSelected: string[];
  anchor: HTMLElement | null;
  onApply: (values: string[]) => void;
  onClose: () => void;
}

/**
 * Reads one dimension's distinct values and hands them to the shared value filter.
 *
 * All this adds is the read - which endpoint the values come from is the only thing that differed between
 * this tab's filter and the Dashboards tab's, and the two were otherwise the same 60 lines twice.
 */
function ReportFilterPopover({
  campaignId,
  field,
  label,
  initialSelected,
  anchor,
  onApply,
  onClose,
}: ReportFilterPopoverProps) {
  const distinctValues = useReportRowDistinctValues(campaignId, field, true);

  return (
    <DataTableValueFilterPopover
      label={label}
      values={distinctValues.data ?? []}
      initialSelected={initialSelected}
      isPending={distinctValues.isPending}
      errorMessage={distinctValues.isError ? formatError(distinctValues.error) : undefined}
      anchor={anchor}
      onApply={onApply}
      onClose={onClose}
    />
  );
}
