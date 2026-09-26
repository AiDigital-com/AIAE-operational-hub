/**
 * Ported from the retired SPA's `workspace/src/pages/Dashboard/components/FilterBar.jsx` (854
 * lines, Tailwind + inline styles) to BEM + TypeScript, behaviour first: the controls for the
 * filter set `useUrlFilters` carries (`range`/`customRange`, `channels`, `labels`, `platforms`),
 * the active-filter chips for every filter including the ones this bar has no picker for
 * (`selection`, `brk`/`brkf` - set by an LI-card click or a journal tag, §15/STEP 8), and clearing.
 *
 * `FilterSpotlight.jsx`/`filter-spotlight-core.js` (the spotlight search, deferred at the time this
 * docblock was first written) are now ported too - `spotlight.tsx`/`spotlight-core.ts`, the first
 * control in `.fb__controls` below (2026-09-25 filter bar brief, Task 1).
 *
 * The date range control was also ported to the reference's real shape (Task 2 of the same
 * brief): FIVE segments in one group, `date-range-control.tsx`, replacing the earlier
 * `Flight · 1d · 3d · 7d` group plus two permanently-visible `<input type="date">` fields (a
 * deliberate simplification at the time, since reverted - the owner's words then: "completely
 * different from the reference"). The calendar itself is `shared/ui/date-range-picker/` - see
 * `date-range-control.tsx`'s own docblock for why a real ported calendar was chosen over a
 * cheaper native-input popover.
 *
 * Still deliberately NOT ported: the Scope/Lens chip TIERING that depended on
 * `filter-spotlight-core.js`'s `classifyActive` (chips render as one flat row here instead of two
 * bordered tiers - a deliberate simplification, not an oversight: the tiering is cosmetic
 * grouping, not a filter behaviour - the spotlight's OWN Scope/Lens tags are a separate thing, see
 * `spotlight-core.ts`), and `PeriodPicker`/the Full-Flight/Period-Scope toggle (container
 * period-scope is out of scope - see `filters/eff-lis.ts`'s docblock).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { derivePlatforms, formatPlatform } from "../journal/fact-dims";
import type { FactRow } from "../journal/fact-dims";
import type { PacingLineItemPlanV1 } from "../types";
import { formatRangeLabel } from "./custom-range-core";
import { DateRangeControl } from "./date-range-control";
import { Spotlight } from "./spotlight";
import type { DashboardFilters } from "./types";
import type { DashboardFiltersPatch } from "./use-url-filters";
import "./filter-bar.css";

function deriveChannels(liPlan: Record<string, PacingLineItemPlanV1> | null | undefined): string[] {
  if (!liPlan) return [];
  return [...new Set(Object.values(liPlan).map((plan) => plan.channel).filter((c): c is string => !!c))].sort();
}

function deriveLabels(liPlan: Record<string, PacingLineItemPlanV1> | null | undefined): string[] {
  if (!liPlan) return [];
  const all = new Set<string>();
  for (const plan of Object.values(liPlan)) {
    if (Array.isArray(plan.labels)) plan.labels.forEach((label) => all.add(label));
  }
  return [...all].sort();
}

/** Closes an open popup on an outside click - the reference's `useDismissableLayer`, ported
 *  directly (a plain `useEffect`, nothing more). */
function useDismissableLayer(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const handlerRef = useRef(onClose);
  handlerRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) handlerRef.current();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, ref]);
}

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  noun?: string;
  formatOption?: (value: string) => string;
}

