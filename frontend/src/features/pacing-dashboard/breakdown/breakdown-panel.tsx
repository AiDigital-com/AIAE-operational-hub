/**
 * The Breakdown panel: where did this pacing's delivery actually go?
 *
 * One tab per dimension the pacing has, a donut beside a sortable table, and a click on either
 * turns that value into a live filter on the whole dashboard - the `brk`/`brkf` pair the filter bar
 * and the Spotlight already speak (`filters/breakdown-filter.ts`). Ported from the retired SPA's
 * `CampaignBreakdown.jsx` -> `LineItemList/Breakdown.jsx`; the arithmetic lives in
 * `build-breakdown.ts` and `breakdown-aggregate.ts`, and this file is the drawing half.
 *
 * Three rules from the reference that look like details and are not:
 *
 *   - RESIDUAL ROWS (`Others`, `Unclassified`, ...) describe leftover delivery, not a value you
 *     could filter by. They sink below the real values, render dimmed, and do not respond to a
 *     click - a chip for `Others` would filter nothing.
 *   - `Others` KNOWS ONLY ITS UNIT. It is the campaign total minus the rows above it, computed in
 *     one unit; its clicks, spend and completes were never calculated. Those cells print an em dash
 *     rather than a 0 that would assert something we did not measure, and the row stays out of the
 *     best/worst comparison - a synthetic 0.00% CTR wins "worst" every time.
 *   - THE TAB BAR DOES NOT MOVE UNDER A FILTER. Which dimensions exist is a property of the data;
 *     `build-breakdown.ts` reads it from the unfiltered aggregate for that reason.
 *
 * No vertical colour stripes: an active row is a tinted cell fill plus its own dot, never a bar
 * down its left edge (project rule).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../../shared/style/cn";
import { formatPlatform } from "../journal/fact-dims";
import { outsidePair } from "../filters/breakdown-filter";
import type { DashboardFilters } from "../filters/types";
import type { PacingDashboardV1 } from "../types";
import { fmtInt, fmtMoney, fmtPercent } from "../format";
import type { BreakdownRow } from "./breakdown-aggregate";
import {
  buildBreakdownContext,
  buildBreakdownView,
  defaultSortCol,
  isUnfilterable,
  unitLabel,
  type BreakdownContext,
  type BreakdownView,
} from "./build-breakdown";
import "./breakdown-panel.css";

/** How many rows before the panel folds the tail behind "Show all". */
const COLLAPSED_ROWS = 10;

/** The categorical ten (`--pal-0 … --pal-9`, app/tokens.css), assigned after the sort so the
 *  biggest slice always reads as slot 0. Residuals keep grey instead: they are not values, and a
 *  palette hue would invite a click the panel refuses. */
function rowPaint(row: BreakdownRow, index: number): string {
  if (row.key === "__notcovered__") return "var(--text-label)";
  if (row.residual) return "var(--muted-strong)";
  return `var(--pal-${index % 10})`;
}

/** The label a person reads. Only `platform` is rewritten: its raw values are BigQuery slugs
 *  (`dv_360_dlv`), and the Hub already shows "DV360" for the same value in the filter chips and the
 *  journal palette - two spellings of one platform on one screen is the thing to avoid. The FILTER
 *  still travels on the raw key, which is what a fact row carries, and so does the A-Z sort - which
 *  costs nothing, because every entry in `PLATFORM_LABELS` sorts the same either way and an unknown
 *  value passes through unchanged. */
function rowLabel(dim: string, row: BreakdownRow): string {
  if (row.residual || dim !== "platform") return row.label;
  return formatPlatform(row.label);
}

interface ColumnDef {
  id: string;
  label: string;
  cell: (row: BreakdownRow) => string;
  total: (totals: BreakdownView["totals"]) => string;
  /** Tints the cell green/red on the best/worst value in view. */
  extreme?: "ctr" | "vcr";
}

