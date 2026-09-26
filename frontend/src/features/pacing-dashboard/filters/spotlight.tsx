/**
 * The FilterBar's Spotlight search (Task 1 of the 2026-09-25 filter bar brief) - one input,
 * fuzzy results across every filterable entity (line items, channels, labels, platforms,
 * breakdown dim values). Enter or a click adds the matching filter. Pure logic lives in
 * `spotlight-core.ts`; this is the React shell, ported from the retired SPA's
 * `workspace/src/pages/Dashboard/components/FilterSpotlight.jsx` to BEM + plain CSS (Tailwind +
 * inline styles there -> `spotlight.css` here), behaviour first.
 *
 * Two modes (the reference's own header comment, carried over verbatim):
 *   - EMPTY query + focus -> a two-section BROWSE list: `SCOPE - paces the dashboard`, then
 *     `LENS - breakdown only`, each sub-grouped by kind ("Line item", "Channel", ...). Headers are
 *     plain muted text - NO vertical stripe (project-wide ban).
 *   - TYPING -> a flat fuzzy search, each row still tier-tagged.
 * Keyboard nav (ArrowUp/Down, Enter, Escape) traverses the SELECTABLE rows only - header rows are
 * skipped, exactly like the reference.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFilterSources,
  browseSources,
  searchFilterSources,
  patchForSource,
  KIND_LABELS,
  type FilterSource,
  type FilterTier,
  type SpotlightLiPlan,
} from "./spotlight-core";
import type { FactRow } from "../journal/fact-dims";
import type { PacingLineItemPlanV1 } from "../types";
import type { DashboardFilters } from "./types";
import type { DashboardFiltersPatch } from "./use-url-filters";
import "./spotlight.css";

const SECTION_CAPTION: Record<FilterTier, string> = {
  scope: "SCOPE · paces the dashboard",
  lens: "LENS · breakdown only",
};

// A dim source (anything not one of these four whole-unit kinds) that is Scope-tier is backed by
// a declared split - flagged with a tiny inline "· split" marker (text, never a stripe/bar).
// Currently dormant: `spotlight-core.ts`'s `tierOf` tags every dim value LENS (2026-09-25 item 4 -
// this build has no `dim-scope.js` to back a Scope claim up), so `splitMarker` below is never true
// today. Left in place rather than deleted - it is the correct rendering for the day `tierOf` goes
// back to checking `splitKeys`, and there is nothing to fix here when that day comes.
const WHOLE_UNIT_KINDS = new Set(["li", "channel", "label", "platform"]);

type Row =
  | { kind: "section"; tier: FilterTier }
  | { kind: "group"; type: string }
  | { kind: "option"; item: FilterSource; optIdx: number };

interface BrowseModel {
  rows: Row[];
  options: FilterSource[];
}

/** Flattens the browse groups into an ordered render model: section headers, kind sub-group
 *  headers, and option rows. Option rows carry a running `optIdx` so keyboard nav can address them
 *  while skipping headers - ported from the reference's own `buildBrowseRows`. */
function buildBrowseRows(browse: { scope: FilterSource[]; lens: FilterSource[] }): BrowseModel {
  const rows: Row[] = [];
  const options: FilterSource[] = [];
  for (const tier of ["scope", "lens"] as const) {
    const group = browse[tier];
    if (!group || group.length === 0) continue;
    rows.push({ kind: "section", tier });
    let lastType: string | null = null;
    for (const item of group) {
      if (item.type !== lastType) {
        rows.push({ kind: "group", type: item.type });
        lastType = item.type;
      }
      const optIdx = options.length;
      options.push(item);
      rows.push({ kind: "option", item, optIdx });
    }
  }
  return { rows, options };
}

export interface SpotlightProps {
  filters: DashboardFilters;
  onApply: (patch: DashboardFiltersPatch) => void;
  liPlan: Record<string, PacingLineItemPlanV1> | null | undefined;
  factsDaily: readonly FactRow[] | null | undefined;
}

