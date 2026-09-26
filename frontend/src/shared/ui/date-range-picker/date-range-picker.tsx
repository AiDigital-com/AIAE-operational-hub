/**
 * A two-month calendar popup for picking a `{from, to}` date range. Ported from the retired
 * Pacing SPA's `workspace/src/components/ui/DateRangePicker.jsx` (Tailwind + inline styles) to
 * BEM + TypeScript, behaviour first - the same month-grid math, the same click-once-for-start,
 * click-again-for-end interaction, the same viewport-aware portal positioning `Tooltip`
 * (`shared/ui/tooltip/tooltip.tsx`) already uses in this project (measured, not guessed: laid out
 * off-screen first, then placed below/above and clamped to the window).
 *
 * Task 2 of the 2026-09-25 filter bar brief: the reference's FilterBar Custom segment IS this
 * picker's trigger (`renderTrigger`) - see `filters/date-range-control.tsx`, which is the one
 * caller today. Kept general (a default button trigger too) because a calendar range picker is
 * exactly the kind of primitive other screens end up wanting.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../style/cn";
import "./date-range-picker.css";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const POPUP_GAP = 6;
const VIEWPORT_PAD = 8;

export interface DateRange {
  from: string;
  to: string;
}

interface YearMonth {
  year: number;
  month: number; // 0-based
}

interface Cell {
  day: number;
  current: boolean;
  ymd: string;
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseYmd(value: string | null | undefined): YearMonth & { d: number } | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m - 1, d };
}

function shiftMonth(year: number, month: number, delta: number): YearMonth {
  const next = new Date(Date.UTC(year, month + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
}

function formatDisplay(value: string): string {
  if (!value) return "";
  return `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
}

function buildCells(viewYear: number, viewMonth: number): Cell[] {
  const cells: Cell[] = [];
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const prev = shiftMonth(viewYear, viewMonth, -1);
  const next = shiftMonth(viewYear, viewMonth, 1);
  const prevMonthDays = new Date(Date.UTC(prev.year, prev.month + 1, 0)).getUTCDate();

  for (let i = firstDow - 1; i >= 0; i -= 1) {
    const day = prevMonthDays - i;
    cells.push({ day, current: false, ymd: toYmd(prev.year, prev.month, day) });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ day, current: true, ymd: toYmd(viewYear, viewMonth, day) });
  }
  while (cells.length < 42) {
    const day = cells.length - daysInMonth - firstDow + 1;
    cells.push({ day, current: false, ymd: toYmd(next.year, next.month, day) });
  }
  return cells;
}

function monthHasSelectableDays(year: number, month: number, minDate?: string, maxDate?: string): boolean {
  const monthStart = toYmd(year, month, 1);
  const monthEnd = toYmd(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  if (minDate && monthEnd < minDate) return false;
  if (maxDate && monthStart > maxDate) return false;
  return true;
}

function todayYmd(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export interface DateRangePickerTriggerProps {
  open: boolean;
  toggle: () => void;
  valueLabel: string;
  popupId: string;
}

export interface DateRangePickerProps {
  value: DateRange | null | undefined;
  onChange: (range: DateRange) => void;
  minDate?: string;
  maxDate?: string;
  placeholder?: string;
  fullWidth?: boolean;
  /** An external trigger (e.g. the FilterBar's Custom segment): rendered in place of the default
   *  button, so the popup positions against it. Callers that omit this get the default button. */
  renderTrigger?: (props: DateRangePickerTriggerProps) => ReactNode;
  wrapperClassName?: string;
  popupGap?: number;
}