const DELIVERY_COLUMNS: ColumnDef[] = [
  { id: "im", label: "Impressions", cell: (r) => fmtInt(r.im), total: (t) => fmtInt(t.im) },
  { id: "cl", label: "Clicks", cell: (r) => fmtInt(r.cl), total: (t) => fmtInt(t.cl) },
  { id: "ctr", label: "CTR", cell: (r) => fmtPercent(r.ctr), total: (t) => fmtPercent(t.ctr), extreme: "ctr" },
  { id: "sp", label: "Spend", cell: (r) => fmtMoney(r.sp), total: (t) => fmtMoney(t.sp) },
];
const CPM_COLUMN: ColumnDef = { id: "cpm", label: "CPM", cell: (r) => fmtMoney(r.cpm), total: (t) => fmtMoney(t.cpm) };
const VCR_COLUMNS: ColumnDef[] = [
  { id: "coV", label: "Compl.", cell: (r) => fmtInt(r.coV), total: (t) => fmtInt(t.coV) },
  { id: "vcr", label: "VCR", cell: (r) => fmtPercent(r.vcr), total: (t) => fmtPercent(t.vcr), extreme: "vcr" },
];
const CONVERSION_COLUMNS: ColumnDef[] = [
  { id: "cv", label: "Conv", cell: (r) => ((r.cv || 0) > 0 ? fmtInt(r.cv) : "—"), total: (t) => (t.cv > 0 ? fmtInt(t.cv) : "—") },
  { id: "cvr", label: "CVR", cell: (r) => ((r.cv || 0) > 0 ? fmtPercent(r.cvr) : "—"), total: (t) => (t.cv > 0 ? fmtPercent(t.cvr) : "—") },
];
/** The conversions cut's own set - the conversions mart carries no impressions, clicks or spend. */
const CONVERSION_DIM_COLUMNS: ColumnDef[] = [
  { id: "cv", label: "Conv", cell: (r) => ((r.cv || 0) > 0 ? fmtInt(r.cv) : "—"), total: (t) => (t.cv > 0 ? fmtInt(t.cv) : "—") },
  { id: "pc", label: "P-Click", cell: (r) => ((r.pc || 0) > 0 ? fmtInt(r.pc) : "—"), total: (t) => (t.pc > 0 ? fmtInt(t.pc) : "—") },
  { id: "pv", label: "P-View", cell: (r) => ((r.pv || 0) > 0 ? fmtInt(r.pv) : "—"), total: (t) => (t.pv > 0 ? fmtInt(t.pv) : "—") },
];

function columnsFor(view: BreakdownView): ColumnDef[] {
  if (view.isConversionDim) return CONVERSION_DIM_COLUMNS;
  return [
    ...DELIVERY_COLUMNS,
    ...(view.showCpm ? [CPM_COLUMN] : []),
    ...(view.showVcr ? VCR_COLUMNS : []),
    ...(view.showConversions ? CONVERSION_COLUMNS : []),
  ];
}

/**
 * The one column an `Others`-style row can legitimately fill: the campaign's buying unit. On a
 * completes-bought pacing that is the GATED column - `Compl.` shows `coV`, and the raw `co` the
 * remainder carries has no column of its own, so the figure is printed there instead of vanishing.
 * The reference matched on the raw key and left the whole row empty on exactly that pacing.
 */
const UNIT_COLUMN: Record<string, string> = { im: "im", cl: "cl", co: "coV", coV: "coV", cv: "cv" };

/** Text for one cell, with the unknown-beyond-unit rule applied: every column but the unit's own
 *  prints an em dash rather than a 0 nobody measured. */
function cellText(column: ColumnDef, row: BreakdownRow, unitKey: string): string {
  if (!row.unknownBeyondUnit) return column.cell(row);
  if (column.id !== UNIT_COLUMN[unitKey]) return "—";
  return unitKey === "co" ? fmtInt(row.co) : column.cell(row);
}

/** The primary-unit figure on one row, on this tab's own unit. */
function unitValueOf(row: BreakdownRow, rowUnitKey: string): number {
  const v = row[rowUnitKey as keyof BreakdownRow];
  return typeof v === "number" ? v : 0;
}

function DonutTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: { payload?: { label: string; value: number } }[];
  total: number;
}) {
  const slice = active ? payload?.[0]?.payload : null;
  if (!slice) return null;
  const share = total > 0 ? `${((slice.value / total) * 100).toFixed(1)}%` : "";
  return (
    <div className="pbrk__tip">
      <div className="pbrk__tip-label">{slice.label}</div>
      <div className="pbrk__tip-value">
        {fmtInt(slice.value)} {share && <span>({share})</span>}
      </div>
    </div>
  );
}

