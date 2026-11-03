/**
 * The "Filter anything…" pop-up - ported from the reference's
 * `workspace/src/pages/Dashboard/components/FilterSpotlight.jsx` (filter spotlight spec 2026-10-01)
 * to TypeScript + BEM (`spotlight.css`), behaviour first. A complete filter control, not an add-only
 * search:
 *   - ACTIVE - what is on, in the chips row's order; click removes. While a query is typed it is one
 *     line, "{n} active · Clear all".
 *   - BROWSE (empty query) - SCOPE then LENS, grouped by kind, six per kind and a "Show {n} more"
 *     row; every row shows its on/off glyph and its count.
 *   - SEARCH - every match, grouped by kind, twenty rows and a "Show all {n} matches" row.
 * A click or Enter toggles the row's filter and the pop-up STAYS open with the query and the focus.
 * The highlighted row is tracked by identity, not index. While the pointer is over the list the
 * Active section is frozen (its rows keep their places; a removed one shows an empty glyph; a new
 * one is not inserted yet), so nothing above the pointer moves. Nothing is highlighted on open; once
 * a query is typed the first option row is (so Enter picks the top match and never "Clear all"); a
 * habitual Enter in the empty box does nothing. Under 480 px the list is fixed to the viewport (16 px
 * gutters, below the input). A row rested on (or reached by the keyboard) shows the explanation
 * panel `FilterBar` owns. Section captions are plain text; the highlighted row is a full-row tint -
 * NO stripes (project-wide ban). Pure logic lives in `spotlight-core.ts`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  activeItems,
  browseSources,
  groupByKind,
  isActive,
  isDimType,
  panelFor,
  patchForSource,
  removeDescriptorOf,
  searchFilterSources,
  KIND_LABELS,
  TOUCH_FOOTER,
  type ActiveItem,
  type BrowseGroups,
  type FilterSource,
  type FilterTier,
  type ScopeFilters,
  type SpotlightLiPlan,
} from "./spotlight-core";
import { EXPLAIN_HOVER_DELAY_MS, type ExplainTarget } from "./explain-panel";
import type { DashboardFilters } from "./types";
import type { DashboardFiltersPatch } from "./use-url-filters";
import "./spotlight.css";

const SECTION_CAPTION: Record<FilterTier, string> = {
  scope: "SCOPE · paces the dashboard",
  lens: "LENS · breakdown only",
};
const SEARCH_CAP = 20;

const domId = (key: string) => `spot-opt-${key.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
const linesText = (n: number) => (n === 1 ? "1 line" : `${n} lines`);

/** A row's item: a filter source, or an applied filter (which may have no source behind it). */
type RowItem = FilterSource | ActiveItem;
type RowSection = "active" | "search" | FilterTier;

export type SpotlightRow =
  | { kind: "option"; key: string; item: RowItem; on: boolean; tier: FilterTier; section: RowSection; showTier: boolean; missing: boolean; selectable: true }
  | { kind: "section"; key: string; tier: "active" | FilterTier; clear?: boolean; selectable?: boolean }
  | { kind: "group"; key: string; type: string; selectable?: false }
  | { kind: "line"; key: string; n: number; selectable: boolean }
  | { kind: "more"; key: string; tier: FilterTier; type: string; n: number; selectable: true }
  | { kind: "all"; key: string; n: number; selectable: true }
  | { kind: "empty"; key: string; q: string; selectable?: false }
  | { kind: "none"; key: string; selectable?: false }
  | { kind: "footer"; key: string; selectable?: false };

interface BuildRowsInput {
  q: string;
  liveActive: readonly ActiveItem[];
  activeRows: readonly ActiveItem[];
  filters: DashboardFilters;
  browse: BrowseGroups | null;
  hitGroups: Array<{ kind: string; items: FilterSource[] }>;
  hits: readonly FilterSource[];
  showAll: boolean;
  actualTier: Map<string, FilterTier>;
}

/**
 * The flat render model - the reference's `buildRows`. Every entry has a `kind`; the ones with
 * `selectable` are what the keyboard walks, by `key`. Option rows carry their item, on/off state and
 * the tier they display (the actual tier for an on row, the static one for an off row).
 */
