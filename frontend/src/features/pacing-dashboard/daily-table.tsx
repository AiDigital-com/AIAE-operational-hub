/**
 * The Daily Performance table (§7 of the migration plan, US-120): one row per day
 * per line item, under the charts, for reading the detail behind a trend.
 *
 * Both halves of what this shows come from Pacing, already worked out.
 *
 * ROWS are `metrics.daily`, not the raw `factsDaily` in the same payload. Those raw
 * rows are split by platform, tactic, audience and geo — thousands of them for a
 * few hundred real day/line-item pairs — and they include days that fall outside a
 * line item's own flight. Pacing's buildRows folds the splits and applies the
 * flight guard the charts and the header already apply, so this table's
 * impressions add up to the figure above it rather than to a larger one nobody can
 * account for.
 *
 * TOTALS are `metrics.campaign`, read rather than computed, and that is what makes
 * US-120's rule hold: "sum of numerator over sum of denominator for derived
 * metrics, never an average of rates". A CPM totalled by averaging the daily CPMs
 * is wrong — low-volume days pull it around — and it is wrong in a way that looks
 * entirely plausible on screen. Reading the canonical figure means the rule cannot
 * be broken by forgetting it.
 */
import { useMemo, useState } from "react";
import {
  DataTable,
  type DataTableColumn,
} from "../../shared/ui/data-table/data-table";
import { fmtInt, fmtMoney, fmtPercent } from "./format";
import type { DailyMetricRow, PacingMetricsBag } from "./types-metrics";
import "./daily-table.css";

type SortDirection = "asc" | "desc";

const COLUMNS: DataTableColumn[] = [
  { id: "date", label: "Date", sortable: true, filterable: true, className: "dtbl__col--text" },
  { id: "rawId", label: "Line item", sortable: true, filterable: true, className: "dtbl__col--text" },
  { id: "channel", label: "Channel", sortable: true, filterable: true, className: "dtbl__col--text" },
  { id: "im", label: "Impressions", sortable: true, agg: "sum", className: "dtbl__col--num" },
  { id: "cl", label: "Clicks", sortable: true, agg: "sum", className: "dtbl__col--num" },
  { id: "co", label: "Completions", sortable: true, agg: "sum", className: "dtbl__col--num" },
  { id: "dc", label: "Cost", sortable: true, agg: "sum", className: "dtbl__col--num" },
  { id: "sp", label: "Spend", sortable: true, agg: "sum", className: "dtbl__col--num" },
  { id: "cpm", label: "CPM", sortable: true, agg: "Σ/Σ", className: "dtbl__col--num" },
  { id: "ctr", label: "CTR", sortable: true, agg: "Σ/Σ", className: "dtbl__col--num" },
  { id: "vcr", label: "VCR", sortable: true, agg: "Σ/Σ", className: "dtbl__col--num" },
];

/** The three derived columns carry "Σ/Σ" rather than "avg" in their header badge —
 *  a small, permanent reminder of how their total was reached. */
const TEXT_COLUMNS = new Set(["date", "rawId", "channel"]);

function cellText(row: DailyMetricRow, columnId: string): string {
  switch (columnId) {
    case "date":
      return row.date;
    case "rawId":
      return row.rawId;
    case "channel":
      return row.channel;
    case "im":
      return fmtInt(row.im);
    case "cl":
      return fmtInt(row.cl);
    case "co":
      return fmtInt(row.co);
    case "dc":
      return fmtMoney(row.dc);
    case "sp":
      return fmtMoney(row.sp);
    case "cpm":
      return fmtMoney(row.cpm);
    case "ctr":
      return fmtPercent(row.ctr);
    // A line item with no completion goal has no completion rate. Pacing decides
    // which those are (isVcrEligible) and this shows a dash rather than the 0%
    // that dividing its completes by its impressions would produce.
    case "vcr":
      return row.vcrEligible ? fmtPercent(row.vcr) : "—";
    default:
      return "";
  }
}