export function DateRangePicker({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "Select range",
  fullWidth = false,
  renderTrigger,
  wrapperClassName,
  popupGap = POPUP_GAP,
}: DateRangePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const popupRef = useRef<HTMLDivElement>(null);
  const resolvedValue = value ?? { from: "", to: "" };
  const fallbackToday = todayYmd();
  const initialAnchor = resolvedValue.to || resolvedValue.from || maxDate || minDate || fallbackToday;
  const parsedAnchor = parseYmd(initialAnchor) ?? parseYmd(fallbackToday);

  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(resolvedValue.from || "");
  const [draftTo, setDraftTo] = useState(resolvedValue.to || "");
  const [viewMonth, setViewMonth] = useState(parsedAnchor?.month ?? 0);
  const [viewYear, setViewYear] = useState(parsedAnchor?.year ?? 1970);
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setDraftFrom(resolvedValue.from || "");
    setDraftTo(resolvedValue.to || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedValue.from, resolvedValue.to]);

  useEffect(() => {
    if (!open) {
      const nextAnchor = parseYmd(resolvedValue.to || resolvedValue.from || maxDate || minDate || initialAnchor);
      if (nextAnchor) {
        setViewMonth(nextAnchor.month);
        setViewYear(nextAnchor.year);
      }
      // A half pick does not outlive the popup: closing without a complete range drops the
      // orphan start, so the next open starts from the applied value.
      setDraftFrom(resolvedValue.from || "");
      setDraftTo(resolvedValue.to || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedValue.from, resolvedValue.to, minDate, maxDate, open]);

  function closeToTrigger() {
    setOpen(false);
    const trigger = ref.current?.querySelector<HTMLButtonElement>("button");
    trigger?.focus?.();
  }

  const focusedThisOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      focusedThisOpenRef.current = false;
      return;
    }
    if (focusedThisOpenRef.current || !popupPosition) return;
    if (popupRef.current) {
      focusedThisOpenRef.current = true;
      popupRef.current.focus({ preventScroll: true });
    }
  }, [open, popupPosition]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      const inTrigger = !!ref.current && ref.current.contains(target);
      const inPopup = !!popupRef.current && popupRef.current.contains(target);
      if (!inTrigger && !inPopup) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeToTrigger();
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      window.addEventListener("keydown", handleKey);
    }
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;

    function updatePosition() {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const popupW = popupRef.current?.offsetWidth || Math.min(560, window.innerWidth - 2 * VIEWPORT_PAD);
      const popupH = popupRef.current?.offsetHeight || 420;
      const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - popupW - VIEWPORT_PAD);
      const left = Math.min(Math.max(VIEWPORT_PAD, rect.left), maxLeft);

      let top = rect.bottom + popupGap;
      const fitsBelow = top + popupH <= window.innerHeight - VIEWPORT_PAD;
      const fitsAbove = rect.top - popupH - popupGap >= VIEWPORT_PAD;
      if (!fitsBelow && fitsAbove) {
        top = rect.top - popupH - popupGap;
      } else if (!fitsBelow) {
        top = Math.max(VIEWPORT_PAD, window.innerHeight - popupH - VIEWPORT_PAD);
      }
      setPopupPosition({ top, left });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, viewMonth, viewYear, popupGap]);

  const canGoPrev = useMemo(() => {
    const { year, month } = shiftMonth(viewYear, viewMonth, -1);
    return monthHasSelectableDays(year, month, minDate, maxDate);
  }, [viewYear, viewMonth, minDate, maxDate]);
  const canGoNext = useMemo(() => {
    const { year, month } = shiftMonth(viewYear, viewMonth, 1);
    return monthHasSelectableDays(year, month, minDate, maxDate);
  }, [viewYear, viewMonth, minDate, maxDate]);

  const months = useMemo(() => {
    const first = { year: viewYear, month: viewMonth };
    const second = shiftMonth(viewYear, viewMonth, 1);
    return [
      { ...first, cells: buildCells(first.year, first.month) },
      { ...second, cells: buildCells(second.year, second.month) },
    ];
  }, [viewYear, viewMonth]);

  const valueLabel =
    resolvedValue.from && resolvedValue.to ? `${formatDisplay(resolvedValue.from)} — ${formatDisplay(resolvedValue.to)}` : "";

  function isDisabled(ymd: string): boolean {
    if (!ymd) return true;
    if (minDate && ymd < minDate) return true;
    if (maxDate && ymd > maxDate) return true;
    return false;
  }

  function navMonth(delta: number) {
    const next = shiftMonth(viewYear, viewMonth, delta);
    if (!monthHasSelectableDays(next.year, next.month, minDate, maxDate)) return;
    setViewMonth(next.month);
    setViewYear(next.year);
  }

  function handlePick(ymd: string) {
    if (isDisabled(ymd)) return;
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(ymd);
      setDraftTo("");
      const picked = parseYmd(ymd);
      if (picked) {
        setViewMonth(picked.month);
        setViewYear(picked.year);
      }
      return;
    }
    const next = ymd < draftFrom ? { from: ymd, to: draftFrom } : { from: draftFrom, to: ymd };
    setDraftFrom(next.from);
    setDraftTo(next.to);
    onChange(next);
    closeToTrigger();
  }

  function handleClear() {
    setDraftFrom("");
    setDraftTo("");
    onChange({ from: "", to: "" });
    closeToTrigger();
  }

  return (
    <div ref={ref} className={cn("drp", fullWidth && "drp--full", wrapperClassName)}>
      {renderTrigger ? (
        renderTrigger({ open, toggle: () => setOpen((c) => !c), valueLabel, popupId })
      ) : (
        <button
          type="button"
          className="drp__trigger"
          onClick={() => setOpen((c) => !c)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
        >
          <CalendarGlyph />
          <span className="drp__trigger-label">{valueLabel || placeholder}</span>
        </button>
      )}

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popupRef}
            id={popupId}
            role="dialog"
            aria-label="Select date range"
            tabIndex={-1}
            data-drp-popup="1"
            className="drp__popup"
            style={{
              top: popupPosition?.top ?? 0,
              left: popupPosition?.left ?? 0,
              visibility: popupPosition ? "visible" : "hidden",
            }}
          >
            <div className="drp__nav">
              <button type="button" onClick={() => navMonth(-1)} disabled={!canGoPrev} className="drp__nav-btn" aria-label="Previous month">
                ‹
              </button>
              <div className="drp__nav-title">Select range</div>
              <button type="button" onClick={() => navMonth(1)} disabled={!canGoNext} className="drp__nav-btn" aria-label="Next month">
                ›
              </button>
            </div>

            <div className="drp__months">
              {months.map((monthModel) => (
                <div key={`${monthModel.year}-${monthModel.month}`} className="drp__month">
                  <div className="drp__month-title">
                    {MONTHS[monthModel.month]} {monthModel.year}
                  </div>
                  <div className="drp__weekdays">
                    {DAYS.map((day) => (
                      <div key={`${monthModel.year}-${monthModel.month}-${day}`} className="drp__weekday">
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="drp__grid">
                    {monthModel.cells.map((cell, index) => {
                      const disabled = isDisabled(cell.ymd);
                      const isStart = !!cell.ymd && cell.ymd === draftFrom;
                      const isEnd = !!cell.ymd && cell.ymd === draftTo;
                      const inRange = !!(cell.ymd && draftFrom && draftTo && cell.ymd > draftFrom && cell.ymd < draftTo);
                      const isAnchor = isStart || isEnd;
                      return (
                        <button
                          type="button"
                          key={`${monthModel.year}-${monthModel.month}-${index}`}
                          disabled={disabled}
                          onClick={() => cell.ymd && handlePick(cell.ymd)}
                          // A day number ("1"-"31") repeats across the two visible months' padding
                          // cells, so it can't identify a cell on its own - data-ymd is the stable
                          // hook both this component's own tests and callers' integration tests
                          // (e.g. filters/date-range-control.test.tsx) query by.
                          data-ymd={cell.ymd}
                          className={cn(
                            "drp__day",
                            !cell.current && "drp__day--outside",
                            isAnchor && "drp__day--anchor",
                            inRange && "drp__day--in-range"
                          )}
                        >
                          {cell.day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="drp__footer">
              <div className="drp__footer-status">
                {draftFrom && !draftTo
                  ? `Start: ${formatDisplay(draftFrom)}. Pick an end date.`
                  : draftFrom && draftTo
                    ? `${formatDisplay(draftFrom)} — ${formatDisplay(draftTo)}`
                    : "Pick a start date, then an end date."}
              </div>
              {(minDate || maxDate) && (
                <div className="drp__footer-range">
                  Available: {formatDisplay(minDate || "")} — {formatDisplay(maxDate || "")}
                </div>
              )}
              <div className="drp__footer-actions">
                <button type="button" onClick={handleClear} className="drp__btn drp__btn--reset">
                  Reset
                </button>
                <button type="button" onClick={closeToTrigger} className="drp__btn drp__btn--close">
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export function CalendarGlyph({ className }: { className?: string } = {}) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className ?? "drp__calendar-glyph"}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 1.5V4M11 1.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
