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
 * The Scope/Lens chip tiering IS ported (owner ask, 2026-11-03 - it had been left out as cosmetic):
 * the applied filters sit in two outlined boxes, SCOPE then LENS, through `classifyActive` with the
 * period-aware `scopeFilters`, as the reference's `TierBox` does.
 *
 * The Full Flight / Period Scope toggle and its period picker ARE ported (2026-10-14,
 * `period-scope.tsx`): shown when the containers define a period or scope is already on, as the
 * reference's `scopeVisible` is.
 *
 * The explanation panel IS ported (`explain-panel.tsx`, reference spec 2026-10-01): a spotlight row
 * or an applied chip rested on for a moment (or a chip's × focused) shows how many lines the filter
 * touches, whether it is Scope or Lens, and - for a value group - which values it stands for. The
 * sources and counts are built once here, the way the reference's `FilterBar` builds them, and
 * the chip's tier inside the panel is the period-aware one (`scopeFilters`).
 *
 * The spotlight is the reference's 2026-10-01 version (`spotlight.tsx`): an Active section, on/off
 * toggles that keep the pop-up open, counts on every row, "Show n more" / "Show all n matches".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { derivePlatforms, formatPlatform } from "../journal/fact-dims";
import type { FactRow } from "../journal/fact-dims";
import type { PacingLineItemPlanV1 } from "../types";
import { formatRangeLabel } from "./custom-range-core";
import { DateRangeControl } from "./date-range-control";
import { EXPLAIN_HOVER_DELAY_MS, EXPLAIN_PANEL_ID, ExplainPanel, type ExplainTarget } from "./explain-panel";
import { PeriodScopeControl, type PeriodScopeControlProps } from "./period-scope";
import { Spotlight } from "./spotlight";
import {
  activeItems,
  buildFilterSources,
  classifyActive,
  TIER_SENTENCES,
  countsFor,
  panelFor,
  type ExplainContent,
  type ScopeFilters,
  type SpotlightLiPlan,
} from "./spotlight-core";
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
}

/** The key `activeItems` gives the same filter, so a chip finds its explanation. */
function chipKey(chip: Chip): string {
  if (chip.type === "selection") return `li:${chip.value}`;
  if (chip.type === "breakdown") return chip.value;
  if (chip.type === "range") return "range";
  return `${chip.type}:${chip.value}`;
}

interface FilterChipProps {
  chip: Chip;
  /** Scope chips are solid (filled, full-weight text) and pace the dashboard; Lens chips are an
   *  outline, muted, and only narrow delivery. Fill and text only - never a side rail. */
  variant: "scope" | "lens";
  explain: ExplainContent | null;
  onExplain: (target: ExplainTarget | null) => void;
  onRemove: () => void;
}

/** One applied filter. Rested on for `EXPLAIN_HOVER_DELAY_MS`, or with its × focused, it shows the
 *  explanation panel - the reference's `FilterChip`, in place of the old tip text. A chip removed
 *  while its panel is up takes the panel with it; one whose text changed under it shows the new. */
