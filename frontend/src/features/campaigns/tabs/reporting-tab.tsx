import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { useDebounce } from "../../../shared/hooks/use-debounce";
import { cn } from "../../../shared/style/cn";
import {
  EditIcon,
  ExpandIcon,
  FilterIcon,
  MoreVerticalIcon,
  PlusIcon,
  SearchIcon,
  SortIcon,
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
 * except the metrics themselves; campaign identity and audit stamps are server-owned and never sent.
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
/** Floor for a dragged column, so one can be narrowed out of the way but never out of existence. */
const MIN_COLUMN_WIDTH = 72;
/** How far one arrow-key press moves a column edge - the keyboard equivalent of a drag. */
const COLUMN_RESIZE_STEP = 12;
/** The Date dimension, whose filter is a window rather than a value list and so is held separately. */
const DATE_DIM_ID = "date";
const CONVERSION_BREAKDOWN_BASE_DIM_IDS = ["date", "line_item_name", "channel"] as const;
const CAMPAIGN_LEVEL_CONVERSION_CHANNELS = new Set(["Google SEM", "Google Search", "YouTube"]);
/** The CNB_* dimensions the view derives by splitting the constructed name, so an added row shows
 * them read-only rather than inviting a value that would be overwritten on read. */
const NAME_DERIVED_DIMS = new Set<string>(CONSTRUCTED_NAME_PART_IDS);

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
 * two-value filter: [from, to].
 *
 * @param config        the report config being saved
 * @param activeFilters value-list filters currently applied
 * @param dateWindow    current delivery-date window
 * @returns filters for the saved report view
 */
function savedReportFilters(
  config: ReportConfig,
  activeFilters: ReportRowFilterV1[],
  dateWindow: DateWindow
): ReportRowFilterV1[] {
  const filters = activeFilters.filter((filter) => filter.field !== "DATE");
  if (!config.dimensions.includes(DATE_DIM_ID) || (dateWindow.from === "" && dateWindow.to === "")) {
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

/** One narrowing in force on the table, named and clearable independently of its column. */
interface Narrowing {
  id: string;
  /** The dimension's own label, as its column header would read it. */
  label: string;
  summary: string;
  clear: () => void;
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
    // sorted or filtered by, and neither can be reached once its header is gone.
    dropStateForDeselectedColumns(selected.config);
  }

  const activeFilters = useMemo<ReportRowFilterV1[]>(
    () =>
      Object.entries(filterState)
        .filter(([, values]) => values.length > 0)
        .map(([id, values]) => ({ field: id.toUpperCase() as ReportRowFilterFieldEnumV1, values })),
    [filterState]
  );
  // Every narrowing currently in force, listed above the table rather than only inside the column
  // header it was set from - so what the rows have been reduced to is legible without opening three
  // popovers to find out, and clearable without opening them either.
  const narrowings = useMemo<Narrowing[]>(() => {
    const applied: Narrowing[] = [];
    if (dateWindow.from !== "" || dateWindow.to !== "") {
      applied.push({
        id: "date-window",
        label: "Date",
        summary: dateWindowSummary(dateWindow),
        clear: () => setDateWindow(NO_DATE_WINDOW),
      });
    }
    for (const def of DIM_DEFS) {
      const values = filterState[def.id];
      if (values == null || values.length === 0) continue;
      applied.push({
        id: def.id,
        label: def.label,
        summary: values.length === 1 ? values[0] : `${values.length} values`,
        clear: () => setFilterState((current) => ({ ...current, [def.id]: [] })),
      });
    }
    return applied;
  }, [dateWindow, filterState]);
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
  // True once the loading gate below stops returning early. The report-rows fetch now genuinely starts
  // one render after `reports` resolves (it was disabled until `hasReports` flipped true), so there's an
  // extra render where `reports.hasNextPage`/etc. already changed while the sentinel `<tr>`s further down
  // still aren't mounted (still behind the loading gate) - without this in the sentinel effects' deps
  // below, they'd bail on that render (ref still null) and never re-run once the row finally mounts,
  // since their own deps wouldn't change again afterwards (same footgun as the Overview page's own
  // scroll sentinel - see its `Boolean(summary)` dep).
  const contentShown = !reports.isPending && !(hasReports && reportRows.isPending);

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
  const [openFilterFor, setOpenFilterFor] = useState<string | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("lines");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  // Widths the user has dragged, by column id. Absent means "whatever the stylesheet says" - the table
  // is auto-layout, so an untouched column still sizes itself to its content.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);
  const sidebar = useSidebarCollapse();
  // What the sidebar was before expanding took it away, so collapsing gives back what it found rather
  // than assuming the user wants it open.
  const sidebarBeforeExpand = useRef(false);

  /** Puts the table back inline and the sidebar back the way expanding found it. */
  const collapseTable = useCallback(() => {
    setExpanded(false);
    sidebar.setCollapsed(sidebarBeforeExpand.current);
  }, [sidebar]);

  // Expanding hides everything above the table - the reports list, the builder, the controls - and
  // collapsing puts it all back, which moves the table a screenful or two down the page while the
  // scroll offset stays where it was. The window ends up showing whatever now occupies that offset,
  // usually the top of the page, and the table the user was reading is gone. Both directions therefore
  // bring the table back under the eye. `null` until the first paint so opening the tab does not
  // scroll anything.
  const actionsRowRef = useRef<HTMLDivElement>(null);
  const paintedExpanded = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (paintedExpanded.current !== null && paintedExpanded.current !== expanded) {
      actionsRowRef.current?.scrollIntoView({ block: "start" });
    }
    paintedExpanded.current = expanded;
  }, [expanded]);

  // Expanded is a mode, not a route, so Escape has to get out of it - there is no other affordance
  // once the page chrome is hidden and the user has scrolled away from the Collapse button.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") collapseTable();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, collapseTable]);

  // Navigating away mid-expand must not leave the sidebar collapsed on the next page - the table that
  // borrowed the space is gone, and nothing else would ever hand it back.
  const restoreSidebarOnUnmount = useRef(() => {});
  restoreSidebarOnUnmount.current = () => {
    if (expanded) sidebar.setCollapsed(sidebarBeforeExpand.current);
  };
  useEffect(() => () => restoreSidebarOnUnmount.current(), []);

  /** Sets one column's width, floored so a column can never be dragged away to nothing. */
  const resizeColumn = useCallback((columnId: string, width: number) => {
    setColumnWidths((current) => ({ ...current, [columnId]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) }));
  }, []);

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
    if (!menuFor && !createMenuOpen && !openFilterFor && !downloadMenuOpen && !editMenuOpen) return undefined;
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".reporting-tab__menu-wrap")) {
        setMenuFor(null);
        setReportMenuAnchor(null);
        setCreateMenuOpen(false);
        setDownloadMenuOpen(false);
        setEditMenuOpen(false);
      }
      if (!target.closest(".reporting-tab__filter-wrap") && !target.closest(".reporting-tab__filter-pop")) {
        setOpenFilterFor(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuFor, createMenuOpen, openFilterFor, downloadMenuOpen, editMenuOpen]);

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

  // Stable array identity across renders (same `appliedConfig`/platform mix) so passing `dims`/`mets`
  // to the memoized ReportRow below never busts its memo on its own. The level labels are resolved
  // here rather than at each render site, so the column header and the added-row inputs' accessible
  // names can never disagree about what a level is called.
  const dims = useMemo(
    () =>
      DIM_DEFS.filter((d) => appliedConfig.dimensions.includes(d.id)).map((d) => ({
        ...d,
        label: levelDimLabel(d.id, d.label, levelTerms),
      })),
    [appliedConfig.dimensions, levelTerms]
  );
  const mets = useMemo(
    () => METRIC_DEFS.filter((m) => appliedConfig.metrics.includes(m.id)),
    [appliedConfig.metrics]
  );

  // Windows the data rows so scrolling a large campaign doesn't mount every loaded row - the sticky
  // <thead> + totals row sit above the virtualized content inside the same scroll container, so
  // `scrollMargin` offsets the virtualizer's math by their measured height.
  const dataScrollRef = useRef<HTMLDivElement>(null);
  const dataTheadRef = useRef<HTMLTableSectionElement>(null);
  const totalsRowRef = useRef<HTMLTableRowElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    setScrollMargin((dataTheadRef.current?.offsetHeight ?? 0) + (totalsRowRef.current?.offsetHeight ?? 0));
  }, [dims, mets]);
  const rowVirtualizer = useVirtualizer({
    count: orderedRows.length,
    getScrollElement: () => dataScrollRef.current,
    // Matches the dense row height set in reporting-tab.css (6px vertical padding + one 13.5px line).
    // Every row is one line now, so this is exact rather than a starting guess, and `measureElement`
    // has nothing to correct unless a cell wraps.
    estimateSize: () => 30,
    overscan: 8,
    scrollMargin,
    getItemKey: (index) => orderedRows[index].renderKey,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualPaddingTop = virtualRows.length > 0 ? virtualRows[0].start - scrollMargin : 0;
  const virtualPaddingBottom =
    virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  const sentinelRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && reportRows.hasNextPage && !reportRows.isFetchingNextPage) {
          reportRows.fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [reportRows.hasNextPage, reportRows.isFetchingNextPage, reportRows.fetchNextPage, contentShown]);

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

  if (reports.isPending || (hasReports && reportRows.isPending)) {
    return <LoadingBlock label="Loading reports" />;
  }
  if (reports.isError) {
    return <p className="form-error">{formatError(reports.error)}</p>;
  }
  if (reportRows.isError) {
    return <p className="form-error">{formatError(reportRows.error)}</p>;
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
   * Drops every sort and filter the applied view can no longer express, because the column it named is
   * no longer in the report.
   *
   * <p>Sorts and filters are reached through the column header - the chevron and the funnel - so a
   * column that leaves the report takes the only handle on them with it. What stays behind keeps acting
   * on the rows with nothing on screen to say so: a report narrowed to one delivery date shows a single
   * day of a campaign and looks like the whole of it, and a report ordered by a metric nobody selected
   * comes back in an order that cannot be explained from what is visible. A grouped read cannot even
   * order by a dimension it does not group by.
   *
   * @param config the selection about to be applied
   */
  function dropStateForDeselectedColumns(config: ReportConfig) {
    const shown = new Set([...config.dimensions, ...config.metrics].map((id) => id.toUpperCase()));
    if (sortField != null && !shown.has(sortField)) {
      setSortField(null);
      setSortDirection("ASC");
    }
    const dimensions = new Set(config.dimensions);
    if (!dimensions.has(DATE_DIM_ID) && (dateWindow.from !== "" || dateWindow.to !== "")) {
      setDateWindow(NO_DATE_WINDOW);
    }
    setFilterState((current) => {
      const kept = Object.entries(current).filter(([id]) => dimensions.has(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }

  /** Commits the staged dimensions/metrics. The dimensions are the aggregation key, so this re-reads
   * the table at the new grain rather than only re-rendering columns of an already-loaded page. */
  function apply() {
    setAppliedConfig(draftConfig);
    dropStateForDeselectedColumns(draftConfig);
    toast.showSuccess("Changes applied to report view.");
  }

  function saveReport() {
    if (!selected) return;
    const name = normalizeSelectedName();
    if (!name) return;
    const filters = savedReportFilters(draftConfig, activeFilters, dateWindow);
    reports
      .saveReport(selected.id, { ...draftConfig, filters }, name)
      .then(() => {
        setAppliedConfig({ ...draftConfig, filters });
        toast.showSuccess("Report saved.");
      })
      .catch(reportError);
  }

  const openFilterDef = dims.find((d) => d.id === openFilterFor);

  /** Enters Edit data mode in the given sub-mode - "lines" for per-row inline edits, "bulk" for the
   * offline delivery spreadsheet, "conversions" for the offline conversions spreadsheet. */
  function enterEditMode(mode: EditMode) {
    setOpenFilterFor(null);
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
      adjustments.push({ added: false, ...identityFields(base), ...values, adjusted_metrics: changed.join(",") });
    }
    for (const row of staged.added) {
      const { values, changed } = stagedMetrics(row);
      // Send the CNB_* split the view will derive from the name anyway, rather than whatever the row
      // object happens to hold - so the write table records the row the report will actually show.
      const identity = { ...identityFields(row), ...constructedNameParts(String(row.line_item_name ?? "")) };
      adjustments.push({ added: true, ...identity, ...values, adjusted_metrics: changed.join(",") });
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
              dimensions: appliedConfig.dimensions,
              metrics: appliedConfig.metrics,
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
        sortField: sortField ?? undefined,
        sortDirection: sortField ? sortDirection : undefined,
        dimensions: appliedConfig.dimensions,
        metrics: appliedConfig.metrics,
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
            <div className="reporting-tab__view-controls">
              <span className="reporting-tab__row-count">
                {totalRows === 0
                  ? "No rows"
                  : loadedRows < totalRows
                    ? `${loadedRows.toLocaleString("en-US")} of ${totalRows.toLocaleString("en-US")} rows`
                    : `${totalRows.toLocaleString("en-US")} row${totalRows === 1 ? "" : "s"}`}
              </span>
              <button
                type="button"
                className="button button--ghost button--sm"
                aria-pressed={expanded}
                onClick={() => {
                  if (expanded) {
                    collapseTable();
                    return;
                  }
                  sidebarBeforeExpand.current = sidebar.collapsed;
                  sidebar.setCollapsed(true);
                  setExpanded(true);
                }}
              >
                <ExpandIcon />
                {expanded ? "Collapse table" : "Expand table"}
              </button>
            </div>
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

          {editing && editMode === "conversions" && (
            <div className="reporting-tab__bulk-panel">
              <div className="reporting-tab__bulk-text">
                Conversions live at their own grain - one row per day, line item and conversion action - so
                they are adjusted in a spreadsheet of their own. Download it, edit the conversions column,
                then re-upload. Only the date window narrows it; the table's column filters do not apply.
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

          {narrowings.length > 0 && (
            <div className="reporting-tab__narrowings">
              <span className="reporting-tab__narrowings-lead">Showing only</span>
              {narrowings.map((narrowing) => (
                <span key={narrowing.id} className="reporting-tab__narrowing">
                  {narrowing.label}: {narrowing.summary}
                  <button
                    type="button"
                    className="reporting-tab__narrowing-clear"
                    aria-label={`Clear the ${narrowing.label} filter`}
                    onClick={narrowing.clear}
                    disabled={editing}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="reporting-tab__data-scroll-wrap">
            <div className="reporting-tab__data-scroll" ref={dataScrollRef}>
              <table className="reporting-tab__data-tbl">
                <thead ref={dataTheadRef}>
                  <tr>
                    {dims.map((d) => {
                      // The date window is its own state, not a value list, so its column's filter
                      // icon lights up from the window instead of from `filterState`.
                      const filterValues = filterState[d.id] ?? [];
                      const isFiltered = d.id === "date"
                        ? dateWindow.from !== "" || dateWindow.to !== ""
                        : filterValues.length > 0;
                      return (
                        <th key={d.id} className={dimColClass(d.id)} style={columnStyle(columnWidths[d.id])}>
                          <div className="reporting-tab__col-head">
                            <button
                              type="button"
                              className={cn("reporting-tab__sort-btn", sortField === d.id.toUpperCase() && "reporting-tab__sort-btn--active")}
                              onClick={() => toggleSort(d.id)}
                              disabled={isReloading || editing}
                            >
                              <span
                                className="reporting-tab__sort-label"
                                title={d.description ? `${d.label} — ${d.description}` : d.label}
                              >
                                {d.label}
                              </span>
                              <SortIcon active={sortField === d.id.toUpperCase() ? sortDirection.toLowerCase() as "asc" | "desc" : undefined} />
                            </button>
                            <div className="reporting-tab__filter-wrap">
                              <button
                                type="button"
                                className={cn("reporting-tab__filter-btn", isFiltered && "reporting-tab__filter-btn--active")}
                                aria-label={`Filter ${d.label}`}
                                aria-expanded={openFilterFor === d.id}
                                disabled={editing}
                                onClick={(event) => {
                                  setFilterAnchor(event.currentTarget);
                                  setOpenFilterFor((current) => (current === d.id ? null : d.id));
                                }}
                              >
                                <FilterIcon />
                              </button>
                            </div>
                          </div>
                          <ColumnResizer columnId={d.id} label={d.label} width={columnWidths[d.id]} onResize={resizeColumn} />
                        </th>
                      );
                    })}
                    {mets.map((m) => (
                      <th key={m.id} className={metricColClass(m.id)} style={columnStyle(columnWidths[m.id])}>
                        <button
                          type="button"
                          className={cn("reporting-tab__sort-btn", sortField === m.id.toUpperCase() && "reporting-tab__sort-btn--active")}
                          onClick={() => toggleSort(m.id)}
                          disabled={isReloading || editing}
                        >
                          <span
                            className="reporting-tab__sort-label"
                            title={m.description ? `${m.label} — ${m.description}` : m.label}
                          >
                            {m.label}
                          </span>
                          <span className="reporting-tab__agg">{m.agg}</span>
                          <SortIcon active={sortField === m.id.toUpperCase() ? sortDirection.toLowerCase() as "asc" | "desc" : undefined} />
                        </button>
                        <ColumnResizer columnId={m.id} label={m.label} width={columnWidths[m.id]} onResize={resizeColumn} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="reporting-tab__totals" ref={totalsRowRef}>
                    {dims.map((d) => (
                      <td key={d.id} className={dimColClass(d.id)} style={columnStyle(columnWidths[d.id])}>
                        {totDim(d.id)}
                      </td>
                    ))}
                    {mets.map((m) => (
                      <td key={m.id} className={metricColClass(m.id)} style={columnStyle(columnWidths[m.id])}>
                        {totalCell(totals, m.id)}
                      </td>
                    ))}
                  </tr>
                  {virtualPaddingTop > 0 && (
                    <tr className="reporting-tab__spacer-row" aria-hidden="true">
                      <td style={{ height: virtualPaddingTop }} colSpan={dims.length + mets.length} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const index = virtualRow.index;
                    const { row, isAdded } = orderedRows[index];
                    const override = isAdded ? undefined : staged.adj[row.key];
                    return (
                      <tr key={virtualRow.key} ref={rowVirtualizer.measureElement} data-index={index}>
                        <ReportRow
                          row={row}
                          override={override}
                          isAdded={isAdded}
                          dims={dims}
                          mets={mets}
                          editing={editing}
                          editMode={editMode}
                          invalidCells={invalidCells}
                          requiredCells={requiredCells}
                          metricDrafts={metricDrafts}
                          lockedDimIds={lockedDimIds}
                          columnWidths={columnWidths}
                          onUpdateCell={updateCell}
                          onUpdateAddedRow={updateAddedRow}
                          /* Offered on every report, grouped or not. Whether the rows behind the cell
                             are really the rows the panel found is settled by the panel, which can
                             compare their sum against the figure - a check no dimension list can make. */
                          onOpenConversions={openConversions}
                        />
                      </tr>
                    );
                  })}
                  {virtualPaddingBottom > 0 && (
                    <tr className="reporting-tab__spacer-row" aria-hidden="true">
                      <td style={{ height: virtualPaddingBottom }} colSpan={dims.length + mets.length} />
                    </tr>
                  )}
                  {reportRows.hasNextPage && (
                    <tr ref={sentinelRef}>
                      <td colSpan={dims.length + mets.length} className="reporting-tab__load-more">
                        {reportRows.isFetchingNextPage && <LoadingSpinner label="Loading more rows" size="sm" />}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {isReloading && <LoadingOverlay label="Updating…" className="reporting-tab__reload-overlay" />}
          </div>

          {openFilterDef?.id === "date" ? (
            <DateWindowPopover
              window={dateWindow}
              bounds={unwindowedDates.current}
              anchor={filterAnchor}
              onApply={setDateWindow}
              onClose={() => setOpenFilterFor(null)}
            />
          ) : (
            openFilterDef && (
              <FilterPopover
                campaignId={campaign.id}
                field={openFilterDef.id.toUpperCase() as ReportRowFilterFieldEnumV1}
                label={openFilterDef.label}
                initialSelected={filterState[openFilterDef.id] ?? []}
                anchor={filterAnchor}
                onApply={(values) => setFilterState((current) => ({ ...current, [openFilterDef.id]: values }))}
                onClose={() => setOpenFilterFor(null)}
              />
            )
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
  dims: DimDef[];
  mets: MetricDef[];
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
  /** Opens the row's conversions by action. Absent on a grouped report, where a row is many rows. */
  onOpenConversions?: (row: KeyedReportRow) => void;
}

/**
 * One data row's cells, memoized so an unrelated row's re-render (a keystroke elsewhere, a sort-state
 * change, a page arriving) doesn't reconcile every mounted row - only the row whose own props actually
 * changed. Effective only because the parent passes a per-row-stable `override` (from `staged.adj`,
 * a `Record` that keeps other keys' references stable across an edit - see
 * NEW-UX-PLAN/11-REPORTING-TABLE-PERFORMANCE-PLAN.md D5/D6) and stable (`useCallback`) edit handlers,
 * rather than rebuilding a merged array/new closures on every keystroke.
 */
const ReportRow = memo(function ReportRow({
  row,
  override,
  isAdded,
  dims,
  mets,
  editing,
  editMode,
  invalidCells,
  requiredCells,
  metricDrafts,
  lockedDimIds,
  columnWidths,
  onUpdateCell,
  onUpdateAddedRow,
  onOpenConversions,
}: ReportRowProps) {
  const merged = override ? { ...row, ...override } : row;
  const isModified = Boolean(override);
  // A manually added row's CNB_* fields are not stored: the view reads them back out of the
  // constructed name by splitting on "_". So they are shown here as that same split, updating as the
  // name is typed - a value typed into them directly would simply vanish on the next read.
  const nameParts = isAdded ? constructedNameParts(String(merged.line_item_name ?? "")) : undefined;
  return (
    <>
      {dims.map((d) => {
        const isRequiredInvalid = requiredCells.has(cellKey(row.key, d.id));
        const isInherited = isAdded && lockedDimIds.has(d.id);
        const isFromName = isAdded && NAME_DERIVED_DIMS.has(d.id);
        return (
          <td
            key={d.id}
            className={cn(dimColClass(d.id), isFromName && editing && "reporting-tab__cell--derived")}
            style={columnStyle(columnWidths[d.id])}
            title={
              editing && isFromName
                ? "Read from the constructed name — edit the name to change it"
                : editing && isInherited
                  ? "Inherited from this campaign"
                  : undefined
            }
          >
            {editing && isAdded && isFromName ? (
              <>
                {nameParts?.[d.id] || "—"}
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
      })}
      {mets.map((m) => {
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
            className={cn(metricColClass(m.id), cellModified && "reporting-tab__metric-cell--modified")}
            style={columnStyle(columnWidths[m.id])}
            title={cellModified ? `Original: ${rowMetricCell(row, m.id)}` : undefined}
          >
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
      })}
    </>
  );
});

/** Pins a column to a dragged width. The stylesheet's own min/max have to be overridden together, or
 * an auto-layout table keeps sizing the column to its content and the drag appears to do nothing. */
function columnStyle(width: number | undefined): CSSProperties | undefined {
  return width == null ? undefined : { width, minWidth: width, maxWidth: width };
}

interface ColumnResizerProps {
  columnId: string;
  label: string;
  /** The width already set for this column, if any - the base the next gesture moves from. */
  width: number | undefined;
  onResize: (columnId: string, width: number) => void;
}

/**
 * The drag handle on a column's trailing edge.
 *
 * Also a real `separator` the arrow keys move: a pointer drag is the obvious gesture but the only one
 * a mouse can make, and a column too narrow to read is exactly the situation a keyboard user is left
 * stuck in. Both paths resize by setting an absolute width measured from the header cell, so the two
 * cannot drift apart.
 */
function ColumnResizer({ columnId, label, width, onResize }: ColumnResizerProps) {
  const handleRef = useRef<HTMLSpanElement>(null);

  /** Where the next gesture starts from: the width already set, or the rendered one until then. */
  function baseWidth(): number | null {
    if (width != null) return width;
    const cell = handleRef.current?.closest("th");
    return cell == null ? null : cell.getBoundingClientRect().width;
  }

  function onPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    const startWidth = baseWidth();
    if (startWidth == null) return;
    event.preventDefault();
    const startX = event.clientX;
    const move = (moved: PointerEvent) => onResize(columnId, startWidth + (moved.clientX - startX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    const step = event.key === "ArrowRight" ? COLUMN_RESIZE_STEP : event.key === "ArrowLeft" ? -COLUMN_RESIZE_STEP : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = baseWidth();
    if (from != null) onResize(columnId, from + step);
  }

  return (
    <span
      ref={handleRef}
      className="reporting-tab__col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

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

/**
 * Where a popover should sit to stay under its anchor, and keeps answering while the page moves.
 *
 * A `position: fixed` popover placed from a rect measured once, at the click, drifts away from the
 * control it belongs to the moment anything scrolls: the rect is in viewport coordinates, the anchor
 * moves, the popover does not. The column filters made that obvious - the popover looked detached from
 * the header row it was opened out of. Re-measuring on scroll and resize keeps the two together.
 *
 * Scroll is listened for in the capture phase because scroll events do not bubble, and what moves the
 * header here is the table's own overflow container rather than the window.
 *
 * @param anchor the element the popover hangs from
 * @returns the anchor's current viewport rect, or null before the first measurement
 */
function useAnchorRect(anchor: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setRect(null);
      return undefined;
    }
    const measure = () => setRect(anchor.getBoundingClientRect());
    measure();
    globalThis.addEventListener("scroll", measure, true);
    globalThis.addEventListener("resize", measure);
    return () => {
      globalThis.removeEventListener("scroll", measure, true);
      globalThis.removeEventListener("resize", measure);
    };
  }, [anchor]);

  return rect;
}

/** Places a popover under its anchor, kept inside the viewport's right edge. */
function popoverPosition(anchorRect: DOMRect | null) {
  return {
    left: Math.max(16, Math.min(anchorRect?.left ?? 16, globalThis.innerWidth - 296)),
    top: (anchorRect?.bottom ?? 0) + 6,
  };
}

interface DateWindowPopoverProps {
  window: DateWindow;
  /** The dataset's own first and last delivery date, stated to the user as the range with data. */
  bounds: { from: string; to: string };
  anchor: HTMLElement | null;
  onApply: (window: DateWindow) => void;
  onClose: () => void;
}

/**
 * The Date column's filter: two native date pickers instead of a checkbox per distinct date.
 *
 * Native `<input type="date">` rather than a hand-built month grid - the same control the Setup tab's
 * add-line form already uses. It brings its own calendar, keyboard handling and locale. What a custom
 * grid would add is per-day shading for days with no data; that is a lot of bespoke UI for a hint, and
 * the range below states the same thing in a line of text.
 *
 * No `min`/`max` on the inputs, though the dataset's bounds are known. Clamping to them read well until
 * the dataset was one day wide, at which point the picker offered exactly that day and refused every
 * keystroke - a control you cannot type into is worse than one that lets you ask for a range with
 * nothing in it. The bounds are stated below the fields instead, and a window outside the data simply
 * matches nothing.
 *
 * Staged locally and committed on Done, so picking a start date does not fire a read before the end
 * date is chosen.
 */
function DateWindowPopover({ window: applied, bounds, anchor, onApply, onClose }: DateWindowPopoverProps) {
  const [draft, setDraft] = useState<DateWindow>(applied);
  const inverted = draft.from !== "" && draft.to !== "" && draft.from > draft.to;

  const { left, top } = popoverPosition(useAnchorRect(anchor));

  return (
    <div className="reporting-tab__filter-pop" role="dialog" aria-label="Filter — Date" style={{ left, top }}>
      <h4 className="reporting-tab__filter-title">Filter — Date</h4>
      <div className="reporting-tab__date-window">
        <label className="reporting-tab__date-field">
          <span>From</span>
          <input
            className="input"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="reporting-tab__date-field">
          <span>To</span>
          <input
            className="input"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        {bounds.from && bounds.to && (
          <p className="reporting-tab__date-hint">
            Data available {fmtDate(bounds.from)} — {fmtDate(bounds.to)}. Leave a side empty for
            open-ended.
          </p>
        )}
        {inverted && <p className="form-error">The start date is after the end date.</p>}
      </div>
      <div className="reporting-tab__filter-footer">
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={() => {
            onApply(NO_DATE_WINDOW);
            onClose();
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={inverted}
          onClick={() => {
            if (inverted) return;
            onApply(draft);
            onClose();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

interface FilterPopoverProps {
  campaignId: number;
  field: ReportRowFilterFieldEnumV1;
  label: string;
  initialSelected: string[];
  anchor: HTMLElement | null;
  onApply: (values: string[]) => void;
  onClose: () => void;
}

/** A dimension column's filter popover: search + select all/clear + a checkbox list of the dimension's
 * distinct values (fetched only while open), staged locally and committed to the applied filter on
 * "Done" - so checking several boxes doesn't refetch the table on every click. */
function FilterPopover({ campaignId, field, label, initialSelected, anchor, onApply, onClose }: FilterPopoverProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const debouncedQuery = useDebounce(query, PICKER_SEARCH_DEBOUNCE_MS);
  const distinctValues = useReportRowDistinctValues(campaignId, field, true);
  const values = useMemo(() => distinctValues.data ?? [], [distinctValues.data]);
  const q = debouncedQuery.toLowerCase();
  const items = values.filter((value) => value.toLowerCase().includes(q));

  function toggle(value: string, on: boolean) {
    setSelected((current) => (on ? [...current, value] : current.filter((v) => v !== value)));
  }

  function done() {
    onApply(selected);
    onClose();
  }

  const { left, top } = popoverPosition(useAnchorRect(anchor));

  return (
    <div className="reporting-tab__filter-pop" role="dialog" aria-label={`Filter — ${label}`} style={{ left, top }}>
      <h4 className="reporting-tab__filter-title">Filter — {label}</h4>
      <div className="reporting-tab__picker-search">
        <SearchIcon />
        <input
          placeholder="Search…"
          aria-label={`Search ${label.toLowerCase()} values`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="reporting-tab__pick-actions">
        <button type="button" onClick={() => setSelected(values)}>Select all</button>
        <button type="button" onClick={() => setSelected([])}>Clear</button>
      </div>
      {distinctValues.isPending && (
        <div className="reporting-tab__filter-loading">
          <LoadingSpinner label="Loading values" size="sm" />
        </div>
      )}
      {distinctValues.isError && <p className="form-error">{formatError(distinctValues.error)}</p>}
      {distinctValues.isSuccess && (
        <div className="reporting-tab__picker-list reporting-tab__filter-list">
          {items.length === 0 && <div className="reporting-tab__pick-empty">No matches for &ldquo;{query}&rdquo;.</div>}
          {items.map((value) => (
            <label key={value} className="reporting-tab__check">
              <input type="checkbox" checked={selected.includes(value)} onChange={(event) => toggle(value, event.target.checked)} />
              {value}
            </label>
          ))}
        </div>
      )}
      <div className="reporting-tab__filter-footer">
        <button type="button" className="button button--primary button--sm" onClick={done}>Done</button>
      </div>
    </div>
  );
}