export function Spotlight({ filters, onApply, liPlan, factsDaily }: SpotlightProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // `PacingLineItemPlanV1.containers` is opaque on the wire (`{[key:string]:unknown}[]`, see
  // `types.ts`) - `spotlight-core.ts` reads it structurally via its own narrower `SpotlightLiPlan`
  // (see that file's docblock), the same way `build-metrics.ts`'s `toEngineRaw` treats it.
  const spotlightLiPlan = liPlan as unknown as Record<string, SpotlightLiPlan | null | undefined> | null | undefined;
  const sources = useMemo(
    () => buildFilterSources({ liPlan: spotlightLiPlan, factsDaily }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liPlan, factsDaily]
  );
  const q = query.trim();
  const results = useMemo(() => searchFilterSources(sources, query), [sources, query]);
  const browse = useMemo(() => (q ? { scope: [], lens: [] } : browseSources(sources)), [sources, q]);
  const browseModel = useMemo(() => buildBrowseRows(browse), [browse]);

  // Selectable items the keyboard traverses: search hits when typing, else the flattened browse
  // options (header rows are not selectable).
  const options = q ? results : browseModel.options;
  const browseList = browseModel.options;
  const open = focused && (results.length > 0 || browseList.length > 0);

  useEffect(() => setActiveIdx(0), [query]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setFocused(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(item: FilterSource | undefined) {
    if (!item) return;
    onApply(patchForSource(filters, item));
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "Escape") setQuery("");
      return;
    }
    const n = options.length;
    if (n === 0) {
      if (e.key === "Escape") setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(options[activeIdx]);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  const tierTag = (item: FilterSource) => (item.tier === "scope" ? "SCOPE" : "LENS");

  return (
    <div ref={ref} className="spot">
      <svg className="spot__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        placeholder="Filter anything…"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length > 0 ? `spot-opt-${activeIdx}` : undefined}
        className={`spot__input${query ? " spot__input--filled" : ""}`}
      />
      {open && (
        <div role="listbox" className="spot__popup">
          {q
            ? results.map((item, i) => (
                <SpotlightOption
                  key={`${item.type}:${item.value}`}
                  item={item}
                  optIdx={i}
                  active={i === activeIdx}
                  showTier
                  onPick={pick}
                  onHover={setActiveIdx}
                  tierTag={tierTag}
                />
              ))
            : browseModel.rows.map((row) => {
                if (row.kind === "section") {
                  return (
                    <div key={`sec:${row.tier}`} aria-hidden="true" className="spot__section">
                      {SECTION_CAPTION[row.tier]}
                    </div>
                  );
                }
                if (row.kind === "group") {
                  return (
                    <div key={`grp:${row.type}`} aria-hidden="true" className="spot__group">
                      {KIND_LABELS[row.type] || row.type}
                    </div>
                  );
                }
                return (
                  <SpotlightOption
                    key={`${row.item.type}:${row.item.value}`}
                    item={row.item}
                    optIdx={row.optIdx}
                    active={row.optIdx === activeIdx}
                    onPick={pick}
                    onHover={setActiveIdx}
                    tierTag={tierTag}
                  />
                );
              })}
        </div>
      )}
    </div>
  );
}

interface SpotlightOptionProps {
  item: FilterSource;
  optIdx: number;
  active: boolean;
  showTier?: boolean;
  onPick: (item: FilterSource) => void;
  onHover: (optIdx: number) => void;
  tierTag: (item: FilterSource) => string;
}

/** One selectable result/browse row. Left: display (+ a tiny inline "· split" marker for
 *  Scope-tier dim values). Right: kind tag (muted), and the tier tag too while typing. Active row
 *  = a full-cell background tint - NO left rail / stripe (project-wide ban). */
function SpotlightOption({ item, optIdx, active, showTier = false, onPick, onHover, tierTag }: SpotlightOptionProps) {
  const isDim = !WHOLE_UNIT_KINDS.has(item.type);
  const splitMarker = isDim && item.tier === "scope";
  return (
    <div
      id={`spot-opt-${optIdx}`}
      role="option"
      aria-selected={active}
      className={`spot__option${active ? " spot__option--active" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick(item);
      }}
      onMouseEnter={() => onHover(optIdx)}
    >
      <span className="spot__option-left">
        <span className="spot__option-display">{item.display}</span>
        {splitMarker && <span className="spot__option-split">· split</span>}
      </span>
      <span className="spot__option-right">
        {showTier && <span className="spot__option-tier">{tierTag(item)}</span>}
        <span className="spot__option-kind">{KIND_LABELS[item.type] || item.type}</span>
      </span>
    </div>
  );
}