export function buildRows({ q, liveActive, activeRows, filters, browse, hitGroups, hits, showAll, actualTier }: BuildRowsInput): SpotlightRow[] {
  const rows: SpotlightRow[] = [];
  const option = (item: RowItem, section: RowSection, showTier: boolean) => {
    const key = `${section}:${item.type}:${item.value}`;
    const on = isActive(filters, item);
    const tier = on ? actualTier.get(`${item.type}:${item.value}`) || item.tier : item.tier;
    const missing = "missing" in item ? !!item.missing : false;
    rows.push({ kind: "option", key, item, on, tier, section, showTier, missing, selectable: true });
  };
  if (q) {
    rows.push({ kind: "line", key: "clear", n: liveActive.length, selectable: liveActive.length > 0 });
    for (const g of hitGroups) {
      rows.push({ kind: "group", key: `grp:search:${g.kind}`, type: g.kind });
      for (const item of g.items) option(item, "search", true);
    }
    if (hits.length > SEARCH_CAP && !showAll) rows.push({ kind: "all", key: "all", n: hits.length, selectable: true });
    if (hits.length === 0) rows.push({ kind: "empty", key: "empty", q });
  } else {
    if (liveActive.length > 0 || activeRows.length > 0) {
      rows.push({ kind: "section", key: "sec:active", tier: "active", clear: true, selectable: true });
      for (const item of activeRows) option(item, "active", true);
    }
    for (const tier of ["scope", "lens"] as const) {
      const groups = browse ? browse[tier] : [];
      if (!groups.length) continue;
      rows.push({ kind: "section", key: `sec:${tier}`, tier });
      for (const g of groups) {
        rows.push({ kind: "group", key: `grp:${tier}:${g.kind}`, type: g.kind });
        for (const item of g.items) option(item, tier, false);
        if (g.hidden > 0) rows.push({ kind: "more", key: `more:${tier}:${g.kind}`, tier, type: g.kind, n: g.hidden, selectable: true });
      }
    }
  }
  if (!q && !rows.some((r) => r.kind === "option")) rows.push({ kind: "none", key: "none" });
  rows.push({ kind: "footer", key: "footer" });
  return rows;
}

export interface SpotlightProps {
  /** Every filterable entity, tier-tagged - `buildFilterSources`, built once in `FilterBar`. */
  sources: readonly FilterSource[];
  /** The line items each source touches - `countsFor`, printed on every row and in the panel. */
  counts?: Map<string, number> | null;
  filters: DashboardFilters;
  /** The period-aware Scope answer for the applied cuts (`selectScopeFilters`), the chips' own. */
  scopeFilters?: ScopeFilters | null;
  /** The plan, for a line item row's channel and the panel's value-group line. */
  liPlan?: Record<string, SpotlightLiPlan | null | undefined> | null;
  onApply: (patch: DashboardFiltersPatch) => void;
  /** The chip's own removal (`FilterBar`'s `removePill`): ONE removal path. */
  onRemove: (type: string, value: string) => void;
  onClear: () => void;
  /** Shows (a target) or hides (null) the explanation panel `FilterBar` owns. */
  onExplain?: (target: ExplainTarget | null) => void;
}