function MultiSelect({ label, options, selected, onChange, noun, formatOption }: MultiSelectProps) {
  const itemNoun = noun || label.replace(/^All\s+/i, "").toLowerCase() || "items";
  const headerNoun = itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1);
  const fmt = formatOption || ((v: string) => v);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismissableLayer(ref, open, () => setOpen(false));

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter(
      (option) => option.toLowerCase().includes(normalized) || fmt(option).toLowerCase().includes(normalized)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query]);

  const buttonLabel =
    selected.length === 0 ? label : selected.length === 1 ? fmt(selected[0]) : `${selected.length} ${itemNoun}`;

  function toggle(value: string) {
    const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
    onChange(next);
  }

  if (options.length === 0) return null;

  return (
    <div ref={ref} className="fb-multiselect">
      <button
        type="button"
        className={`fb-control fb-multiselect__trigger${selected.length > 0 || open ? " fb-control--active" : ""}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="fb-multiselect__label">{buttonLabel}</span>
        <svg width="9" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true" className="fb-multiselect__caret">
          <path d="M1 1 L5 5 L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="fb-multiselect__popup">
          <div className="fb-multiselect__popup-header">
            <span className="fb-multiselect__popup-title">{headerNoun}</span>
            {selected.length > 0 && (
              <button type="button" className="fb-multiselect__popup-clear" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>

          {options.length > 8 && (
            <div className="fb-multiselect__search">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${itemNoun}...`}
              />
            </div>
          )}

          <div className="fb-multiselect__list">
            {filteredOptions.length === 0 ? (
              <div className="fb-multiselect__empty">No {itemNoun} found.</div>
            ) : (
              filteredOptions.map((option) => {
                const active = selected.includes(option);
                return (
                  <label key={option} className={`fb-multiselect__option${active ? " fb-multiselect__option--active" : ""}`}>
                    <input type="checkbox" checked={active} onChange={() => toggle(option)} />
                    <span>{fmt(option)}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type ChipType = "selection" | "channel" | "label" | "platform" | "range" | "breakdown";

interface Chip {
  type: ChipType;
  label: string;
  value: string;
  tone?: "range";
  tip?: string;
}

export interface FilterBarProps {
  filters: DashboardFilters;
  setFilters: (patch: DashboardFiltersPatch) => void;
  liPlan: Record<string, PacingLineItemPlanV1> | null | undefined;
  factsDaily: readonly FactRow[] | null | undefined;
  /** Bounds the Custom calendar's pickable days - the campaign's own flight window / data edge.
   *  Mirrors the reference's `minDate`/`maxDate` (`FilterBar.jsx:476-477`: `campaign.startDate`,
   *  `facts.asOf || campaign.endDate`). Optional - an unbounded calendar is still correct. */
  minDate?: string;
  maxDate?: string;
}

export function FilterBar({ filters, setFilters, liPlan, factsDaily, minDate, maxDate }: FilterBarProps) {
  const channels = useMemo(() => deriveChannels(liPlan), [liPlan]);
  const labels = useMemo(() => deriveLabels(liPlan), [liPlan]);
  const platforms = useMemo(() => derivePlatforms(factsDaily), [factsDaily]);

  const customActive = filters.range === "custom" && !!filters.customRange.from && !!filters.customRange.to;

  const hasFilters =
    filters.range !== "all" ||
    filters.channels.length > 0 ||
    filters.labels.length > 0 ||
    filters.platforms.length > 0 ||
    filters.selection.length > 0 ||
    filters.brkf.length > 0;

  // Pinned-to-the-top state, for the squared-off corners and deeper shadow the reference shows
  // once the bar detaches from the page. `position: sticky` reports nothing about being stuck, so
  // the sentinel above the bar is watched instead: it leaves the viewport exactly when the bar
  // pins. Threshold 0 on the default (viewport) root; no observer support means simply never
  // styled as stuck, which is the unpinned look and harmless.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  function handleClear() {
    setFilters({
      range: "all",
      customRange: { from: "", to: "" },
      channels: [],
      labels: [],
      platforms: [],
      selection: [],
      brk: "",
      brkf: [],
    });
  }

  function removePill(type: ChipType, value: string) {
    if (type === "channel") setFilters({ channels: filters.channels.filter((c) => c !== value), selection: [] });
    else if (type === "label") setFilters({ labels: filters.labels.filter((l) => l !== value) });
    else if (type === "platform") setFilters({ platforms: filters.platforms.filter((p) => p !== value) });
    else if (type === "selection") setFilters({ selection: filters.selection.filter((id) => id !== value) });
    else if (type === "range") setFilters({ range: "all", customRange: { from: "", to: "" } });
    else if (type === "breakdown") setFilters({ brkf: filters.brkf.filter((p) => p !== value) });
  }

  const chips: Chip[] = [];
  for (const id of filters.selection) chips.push({ type: "selection", label: `LI ${id}`, value: id });
  for (const c of filters.channels) chips.push({ type: "channel", label: c, value: c });
  for (const l of filters.labels) chips.push({ type: "label", label: l, value: l });
  for (const p of filters.platforms) {
    chips.push({
      type: "platform",
      label: formatPlatform(p),
      value: p,
      tip: "Delivery numbers are platform-filtered. Status and pacing math still reflect the full line item.",
    });
  }
  for (const pair of filters.brkf) {
    const idx = pair.indexOf(":");
    chips.push({
      type: "breakdown",
      label: idx > 0 ? `${pair.slice(0, idx)}: ${pair.slice(idx + 1)}` : pair,
      value: pair,
    });
  }
  if (filters.range !== "all") {
    if (customActive) {
      // Same compact label the Custom segment itself reads back (`formatRangeLabel`,
      // `FilterBar.jsx:612` in the reference) - the raw ISO strings this used to show didn't
      // match what the segment right above the chip already says.
      chips.push({
        type: "range",
        label: formatRangeLabel(filters.customRange.from, filters.customRange.to),
        value: filters.range,
        tone: "range",
      });
    } else if (filters.range !== "custom") {
      chips.push({ type: "range", label: `${filters.range}d`, value: filters.range, tone: "range" });
    }
  }

  return (
    <>
      {/* A 1px sentinel immediately above the bar, pulled back out of the flow by its own
          negative margin. Once it scrolls off, the sticky bar is pinned - which `position:
          sticky` itself gives no way to detect. Same device the reference's FilterBar uses.

          Sentinel and bar are deliberately kept as TWO separate flex children of `.pdash`, not
          wrapped in one element (tried first, reverted - see git history / the 2026-09-25 note
          below): a wrapper sized to just these two (52px) becomes `.fb`'s sticky containing
          block, and a containing block that short gives the sticky element no room to travel -
          it stops pinning at all (`top` stays negative while scrolled, `.fb--stuck` still gets
          added by the IntersectionObserver, but the element visually scrolls away - caught live,
          not in a screenshot). Keeping `.pdash` itself as the sticky containing block (3500+px
          tall) is what makes pinning work at all, so the sentinel stays a direct sibling and the
          double-gap this produces (`.pdash`'s `gap` lands on both sides of it) is cancelled in
          CSS instead - see `.fb__sentinel`'s `margin-top` below. */}
      <div ref={sentinelRef} className="fb__sentinel" aria-hidden="true" />
      <div className={`fb${hasFilters ? " fb--active" : ""}${stuck ? " fb--stuck" : ""}`}>
      <div className="fb__row">
        <div className="fb__controls">
          <Spotlight filters={filters} onApply={setFilters} liPlan={liPlan} factsDaily={factsDaily} />

          {channels.length > 0 && (
            <MultiSelect
              label="All Channels"
              options={channels}
              selected={filters.channels}
              onChange={(next) => setFilters({ channels: next, selection: [] })}
            />
          )}

          <MultiSelect label="All Labels" options={labels} selected={filters.labels} onChange={(next) => setFilters({ labels: next })} />

          {platforms.length > 0 && (
            <MultiSelect
              label="All Platforms"
              noun="platforms"
              options={platforms}
              selected={filters.platforms}
              onChange={(next) => setFilters({ platforms: next })}
              formatOption={formatPlatform}
            />
          )}

          <DateRangeControl filters={filters} setFilters={setFilters} minDate={minDate} maxDate={maxDate} />
        </div>
      </div>

      {chips.length > 0 && (
        <div className="fb__chips">
          {chips.map((chip, index) => (
            <span
              key={`${chip.type}-${chip.value}-${index}`}
              className={`fb-chip${chip.tone === "range" ? " fb-chip--range" : ""}`}
              title={chip.tip}
            >
              <span>{chip.label}</span>
              <button type="button" aria-label={`Remove ${chip.label} filter`} onClick={() => removePill(chip.type, chip.value)}>
                ×
              </button>
            </span>
          ))}
          <button type="button" className="fb__clear" onClick={handleClear}>
            Clear
          </button>
        </div>
      )}
      </div>
    </>
  );
}
