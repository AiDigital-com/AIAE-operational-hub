/** One dimension the Filters bar's field picker can offer, as it lists every dimension regardless of
 *  whether the table currently shows it as a column (PDI_115). */
export interface FilterField {
  id: string;
  label: string;
  description?: string;
}

/** One filter in force, as the Filters bar renders its chip (PDI_115).
 *
 * Filters no longer disappear when their dimension leaves the table's displayed columns, so the chip
 * carries everything needed to explain and act on a filter whether or not its column is on screen:
 * `hiddenColumn` drives the dashed, explained treatment, and `edit`/`clear` are the chip's own two
 * gestures - reopen the value popover staged with the current selection, or drop the filter outright.
 */
export interface AppliedFilter {
  id: string;
  label: string;
  /** What the dimension was narrowed to, in as few words as it takes. */
  summary: string;
  /** True when the dimension is not one of the table's currently displayed columns. */
  hiddenColumn: boolean;
  /** Reopens this filter's value popover, staged with its current selection, anchored under the
   *  element the click came from - the same anchor convention every other popover trigger in this
   *  module already follows. */
  edit: (anchor: HTMLElement) => void;
  /** Removes the filter outright, with no popover involved. */
  clear: () => void;
}

export interface DataTableFilterBarProps {
  /** "All dates" when unset, or the applied window in words. */
  dateLabel: string;
  onOpenDate: (anchor: HTMLElement) => void;
  filters: readonly AppliedFilter[];
  onOpenFieldPicker: (anchor: HTMLElement) => void;
  onClearAll: () => void;
  /** Off while the table is being edited - a filter changed under an open edit would re-read the rows
   *  out from under it. */
  disabled?: boolean;
}

export interface DataTableFieldPickerProps {
  /** Every dimension the bar can filter by - the full vocabulary, not only the table's current columns
   *  (PDI_115: filtering must reach a dimension that is not displayed). */
  fields: readonly FilterField[];
  /** Ids that already carry a filter, marked with a badge so the picker doubles as an editor. */
  filteredIds: readonly string[];
  anchor: HTMLElement | null;
  onPick: (fieldId: string) => void;
}