export function Spotlight({ sources, counts, filters, scopeFilters = null, liPlan, onApply, onRemove, onClear, onExplain }: SpotlightProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [closed, setClosed] = useState(false); // Escape closed it; typing or ArrowDown reopens
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [expandedKinds, setExpandedKinds] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [frozen, setFrozen] = useState<ActiveItem[] | null>(null); // the Active rows snapshot while the pointer is inside
  const [popTop, setPopTop] = useState<number | null>(null); // the list's top under 480 px (fixed to the viewport)
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKeys = useRef<string[]>([]); // the selectable keys of the last render, for a vanished highlight
  const fallback = useRef<{ forKey: string | null | undefined; key: string | null }>({ forKey: undefined, key: null });
  const kb = useRef(false); // the last highlight move came from the keyboard
  const explained = useRef<string | null>(null); // the row key the panel explains, null when hidden

  const q = query.trim();
  const liveActive = useMemo(() => activeItems(filters, sources, scopeFilters), [filters, sources, scopeFilters]);
  const actualTier = useMemo(() => new Map(liveActive.map((r) => [r.key, r.tier])), [liveActive]);
  const activeRows = pointerInside && frozen ? frozen : liveActive;
  const browse = useMemo(() => (q ? null : browseSources(sources, { expandedKinds })), [sources, q, expandedKinds]);
  const hits = useMemo(() => (q ? searchFilterSources(sources, q) : []), [sources, q]);
  const hitGroups = useMemo(() => groupByKind(showAll ? hits : hits.slice(0, SEARCH_CAP)), [hits, showAll]);
  const rows = useMemo(
    () => buildRows({ q, liveActive, activeRows, filters, browse, hitGroups, hits, showAll, actualTier }),
    [q, liveActive, activeRows, filters, browse, hitGroups, hits, showAll, actualTier]
  );
  const selectable = useMemo(() => rows.filter((r) => r.selectable), [rows]);

  const open = focused && !closed;

  // The highlight by identity. No explicit highlight: nothing while the query is empty, the first
  // option row once something is typed (so Enter picks the top match, never "Clear all"). A
  // highlighted row that vanished: the first row that followed it and is still here, else the first
  // option row; the answer is kept for as long as that vanished key stays the explicit one, so it
  // does not drift on re-renders.
  const highlighted = useMemo(() => {
    if (!selectable.length) return null;
    const keys = selectable.map((r) => r.key);
    const firstOption = () => (selectable.find((r) => r.kind === "option") || selectable[0]).key;
    let key: string | null;
    if (activeKey != null && keys.includes(activeKey)) key = activeKey;
    else if (activeKey == null) key = q ? firstOption() : null;
    else {
      const f = fallback.current;
      if (f.forKey === activeKey && f.key != null && keys.includes(f.key)) key = f.key;
      else {
        const i = prevKeys.current.indexOf(activeKey);
        const next = i >= 0 ? prevKeys.current.slice(i + 1).find((k) => keys.includes(k)) : undefined;
        key = next !== undefined ? next : firstOption();
      }
      fallback.current = { forKey: activeKey, key };
    }
    prevKeys.current = keys;
    return key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectable, activeKey]);

  const clearHoverTimer = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const hideExplain = () => {
    explained.current = null;
    onExplain?.(null);
  };
  const explainRow = (row: SpotlightRow | null) => {
    if (!onExplain) return;
    if (!row || row.kind !== "option") {
      hideExplain();
      return;
    }
    const panel = panelFor(row.item, { displayedTier: row.tier, counts, liPlan, missing: row.missing });
    const el = document.getElementById(domId(row.key));
    const rect = el ? el.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
    explained.current = row.key;
    onExplain({ ...panel, rect });
  };
  const rowByKey = (key: string | null) => rows.find((r) => r.key === key) || null;
  const scrollRowIntoView = (key: string | null) => {
    if (!key) return;
    const el = document.getElementById(domId(key));
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  };

  // Typing: the highlight, the cap and the panel start over.
  useEffect(() => {
    setActiveKey(null);
    setShowAll(false);
    setFrozen(null);
    kb.current = false;
    hideExplain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    if (open) return;
    setPointerInside(false);
    setFrozen(null);
    setExpandedKinds(new Set());
    setShowAll(false);
    clearHoverTimer();
    kb.current = false;
    hideExplain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // The panel stays true to the list: after a keyboard move the highlighted row is scrolled into
  // view and explained where it now is; after a toggle or a removal the row the panel explains is
  // explained again (new state, new count) or, when it is gone, the panel hides.
  useEffect(() => {
    if (!open) return;
    if (kb.current) {
      scrollRowIntoView(highlighted);
      explainRow(rowByKey(highlighted));
      return;
    }
    if (explained.current == null) return;
    const row = rowByKey(explained.current);
    if (row && row.kind === "option" && row.key === highlighted) explainRow(row);
    else hideExplain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, highlighted, rows]);
  // Under 480 px the list is fixed to the viewport, so it needs the input's bottom edge.
  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const measure = () => {
      const r = ref.current ? ref.current.getBoundingClientRect() : null;
      if (r) setPopTop(Math.round(r.bottom + 6));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);
  // Capture phase on purpose: React handles the row's mousedown first otherwise, and a row that
  // re-render removes (Show more, Show all, Clear all) is detached by the time the bubble reaches
  // document, so `contains` would call an inside click an outside one.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setFocused(false);
    }
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);
  useEffect(() => () => clearHoverTimer(), []);

  // The keyboard's own highlight move: immediate explanation, and the Active snapshot dropped (it
  // re-freezes on the next pointer move inside the list).
  const moveTo = (key: string) => {
    kb.current = true;
    setActiveKey(key);
    setFrozen(null);
    explainRow(rowByKey(key));
  };
  // After "Clear all" the highlight goes to the first browse (or search) row.
  const highlightFirstListed = () => {
    const first = rows.find((r) => r.kind === "option" && r.section !== "active");
    setActiveKey(first ? first.key : null);
  };

  function act(row: SpotlightRow | undefined) {
    if (!row) return;
    if (row.kind === "option") {
      if (row.on) {
        const d = removeDescriptorOf(row.item);
        onRemove(d.type, d.value);
      } else if (row.item.type === "range") {
        // A frozen, removed range row: put it back.
        const restore = (row.item as ActiveItem).restore;
        if (restore) onApply(restore);
      } else onApply(patchForSource(filters, row.item));
    } else if (row.kind === "more") {
      setExpandedKinds((cur) => new Set(cur).add(`${row.tier}:${row.type}`));
    } else if (row.kind === "all") {
      setShowAll(true);
    } else if (row.kind === "line" || row.kind === "section") {
      if (row.kind === "line" && row.n === 0) return;
      onClear();
      highlightFirstListed();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else {
        setClosed(true);
        hideExplain();
      }
      return;
    }
    if (e.key === "Backspace" && query === "" && !e.repeat && liveActive.length) {
      const d = removeDescriptorOf(liveActive[liveActive.length - 1]);
      setFrozen(null);
      onRemove(d.type, d.value);
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown" && closed) {
        e.preventDefault();
        setClosed(false);
      }
      return;
    }
    const n = selectable.length;
    if (!n) return;
    const i = selectable.findIndex((r) => r.key === highlighted); // -1: nothing highlighted yet
    const typing = query !== ""; // with text in the box, Space, Home and End are the text's
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveTo(i < 0 ? (selectable.find((r) => r.kind === "option") || selectable[0]).key : selectable[(i + 1) % n].key);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveTo(i < 0 ? selectable[n - 1].key : selectable[(i - 1 + n) % n].key);
    } else if (e.key === "Home" && !typing) {
      e.preventDefault();
      moveTo(selectable[0].key);
    } else if (e.key === "End" && !typing) {
      e.preventDefault();
      moveTo(selectable[n - 1].key);
    } else if (e.key === "Enter" || (e.key === " " && !typing)) {
      if (i < 0) {
        // Nothing highlighted: Enter does nothing, Space types.
        if (e.key === "Enter") e.preventDefault();
        return;
      }
      e.preventDefault();
      kb.current = true;
      setFrozen(null);
      act(selectable[i]);
    }
  }
  // Rows act on the primary button only; the pop-up's own mousedown keeps the focus in the input.
  const press = (row: SpotlightRow) => (e: React.MouseEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    act(row);
  };
  const hoverStart = (row: SpotlightRow) => {
    kb.current = false;
    setActiveKey(row.key);
  };

  const onPointerEnterList = () => {
    setPointerInside(true);
    setFrozen(liveActive);
  };
  const onPointerLeaveList = () => {
    setPointerInside(false);
    setFrozen(null);
    clearHoverTimer();
    hideExplain();
  };
  const onPointerMoveList = () => {
    if (pointerInside && !frozen) setFrozen(liveActive);
  };

  const countText = (item: RowItem): string | null => {
    if (item.type === "range") return null;
    if (item.type === "li") return liPlan?.[item.value]?.channel || null;
    const key = `${item.type}:${item.value}`;
    return counts && counts.has(key) ? linesText(counts.get(key)!) : null;
  };

  const renderRow = (row: SpotlightRow) => {
    const active = !!row.selectable && row.key === highlighted;
    switch (row.kind) {
      case "section":
        return (
          <div key={row.key} className="spot__section" aria-hidden={row.tier !== "active" ? "true" : undefined}>
            <span className="spot__caption">{row.tier === "active" ? "ACTIVE" : SECTION_CAPTION[row.tier]}</span>
            {row.clear && (
              <span
                id={domId(row.key)}
                role="option"
                aria-selected="false"
                aria-label="Clear all filters"
                className={`spot__clear${active ? " spot__clear--active" : ""}`}
                onMouseDown={press(row)}
                onMouseEnter={() => {
                  hoverStart(row);
                  hideExplain();
                }}
              >
                Clear all
              </span>
            )}
          </div>
        );
      case "group":
        return (
          <div key={row.key} className="spot__group" aria-hidden="true">
            {KIND_LABELS[row.type] || row.type}
          </div>
        );
      case "line":
        return (
          <div
            key={row.key}
            id={domId(row.key)}
            role="option"
            aria-selected="false"
            aria-label={row.n ? "Clear all filters" : "0 active filters"}
            aria-disabled={row.n ? undefined : "true"}
            className={`spot__line${active ? " spot__line--active" : ""}${row.n ? "" : " spot__line--empty"}`}
            onMouseDown={press(row)}
            onMouseEnter={() => {
              if (row.n) hoverStart(row);
              hideExplain();
            }}
          >
            <span>{row.n} active</span>
            <span aria-hidden="true"> · </span>
            <span className="spot__clear-word">Clear all</span>
          </div>
        );
      case "more":
      case "all": {
        const text = row.kind === "more" ? `Show ${row.n} more` : `Show all ${row.n} matches`;
        const label =
          row.kind === "more" ? `Show ${row.n} more ${KIND_LABELS[row.type] || row.type} values` : `Show all ${row.n} matches`;
        return (
          <div
            key={row.key}
            id={domId(row.key)}
            role="option"
            aria-selected="false"
            aria-label={label}
            className={`spot__more${active ? " spot__more--active" : ""}`}
            onMouseDown={press(row)}
            onMouseEnter={() => {
              hoverStart(row);
              hideExplain();
            }}
          >
            {text}
          </div>
        );
      }
      case "empty":
        return (
          <div key={row.key} className="spot__empty">
            No matches for &ldquo;{row.q}&rdquo;
          </div>
        );
      case "none":
        return (
          <div key={row.key} className="spot__empty">
            Nothing to filter in this data
          </div>
        );
      case "footer":
        return (
          <div key={row.key} className="spot__footer" aria-hidden="true">
            {TOUCH_FOOTER}
          </div>
        );
      case "option": {
        const { item } = row;
        const count = countText(item);
        const isActiveSection = row.section === "active";
        const sub = isActiveSection && "sub" in item ? item.sub : null;
        const label = isActiveSection && "label" in item ? item.label : item.display;
        return (
          <div
            key={row.key}
            id={domId(row.key)}
            role="option"
            aria-selected={row.on}
            className={`spot__row${row.on ? " spot__row--on" : ""}${active ? " spot__row--active" : ""}${row.missing ? " spot__row--missing" : ""}`}
            onMouseDown={press(row)}
            onMouseEnter={() => {
              hoverStart(row);
              clearHoverTimer();
              hoverTimer.current = setTimeout(() => explainRow(row), EXPLAIN_HOVER_DELAY_MS);
            }}
            onMouseLeave={() => {
              clearHoverTimer();
              hideExplain();
            }}
          >
            <span className="spot__glyph" aria-hidden="true" />
            <span className="spot__label">
              <span className="spot__label-text">{label}</span>
              {sub && <span className="spot__sub">{sub}</span>}
              {!isActiveSection && isDimType(item.type) && item.tier === "scope" && <span className="spot__sub">· split</span>}
            </span>
            {count && <span className="spot__count">{count}</span>}
            <span className="spot__tags">
              {row.showTier && <span className="spot__tag">{row.tier === "scope" ? "SCOPE" : "LENS"}</span>}
              <span className="spot__tag spot__tag--kind">{item.type === "range" ? "Range" : KIND_LABELS[item.type] || item.type}</span>
            </span>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div
      ref={ref}
      className="spot"
      // Tab out closes: focus left for something outside this control (a row click keeps focus in
      // the input through its mousedown preventDefault, so it never lands here).
      onBlur={(e) => {
        const inside = !!(e.relatedTarget && ref.current && ref.current.contains(e.relatedTarget as Node));
        if (!inside) setFocused(false);
      }}
    >
      <svg className="spot__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setClosed(false);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          setClosed(false);
        }}
        placeholder="Filter anything…"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? "spot-list" : undefined}
        aria-activedescendant={open && highlighted ? domId(highlighted) : undefined}
        className={`spot__input${query ? " spot__input--filled" : ""}`}
      />
      {open && (
        <div
          id="spot-list"
          role="listbox"
          aria-multiselectable="true"
          className="spot__popup"
          style={popTop != null ? ({ "--spot-top": `${popTop}px` } as React.CSSProperties) : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onPointerEnter={onPointerEnterList}
          onPointerLeave={onPointerLeaveList}
          onPointerMove={onPointerMoveList}
        >
          {rows.map(renderRow)}
        </div>
      )}
    </div>
  );
}
