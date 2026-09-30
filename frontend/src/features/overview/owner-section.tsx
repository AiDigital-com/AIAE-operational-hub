import { memo } from "react";
import { cn } from "../../shared/style/cn";
import { ChevronRightIcon, SortIcon } from "../../shared/ui/icons/icons";
import { MarginCell } from "../../shared/ui/margin-cell/margin-cell";
import { PacingBar } from "../../shared/ui/pacing-bar/pacing-bar";
import { StatusBadge } from "../../shared/ui/status-badge/status-badge";
import { fmtBudget, fmtMD } from "../pacing/mock/format";
import { PACING_STATUS_STYLE } from "../pacing-overview/format";
import { pacingRoute } from "../pacing-overview/navigation";
import { NsDiffCell } from "../pacing-overview/ns-diff-cell";
import type { PacingRowV1 } from "../pacing-overview/types";
import { LineItemRows } from "./line-item-rows";
import type { OverviewSort, OverviewSortField, OwnerGroup } from "./owner-groups";
import { OverviewRowMenu } from "./row-menu";

/**
 * A column header that orders every group's table by its own column. Three states: ascending,
 * descending, off — off returns to the reference's status-priority order inside each group.
 */
function SortableHeader({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string;
  field: OverviewSortField;
  sort: OverviewSort | null;
  onSort: (field: OverviewSortField) => void;
  className?: string;
}) {
  const direction = sort?.field === field ? sort.direction : null;
  return (
    <th
      className={className}
      aria-sort={direction === "ASC" ? "ascending" : direction === "DESC" ? "descending" : "none"}
    >
      <button
        type="button"
        className={cn("overview__sort", direction && "overview__sort--active")}
        onClick={() => onSort(field)}
      >
        <span className="overview__sort-label">{label}</span>
        <SortIcon active={direction === "ASC" ? "asc" : direction === "DESC" ? "desc" : undefined} />
      </button>
    </th>
  );
}

/**
 * The period-scope pill (mirrors Pacing's dashboard banner): amber when "now" is outside the scoped
 * period, calm otherwise. A pill with an inline dot — never a vertical stripe (project ban).
 */
function PeriodScopePill({ row }: { row: PacingRowV1 }) {
  if (!row.periodScope) return null;
  const state = row.periodScopeState;
  const amber = state !== "in_period"; // ended / upcoming / no_period
  const label = row.periodLabel ? ` · ${row.periodLabel}` : "";
  const text =
    state === "ended"
      ? `Out of period${label}`
      : state === "upcoming"
        ? `Upcoming${label}`
        : state === "no_period"
          ? "Period scope · no period"
          : `Period scope${label}`;
  return (
    <div className="overview__period">
      <span className={cn("overview__period-pill", amber && "overview__period-pill--amber")}>
        <span className="overview__period-dot" />
        {text}
      </span>
    </div>
  );
}

/**
 * One pacing row plus, when open, its expanded line-item rows. Clicking the row toggles the
 * expansion; the arrow button on the right is what navigates (to the primary campaign's Pacing tab,
 * US-113). The row is washed red/amber when the whole pacing is beyond ±5pp off pace.
 *
 * Memoized so a search keystroke or another group's expansion only reconciles rows whose own props
 * changed — `onToggle`/`onOpen` must stay referentially stable in the parent for that to hold.
 */
