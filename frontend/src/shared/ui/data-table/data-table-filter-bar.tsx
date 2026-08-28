import { cn } from "../../style/cn";
import { CalendarIcon, ChevronDownIcon, PlusIcon } from "../icons/icons";
import type { DataTableFilterBarProps } from "./data-table-filter-bar-model";

/**
 * Every dimension filter in force, plus the entry points to add or clear one - independent of which
 * dimensions the table currently shows as columns (PDI_115).
 *
 * Unlike `DataTableChips`, this renders even with zero filters: the Date pill and `+ Filter` are
 * always available, because they are how a filter gets applied in the first place now that the column
 * header's funnel is gone.
 */
export function DataTableFilterBar({
  dateLabel,
  onOpenDate,
  filters,
  onOpenFieldPicker,
  onClearAll,
  disabled = false,
}: DataTableFilterBarProps) {
  return (
    <div className="data-table__filter-bar">
      <span className="data-table__filter-bar-lead">Filters</span>
      <button
        type="button"
        className="data-table__date-pill"
        disabled={disabled}
        onClick={(event) => onOpenDate(event.currentTarget)}
      >
        <CalendarIcon className="data-table__date-pill-icon" />
        {dateLabel}
        <ChevronDownIcon className="data-table__date-pill-caret" />
      </button>
      {filters.map((filter) => (
        <span key={filter.id} className={cn("data-table__chip", filter.hiddenColumn && "data-table__chip--hidden")}>
          <button
            type="button"
            className="data-table__chip-label"
            disabled={disabled}
            title={filter.hiddenColumn ? "Filtered on a column that is not displayed" : undefined}
            aria-label={
              filter.hiddenColumn
                ? `${filter.label}: ${filter.summary} — edit filter. Filtered on a column that is not displayed.`
                : `${filter.label}: ${filter.summary} — edit filter`
            }
            onClick={(event) => filter.edit(event.currentTarget)}
          >
            {filter.label}: {filter.summary}
          </button>
          <button
            type="button"
            className="data-table__chip-clear"
            aria-label={`Clear the ${filter.label} filter`}
            disabled={disabled}
            onClick={filter.clear}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="data-table__add-filter"
        disabled={disabled}
        onClick={(event) => onOpenFieldPicker(event.currentTarget)}
      >
        <PlusIcon />
        Filter
      </button>
      {filters.length > 0 && (
        <button type="button" className="data-table__filter-clear-all" disabled={disabled} onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
