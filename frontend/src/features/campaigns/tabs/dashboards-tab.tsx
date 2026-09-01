import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { Link, useLocation, useOutletContext } from "react-router-dom";
import { fmtDate as formatDate } from "../../pacing/mock/format";
import { formatError } from "../../../shared/format/error";
import { cn } from "../../../shared/style/cn";
import { useSidebarCollapse } from "../../layout/app-shell/sidebar-collapse";
import {
  DataTable,
  DataTableViewControls,
  columnDragCellClass,
  columnDropCellClass,
  columnStyle,
} from "../../../shared/ui/data-table/data-table";
import type { DataTableColumn, DataTableColumnReorder } from "../../../shared/ui/data-table/data-table";
import { DataTableFilterBar } from "../../../shared/ui/data-table/data-table-filter-bar";
import type { AppliedFilter, FilterField } from "../../../shared/ui/data-table/data-table-filter-bar-model";
import { insertAtBoundary, withShownColumns, useColumnWidths, useTableExpand } from "../../../shared/ui/data-table/data-table-hooks";
import {
  DataTableDateFilterPopover,
  DataTableFieldPickerPopover,
  DataTableValueFilterPopover,
} from "../../../shared/ui/data-table/data-table-popover";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  MoreVerticalIcon,
  PlusIcon,
  UploadIcon,
} from "../../../shared/ui/icons/icons";
import { LoadingBlock, LoadingOverlay, LoadingSpinner } from "../../../shared/ui/loading-spinner/loading-spinner";
import { Modal } from "../../../shared/ui/modal/modal";
import { useToast } from "../../../shared/ui/toast/toast";
import { exportDashboardDatasetRows } from "../api";
import type { CampaignTabContext } from "../campaign-workspace";
import {
  useDashboardDatasetDistinctValues,
  useDashboardDatasetRows,
  useDashboardPreview,
  useDashboards,
} from "../hooks";
import type { DateWindow } from "../hooks";
import type { DashboardFilterPopover } from "../model/dashboard-filters";
import type { DashboardDatasetFilterV1, DashboardV1 } from "../types";
import "./reporting-tab.css";
import "./dashboards-tab.css";

/** A column of the Basic type's fixed schema, as the ClicData template binds it. */
interface SchemaColumn {
  id: string;
  label: string;
  /** BigQuery output alias read by the preview table; absent for UI-only/calculated columns. */
  field?: string;
  /** How ClicData rolls the column up; dimensions have none. WTD is the Reporting tab's own word for a
   *  ratio re-derived from summed components - a week's CPM is total cost over total impressions, never
   *  the mean of its days. */
  agg?: "SUM" | "WTD";
  /** Whether the user may switch this one off. Everything else is the template's own contract. */
  optional?: boolean;
  format?: "date" | "currency" | "number" | "percent" | "text";
}

/**
 * 17 of the Basic type's dimensions, in the order the written table carries them.
 *
 * Fixed, and not by our choice: the ClicData template reads these columns by name. Creative is the one a
 * user may drop, which collapses the rows across creatives rather than removing the column. This is not a
 * complete mirror of the written table: `Goal` and `Campaign_Short_Name` are written to BigQuery but are
 * deliberately not surfaced here as UI dimensions.
 */
const BASIC_DIMENSIONS: SchemaColumn[] = [
  { id: "date", label: "Date", field: "Date", format: "date" },
  { id: "line_item", label: "Line item", field: "Line_Item_Description" },
  { id: "week", label: "Week (Mon start)", field: "week_start_date_monday", format: "date" },
  { id: "quarter", label: "Quarter", field: "Quarter" },
  { id: "tactic", label: "Tactic", field: "Tactic" },
  { id: "channel", label: "Channel", field: "Channel" },
  { id: "channel_short", label: "Channel (short)", field: "Channel_Short_Name" },
  { id: "level1", label: "Level 1 naming", field: "lvl1" },
  { id: "creative", label: "Creative", field: "Creative", optional: true },
  { id: "audience", label: "Audience", field: "CNB_audience" },
  { id: "geo", label: "Geo", field: "CNB_geo" },
  { id: "language", label: "Language", field: "CNB_language" },
  { id: "message", label: "Message", field: "CNB_message" },
  { id: "creative_tag", label: "Creative tag", field: "CNB_creative_tag" },
  { id: "keyword_group", label: "Keyword group", field: "CNB_keyword_group" },
  { id: "flight", label: "Flight identifier", field: "CNB_flight_identifier" },
  { id: "other", label: "Other", field: "CNB_other" },
];

/** The Basic type's 12 metrics. CPA is the one a user may drop. */
const BASIC_METRICS: SchemaColumn[] = [
  { id: "impressions", label: "Impressions", field: "Impressions", agg: "SUM", format: "number" },
  { id: "clicks", label: "Clicks", field: "Clicks", agg: "SUM", format: "number" },
  { id: "cost", label: "Cost", field: "Cost", agg: "SUM", format: "currency" },
  { id: "completions", label: "Completions", field: "Completions", agg: "SUM", format: "number" },
  { id: "conversions", label: "Conversions", field: "Conversions", agg: "SUM", format: "number" },
  { id: "ivt", label: "IVT", field: "IVT", agg: "SUM", format: "number" },
  { id: "cpc", label: "CPC", field: "CPC", agg: "WTD", format: "currency" },
  { id: "cpm", label: "CPM", field: "CPM", agg: "WTD", format: "currency" },
  { id: "cpv", label: "CPV", field: "CPV", agg: "WTD", format: "currency" },
  { id: "avcr", label: "AVCR", field: "AVCR", agg: "WTD", format: "percent" },
  { id: "ctr", label: "CTR", field: "CTR", agg: "WTD", format: "percent" },
  { id: "cpa", label: "CPA", agg: "WTD", optional: true, format: "currency" },
];

/** Dashboard types the product plans but nothing can write yet (US-016). */
const SOON_TYPES = [
  "Conversions",
  "Geo",
  "Keywords",
  "Business outcomes",
  "Live Sports",
  "Device",
  "Genre",
  "Demographics",
  "Placements",
];

/**
 * Every optional column a new dashboard starts with, derived from the schema above rather than listed again -
 * a second list is a second opinion, and the panels would eventually disagree with the create call.
 */
const ALL_OPTIONAL_COLUMNS = [...BASIC_DIMENSIONS, ...BASIC_METRICS]
  .filter((column) => column.optional)
  .map((column) => column.id);

/** Every column of the fixed schema, dimensions then metrics - the full vocabulary a filter can be put on,
 *  independent of which of them the preview currently shows (PDI_125, mirroring PDI_115). */
const ALL_COLUMNS: SchemaColumn[] = [...BASIC_DIMENSIONS, ...BASIC_METRICS];

/** The columns the Filters bar can actually filter by: those with a BigQuery field behind them (CPA is
 *  calculated from two others and has nothing the server could filter on), minus Date - whose persistent
 *  pill already owns it, the same reason Reporting's field picker excludes its own Date dimension. */
const FILTERABLE_COLUMNS: SchemaColumn[] = ALL_COLUMNS.filter(
  (column) => column.field != null && column.id !== "date"
);

/** `FILTERABLE_COLUMNS`, keyed by id - how a chip's `edit`/a field-picker pick/a value popover all find
 *  their way back to the schema column (and its BigQuery field) they mean. */
const FILTERABLE_COLUMN_BY_ID = new Map(FILTERABLE_COLUMNS.map((column) => [column.id, column] as const));

/** The field picker's vocabulary, offered whether or not the column is one of the preview's currently
 *  displayed ones (PDI_125's whole point, per the `FilterField` JSDoc). */
const FILTER_FIELDS: FilterField[] = FILTERABLE_COLUMNS.map((column) => ({ id: column.id, label: column.label }));