export interface BreakdownPanelProps {
  data: PacingDashboardV1 | null | undefined;
  filters: DashboardFilters;
  setFilters: (patch: Partial<DashboardFilters>) => void;
}

export function BreakdownPanel({ data, filters, setFilters }: BreakdownPanelProps) {
  const ctx: BreakdownContext | null = useMemo(() => buildBreakdownContext(data, filters), [data, filters]);

  const [activeDim, setActiveDim] = useState<string>("");
  // null = "this tab's own default", which is the buying unit (conversions on the conversions
  // cut). Storing the resolved column instead would pin a clicks-bought pacing to impressions,
  // and would carry one tab's choice onto the next.
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  // Memoized so the effect below does not re-fire on every render through a fresh `[]`.
  const dims = useMemo(() => ctx?.dims ?? [], [ctx]);
  // The tab actually shown: the viewer's pick while it still exists, else the URL's `brk`, else the
  // first cut. Derived rather than stored, so a pacing that loses a dimension (a filter narrowed
  // the line items) cannot leave this pointing at a tab that is no longer on screen.
  const dim = dims.includes(activeDim) ? activeDim : dims.includes(filters.brk) ? filters.brk : (dims[0] ?? "");

  // Following the URL is what makes a Spotlight pick or a journal tag land on the matching tab.
  // Only when `brk` names a cut this pacing has - an unknown one leaves the current tab alone
  // rather than blanking the panel.
  // Reacts to a CHANGE of `brk`, not to its value: clicking a row writes `brk` itself, and without
  // the ref that write would read back as "the URL wants a different tab" and wipe the sort and the
  // search the viewer had set. Same guard, and the same reason, as the reference's `lastUrlDimRef`.
  // A genuine cross-tab jump does reset that state, exactly as clicking the tab would - a sort
  // column and a search typed against one cut mean nothing on the next, and a carried-over "CTR" is
  // a column the conversions cut does not even have.
  const lastUrlDim = useRef("");
  useEffect(() => {
    const next = filters.brk;
    if (!next || next === lastUrlDim.current) return;
    lastUrlDim.current = next;
    if (next === dim || !dims.includes(next)) return;
    setActiveDim(next);
    setSortCol(null);
    setSortDir("desc");
    setSearch("");
    setExpanded(false);
  }, [filters.brk, dims, dim]);

  const effectiveSortCol = sortCol ?? (ctx ? defaultSortCol(dim, ctx.unitKey) : "im");
  const view = useMemo(
    () => (ctx && dim ? buildBreakdownView(ctx, dim, effectiveSortCol, sortDir) : null),
    [ctx, dim, effectiveSortCol, sortDir]
  );

  // Paint is assigned once, over the SORTED FULL row set, and then looked up by key everywhere. A
  // per-render index would give the donut and the table different hues the moment the search box
  // hid a row, and the dot beside a name is the only thing tying the two together.
  const paintByKey = useMemo(() => {
    const map = new Map<string, string>();
    (view?.rows ?? []).forEach((row, index) => map.set(row.key, rowPaint(row, index)));
    return map;
  }, [view]);

  // The donut is built from the UNSEARCHED rows so it does not re-layout on every keystroke while
  // the table narrows underneath it.
  const donutData = useMemo(
    () =>
      (view?.rows ?? []).map((row) => ({
        key: row.key,
        label: rowLabel(dim, row),
        value: unitValueOf(row, view?.rowUnitKey ?? "im"),
        paint: paintByKey.get(row.key) ?? "var(--muted-strong)",
      })),
    [view, ctx, dim, paintByKey]
  );

  const visibleRows = useMemo(() => {
    const rows = view?.rows ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => rowLabel(dim, row).toLowerCase().includes(query));
  }, [view, search, dim]);

  if (!ctx || dims.length === 0 || !view || !dim) return null;

  const columns = columnsFor(view);
  const unfilterable = isUnfilterable(dim);
  const shown = expanded ? visibleRows : visibleRows.slice(0, COLLAPSED_ROWS);
  const overflow = visibleRows.length > COLLAPSED_ROWS;

  function pickDim(next: string) {
    if (next === dim) return;
    setActiveDim(next);
    setSortCol(null);
    setSortDir("desc");
    setSearch("");
    setExpanded(false);
  }

  function toggleSort(columnId: string) {
    if (columnId === effectiveSortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      return;
    }
    setSortCol(columnId);
    setSortDir(columnId === "label" ? "asc" : "desc");
  }

  /** One value in, one value out of the multi-dim filter. `brk` follows as the active-tab hint, so
   *  reopening the dashboard from a shared link lands on the cut the chip came from. */
  function toggleFilter(row: BreakdownRow) {
    if (row.residual || unfilterable) return;
    const pair = `${dim}:${row.key}`;
    const next = filters.brkf.includes(pair) ? filters.brkf.filter((p) => p !== pair) : [...filters.brkf, pair];
    setFilters({ brk: dim, brkf: next });
  }

  const isActivePair = (row: BreakdownRow) => filters.brkf.includes(`${dim}:${row.key}`);

  /**
   * The complement filter: show only the delivery this line item ran on values its container
   * splits never declared.
   *
   * The reference also SETS the line-item selection when this goes on, because there the row is
   * reached from a line-item card and the rest of the screen is still showing every other line
   * whole. Here the selection is what put the panel in per-line-item mode to begin with, so
   * setting it again says nothing - and CLEARING it on the way out would drop the scope that makes
   * this row exist at all, which is not what turning one filter off should do.
   */
  function toggleOutside(liId: string) {
    const pair = outsidePair(dim, liId);
    const next = filters.brkf.includes(pair) ? filters.brkf.filter((p) => p !== pair) : [...filters.brkf, pair];
    setFilters({ brk: dim, brkf: next });
  }

  return (
    <section className="pdash__section pbrk">
      <div className="pbrk__head">
        <h2 className="pdash__section-title">Breakdown</h2>
        <label className="pbrk__search">
          <span className="pbrk__sr">Filter segments</span>
          <input
            type="text"
            value={search}
            placeholder="Filter segments…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="pbrk__tabs" role="tablist" aria-label="Breakdown dimension">
        {dims.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={option === dim}
            className={cn("pbrk__tab", option === dim && "pbrk__tab--active")}
            onClick={() => pickDim(option)}
            // Where a cut needs a word of explanation it rides in the tooltip, not on a second
            // line. Only three of the twelve have one, and giving every tab their height to keep
            // one baseline made the nine without look like oversized buttons.
            title={ctx.dimMeta[option]?.sub}
          >
            {ctx.dimMeta[option]?.label ?? option}
          </button>
        ))}
      </div>

      {view.coverage && (view.coverage.line || view.coverage.stale) && (
        <p className="pbrk__coverage">
          {view.coverage.line}
          {view.coverage.gap && <span className="pbrk__coverage-gap">{view.coverage.gap}</span>}
          {view.coverage.window && <span className="pbrk__coverage-window">{view.coverage.window}</span>}
          {view.coverage.stale && <span className="pbrk__coverage-stale">{view.coverage.stale}</span>}
        </p>
      )}

      {view.rows.length === 0 ? (
        <p className="pbrk__empty">No breakdown data for the current selection.</p>
      ) : (
        <div className="pbrk__body">
          <div className="pbrk__donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={1}
                  strokeWidth={0}
                  isAnimationActive={false}
                  cursor={unfilterable ? "default" : "pointer"}
                  onClick={(_, index) => {
                    const row = view.rows[index];
                    if (row) toggleFilter(row);
                  }}
                >
                  {donutData.map((slice) => (
                    <Cell
                      key={slice.key}
                      fill={slice.paint}
                      stroke={filters.brkf.includes(`${dim}:${slice.key}`) ? "var(--accent-primary)" : "none"}
                      strokeWidth={filters.brkf.includes(`${dim}:${slice.key}`) ? 2 : 0}
                    />
                  ))}
                </Pie>
                <Tooltip cursor={false} content={<DonutTooltip total={view.totalUnits} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="pbrk__table-wrap">
            <table className="pbrk__table">
              <thead>
                <tr>
                  <th scope="col" className="pbrk__col--text">
                    <button type="button" className="pbrk__sort" onClick={() => toggleSort("label")}>
                      {ctx.dimMeta[dim]?.label ?? dim}
                      <SortMark active={effectiveSortCol === "label"} dir={sortDir} />
                    </button>
                  </th>
                  {columns.map((column) => (
                    <th scope="col" key={column.id} className="pbrk__col--num">
                      <button type="button" className="pbrk__sort" onClick={() => toggleSort(column.id)}>
                        {column.label}
                        <SortMark active={effectiveSortCol === column.id} dir={sortDir} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const paint = paintByKey.get(row.key) ?? "var(--muted-strong)";
                  const clickable = !row.residual && !unfilterable;
                  const active = isActivePair(row);
                  const share =
                    view.totalUnits > 0
                      ? `${((unitValueOf(row, view.rowUnitKey) / view.totalUnits) * 100).toFixed(1)}%`
                      : "";
                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        "pbrk__row",
                        row.residual && "pbrk__row--residual",
                        clickable && "pbrk__row--clickable",
                        active && "pbrk__row--active"
                      )}
                      onClick={clickable ? () => toggleFilter(row) : undefined}
                    >
                      <td className="pbrk__col--text">
                        {clickable ? (
                          <button
                            type="button"
                            className="pbrk__pick"
                            aria-pressed={active}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFilter(row);
                            }}
                          >
                            <span className="pbrk__dot" style={{ background: paint }} />
                            <span className="pbrk__label">{rowLabel(dim, row)}</span>
                            <span className="pbrk__share">{share}</span>
                          </button>
                        ) : (
                          <span className="pbrk__pick pbrk__pick--inert">
                            <span className="pbrk__dot" style={{ background: paint }} />
                            <span className="pbrk__label">{rowLabel(dim, row)}</span>
                            <span className="pbrk__share">{share}</span>
                          </span>
                        )}
                      </td>
                      {columns.map((column) => (
                        <td
                          key={column.id}
                          className={cn("pbrk__col--num", extremeClass(column, row, view))}
                        >
                          {cellText(column, row, view.rowUnitKey)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="pbrk__totals">
                  <td className="pbrk__col--text">Total</td>
                  {columns.map((column) => (
                    <td key={column.id} className="pbrk__col--num">
                      {column.total(view.totals)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>

            {view.outside && (
              <div className="pbrk__outside">
                <button
                  type="button"
                  className={cn("pbrk__outside-btn", filters.brkf.includes(outsidePair(dim, view.outside.liId)) && "pbrk__outside-btn--on")}
                  aria-pressed={filters.brkf.includes(outsidePair(dim, view.outside.liId))}
                  onClick={() => toggleOutside(view.outside!.liId)}
                  title="Delivery this line item ran on values its container splits do not declare"
                >
                  Outside splits
                </button>
                <span>
                  {fmtInt(view.outside.units)} {unitLabel(ctx.unitKey)} · {view.outside.share.toFixed(1)}% of delivery
                </span>
                <span className="pbrk__outside-note">
                  {filters.brkf.includes(outsidePair(dim, view.outside.liId))
                    ? "showing only this"
                    : "already counted in the rows above"}
                </span>
              </div>
            )}

            {overflow && (
              <div className="pbrk__more">
                <button type="button" className="button button--ghost button--sm" onClick={() => setExpanded((x) => !x)}>
                  {expanded ? `Collapse to ${COLLAPSED_ROWS}` : `Show all (${visibleRows.length})`}
                </button>
              </div>
            )}
            {visibleRows.length === 0 && search && (
              <p className="pbrk__empty">No segments match “{search}”.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Green on the best rate in view, red on the worst - and only when the spread is worth pointing
 *  at, which `rateExtremes` decides. */
function extremeClass(column: ColumnDef, row: BreakdownRow, view: BreakdownView): string | false {
  if (!column.extreme || row.unknownBeyondUnit) return false;
  const value = column.extreme === "ctr" ? row.ctr : row.vcr;
  const best = column.extreme === "ctr" ? view.extremes.bestCtr : view.extremes.bestVcr;
  const worst = column.extreme === "ctr" ? view.extremes.worstCtr : view.extremes.worstVcr;
  if (best != null && value === best) return "pbrk__cell--best";
  if (worst != null && value === worst) return "pbrk__cell--worst";
  return false;
}

function SortMark({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span className={cn("pbrk__arrow", active && "pbrk__arrow--active")} aria-hidden="true">
      {active && dir === "asc" ? "▲" : "▼"}
    </span>
  );
}
