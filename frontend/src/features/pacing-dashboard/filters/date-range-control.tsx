/**
 * The FilterBar's date range control (Task 2 of the 2026-09-25 filter bar brief) - FIVE segments
 * in one group, `Flight · 1d · 3d · 7d · Custom`, ported from the reference's `RANGE_TABS`
 * (`FilterBar.jsx:14`) and the render around its line 676. Replaces the previous shape (a
 * `Flight · 1d · 3d · 7d` group followed by two permanently-visible `<input type="date">` fields)
 * - the owner's words: that shape "is completely different from the reference".
 *
 * The fifth segment, Custom, IS the calendar trigger (owner ask carried over from the reference,
 * 2026-09-11): clicking it opens `DateRangePicker` anchored to it; once a complete range is
 * picked, the SAME segment stops reading "Custom" and reads back the range ("Sep 1 – Sep 10",
 * `formatRangeLabel`) with a calendar icon. Dismissing the calendar changes nothing (see
 * `customRangePatch`'s "no dangling custom" rule - only a COMPLETE pick ever calls `setFilters`).
 * Clicking the active segment reopens it (`DateRangePicker`'s own `toggle`).
 */
import { DateRangePicker, CalendarGlyph } from "../../../shared/ui/date-range-picker/date-range-picker";
import { customRangeState, customRangePatch, formatRangeLabel } from "./custom-range-core";
import type { DashboardFilters } from "./types";
import type { DashboardFiltersPatch } from "./use-url-filters";
import "./date-range-control.css";

const RANGE_TABS: { value: string; label: string }[] = [
  { value: "all", label: "Flight" },
  { value: "1", label: "1d" },
  { value: "3", label: "3d" },
  { value: "7", label: "7d" },
];

export interface DateRangeControlProps {
  filters: DashboardFilters;
  setFilters: (patch: DashboardFiltersPatch) => void;
  /** The flight window/data edge, bounding which days are pickable - the campaign's own
   *  `startDate`/`asOf ?? endDate`, mirroring the reference's `minDate`/`maxDate`
   *  (`FilterBar.jsx:476-477`, `useCampaign()`/`useFacts()`). Optional: an unbounded picker (no
   *  min/max) is still correct, just less helpful. */
  minDate?: string;
  maxDate?: string;
}

export function DateRangeControl({ filters, setFilters, minDate, maxDate }: DateRangeControlProps) {
  const { from, to, customActive, shownRange } = customRangeState(filters);

  function handleRangeTab(value: string) {
    setFilters({ range: value, customRange: { from: "", to: "" } });
  }

  function handleCalendarChange(picked: { from: string; to: string }) {
    const patch = customRangePatch(filters, picked);
    if (patch) setFilters(patch);
  }

  return (
    <div className="fb-seg" role="tablist" aria-label="Date range">
      {RANGE_TABS.map(({ value, label }) => {
        const active = shownRange === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`fb-seg__btn${active ? " fb-seg__btn--active" : ""}`}
            onClick={() => handleRangeTab(value)}
          >
            {label}
          </button>
        );
      })}

      <DateRangePicker
        value={{ from, to }}
        onChange={handleCalendarChange}
        minDate={minDate}
        maxDate={maxDate}
        popupGap={10}
        wrapperClassName="fb-seg__custom-wrap"
        renderTrigger={({ open, toggle, popupId }) => {
          const rangeLabel = customActive ? formatRangeLabel(from, to) : "";
          // Exactly one segment ever wears the selected style. While the calendar is open over
          // another range, this one only shows an "open" outline - nothing is applied yet.
          const openOnly = open && !customActive;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={customActive}
              className={`fb-seg__btn fb-seg__custom${customActive ? " fb-seg__btn--active" : ""}${openOnly ? " fb-seg__custom--open" : ""}`}
              onClick={toggle}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? popupId : undefined}
              aria-label={customActive ? `Custom date range: ${rangeLabel}` : "Custom date range"}
              title={customActive ? `${from} – ${to}` : "Pick a custom date range"}
            >
              <CalendarGlyph className="fb-seg__custom-icon" />
              <span>{customActive ? rangeLabel : "Custom"}</span>
            </button>
          );
        }}
      />
    </div>
  );
}
