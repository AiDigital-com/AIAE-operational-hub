import { useEffect, useRef, useState } from "react";
import { cn } from "../../style/cn";
import { formatError } from "../../format/error";
import { ChevronRightIcon, SearchIcon } from "../icons/icons";
import { LoadingSpinner } from "../loading-spinner/loading-spinner";
import "./multi-select.css";

/** One selectable option. `id` is the stable value reported back through `onChange`. */
export interface MultiSelectOption {
  id: number;
  label: string;
}

interface MultiSelectProps {
  /** Accessible name of the control, also the label shown when nothing is selected. */
  label: string;
  /** The options to show for the current search term. */
  options: MultiSelectOption[];
  /** Currently selected ids. Selected options stay listed even when the search term excludes them. */
  selected: number[];
  onChange: (selected: number[]) => void;
  /** Raw search input value, owned by the caller so it can drive a debounced server-side search. */
  search: string;
  onSearchChange: (search: string) => void;
  searchPlaceholder?: string;
  isPending?: boolean;
  error?: unknown;
  /** Set when more options exist than are loaded; `onLoadMore` fetches the next page. */
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  className?: string;
}

/**
 * A searchable multi-select dropdown: a trigger summarizing the selection, and a popover with a search
 * box and a checkbox per option.
 *
 * Searching is delegated to the caller (`search`/`onSearchChange`) rather than filtering `options`
 * here, so a long list can be searched on the server instead of being fully preloaded just to filter
 * it client-side. Options already selected are always listed, even when the current term wouldn't match
 * them, so a selection can never become invisible-but-active.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  isPending,
  error,
  hasMore,
  isLoadingMore,
  onLoadMore,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Selected options are remembered by id->label so a chosen option can still be listed (and
  // de-selectable) after a search term stops returning it.
  const labelsRef = useRef(new Map<number, string>());
  for (const option of options) {
    labelsRef.current.set(option.id, option.label);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(id: number, on: boolean) {
    onChange(on ? [...selected, id] : selected.filter((value) => value !== id));
  }

  const selectedNotListed = selected.filter((id) => !options.some((option) => option.id === id));
  const rows: MultiSelectOption[] = [
    ...selectedNotListed.map((id) => ({ id, label: labelsRef.current.get(id) ?? String(id) })),
    ...options,
  ];

  const summary =
    selected.length === 0
      ? label
      : selected.length === 1
        ? labelsRef.current.get(selected[0]) ?? `1 selected`
        : `${selected.length} selected`;

  return (
    <div className={cn("multi-select", className)} ref={rootRef}>
      <button
        type="button"
        className={cn("multi-select__trigger", selected.length > 0 && "multi-select__trigger--active")}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="multi-select__summary">{summary}</span>
        {selected.length > 0 && (
          <span
            className="multi-select__clear"
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onChange([]);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onChange([]);
              }
            }}
          >
            ✕
          </span>
        )}
        <ChevronRightIcon className="multi-select__chev" />
      </button>

      {open && (
        <div className="multi-select__pop" role="dialog" aria-label={label}>
          <label className="multi-select__search">
            <SearchIcon />
            <input
              autoFocus
              type="search"
              placeholder={searchPlaceholder}
              aria-label={`Search ${label.toLowerCase()}`}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>

          {error != null && <p className="form-error multi-select__error">{formatError(error)}</p>}

          {isPending ? (
            <div className="multi-select__loading">
              <LoadingSpinner label={`Loading ${label.toLowerCase()}`} size="sm" />
            </div>
          ) : (
            <div className="multi-select__list">
              {rows.length === 0 && (
                <div className="multi-select__empty">
                  {search ? `No matches for “${search}”.` : "Nothing to choose from."}
                </div>
              )}
              {rows.map((option) => (
                <label key={option.id} className="multi-select__check">
                  <input
                    type="checkbox"
                    checked={selected.includes(option.id)}
                    onChange={(event) => toggle(option.id, event.target.checked)}
                  />
                  <span className="multi-select__check-label">{option.label}</span>
                </label>
              ))}
              {hasMore && (
                <button
                  type="button"
                  className="multi-select__more"
                  disabled={isLoadingMore}
                  onClick={onLoadMore}
                >
                  {isLoadingMore ? <LoadingSpinner label="Loading more" size="sm" /> : "Load more"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