const PacingRows = memo(function PacingRows({
  row,
  open,
  onToggle,
  onOpen,
  isAdmin,
  refreshCooldownSeconds,
  onRefresh,
  onRevalidate,
  onDelete,
  onOpenNsDiff,
}: {
  row: PacingRowV1;
  open: boolean;
  onToggle: (pacingId: string) => void;
  onOpen: (row: PacingRowV1) => void;
  isAdmin: boolean;
  refreshCooldownSeconds: number;
  onRefresh: (row: PacingRowV1) => void;
  onRevalidate: (row: PacingRowV1) => void;
  onDelete: (row: PacingRowV1) => void;
  onOpenNsDiff: (row: PacingRowV1) => void;
}) {
  const statusStyle = PACING_STATUS_STYLE[row.status] ?? { color: "var(--muted)" };
  const pp = row.pacingDeviationPct;
  const isUnder = pp != null && pp < -5;
  const isOver = pp != null && pp > 5;
  const canOpen = pacingRoute(row) !== null;
  const subtitle = [row.agency, row.client].filter(Boolean).join(" · ");
  const delegatedTo = row.delegatedTo ?? [];

  return (
    <>
      <tr
        className={cn("overview__row", isUnder && "overview__row--under", isOver && "overview__row--over")}
        onClick={() => onToggle(row.id)}
      >
        <td className="overview__chevron-cell">
          <button
            type="button"
            className={cn("overview__exp", open && "overview__exp--open")}
            aria-label={open ? `Collapse ${row.name}` : `Expand ${row.name}`}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(row.id);
            }}
          >
            <ChevronRightIcon />
          </button>
        </td>
        <td>
          <div className="overview__name-line">
            <span className="overview__name" title={row.name}>
              {row.name}
            </span>
            {row.delegatedFrom && (
              <span className="overview__pill overview__pill--in" title={`Delegated to you by ${row.delegatedFrom.name}`}>
                ← {row.delegatedFrom.name}
              </span>
            )}
            {delegatedTo.length > 0 && (
              <span
                className="overview__pill overview__pill--out"
                title={`Delegated to ${delegatedTo.map((d) => d.name).join(", ")}`}
              >
                → {delegatedTo.map((d) => d.name).join(", ")}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="overview__subtitle" title={subtitle}>
              {subtitle}
            </div>
          )}
          <PeriodScopePill row={row} />
        </td>
        <td>
          <StatusBadge label={row.status} color={statusStyle.color} glow={statusStyle.glow} />
        </td>
        <td className="overview__num overview__budget">{fmtBudget(row.budgetTotal ?? 0)}</td>
        <td className="overview__num">
          <MarginCell actual={row.marginActualPct ?? null} target={row.marginTargetPct ?? 0} />
        </td>
        <td className="overview__num">
          <PacingBar pp={pp ?? null} />
        </td>
        <td className="overview__flight">
          {row.flightStart ? fmtMD(row.flightStart) : "—"}
          <span className="overview__flight-sep">–</span>
          {row.flightEnd ? fmtMD(row.flightEnd) : "—"}
          {row.daysRemaining != null && (
            <span className={cn("overview__days", row.daysRemaining <= 0 && "overview__days--out")}>
              {row.daysRemaining}d
            </span>
          )}
        </td>
        <td className="overview__num">{row.liCount ?? row.lineItemCount}</td>
        <td className="overview__num">
          <NsDiffCell row={row} />
        </td>
        <td>
          <div className="overview__actions">
            {/* The kebab is on every row, so the rightmost control is always there and the column
                stays ruled. A row that cannot navigate simply has no arrow to its left - nothing
                shifts, because the kebab (not the arrow) is what everything right-aligns against. */}
            {canOpen && (
              <button
                type="button"
                className="overview__open"
                title="Open pacing"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(row);
                }}
              >
                <ChevronRightIcon />
              </button>
            )}
            <OverviewRowMenu
              row={row}
              isAdmin={isAdmin}
              refreshCooldownSeconds={refreshCooldownSeconds}
              onRefresh={onRefresh}
              onRevalidate={onRevalidate}
              onDelete={onDelete}
              onOpenNsDiff={onOpenNsDiff}
            />
          </div>
        </td>
      </tr>
      {open && <LineItemRows row={row} />}
    </>
  );
});

/**
 * One owner's card: a header strip (owner name, pacing/LI counts, under/over badges, a per-group
 * expand-all) over the group's own table. Every group shares the page-level sort so the columns
 * behave as one table split by owner.
 */