function FilterChip({ chip, variant, explain, onExplain, onRemove }: FilterChipProps) {
  const chipRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownRef = useRef(false);
  const [shown, setShown] = useState(false);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = () => {
    if (shownRef.current) onExplain(null);
    shownRef.current = false;
    setShown(false);
  };
  const show = () => {
    if (!explain || !chipRef.current) return;
    onExplain({ ...explain, rect: chipRef.current.getBoundingClientRect() });
    shownRef.current = true;
    setShown(true);
  };
  const enter = () => {
    if (!explain) return;
    clearTimer();
    timer.current = setTimeout(show, EXPLAIN_HOVER_DELAY_MS);
  };
  const leave = () => {
    clearTimer();
    hide();
  };
  useEffect(
    () => () => {
      clearTimer();
      if (shownRef.current) onExplain(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(() => {
    if (shownRef.current) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explain]);
  return (
    <span
      ref={chipRef}
      className={`fb-chip${chip.tone === "range" ? " fb-chip--range" : variant === "lens" ? " fb-chip--lens" : ""}`}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <span>{chip.label}</span>
      <button
        type="button"
        aria-label={`Remove ${chip.label} filter`}
        aria-describedby={shown ? EXPLAIN_PANEL_ID : undefined}
        onClick={onRemove}
        onFocus={show}
        onBlur={leave}
      >
        ×
      </button>
    </span>
  );
}

interface TierBoxProps {
  legend: "scope" | "lens";
  hint: string;
  chips: Chip[];
  variant: "scope" | "lens";
  explainByKey: Map<string, ExplainContent>;
  onExplain: (target: ExplainTarget | null) => void;
  onRemove: (type: ChipType, value: string) => void;
}

/** One tier's applied-filter chips inside a soft outlined box (reference spec 2026-06-23): a small
 *  legend names the tier and carries its sentence as a tooltip. A FULL box border, never a left rail
 *  (project-wide stripe ban). Renders nothing when empty. */
function TierBox({ legend, hint, chips, variant, explainByKey, onExplain, onRemove }: TierBoxProps) {
  if (chips.length === 0) return null;
  return (
    <div className="fb-tier">
      {/* `ui-tip` is the moved SPA's tooltip (`spa/pacing-spa.css`), the reference legend's own. */}
      <span className="fb-tier__legend ui-tip" data-tip={hint}>
        {legend}
      </span>
      {chips.map((chip, index) => (
        <FilterChip
          key={`${chip.type}-${chip.value}-${index}`}
          chip={chip}
          variant={chip.tone === "range" ? "scope" : variant}
          explain={explainByKey.get(chipKey(chip)) ?? null}
          onExplain={onExplain}
          onRemove={() => onRemove(chip.type, chip.value)}
        />
      ))}
    </div>
  );
}

export interface FilterBarProps {
  filters: DashboardFilters;
  setFilters: (patch: DashboardFiltersPatch) => void;
  liPlan: Record<string, PacingLineItemPlanV1> | null | undefined;
  factsDaily: readonly FactRow[] | null | undefined;
  /** The custom display names by line item id (`display.liNames`), for the spotlight's line item
   *  entries - the reference's `buildFilterSources` reads them off the store's display. */
  liNames?: Record<string, string> | null;
  /** Bounds the Custom calendar's pickable days - the campaign's own flight window / data edge.
   *  Mirrors the reference's `minDate`/`maxDate` (`FilterBar.jsx:476-477`: `campaign.startDate`,
   *  `facts.asOf || campaign.endDate`). Optional - an unbounded calendar is still correct. */
  minDate?: string;
  maxDate?: string;
  /** Period scope's toggle and picker. Absent (or not `visible`) draws neither - the reference
   *  shows them only when the containers define a period or scope is already on. */
  periodScope?: PeriodScopeControlProps & { visible: boolean };
  /** Buttons at the right end of the row - the reference keeps the dashboard's settings gear there. */
  actions?: React.ReactNode;
  /** Layout mode is open: the bar stays on screen but dimmed, unclickable and NOT sticky - Layout
   *  mode's own hint bar owns the sticky slot. Set on the bar itself, never on a wrapper (a wrapper
   *  becomes the sticky containing block and the bar stops pinning - see the sentinel note below). */
  inert?: boolean;
  /** Which applied dimension cuts pace the dashboard in the current period -
   *  `spa/selectors.js:selectScopeFilters`, the board's own answer. The explanation panel says a
   *  chip's tier from it; without it every cut reads as Lens. */
  scopeFilters?: ScopeFilters | null;
}

export function FilterBar({
  filters,
  setFilters,
  liPlan,
  factsDaily,
  liNames,
  minDate,
  maxDate,
  periodScope,
  actions,
  scopeFilters = null,
  inert = false,
}: FilterBarProps) {
  const channels = useMemo(() => deriveChannels(liPlan), [liPlan]);
  const labels = useMemo(() => deriveLabels(liPlan), [liPlan]);
  const platforms = useMemo(() => derivePlatforms(factsDaily), [factsDaily]);

  // The spotlight's sources and every filter's count, built ONCE here: the spotlight rows and the
  // chips both read them, and the explanation panel is one panel. `PacingLineItemPlanV1.containers`
  // is opaque on the wire, so the plan is read through `spotlight-core.ts`'s narrower shape.
  const spotLiPlan = liPlan as unknown as Record<string, SpotlightLiPlan | null | undefined> | null | undefined;
  const sources = useMemo(
    () => buildFilterSources({ liPlan: spotLiPlan, factsDaily, liNames }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liPlan, factsDaily, liNames]
  );
  const counts = useMemo(
    () => countsFor(sources, { liPlan: spotLiPlan, factsDaily }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, liPlan, factsDaily]
  );
  const [explain, setExplain] = useState<ExplainTarget | null>(null);
  const onExplain = useCallback((target: ExplainTarget | null) => setExplain(target), []);
  // What each chip explains: the same text its spotlight row shows, keyed the way the rows are.
  const explainByKey = useMemo(() => {
    const out = new Map<string, ExplainContent>();
    for (const row of activeItems(filters, sources, scopeFilters)) {
      out.set(row.key, panelFor(row, { displayedTier: row.tier, counts, liPlan: spotLiPlan, missing: row.missing }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sources, scopeFilters, counts, liPlan]);

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

  // Tier the applied filters (reference spec 2026-06-14): Scope (plan-backed, paces the dashboard)
  // and Lens (delivery-only), with the period-aware answer for the dimension cuts. Each descriptor
  // maps to the SAME `removePill` type and label as before - only the grouping changes.
  const tiered = classifyActive(filters, null, scopeFilters);
  const descriptorToChip = (desc: { kind: string; value: string }): Chip => {
    switch (desc.kind) {
      case "li":
        return { type: "selection", label: `LI ${desc.value}`, value: desc.value };
      case "channel":
        return { type: "channel", label: desc.value, value: desc.value };
      case "label":
        return { type: "label", label: desc.value, value: desc.value };
      case "platform":
        return { type: "platform", label: formatPlatform(desc.value), value: desc.value };
      default: {
        const idx = desc.value.indexOf(":");
        return {
          type: "breakdown",
          label: idx > 0 ? `${desc.value.slice(0, idx)}: ${desc.value.slice(idx + 1)}` : desc.value,
          value: desc.value,
        };
      }
    }
  };
  const scopeChips = tiered.scope.map(descriptorToChip);
  const lensChips = tiered.lens.map(descriptorToChip);
  // The date range is not a classified source, but a window IS Scope - last among the Scope chips.
  if (filters.range !== "all") {
    if (customActive) {
      // Same compact label the Custom segment itself reads back (`formatRangeLabel`).
      scopeChips.push({
        type: "range",
        label: formatRangeLabel(filters.customRange.from, filters.customRange.to),
        value: filters.range,
        tone: "range",
      });
    } else if (filters.range !== "custom") {
      scopeChips.push({ type: "range", label: `${filters.range}d`, value: filters.range, tone: "range" });
    }
  }
  const hasChips = scopeChips.length > 0 || lensChips.length > 0;

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
      <div
        className={`fb${hasFilters ? " fb--active" : ""}${stuck && !inert ? " fb--stuck" : ""}${inert ? " fb--inert" : ""}`}
        {...(inert ? { inert: "" } : {})}
      >
      <div className="fb__row">
        <div className="fb__controls">
          <Spotlight
            sources={sources}
            counts={counts}
            filters={filters}
            scopeFilters={scopeFilters}
            liPlan={spotLiPlan}
            onApply={setFilters}
            onRemove={(type, value) => removePill(type as ChipType, value)}
            onClear={handleClear}
            onExplain={onExplain}
          />

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

          {periodScope?.visible && (
            <PeriodScopeControl
              scoped={periodScope.scoped}
              periods={periodScope.periods}
              selectedKey={periodScope.selectedKey}
              onToggle={periodScope.onToggle}
              onSelect={periodScope.onSelect}
            />
          )}
        </div>
        {actions && <div className="fb__actions">{actions}</div>}
      </div>

      {hasChips && (
        <div className="fb__chips">
          <TierBox
            legend="scope"
            hint={TIER_SENTENCES.scope}
            chips={scopeChips}
            variant="scope"
            explainByKey={explainByKey}
            onExplain={onExplain}
            onRemove={removePill}
          />
          <TierBox
            legend="lens"
            hint={TIER_SENTENCES.lens}
            chips={lensChips}
            variant="lens"
            explainByKey={explainByKey}
            onExplain={onExplain}
            onRemove={removePill}
          />
          {/* Clear sits with the chips it clears: every active filter draws a chip, so this row
              exists exactly when there is something to clear. */}
          <button type="button" className="fb__clear" onClick={handleClear}>
            Clear
          </button>
        </div>
      )}
      </div>
      <ExplainPanel target={explain} />
    </>
  );
}