/** The totals cell for a column, taken off the canonical campaign figures. */
function totalText(columnId: string, campaign: Record<string, unknown>): string {
  const num = (key: string) => {
    const v = campaign[key];
    return typeof v === "number" ? v : null;
  };
  switch (columnId) {
    case "date":
      return "Total";
    case "rawId":
    case "channel":
      return "";
    case "im":
      return fmtInt(num("im"));
    case "cl":
      return fmtInt(num("cl"));
    case "co":
      return fmtInt(num("co"));
    case "dc":
      return fmtMoney(num("dc"));
    case "sp":
      return fmtMoney(num("sp"));
    case "cpm":
      return fmtMoney(num("cpm"));
    case "ctr":
      return fmtPercent(num("ctr"));
    case "vcr":
      return fmtPercent(num("vcr"));
    default:
      return "";
  }
}

function compare(a: DailyMetricRow, b: DailyMetricRow, columnId: string): number {
  if (TEXT_COLUMNS.has(columnId)) {
    return String(a[columnId as keyof DailyMetricRow]).localeCompare(String(b[columnId as keyof DailyMetricRow]));
  }
  return (Number(a[columnId as keyof DailyMetricRow]) || 0) - (Number(b[columnId as keyof DailyMetricRow]) || 0);
}

export function DailyTable({ metrics }: { metrics: PacingMetricsBag | null }) {
  const [sortColumnId, setSortColumnId] = useState<string>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Record<string, string>>({});

  const rows = (metrics?.daily ?? []) as DailyMetricRow[];

  const visible = useMemo(() => {
    const active = Object.entries(filters).filter(([, term]) => term.trim());
    const matching = active.length
      ? rows.filter((row) =>
          active.every(([columnId, term]) =>
            cellText(row, columnId).toLowerCase().includes(term.trim().toLowerCase())
          )
        )
      : rows;
    // A copy: sorting the array Pacing sent would reorder it under every other
    // reader of the same payload.
    const sorted = [...matching].sort((a, b) => compare(a, b, sortColumnId));
    return sortDirection === "asc" ? sorted : sorted.reverse();
  }, [rows, filters, sortColumnId, sortDirection]);

  if (!metrics || rows.length === 0) {
    return (
      <section className="pdash__section">
        <h2 className="pdash__section-title">Daily performance</h2>
        <p className="dtbl__empty">No delivery has been recorded for this pacing yet.</p>
      </section>
    );
  }

  function onSort(columnId: string) {
    if (columnId === sortColumnId) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumnId(columnId);
    setSortDirection(columnId === "date" || TEXT_COLUMNS.has(columnId) ? "asc" : "desc");
  }

  const filtered = Object.entries(filters).filter(([, t]) => t.trim()).length;

  return (
    <section className="pdash__section">
      <div className="dtbl__head">
        <h2 className="pdash__section-title">Daily performance</h2>
        <span className="dtbl__count">
          {visible.length === rows.length
            ? `${fmtInt(rows.length)} rows`
            : `${fmtInt(visible.length)} of ${fmtInt(rows.length)} rows`}
        </span>
      </div>

      {/* Filtering is per text column and lives in the header row rather than behind
          a popover: three columns, one word each, and a visible input says what is
          narrowing the table without a click to find out. */}
      <div className="dtbl__filters">
        {COLUMNS.filter((c) => c.filterable).map((c) => (
          <label key={c.id} className="dtbl__filter">
            <span className="dtbl__filter-label">{c.label}</span>
            <input
              type="text"
              className="dtbl__filter-input"
              value={filters[c.id] ?? ""}
              placeholder="All"
              onChange={(e) => setFilters((f) => ({ ...f, [c.id]: e.target.value }))}
            />
          </label>
        ))}
        {filtered > 0 && (
          <button type="button" className="button button--ghost button--sm" onClick={() => setFilters({})}>
            Clear filters
          </button>
        )}
      </div>

      <DataTable
        columns={COLUMNS}
        rows={visible}
        getRowKey={(row) => `${row.date}|${row.liId}`}
        columnWidths={columnWidths}
        onResizeColumn={(id, width) => setColumnWidths((w) => ({ ...w, [id]: width }))}
        sortColumnId={sortColumnId}
        sortDirection={sortDirection}
        onSort={onSort}
        className="dtbl"
        renderCells={(row) =>
          COLUMNS.map((c) => (
            <td key={c.id} className={c.className}>
              {cellText(row, c.id)}
            </td>
          ))
        }
        renderPinnedCells={() =>
          COLUMNS.map((c) => (
            <td key={c.id} className={c.className}>
              {totalText(c.id, metrics.campaign)}
            </td>
          ))
        }
      />
    </section>
  );
}