export const OwnerSection = memo(function OwnerSection({
  group,
  openIds,
  onToggleRow,
  onToggleGroup,
  onOpen,
  sort,
  onSort,
  isAdmin,
  cooldownSecondsFor,
  onRefresh,
  onRevalidate,
  onDelete,
  onOpenNsDiff,
}: {
  group: OwnerGroup;
  openIds: ReadonlySet<string>;
  onToggleRow: (pacingId: string) => void;
  onToggleGroup: (pacingIds: string[], expand: boolean) => void;
  onOpen: (row: PacingRowV1) => void;
  sort: OverviewSort | null;
  onSort: (field: OverviewSortField) => void;
  isAdmin: boolean;
  /** Seconds left on a row's refresh cooldown; resolved here so the memoized row only re-renders
   *  while ITS OWN countdown is running. */
  cooldownSecondsFor: (pacingId: string) => number;
  onRefresh: (row: PacingRowV1) => void;
  onRevalidate: (row: PacingRowV1) => void;
  onDelete: (row: PacingRowV1) => void;
  onOpenNsDiff: (row: PacingRowV1) => void;
}) {
  const groupIds = group.rows.map((row) => row.id);
  const allOpen = groupIds.length > 0 && groupIds.every((id) => openIds.has(id));
  return (
    <section className="overview__owner-card" aria-label={`Pacings owned by ${group.owner}`}>
      <header className="overview__owner-head">
        <span className="overview__owner-name">{group.owner}</span>
        <span className="overview__owner-meta">
          {group.rows.length} pacing{group.rows.length === 1 ? "" : "s"} · {group.liTotal} LIs
        </span>
        {group.under > 0 && <span className="overview__owner-badge overview__owner-badge--under">{group.under} under</span>}
        {group.over > 0 && <span className="overview__owner-badge overview__owner-badge--over">{group.over} over</span>}
        <button
          type="button"
          className="overview__owner-toggle"
          onClick={() => onToggleGroup(groupIds, !allOpen)}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </header>
      <table className="overview__table">
        <colgroup>
          <col className="overview__col-chevron" />
          <col />
          <col className="overview__col-status" />
          <col className="overview__col-budget" />
          <col className="overview__col-margin" />
          <col className="overview__col-pacing" />
          <col className="overview__col-flight" />
          <col className="overview__col-lis" />
          <col className="overview__col-nsdiff" />
          <col className="overview__col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th />
            <SortableHeader label="Campaign" field="NAME" sort={sort} onSort={onSort} />
            <SortableHeader label="Status" field="STATUS" sort={sort} onSort={onSort} />
            <SortableHeader label="Budget" field="BUDGET" sort={sort} onSort={onSort} className="overview__num" />
            <SortableHeader label="Margin" field="MARGIN" sort={sort} onSort={onSort} className="overview__num" />
            <SortableHeader label="Pacing" field="PACING" sort={sort} onSort={onSort} className="overview__num" />
            <SortableHeader label="Flight" field="FLIGHT" sort={sort} onSort={onSort} />
            <SortableHeader label="LIs" field="LINE_ITEMS" sort={sort} onSort={onSort} className="overview__num" />
            {/* §13, US-136. Sortable on purpose: "who has drifted from NetSuite" is a question
                answered by running an eye down a column, which is exactly what the retired /pacing
                table was for. */}
            <SortableHeader label="NS diff" field="NS_DIFF" sort={sort} onSort={onSort} className="overview__num" />
            <th />
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => (
            <PacingRows
              key={row.id}
              row={row}
              open={openIds.has(row.id)}
              onToggle={onToggleRow}
              onOpen={onOpen}
              isAdmin={isAdmin}
              refreshCooldownSeconds={cooldownSecondsFor(row.id)}
              onRefresh={onRefresh}
              onRevalidate={onRevalidate}
              onDelete={onDelete}
              onOpenNsDiff={onOpenNsDiff}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
});