/**
 * Why a cell in the preview can be empty, in the order a reader meets them.
 *
 * Every one of these is the reporting tool's own rule, read off its query rather than guessed - a blank
 * cell here is the tool's answer, not a fault, and the only thing missing was anywhere to learn that. The
 * first two are what PDI_106 turned out to be: CPA needs the campaign's plan to ask for it.
 */
const BLANK_CELL_REASONS = [
  "CPA needs the campaign's plan to be measured on cost per action. With no plan row for the Level 1 " +
    "name, or one that says otherwise, both its cost and its conversions are dropped and the column is empty.",
  "Goal, Campaign (short) and the benchmarks come from the plans and benchmarks table. A Level 1 name " +
    "with no row there leaves all of them empty at once - that is the tell.",
  "A target the reporting spreadsheets disagree on. One campaign is often planned in more than one of " +
    "them, and where their plans contradict each other a figure here would be one report's answer and " +
    "another's mistake, so it is left out. Names and goals still show the most recently planned value.",
  "A metric the channel does not use: no CPC on CTV, DOOH or Live Sports; CPV and AVCR only on audio " +
    "and video channels; no IVT where the channel reports its own.",
  "Nothing to divide by. A rate needs its divisor above zero - no clicks, no CPC; no completions, no CPV.",
  "A dimension the view does not group by. The row covers several of its values, so it stays empty " +
    "rather than showing one of them.",
];

/**
 * How CPA is arrived at, spelled out because it is the column that gets asked about (PDI_106) and because
 * none of it is visible from the column itself: two of the three inputs come from outside the delivery
 * mart, and the division happens downstream in the dashboard rather than here.
 */
const CPA_EXPLAINER =
  "CPA is total cost divided by total conversions, over the rows the campaign's plan asks to be measured "
  + "on cost per action - not the average of each row's own CPA. Cost counts as zero on added-value line "
  + "items. Conversions come from the conversions mart rather than from delivery, and on Google Search and "
  + "YouTube the day's figure sits on the largest row rather than being spread. Where the plan does not ask "
  + "for it, both halves are left empty, so those rows do not enter either total.";

const NEW_DASHBOARD_NAME = "Untitled Basic dashboard";
const DASHBOARD_NAME_MAX_LENGTH = 50;
const COPIED_FEEDBACK_MS = 1600;

function fmtDashboardDate(iso: string | undefined): string {
  if (!iso) {
    return "—";
  }
  return formatDate(iso);
}

