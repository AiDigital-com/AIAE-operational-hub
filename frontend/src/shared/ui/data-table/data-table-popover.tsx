import { useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { useDebounce } from "../../hooks/use-debounce";
import { SearchIcon } from "../icons/icons";
import { LoadingSpinner } from "../loading-spinner/loading-spinner";
import type { DataTableFieldPickerProps } from "./data-table-filter-bar-model";

/**
 * How long the value search waits before it filters the list.
 *
 * Short, because it filters an array already in memory rather than asking the server: the delay exists
 * only so a long list is not re-rendered on every keystroke.
 */
const VALUE_SEARCH_DEBOUNCE_MS = 150;

/** The popover's own 280px width plus the 16px margin it keeps from either viewport edge. */
const POPOVER_FOOTPRINT = 296;

/** A closed date range, either side of which may be empty to mean open-ended. */
export interface DataTableDateRange {
  from: string;
  to: string;
}

/** Both sides empty - the range that narrows nothing. */
export const NO_DATE_RANGE: DataTableDateRange = { from: "", to: "" };

/**
 * Tracks the popover's anchor so the popover follows it.
 *
 * A fixed-position popover is positioned against the viewport, so it has to be re-placed whenever the
 * header cell it was opened from moves. Scroll is listened for in the capture phase because scroll events
 * do not bubble, and what moves the header here is the table's own overflow container rather than the
 * window.
 *
 * @param anchor the element the popover hangs from
 * @returns the anchor's current viewport rect, or null before the first measurement
 */
export function useAnchorRect(anchor: HTMLElement | null): DOMRect | null {
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

/**
 * Places a popover under its anchor, kept inside the viewport's right edge.
 *
 * @param anchorRect the anchor's viewport rect, or null before it has been measured
 * @returns the fixed-position offsets
 */
export function popoverPosition(anchorRect: DOMRect | null) {
  return {
    left: Math.max(16, Math.min(anchorRect?.left ?? 16, globalThis.innerWidth - POPOVER_FOOTPRINT)),
    top: (anchorRect?.bottom ?? 0) + 6,
  };
}

interface DataTablePopoverProps {
  /** The column being filtered; titles the popover and names it to assistive technology, unless
   *  `title` overrides that heading. */
  label: string;
  /** Overrides the default "Filter — {label}" heading - the field picker's stage-1 popover (PDI_115)
   *  is not filtering any one column yet, so it reads "Add filter" instead. */
  title?: string;
  anchor: HTMLElement | null;
  children: ReactNode;
  /** Commit controls under the content. Omitted entirely (no footer strip at all) when the popover has
   *  nothing to commit - the field picker acts the moment a row is picked, with no Done to press. */
  footer?: ReactNode;
}

/**
 * The shell every column filter is drawn in: a fixed-position card under its header cell, with a title
 * naming the column and, usually, a footer holding the commit controls.
 *
 * A shell rather than a base class, because the filters drawn in it have little in common inside it - a
 * checkbox list, two date fields, a searchable field list (PDI_115) - and the only thing worth sharing
 * is that they are the same object on screen.
 */
export function DataTablePopover({ label, title, anchor, children, footer }: DataTablePopoverProps) {
  const { left, top } = popoverPosition(useAnchorRect(anchor));
  const heading = title ?? `Filter — ${label}`;

  return (
    <div className="data-table__pop" role="dialog" aria-label={heading} style={{ left, top }}>
      <h4 className="data-table__pop-title">{heading}</h4>
      {children}
      {footer != null && <div className="data-table__pop-footer">{footer}</div>}
    </div>
  );
}

export interface DataTableValueFilterProps {
  label: string;
  /** Every value the column can be narrowed to. Empty while they are still being read. */
  values: readonly string[];
  /** The values already applied, which the popover opens with staged. */
  initialSelected: readonly string[];
  isPending?: boolean;
  /** Already formatted by the consumer, which owns what its own read failures read as. */
  errorMessage?: string;
  anchor: HTMLElement | null;
  onApply: (values: string[]) => void;
  onClose: () => void;
}

/**
 * A column's value filter: search, select all/clear, and a checkbox per distinct value.
 *
 * Staged locally and committed on Done, so checking four boxes is one read of the table rather than four.
 *
 * The values are a prop rather than something this component fetches: the two tables read their distinct
 * values from different endpoints, and that is the only thing that differs between them. Passing the list
 * in is what lets the rest - the staging, the search, the markup - exist once.
 */
export function DataTableValueFilterPopover({
  label,
  values,
  initialSelected,
  isPending = false,
  errorMessage,
  anchor,
  onApply,
  onClose,
}: DataTableValueFilterProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([...initialSelected]);
  const debouncedQuery = useDebounce(query, VALUE_SEARCH_DEBOUNCE_MS);
  const needle = debouncedQuery.trim().toLowerCase();
  const items = needle ? values.filter((value) => value.toLowerCase().includes(needle)) : values;

  function toggle(value: string, checked: boolean) {
    setSelected((current) => (checked ? [...current, value] : current.filter((item) => item !== value)));
  }

  return (
    <DataTablePopover
      label={label}
      anchor={anchor}
      footer={
        <button
          type="button"
          className="button button--primary button--sm"
          onClick={() => {
            onApply(selected);
            onClose();
          }}
        >
          Done
        </button>
      }
    >
      <div className="data-table__pop-search">
        <SearchIcon />
        <input
          placeholder="Search…"
          aria-label={`Search ${label.toLowerCase()} values`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="data-table__pop-actions">
        <button type="button" onClick={() => setSelected([...values])}>Select all</button>
        <button type="button" onClick={() => setSelected([])}>Clear</button>
      </div>
      {isPending && (
        <div className="data-table__pop-loading">
          <LoadingSpinner label="Loading values" size="sm" />
        </div>
      )}
      {errorMessage != null && <p className="form-error">{errorMessage}</p>}
      {!isPending && errorMessage == null && (
        <div className="data-table__pop-list">
          {items.length === 0 && <div className="data-table__pop-empty">No matches for &ldquo;{query}&rdquo;.</div>}
          {items.map((value) => (
            <label key={value} className="data-table__pop-check">
              <input
                type="checkbox"
                checked={selected.includes(value)}
                onChange={(event) => toggle(value, event.target.checked)}
              />
              {value}
            </label>
          ))}
        </div>
      )}
    </DataTablePopover>
  );
}

export interface DataTableDateFilterProps {
  label?: string;
  range: DataTableDateRange;
  /** Said under the fields - the dates the dataset actually covers, when the consumer knows them. */
  hint?: ReactNode;
  anchor: HTMLElement | null;
  onApply: (range: DataTableDateRange) => void;
  onClose: () => void;
}

/**
 * The date column's filter: two native date pickers instead of a checkbox per distinct date.
 *
 * Native `<input type="date">` rather than a hand-built month grid - the same control the Setup tab's
 * add-line form already uses. It brings its own calendar, keyboard handling and locale. What a custom grid
 * would add is per-day shading for days with no data; that is a lot of bespoke UI for a hint, and the
 * hint below says the same thing in a line of text.
 *
 * The fields clamp each other - From cannot pass To - but neither is clamped to the dataset's own bounds,
 * though the consumer may know them. Clamping to them read well until the dataset was one day wide, at
 * which point the picker offered exactly that day and refused every keystroke; a control you cannot type
 * into is worse than one that lets you ask for a range with nothing in it. An impossible range is caught
 * below instead, and a window outside the data simply matches nothing.
 *
 * Staged locally and committed on Done, so picking a start date does not fire a read before the end date
 * is chosen.
 */
export function DataTableDateFilterPopover({
  label = "Date",
  range: applied,
  hint,
  anchor,
  onApply,
  onClose,
}: DataTableDateFilterProps) {
  const [draft, setDraft] = useState<DataTableDateRange>(applied);
  const inverted = draft.from !== "" && draft.to !== "" && draft.from > draft.to;

  return (
    <DataTablePopover
      label={label}
      anchor={anchor}
      footer={
        <>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => {
              onApply(NO_DATE_RANGE);
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
        </>
      }
    >
      <div className="data-table__pop-dates">
        <label className="data-table__pop-date">
          <span>From</span>
          <input
            className="input"
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="data-table__pop-date">
          <span>To</span>
          <input
            className="input"
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        {hint != null && <p className="data-table__pop-hint">{hint}</p>}
        {inverted && <p className="form-error">The start date is after the end date.</p>}
      </div>
    </DataTablePopover>
  );
}

/**
 * Stage 1 of the Filters bar's `+ Filter` control (PDI_115): a searchable list of every dimension,
 * shown or not. Picking one hands off to {@link DataTableValueFilterPopover} for stage 2 via `onPick`
 * alone - the consumer swaps popover state, so this popover never calls a separate close and never
 * shows both stages at once. It commits nothing itself, so it has no footer/Done of its own; dismissing
 * it without picking anything is the same outside-click handling every other popover here relies on.
 */
export function DataTableFieldPickerPopover({ fields, filteredIds, anchor, onPick }: DataTableFieldPickerProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, VALUE_SEARCH_DEBOUNCE_MS);
  const needle = debouncedQuery.trim().toLowerCase();
  const items = fields
    .filter((field) => field.label.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <DataTablePopover label="Add filter" title="Add filter" anchor={anchor}>
      <div className="data-table__pop-search">
        <SearchIcon />
        <input
          placeholder="Search fields…"
          aria-label="Search fields"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="data-table__pop-list">
        {items.length === 0 && <div className="data-table__pop-empty">No matches for &ldquo;{query}&rdquo;.</div>}
        {items.map((field) => (
          <button
            key={field.id}
            type="button"
            className="data-table__pop-field-row"
            onClick={() => onPick(field.id)}
          >
            <span className="data-table__pop-field-text">
              <span className="data-table__pop-field-label">{field.label}</span>
              {field.description != null && (
                <span className="data-table__pop-field-desc">{field.description}</span>
              )}
            </span>
            {filteredIds.includes(field.id) && <span className="data-table__pop-field-badge">Filtered</span>}
          </button>
        ))}
      </div>
    </DataTablePopover>
  );
}