function fmtCount(value: number | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

function uniqueDashboardName(baseName: string, dashboards: DashboardV1[]): string {
  const existing = new Set(dashboards.map((dashboard) => dashboard.name.trim().toLowerCase()));
  if (!existing.has(baseName.toLowerCase())) {
    return baseName;
  }
  for (let index = 1; index < 1000; index += 1) {
    const suffix = ` (${index})`;
    const stem = baseName.slice(0, DASHBOARD_NAME_MAX_LENGTH - suffix.length).trimEnd();
    const candidate = `${stem}${suffix}`;
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${baseName.slice(0, DASHBOARD_NAME_MAX_LENGTH - 7).trimEnd()} (${Date.now() % 1000})`;
}

function dashboardDateWindow(dashboard: DashboardV1): DateWindow {
  return { from: dashboard.dateFrom ?? "", to: dashboard.dateTo ?? "" };
}

/** Replaces characters that are unsafe in a downloaded filename with a hyphen - same rule Reporting's own
 *  download uses, kept local because the two tabs do not share a module to declare it in once. */
function fileSafe(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}

/** The table's own name, without the project and dataset in front of it. */
function shortTable(table: string): string {
  const parts = table.split(".");
  return parts[parts.length - 1];
}

/** The ready-to-run query ClicData is pointed at. Backticks are mandatory, not a style choice: the project
 *  id carries hyphens (e.g. `silken-quasar-376417`), so an unquoted or single-quoted identifier is a
 *  BigQuery syntax error. */
function clicDataQuery(sourceTable: string): string {
  return `SELECT * FROM \`${sourceTable}\``;
}

/**
 * The Dashboards tab: a campaign's ClicData datasets (US-017, US-019, US-020, US-021).
 *
 * A dashboard here is not the pacing dashboard — it is a fixed-schema BigQuery table that one ClicData
 * dashboard reads. That is why the dimension and metric panels are locked: the template binds to those
 * column names, so the only genuine choices are the two optional columns and whether the table exists yet.
 */
export function DashboardsTab() {
  const { campaign } = useOutletContext<CampaignTabContext>();
  const location = useLocation();
  const toast = useToast();
  const dash = useDashboards(campaign);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createMenuAt, setCreateMenuAt] = useState<"head" | "empty" | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<DashboardV1 | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DashboardV1 | null>(null);
  // Tracks the dashboard id alongside which copy action fired, so two copy buttons on the same source
  // menu never both light up "Copied!" for a click on just one of them.
  const [copiedAction, setCopiedAction] = useState<{ id: number; action: "table" | "query" } | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<number | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Expansion is owned here rather than by the table, because what it hides is this page's chrome - the
  // dashboards list, the schema panels, the write action - and the rules that hide it are descendant
  // selectors from this root. The anchor is the line directly above the table, so collapsing brings the
  // table back under the eye instead of leaving the window wherever the old scroll offset now points.
  const sidebar = useSidebarCollapse();
  const expandAnchorRef = useRef<HTMLDivElement>(null);
  const { expanded, toggleExpanded } = useTableExpand({ space: sidebar, anchorRef: expandAnchorRef });

  const dashboards = dash.dashboards;
  const selected = useMemo(
    () => dashboards.find((item) => item.id === selectedId) ?? dashboards[0],
    [dashboards, selectedId]
  );

  useEffect(() => {
    if (copiedAction == null) {
      return undefined;
    }
    const timer = window.setTimeout(() => setCopiedAction(null), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copiedAction]);

  useEffect(() => {
    if (!createMenuAt && openMenuFor == null) {
      return undefined;
    }
    function closeMenus(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target?.closest(".dashboards-tab__menu-wrap, .dashboards-tab__actions, .dashboards-tab__menu")) {
        setCreateMenuAt(null);
        setOpenMenuFor(null);
        setMenuAnchor(null);
      }
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, [createMenuAt, openMenuFor]);

  if (dash.isPending) {
    return <LoadingBlock label="Loading dashboards" />;
  }
  if (dash.isError) {
    return <p className="form-error">{formatError(dash.error)}</p>;
  }

  async function create() {
    setCreateMenuAt(null);
    try {
      const created = await dash.createDashboard(
        uniqueDashboardName(NEW_DASHBOARD_NAME, dashboards),
        ALL_OPTIONAL_COLUMNS
      );
      setSelectedId(created.id);
      toast.showSuccess("Dashboard created — review the dataset, then create the ClicData source.");
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  /**
   * Writes one dashboard's editable fields, filling whatever the caller did not name from what is already
   * saved - so an immediate save of a filter cannot silently revert a column choice, and vice versa.
   *
   * @param dashboard the dashboard to write
   * @param changes   only the fields this call means to change
   * @param notify    whether to confirm with a toast; false for the saves that follow a gesture rather
   *                  than a button, where a toast per drag would be noise
   */
  async function saveDashboard(
    dashboard: DashboardV1,
    changes: {
      kept?: string[];
      columnOrder?: string[];
      filters?: DashboardDatasetFilterV1[];
      dateWindow?: DateWindow;
    },
    notify: boolean
  ) {
    try {
      await dash.updateDashboard(
        dashboard.id,
        dashboard.name,
        changes.kept ?? dashboard.optionalColumns,
        changes.columnOrder ?? dashboard.columnOrder ?? [],
        changes.filters ?? dashboard.filters ?? [],
        changes.dateWindow ?? dashboardDateWindow(dashboard),
        dashboard.displayCampaignName
      );
      if (notify) {
        toast.showSuccess("Dataset updated.");
      }
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  async function rename(dashboard: DashboardV1, name: string) {
    if (!name.trim() || name.trim() === dashboard.name) {
      return;
    }
    try {
      await dash.updateDashboard(
        dashboard.id,
        name.trim(),
        dashboard.optionalColumns,
        dashboard.columnOrder ?? [],
        dashboard.filters,
        dashboardDateWindow(dashboard),
        dashboard.displayCampaignName
      );
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  async function commitRename(dashboard: DashboardV1) {
    try {
      await rename(dashboard, renameValue);
      setRenamingId(null);
      setRenameValue("");
    } catch {
      // rename() already surfaces the error through the toast.
    }
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  async function duplicate(dashboard: DashboardV1) {
    setOpenMenuFor(null);
    setMenuAnchor(null);
    try {
      const copy = await dash.duplicateDashboard(dashboard.id);
      setSelectedId(copy.id);
      toast.showSuccess("Dashboard duplicated.");
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  function toggleDashboardMenu(event: ReactMouseEvent<HTMLButtonElement>, dashboardId: number) {
    event.stopPropagation();
    if (openMenuFor === dashboardId) {
      setOpenMenuFor(null);
      setMenuAnchor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenMenuFor(dashboardId);
    setMenuAnchor({ top: rect.bottom + 6, left: Math.max(16, rect.right - 190) });
  }

  async function removeSource(dashboard: DashboardV1) {
    setConfirmRemove(null);
    try {
      await dash.removeDataSource(dashboard.id);
      toast.showSuccess("Data source removed.");
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  async function remove(dashboard: DashboardV1) {
    setConfirmDelete(null);
    try {
      await dash.deleteDashboard(dashboard.id);
      if (selectedId === dashboard.id) {
        setSelectedId(null);
      }
      toast.showSuccess("Dashboard deleted.");
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  async function copyTable(dashboard: DashboardV1) {
    setOpenMenuFor(null);
    if (!dashboard.sourceTable) {
      return;
    }
    try {
      await navigator.clipboard.writeText(dashboard.sourceTable);
      setCopiedAction({ id: dashboard.id, action: "table" });
    } catch {
      // Clipboard access can be refused (an insecure context, or a denied permission). Saying so beats a
      // "Copied!" that did not happen - the user would paste the previous clipboard into ClicData.
      toast.showError("Could not copy the table name. Select it and copy manually.");
    }
  }

  async function copyQuery(dashboard: DashboardV1) {
    setOpenMenuFor(null);
    if (!dashboard.sourceTable) {
      return;
    }
    try {
      await navigator.clipboard.writeText(clicDataQuery(dashboard.sourceTable));
      setCopiedAction({ id: dashboard.id, action: "query" });
    } catch {
      // Same reasoning as copyTable: a silent "Copied!" would leave the user pasting a stale clipboard
      // into ClicData instead of the query they just tried to copy.
      toast.showError("Could not copy the query. Select it and copy manually.");
    }
  }

  return (
    <div className={cn("dashboards-tab", expanded && "dashboards-tab--expanded")}>
      <div className="dashboards-tab__head">
        <div>
          <h2 className="dashboards-tab__title">Dashboards</h2>
          <div className="dashboards-tab__sub">
            {dashboards.length} dashboard{dashboards.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="dashboards-tab__head-actions">
          <Link
            to={`/campaigns/${campaign.id}/reporting`}
            // Carried forward for the same reason the tab bar carries it: the hero above reads the campaign
            // from the location's state, and a plain link would drop it.
            state={location.state}
            className="button button--ghost button--sm"
          >
            Reporting →
          </Link>
          <div className="dashboards-tab__menu-wrap">
            <button
              type="button"
              className="button button--primary button--sm dashboards-tab__dropdown-btn"
              onClick={() => setCreateMenuAt((open) => (open === "head" ? null : "head"))}
            >
              <PlusIcon />
              Create dashboard source
            </button>
            {createMenuAt === "head" && <TypeMenu onPick={create} />}
          </div>
        </div>
      </div>

      {dashboards.length === 0 ? (
        <div className="dashboards-tab__empty">
          <div className="dashboards-tab__empty-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
          </div>
          <h3>Create your first dashboard</h3>
          <p>Pick a dashboard type — its columns are fixed by the ClicData template.</p>
          <div className="dashboards-tab__menu-wrap">
            <button
              type="button"
              className="button button--primary dashboards-tab__dropdown-btn"
              onClick={() => setCreateMenuAt((open) => (open === "empty" ? null : "empty"))}
            >
              Create dashboard source
            </button>
            {createMenuAt === "empty" && <TypeMenu onPick={create} />}
          </div>
        </div>
      ) : (
        // Reporting's own table chrome, not a copy of it: the two lists are the same six columns of the
        // same kind of saved thing, and the second set of classes had drifted into a box that does not
        // scroll, a header that does not stick and denser rows. The block class stays as the hook the
        // expanded-mode rules hide the list by.
        <div className="dashboards-tab__tbl-wrap reporting-tab__tbl-wrap">
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
              {dashboards.map((item) => (
                <tr
                  key={item.id}
                  className={cn(
                    "reporting-tab__row",
                    selected?.id === item.id && "reporting-tab__row--selected"
                  )}
                  onClick={() => setSelectedId(item.id)}
                >
                  <td>
                    {renamingId === item.id ? (
                      <div
                        className="reporting-tab__rename-form"
                        role="group"
                        aria-label={`Rename ${item.name}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          autoFocus
                          className="input reporting-tab__rename-input"
                          aria-label="Rename dashboard name"
                          value={renameValue}
                          maxLength={50}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename(item);
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
                            onClick={() => commitRename(item)}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="reporting-tab__view-link" title={item.name}>{item.name}</span>
                        {item.sourceTable && (
                          <code className="reporting-tab__row-note" title={item.sourceTable}>
                            {shortTable(item.sourceTable)}
                          </code>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <span className="reporting-tab__type-badge">Basic</span>
                  </td>
                  <td>
                    <span className="reporting-tab__status">
                      <span
                        className={cn(
                          "reporting-tab__led",
                          item.status === "live" && "dashboards-tab__led--live"
                        )}
                      />
                      {item.status === "live" ? "Live" : "Draft"}
                    </span>
                  </td>
                  <td className="reporting-tab__flight">{fmtDashboardDate(item.created)}</td>
                  <td className="reporting-tab__flight">{fmtDashboardDate(item.edited ?? undefined)}</td>
                  <td className="dashboards-tab__actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="reporting-tab__kebab"
                      aria-label={`Actions for ${item.name}`}
                      aria-expanded={openMenuFor === item.id}
                      onClick={(event) => toggleDashboardMenu(event, item.id)}
                    >
                      <MoreVerticalIcon />
                    </button>
                    {openMenuFor === item.id && (
                      <div
                        className="reporting-tab__menu reporting-tab__menu--fixed"
                        role="menu"
                        style={menuAnchor ?? undefined}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuFor(null);
                            setMenuAnchor(null);
                            setRenamingId(item.id);
                            setRenameValue(item.name);
                          }}
                        >
                          Rename
                        </button>
                        <button type="button" role="menuitem" onClick={() => duplicate(item)}>
                          Duplicate
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="reporting-tab__menu-danger"
                          onClick={() => {
                            setOpenMenuFor(null);
                            setMenuAnchor(null);
                            setConfirmDelete(item);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dash.hasNextPage && (
        <button
          type="button"
          className="button button--secondary button--sm"
          disabled={dash.isFetchingNextPage}
          onClick={() => dash.fetchNextPage()}
        >
          {dash.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}

      {selected && (
        <DashboardDetail
          campaignId={campaign.id}
          campaignName={campaign.name}
          dashboard={selected}
          copiedTable={copiedAction?.id === selected.id && copiedAction.action === "table"}
          copiedQuery={copiedAction?.id === selected.id && copiedAction.action === "query"}
          onRename={(name) => rename(selected, name)}
          onApplyDashboard={(kept) => saveDashboard(selected, { kept }, true)}
          onSaveFilters={(filters, dateWindow) => saveDashboard(selected, { filters, dateWindow }, false)}
          onSaveColumnOrder={(columnOrder) => saveDashboard(selected, { columnOrder }, false)}
          onCopyTable={() => copyTable(selected)}
          onCopyQuery={() => copyQuery(selected)}
          onCreateSource={() => setPublishOpen(true)}
          onRemoveSource={() => setConfirmRemove(selected)}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          expandAnchorRef={expandAnchorRef}
        />
      )}

      {selected && (
        <PublishDialog
          open={publishOpen}
          campaignName={campaign.name}
          dashboard={selected}
          campaignId={campaign.id}
          busy={dash.isCreatingDataSource}
          onClose={() => setPublishOpen(false)}
          onConfirm={async (displayCampaignName) => {
            try {
              await dash.createDataSource(selected.id, displayCampaignName);
              setPublishOpen(false);
              toast.showSuccess(
                selected.sourceTable ? "ClicData data source updated." : "ClicData data source created."
              );
            } catch (error) {
              toast.showError(formatError(error));
            }
          }}
        />
      )}

      <Modal
        open={confirmRemove != null}
        onClose={() => setConfirmRemove(null)}
        title="Remove the ClicData data source?"
        subtitle={`The ClicData dashboard reading “${confirmRemove?.name ?? ""}” will stop updating. The BigQuery table itself is left in place.`}
        className="dashboards-tab__confirm"
      >
        <div className="dashboards-tab__confirm-actions">
          <button type="button" className="button button--secondary" onClick={() => setConfirmRemove(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => confirmRemove && removeSource(confirmRemove)}
          >
            Remove data source
          </button>
        </div>
      </Modal>

      <Modal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this dashboard?"
        subtitle={
          confirmDelete?.sourceTable
            ? `“${confirmDelete.name}” has a data source, and the ClicData dashboard reading it will stop updating.`
            : `“${confirmDelete?.name ?? ""}” has no data source yet, so nothing outside the Hub is affected.`
        }
        className="dashboards-tab__confirm"
      >
        <div className="dashboards-tab__confirm-actions">
          <button type="button" className="button button--secondary" onClick={() => setConfirmDelete(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => confirmDelete && remove(confirmDelete)}
          >
            Delete dashboard
          </button>
        </div>
      </Modal>
    </div>
  );
}

interface TypeMenuProps {
  onPick: () => void;
}

/**
 * The dashboard types, as the reference offers them: one that can be created and the rest marked as coming.
 *
 * A menu rather than a dialog because the choice is the whole of the interaction - the type is the schema, so
 * there is nothing else to fill in before a dashboard exists.
 */
function TypeMenu({ onPick }: TypeMenuProps) {
  return (
    <div className="dashboards-tab__menu dashboards-tab__menu--types" role="menu">
      <button type="button" role="menuitem" className="dashboards-tab__menu-item" onClick={onPick}>
        Basic
      </button>
      {SOON_TYPES.map((label) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          className="dashboards-tab__menu-item dashboards-tab__menu-item--disabled"
          disabled
        >
          {label}
          <span className="dashboards-tab__soon">Coming soon</span>
        </button>
      ))}
    </div>
  );
}

interface DashboardDetailProps {
  campaignId: number;
  /** The owning campaign's own name, used only to build the dataset download's filename. */
  campaignName: string;
  dashboard: DashboardV1;
  copiedTable: boolean;
  copiedQuery: boolean;
  onRename: (name: string) => void;
  /** Saves the on-screen column selection. Awaited, because the write reads what was saved, not what is
   *  shown. Filters and column order do not go through here - they save on the gesture itself. */
  onApplyDashboard: (kept: string[]) => Promise<void>;
  /** Saves a filter or date-window change at once, with no Apply in between: a filter is a question about
   *  the dataset, and the answer should still be there after a reload. */
  onSaveFilters: (filters: DashboardDatasetFilterV1[], dateWindow: DateWindow) => Promise<void>;
  /** Saves the arrangement of the preview's columns at once, for the same reason. */
  onSaveColumnOrder: (columnOrder: string[]) => Promise<void>;
  onCopyTable: () => void;
  onCopyQuery: () => void;
  onCreateSource: () => void;
  onRemoveSource: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Attached to the line above the table, so collapsing scrolls it back into view. */
  expandAnchorRef: RefObject<HTMLDivElement>;
}

/** The selected dashboard's fixed schema, its live row count, and its data-source actions. */
function DashboardDetail({
  campaignId,
  campaignName,
  dashboard,
  copiedTable,
  copiedQuery,
  onRename,
  onApplyDashboard,
  onSaveFilters,
  onSaveColumnOrder,
  onCopyTable,
  onCopyQuery,
  onCreateSource,
  onRemoveSource,
  expanded,
  onToggleExpanded,
  expandAnchorRef,
}: DashboardDetailProps) {
  const [name, setName] = useState(dashboard.name);
  const [draftColumns, setDraftColumns] = useState(dashboard.optionalColumns);
  const [draftFilters, setDraftFilters] = useState<DashboardDatasetFilterV1[]>(dashboard.filters);
  const [draftDateWindow, setDraftDateWindow] = useState<DateWindow>(dashboardDateWindow(dashboard));
  const preview = useDashboardPreview(
    campaignId,
    dashboard.id,
    dashboard.optionalColumns,
    dashboard.filters,
    dashboardDateWindow(dashboard)
  );
  useEffect(() => setName(dashboard.name), [dashboard.id, dashboard.name]);
  useEffect(() => setDraftColumns(dashboard.optionalColumns), [dashboard.id, dashboard.optionalColumns]);
  useEffect(() => setDraftFilters(dashboard.filters), [dashboard.id, dashboard.filters]);
  useEffect(() => setDraftDateWindow(dashboardDateWindow(dashboard)), [dashboard.id, dashboard.dateFrom, dashboard.dateTo]);

  // The counts follow the checkbox at once; the dataset waits for Apply, so the row count on screen keeps
  // describing the dataset that exists rather than the one being considered.
  const keptDimensions = BASIC_DIMENSIONS.filter(
    (column) => !column.optional || draftColumns.includes(column.id)
  );
  const keptMetrics = BASIC_METRICS.filter((column) => !column.optional || draftColumns.includes(column.id));
  const savedDimensions = BASIC_DIMENSIONS.filter(
    (column) => !column.optional || dashboard.optionalColumns.includes(column.id)
  ).length;
  const savedMetrics = BASIC_METRICS.filter(
    (column) => !column.optional || dashboard.optionalColumns.includes(column.id)
  ).length;
  const savedPreviewColumns = [
    ...BASIC_DIMENSIONS.filter((column) => !column.optional || dashboard.optionalColumns.includes(column.id)),
    ...BASIC_METRICS.filter((column) => !column.optional || dashboard.optionalColumns.includes(column.id)),
  ];
  // The column selection alone. Filters and the date window are saved the moment they change, so they can
  // never be "unapplied"; only which columns the written table carries still waits for a decision, because
  // that is what the data source's schema is.
  const unapplied =
    draftColumns.length !== dashboard.optionalColumns.length
    || draftColumns.some((id) => !dashboard.optionalColumns.includes(id));

  function toggle(id: string) {
    setDraftColumns((current) =>
      current.includes(id) ? current.filter((column) => column !== id) : [...current, id]
    );
  }

  /**
   * Writes the data source, applying the column selection first if it is still staged.
   *
   * The write reads the *saved* dashboard, so a selection left on screen would be written out of. Applying
   * it here rather than refusing keeps the button honest about what it does: it writes what you are looking
   * at.
   */
  async function writeSource() {
    if (unapplied) {
      await onApplyDashboard(draftColumns);
    }
    onCreateSource();
  }

  return (
    <div className="dashboards-tab__detail">
      <div className="dashboards-tab__detail-head">
        <input
          className="dashboards-tab__name-input"
          aria-label="Dashboard name"
          value={name}
          readOnly={dashboard.sourceTable != null}
          title={
            dashboard.sourceTable != null
              ? "The name is part of this dashboard's BigQuery table. Remove the data source to rename it."
              : undefined
          }
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onRename(name)}
        />
        <span className="reporting-tab__type-badge">Basic</span>
        {dashboard.status === "live" ? (
          <span className="dashboards-tab__chip dashboards-tab__chip--live">Live in BigQuery</span>
        ) : (
          <span className="dashboards-tab__chip">Draft</span>
        )}
      </div>

      <div className="dashboards-tab__panels">
        <SchemaPanel
          title="Dimensions"
          columns={BASIC_DIMENSIONS}
          kept={keptDimensions.length}
          optionalKept={draftColumns}
          onToggle={toggle}
        />
        <SchemaPanel
          title="Metrics"
          columns={BASIC_METRICS}
          kept={keptMetrics.length}
          optionalKept={draftColumns}
          onToggle={toggle}
        />
      </div>

      <div className="dashboards-tab__apply">
        <button
          type="button"
          className="button button--primary"
          disabled={!unapplied}
          onClick={() => onApplyDashboard(draftColumns)}
        >
          Apply
        </button>
      </div>

      <DashboardDatasetTable
        campaignId={campaignId}
        campaignName={campaignName}
        dashboard={dashboard}
        columns={savedPreviewColumns}
        filters={draftFilters}
        dateWindow={draftDateWindow}
        onFiltersChange={(filters) => {
          setDraftFilters(filters);
          void onSaveFilters(filters, draftDateWindow);
        }}
        onDateWindowChange={(dateWindow) => {
          setDraftDateWindow(dateWindow);
          void onSaveFilters(draftFilters, dateWindow);
        }}
        onSaveColumnOrder={onSaveColumnOrder}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        expandAnchorRef={expandAnchorRef}
        datasetHint={
          <DatasetHint
            rowCount={
              preview.isPending
                ? "counting rows…"
                : preview.isError
                  ? formatError(preview.error)
                  : `${fmtCount(preview.data?.rowCount)} rows`
            }
            dimensions={savedDimensions}
            metrics={savedMetrics}
          />
        }
        sourceActions={
          /* One control, whichever state the dashboard is in: a prominent button while there is no source
             to speak of, and the pill with everything about the existing one - including rewriting it -
             once there is. A source that exists never grows a second button beside its own menu, not even
             when a saved change has left the written table behind. */
          dashboard.sourceTable ? (
            <SourceMenu
              dashboard={dashboard}
              copiedTable={copiedTable}
              copiedQuery={copiedQuery}
              onCopyTable={onCopyTable}
              onCopyQuery={onCopyQuery}
              onWriteSource={writeSource}
              onRemoveSource={onRemoveSource}
            />
          ) : (
            <button type="button" className="button button--primary" onClick={writeSource}>
              <UploadIcon />
              Create data source for ClicData
            </button>
          )
        }
      />
    </div>
  );
}

interface DashboardDatasetTableProps {
  campaignId: number;
  /** The owning campaign's own name, used only to build the dataset download's filename. */
  campaignName: string;
  dashboard: DashboardV1;
  columns: SchemaColumn[];
  filters: DashboardDatasetFilterV1[];
  dateWindow: DateWindow;
  onFiltersChange: (filters: DashboardDatasetFilterV1[]) => void;
  onDateWindowChange: (dateWindow: DateWindow) => void;
  onSaveColumnOrder: (columnOrder: string[]) => Promise<void>;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Attached to the controls row, so collapsing scrolls the table back into view. */
  expandAnchorRef?: RefObject<HTMLDivElement>;
  /** The "?" describing what the preview is, shown beside the view controls. */
  datasetHint?: ReactNode;
  /** The data-source control, shown beside the view controls - the row directly above the table it acts on. */
  sourceActions?: ReactNode;
}

function filterValues(filters: DashboardDatasetFilterV1[], field: string): string[] {
  return filters.find((filter) => filter.field === field)?.values ?? [];
}

/** A filter's applied values, in as few words as it takes - the chip strip's own threshold, kept as it
 *  was rather than adopted from Reporting's (which joins up to two values): a dataset column can carry
 *  many more distinct values than a report dimension, so naming even two of them read as arbitrary. */
function filterSummary(values: readonly string[]): string {
  return values.length === 1 ? values[0] : `${values.length} values`;
}

function applyFilter(filters: DashboardDatasetFilterV1[], field: string, values: string[]) {
  const next = filters.filter((filter) => filter.field !== field);
  return values.length === 0 ? next : [...next, { field, values }];
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Whether a column's values are figures, and so read right-aligned in tabular numerals. */
function numericFormat(column: SchemaColumn): boolean {
  return column.format === "currency" || column.format === "number" || column.format === "percent";
}

/** The date window as a chip reads it: an open side says "before"/"from" rather than showing a blank. */
function datasetDateSummary(window: DateWindow): string {
  if (window.from !== "" && window.to !== "") {
    return `${formatDate(window.from)} — ${formatDate(window.to)}`;
  }
  if (window.from !== "") {
    return `from ${formatDate(window.from)}`;
  }
  return `until ${formatDate(window.to)}`;
}

function valueFor(column: SchemaColumn, values: Record<string, unknown>): unknown {
  if (column.id !== "cpa") {
    return column.field ? values[column.field] : undefined;
  }
  const cost = numberValue(values.CPA_Cost);
  const conversions = numberValue(values.CPA_Conversions);
  return cost != null && conversions != null && conversions > 0 ? cost / conversions : null;
}

function formatDatasetValue(column: SchemaColumn, values: Record<string, unknown>): string {
  const value = valueFor(column, values);
  if (value == null || value === "") {
    return "—";
  }
  if (column.format === "date") {
    return formatDate(String(value));
  }
  const numeric = numberValue(value);
  if (numeric != null) {
    if (column.format === "currency") {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(numeric);
    }
    if (column.format === "percent") {
      const percent = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(percent)}%`;
    }
    if (column.format === "number") {
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
    }
  }
  return String(value);
}

/**
 * The read-only preview of the dashboard's BigQuery dataset, including server-side filters. It deliberately
 * mirrors Reporting's table affordances instead of becoming a second source of ad-data editing.
 */
function DashboardDatasetTable({
  campaignId,
  campaignName,
  dashboard,
  columns,
  filters,
  dateWindow,
  onFiltersChange,
  onDateWindowChange,
  onSaveColumnOrder,
  expanded,
  onToggleExpanded,
  expandAnchorRef,
  datasetHint,
  sourceActions,
}: DashboardDatasetTableProps) {
  // Which of the Filters bar's popovers is open - the field picker, a column's value popover, or the
  // Date pill's own window popover - and where it hangs from (PDI_125, mirroring PDI_115's Reporting
  // model). Replaces the funnel-era per-column `openFilter` state, which paired one column with one
  // anchor and had no notion of a field-picker stage at all.
  const [filterPopover, setFilterPopover] = useState<DashboardFilterPopover | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const { columnWidths, resizeColumn } = useColumnWidths();
  // Shown from local state and written through on every change: the drag has to land instantly, and it has
  // to still be there after a reload. It is deliberately not part of `unapplied` - rearranging the preview
  // is a way of reading the dataset, not a change to what it contains.
  const [columnOrder, setColumnOrder] = useState<string[]>(dashboard.columnOrder ?? []);
  useEffect(() => setColumnOrder(dashboard.columnOrder ?? []), [dashboard.id, dashboard.columnOrder]);

  /**
   * Applies a rearrangement locally and saves it, from whichever gesture produced it.
   *
   * The move is computed here rather than inside a state updater: the save is a side effect, and React may
   * call an updater more than once. The order is seeded from the columns on screen on the first move, so
   * what gets saved is a whole arrangement rather than one pair of ids the rest has to be guessed around.
   *
   * @param move returns the rearranged ids, or the array it was given to mean "no move"
   */
  const reorder = useCallback((move: (seeded: string[]) => string[]) => {
    // Reconciled against what is on screen, not just seeded from it: an optional column switched back on
    // after an arrangement was saved is absent from that order, and a move that looks it up there finds
    // nothing and does nothing - a column the user can pick up and cannot move.
    const seeded = withShownColumns(columnOrder, columns.map((column) => column.id));
    const moved = move(seeded);
    // Identity, so a refused move neither writes state nor spends a save. It has to be compared against
    // the array `move` was handed, which is why `seeded` is passed straight in rather than copied.
    if (moved === seeded) {
      return;
    }
    setColumnOrder(moved);
    void onSaveColumnOrder(moved);
  }, [columnOrder, columns, onSaveColumnOrder]);
  const rows = useDashboardDatasetRows(campaignId, dashboard.id, dashboard.optionalColumns, filters, dateWindow);

  // No dimension/metric split here - the schema is a fixed template list, not two groups with a boundary
  // to keep - so a column may already land anywhere among the others; that has not changed.
  const moveColumn = useCallback((fromId: string, toId: string, side: "before" | "after") => {
    if (fromId === toId) return;
    reorder((next) => {
      const without = next.filter((id) => id !== fromId);
      const targetIndex = without.indexOf(toId);
      if (targetIndex === -1) return next;
      const boundary = side === "before" ? targetIndex : targetIndex + 1;
      return insertAtBoundary(next, fromId, boundary);
    });
  }, [reorder]);

  const nudgeColumn = useCallback((columnId: string, offset: -1 | 1) => {
    const shownIds = columns.map((column) => column.id);
    reorder((next) => {
      // The neighbour is the next column the user can see, not the next id in the saved order: that order
      // also carries columns switched off since it was saved, and swapping with one of those would move
      // nothing on screen while still spending a save. One slot left means one visible slot left.
      const visible = next.filter((id) => shownIds.includes(id));
      const fromVisible = visible.indexOf(columnId);
      const toVisible = fromVisible + offset;
      if (fromVisible === -1 || toVisible < 0 || toVisible >= visible.length) return next;
      const without = next.filter((id) => id !== columnId);
      const targetIndex = without.indexOf(visible[toVisible]);
      if (targetIndex === -1) return next;
      const boundary = offset === -1 ? targetIndex : targetIndex + 1;
      return insertAtBoundary(next, columnId, boundary);
    });
  }, [reorder, columns]);

  const columnReorder: DataTableColumnReorder = { onReorder: moveColumn, onNudge: nudgeColumn };

  // The template's order until the user drags one, then theirs. A column the saved order does not mention
  // - the optional pair, switched back on after a drag - falls in behind the ones it does.
  const orderedColumns = useMemo(() => {
    if (columnOrder.length === 0) return columns;
    const at = (id: string) => {
      const index = columnOrder.indexOf(id);
      return index === -1 ? columnOrder.length : index;
    };
    return [...columns].sort((left, right) => at(left.id) - at(right.id));
  }, [columns, columnOrder]);

  // No `filterable`/`filtered` on the column objects (PDI_125, mirroring PDI_115): filters and the date
  // window are reachable from the Filters bar now, not from a column header's funnel, and the bar draws
  // its own state from `filterChips` below rather than lighting up a header button.
  const tableColumns = useMemo<DataTableColumn[]>(
    () =>
      orderedColumns.map((column) => ({
        id: column.id,
        label: column.label,
        // How ClicData will roll this column up, said in the header the same way the Reporting tab says it -
        // a dashboard's reader needs to know a rate is averaged and not summed before they read a week of it.
        agg: column.agg,
        className: numericFormat(column) ? "reporting-tab__num" : undefined,
      })),
    [orderedColumns]
  );

  // Every value filter currently in force, listed on the Filters bar rather than only inside the column
  // header it used to open from (PDI_125) - so what the preview has been narrowed to is legible without
  // opening a popover to find out, and clearable without opening one either. Built from the full schema
  // (`FILTERABLE_COLUMNS`), not just `columns` (the preview's currently displayed ones): a filter on an
  // optional column switched off since is exactly what `hiddenColumn` exists to keep visible. Date is not
  // among these - the bar's own persistent pill owns it, so it is never pruned here on a column change.
  const filterChips = useMemo<AppliedFilter[]>(
    () =>
      FILTERABLE_COLUMNS.filter((column) => filterValues(filters, column.field as string).length > 0).map(
        (column) => ({
          id: column.id,
          label: column.label,
          summary: filterSummary(filterValues(filters, column.field as string)),
          // Dashed and explained on the bar rather than pruned away: a filter surviving its column
          // leaving the preview's displayed set is exactly what PDI_125 asks for.
          hiddenColumn: !columns.some((displayed) => displayed.id === column.id),
          edit: (anchor: HTMLElement) => openValueFilter(column.id, anchor),
          clear: () => onFiltersChange(applyFilter(filters, column.field as string, [])),
        })
      ),
    [filters, columns, onFiltersChange]
  );

  useEffect(() => {
    setFilterPopover(null);
  }, [dashboard.id, dashboard.optionalColumns.join(",")]);

  useEffect(() => {
    if (!filterPopover) {
      return undefined;
    }
    function close(event: MouseEvent) {
      const target = event.target as Element | null;
      // The Filters bar is this table's own, the popover it opens is too - but missing either here does
      // not just fail to close - it closes on the same mousedown that opened it, so the button's own
      // click reopens and the popover can never be dismissed by the control that opened it.
      if (!target?.closest(".data-table__filter-bar") && !target?.closest(".data-table__pop")) {
        setFilterPopover(null);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [filterPopover]);

  function updateFilter(field: string, values: string[]) {
    onFiltersChange(applyFilter(filters, field, values));
  }

  function updateDateWindow(window: DateWindow) {
    onDateWindowChange(window);
  }

  /** Opens a column's value popover, staged with its current selection - the field picker's own handoff
   *  after a column is picked, and a chip's label click, both funnel through here. */
  function openValueFilter(columnId: string, anchor: HTMLElement) {
    setFilterAnchor(anchor);
    setFilterPopover({ stage: "values", columnId });
  }

  /** Opens the `+ Filter` field picker (stage 1), toggling it closed on a second click of the same
   *  button - the same toggle the funnel-era filter button offered. */
  function openFieldPicker(anchor: HTMLElement) {
    setFilterAnchor(anchor);
    setFilterPopover((current) => (current?.stage === "fields" ? null : { stage: "fields" }));
  }

  /** Opens the persistent Date pill's own window popover, toggling closed on a second click. */
  function openDateFilter(anchor: HTMLElement) {
    setFilterAnchor(anchor);
    setFilterPopover((current) => (current?.stage === "date" ? null : { stage: "date" }));
  }

  /** Drops every value filter at once. The date window is not one of them and survives, same as
   *  Reporting's own Clear all - pinning that distinction is the point of the dedicated test for it.
   *  Goes through `onFiltersChange`, so it auto-saves exactly like every other gesture on this bar. */
  function clearAllFilters() {
    onFiltersChange([]);
  }

  const selectedFilterColumn =
    filterPopover?.stage === "values" ? FILTERABLE_COLUMN_BY_ID.get(filterPopover.columnId) : undefined;

  const content = rows.data?.pages.flatMap((datasetPage) => datasetPage.content) ?? [];
  const totalRows = rows.data?.pages[0]?.totalElements ?? 0;

  return (
    <div className="dashboards-tab__dataset">
      {/* The same row the Reporting tab uses: how the table is shown on the left, what acts on it on the
          right, directly above the table itself. */}
      <div className="reporting-tab__actions-row" ref={expandAnchorRef}>
        <DataTableViewControls
          totalRows={totalRows}
          loadedRows={content.length}
          isPending={rows.isPending}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
        />
        {datasetHint}
        <DatasetDownloadMenu
          campaignId={campaignId}
          campaignName={campaignName}
          dashboard={dashboard}
          filters={filters}
          dateWindow={dateWindow}
        />
        {sourceActions}
      </div>
      <DataTableFilterBar
        dateLabel={dateWindow.from === "" && dateWindow.to === "" ? "All dates" : datasetDateSummary(dateWindow)}
        onOpenDate={openDateFilter}
        filters={filterChips}
        onOpenFieldPicker={openFieldPicker}
        onClearAll={clearAllFilters}
      />
      <DataTable
        columns={tableColumns}
        rows={content}
        getRowKey={(_row, index) => `row-${index}`}
        renderCells={(row, _index, draggedColumnIndex, dropBoundaryIndex) => (
          <>
            {tableColumns.map((column, index) => (
              <td
                key={column.id}
                className={cn(
                  column.className,
                  columnDragCellClass(index, draggedColumnIndex),
                  columnDropCellClass(index, dropBoundaryIndex, tableColumns.length)
                )}
                style={columnStyle(columnWidths[column.id])}
                title={formatDatasetValue(orderedColumns[index], row.values)}
              >
                {formatDatasetValue(orderedColumns[index], row.values)}
              </td>
            ))}
          </>
        )}
        columnWidths={columnWidths}
        onResizeColumn={resizeColumn}
        columnReorder={columnReorder}
        hasNextPage={rows.hasNextPage}
        isFetchingNextPage={rows.isFetchingNextPage}
        fetchNextPage={rows.fetchNextPage}
        loadingMoreSlot={<LoadingSpinner label="Loading more rows" size="sm" />}
        statusRow={rows.isSuccess && content.length === 0 ? "No rows match this dataset preview." : undefined}
        // The same condition the Reporting tab reads: `isRefetching` is `isFetching && !isPending`, which
        // is false during exactly the two reads that matter - the first one, and any that mints a new key.
        overlay={
          rows.isFetching && !rows.isFetchingNextPage && <LoadingOverlay label="Loading rows" />
        }
        expanded={expanded}
      />
      {rows.isError && <p className="form-error dashboards-tab__dataset-error">{formatError(rows.error)}</p>}

      {filterPopover?.stage === "date" && (
        <DataTableDateFilterPopover
          range={dateWindow}
          anchor={filterAnchor}
          onApply={updateDateWindow}
          onClose={() => setFilterPopover(null)}
        />
      )}
      {filterPopover?.stage === "fields" && (
        <DataTableFieldPickerPopover
          fields={FILTER_FIELDS}
          filteredIds={filterChips.map((filter) => filter.id)}
          anchor={filterAnchor}
          onPick={(columnId) => setFilterPopover({ stage: "values", columnId })}
        />
      )}
      {selectedFilterColumn && (
        <DashboardDatasetFilterPopover
          campaignId={campaignId}
          dashboardId={dashboard.id}
          column={selectedFilterColumn}
          initialSelected={filterValues(filters, selectedFilterColumn.field as string)}
          anchor={filterAnchor}
          onApply={(values) => updateFilter(selectedFilterColumn.field as string, values)}
          onClose={() => setFilterPopover(null)}
        />
      )}
    </div>
  );
}

interface DatasetDownloadMenuProps {
  campaignId: number;
  /** The owning campaign's own name, used only to build the download's filename. */
  campaignName: string;
  dashboard: DashboardV1;
  /** The preview table's currently-applied filters - what "Current view" downloads. */
  filters: DashboardDatasetFilterV1[];
  /** The preview table's currently-applied date window - what "Current view" downloads. */
  dateWindow: DateWindow;
}

/**
 * The dataset preview's "Download" action: everything the on-screen table currently shows, or the
 * dashboard's whole unfiltered delivery history, as an .xlsx - mirroring Reporting's own Download menu in
 * shape and behaviour (US-019's read-only preview gets the same download the Reporting table already has).
 *
 * Unlike Reporting, a dashboard has only one filter layer: filters and the date window save the moment
 * they change (see `unapplied` in `DashboardDetail` above), so what is on screen and what is saved are
 * the same thing - "Current view" is simply the request the preview table itself is already sending,
 * minus paging.
 */
function DatasetDownloadMenu({ campaignId, campaignName, dashboard, filters, dateWindow }: DatasetDownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** Downloads the dataset as .xlsx - "current" honors the preview table's active filters/date window,
   *  "all" exports the dashboard's whole delivery history regardless of what's currently applied. */
  async function download(scope: "current" | "all") {
    setOpen(false);
    setDownloading(true);
    try {
      const { blob, truncated } = await exportDashboardDatasetRows(
        campaignId,
        dashboard.id,
        scope === "current"
          ? { filters, dateFrom: dateWindow.from || undefined, dateTo: dateWindow.to || undefined }
          : {}
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        `${fileSafe(campaignName)} - ${fileSafe(dashboard.name)}${scope === "all" ? " - all" : ""}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      if (truncated) {
        toast.showError(
          "This dataset has more rows than one download can carry, so the file is missing some. Narrow " +
            "the date range to get a complete file."
        );
      }
    } catch (error) {
      toast.showError(formatError(error));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="reporting-tab__menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="button button--secondary reporting-tab__dropdown-btn"
        onClick={() => setOpen((current) => !current)}
        disabled={downloading}
      >
        {downloading ? "Downloading…" : "Download"}
      </button>
      {open && (
        <div className="reporting-tab__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => download("current")}>
            Current view
          </button>
          <button type="button" role="menuitem" onClick={() => download("all")}>
            All data
          </button>
        </div>
      )}
    </div>
  );
}

interface DashboardDatasetFilterPopoverProps {
  campaignId: number;
  dashboardId: number;
  column: SchemaColumn;
  initialSelected: string[];
  anchor: HTMLElement | null;
  onApply: (values: string[]) => void;
  onClose: () => void;
}

/**
 * Reads one dataset column's distinct values and hands them to the shared value filter.
 *
 * The read is the only part of this filter that is the Dashboards tab's own - which is why the popover
 * itself now lives beside the table it belongs to instead of being maintained twice.
 */
function DashboardDatasetFilterPopover({
  campaignId,
  dashboardId,
  column,
  initialSelected,
  anchor,
  onApply,
  onClose,
}: DashboardDatasetFilterPopoverProps) {
  const distinctValues = useDashboardDatasetDistinctValues(campaignId, dashboardId, column.field, true);

  return (
    <DataTableValueFilterPopover
      label={column.label}
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


interface DatasetHintProps {
  /** Already worded by the caller: a count, "counting rows…", or the reason the count failed. */
  rowCount: string;
  dimensions: number;
  metrics: number;
}

/**
 * What the preview is, behind the same "?" the Reporting tab puts beside its own table controls.
 *
 * It used to be a "Dataset preview" heading spelling all of this out above the table. Every part of it
 * repeats something already on screen - the row count is in the controls beside it, the dimension and
 * metric counts are in the two panels above - so it earned a line of its own for nothing, and pushed the
 * table down a row. Behind a "?" it is there for whoever wants it and costs nothing to the rest.
 *
 * Hover and focus both open it, Escape gives up focus, and the popover is a child of the same wrapper so
 * the pointer can travel into it.
 */
function DatasetHint({ rowCount, dimensions, metrics }: DatasetHintProps) {
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
        aria-label="What this dataset preview shows"
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
          <h4 className="reporting-tab__levels-title">Dataset preview</h4>
          <p className="reporting-tab__levels-lead">
            {rowCount} · {dimensions} dimensions · {metrics} metrics · read-only — edit data in Reporting
          </p>
          <h4 className="reporting-tab__levels-title">How CPA is worked out</h4>
          <p className="reporting-tab__levels-lead">{CPA_EXPLAINER}</p>
          <h4 className="reporting-tab__levels-title">Why a cell can be empty</h4>
          <ol className="reporting-tab__levels-list">
            {BLANK_CELL_REASONS.map((reason) => (
              <li key={reason} className="reporting-tab__levels-item">
                {reason}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

interface SourceMenuProps {
  dashboard: DashboardV1;
  copiedTable: boolean;
  copiedQuery: boolean;
  onCopyTable: () => void;
  onCopyQuery: () => void;
  onWriteSource: () => void;
  onRemoveSource: () => void;
}

/**
 * The published data source, as one control: a pill saying it exists, and a menu holding everything there
 * is to do with it.
 *
 * It replaced a full-width strip that spelled the table name, the row count and the write date across two
 * rows, with a standing "Update data source" button beneath. All of it true, and all of it shouting - the
 * table name is 90 characters of BigQuery path that matters twice in a dashboard's life, when it is pasted
 * into ClicData and when someone checks which table this is. So the pill states the fact and the menu
 * carries the detail, which is also where the rewrite lives: a source that is in step with its definition
 * has nothing pending, and a permanent button says otherwise.
 */
function SourceMenu({
  dashboard,
  copiedTable,
  copiedQuery,
  onCopyTable,
  onCopyQuery,
  onWriteSource,
  onRemoveSource,
}: SourceMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dashboards-tab__source" ref={wrapRef}>
      <button
        type="button"
        className="dashboards-tab__source-pill"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CheckIcon />
        ClicData source
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="dashboards-tab__source-menu" role="menu">
          <div className="dashboards-tab__source-table">
            <span className="dashboards-tab__source-label">ClicData query</span>
            <code>{clicDataQuery(dashboard.sourceTable ?? "")}</code>
            <p className="dashboards-tab__source-meta">
              {fmtCount(dashboard.sourceRowCount ?? undefined)} rows written{" "}
              {fmtDashboardDate(dashboard.sourceCreated ?? undefined)}
            </p>
          </div>
          <button type="button" role="menuitem" onClick={onCopyQuery}>
            {copiedQuery ? "Copied!" : "Copy query"}
            <CopyIcon />
          </button>
          <button type="button" role="menuitem" onClick={onCopyTable}>
            {copiedTable ? "Copied!" : "Copy table name only"}
            <CopyIcon />
          </button>
          {/* Here rather than as a standing button: the definition has not changed, so this rewrites the
              table for delivery that has arrived since - a deliberate act, not the obvious next step. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onWriteSource();
            }}
          >
            Update data source
          </button>
          <button
            type="button"
            role="menuitem"
            className="dashboards-tab__menu-danger"
            onClick={() => {
              setOpen(false);
              onRemoveSource();
            }}
          >
            Remove data source
          </button>
        </div>
      )}
    </div>
  );
}

interface SchemaPanelProps {
  title: string;
  columns: SchemaColumn[];
  kept: number;
  optionalKept: string[];
  onToggle: (id: string) => void;
}

/** One locked column list, with a checkbox on the columns the template lets a user drop. */
function SchemaPanel({ title, columns, kept, optionalKept, onToggle }: SchemaPanelProps) {
  const optionalNames = columns.filter((column) => column.optional).map((column) => column.label);
  return (
    <div className="dashboards-tab__picker">
      <div className="dashboards-tab__picker-head">
        <h4>
          {title} <span className="dashboards-tab__pick-count">{kept}</span>
          <span className="dashboards-tab__scope">Fixed</span>
        </h4>
      </div>
      <div className="dashboards-tab__picker-list">
        {columns.map((column) =>
          column.optional ? (
            <label key={column.id} className="dashboards-tab__check">
              <input
                type="checkbox"
                checked={optionalKept.includes(column.id)}
                onChange={() => onToggle(column.id)}
              />
              {column.label}
              {column.agg && <span className="dashboards-tab__agg">{column.agg}</span>}
            </label>
          ) : (
            <div key={column.id} className="dashboards-tab__locked">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              {column.label}
              {column.agg && <span className="dashboards-tab__agg">{column.agg}</span>}
            </div>
          )
        )}
      </div>
      <div className="dashboards-tab__picker-foot">
        Set by the ClicData template
        {optionalNames.length > 0 && ` · ${optionalNames.join(", ")} optional`}
      </div>
    </div>
  );
}

interface PublishDialogProps {
  open: boolean;
  campaignId: number;
  campaignName: string;
  dashboard: DashboardV1;
  busy: boolean;
  onClose: () => void;
  onConfirm: (displayCampaignName: string) => void;
}

/** The US-020 confirmation: what is about to be written, and the name the dashboard will show. */
function PublishDialog({
  open,
  campaignId,
  campaignName,
  dashboard,
  busy,
  onClose,
  onConfirm,
}: PublishDialogProps) {
  const [heading, setHeading] = useState(dashboard.displayCampaignName ?? campaignName);
  // The same inputs the detail panel asks under, so the dialog reads that count from cache instead of
  // spending a second BigQuery job to arrive at the same figure.
  const preview = useDashboardPreview(
    open ? campaignId : undefined,
    open ? dashboard.id : undefined,
    dashboard.optionalColumns,
    dashboard.filters,
    dashboardDateWindow(dashboard)
  );

  useEffect(() => {
    if (open) {
      setHeading(dashboard.displayCampaignName ?? campaignName);
    }
  }, [open, dashboard.displayCampaignName, campaignName]);

  const dimensions = BASIC_DIMENSIONS.filter(
    (column) => !column.optional || dashboard.optionalColumns.includes(column.id)
  ).length;
  const metrics = BASIC_METRICS.filter(
    (column) => !column.optional || dashboard.optionalColumns.includes(column.id)
  ).length;
  const isUpdate = Boolean(dashboard.sourceTable);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${isUpdate ? "Update" : "Create"} data source for ClicData`}
      subtitle="Writes the saved dashboard filters and fixed schema to BigQuery for the ClicData dashboard."
      className="dashboards-tab__wiz-card"
    >
      <div className="dashboards-tab__wiz-review">
        <div className="dashboards-tab__ps-row">
          <span className="dashboards-tab__ps-label">Dashboard</span>
          <span>
            {dashboard.name} <span className="reporting-tab__type-badge">Basic</span>
          </span>
        </div>
        <div className="dashboards-tab__ps-row">
          <span className="dashboards-tab__ps-label">Schema</span>
          <span>
            {dimensions} dimensions · {metrics} metrics
          </span>
        </div>
        <div className="dashboards-tab__ps-row">
          <span className="dashboards-tab__ps-label">Rows</span>
          <span>{preview.isPending ? "counting…" : fmtCount(preview.data?.rowCount)}</span>
        </div>
        <div className="dashboards-tab__ps-row">
          <span className="dashboards-tab__ps-label">BQ table</span>
          <code className="dashboards-tab__ps-code">
            {preview.isPending ? "generating…" : preview.data?.sourceTable ?? "—"}
          </code>
        </div>
      </div>
      <label className="dashboards-tab__field">
        Campaign name shown on the dashboard
        <input value={heading} onChange={(event) => setHeading(event.target.value)} />
      </label>
      <div className="dashboards-tab__hint">
        Writing again replaces the table rather than adding to it, so this is also how a live data source is
        refreshed. A campaign with a long flight can take a few minutes — leave this open until it finishes.
      </div>
      <div className="dashboards-tab__wiz-foot">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => onConfirm(heading)}
        >
          {busy ? "Writing…" : `${isUpdate ? "Update" : "Create"} data source`}
        </button>
        <button type="button" className="button button--ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
