import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/api-error";
import { formatError } from "../../../shared/format/error";
import { todayISO } from "../../pacing/mock/format";
import type { PacingLineItemPlanV1 } from "../../pacing-plan/types";
import type { PacingJournalEntryV1 } from "../types";
import { useAddJournalEntry, useDeleteJournalEntry, useUpdateJournalEntry } from "./hooks";
import { JournalEntryRow } from "./journal-entry";
import { JournalTagPills } from "./journal-tag-pills";
import { TagPalette } from "./tag-palette";
import { derivePlatforms, deriveDimValues, formatPlatform, type FactRow } from "./fact-dims";
import { getCaretCoordinates } from "./caret-coords";
import {
  buildTagResolver,
  buildTagSources,
  clampPopoverPosition,
  findActiveToken,
  maybeConvertTrigger,
  parseTags,
  rankSources,
  tagFrequencies,
  CHIP_TYPES,
  type PopoverPosition,
  type RankedTagSource,
  type RecentTag,
} from "./tags-core";
import { validateJournalDate } from "./validate-date";
import type { DashboardFiltersPatch } from "../filters/use-url-filters";
import "./journal-panel.css";
import "./journal-tags.css";

const VISIBLE_LIMIT = 6;
const PALETTE_W = 300;

// Breakdown-dim tag types that route into `brk`/`brkf` on a row click (§15/STEP 8). Token 'aud'
// maps to the 'audience' dim; every other token here equals its dim name. Kept as its own list
// (not derived from FACTS_DIM_TAGS below) because it excludes 'aud' on purpose - 'aud' gets the
// dim-name translation, the rest don't need one - matching the reference's own two lists.
const FACTS_DIMS = ["tactic", "geo", "creative", "comment", "message", "keyword", "flight", "language"];

/** Breakdown dims sourced from `factsDaily`; tag type token == dim name, except `aud`, which reads
 *  the `audience` column - the reference sources this one from a separate `availableSplits.audience`
 *  field the Hub's own `PacingDashboardV1` does not carry (the "splits" model was replaced by
 *  containers - see CLAUDE.md), so this pulls the same values straight out of the facts instead; the
 *  reference's own test fixtures (`tests/dashboard/fixtures/breakdown-lens.js`) confirm `factsDaily`
 *  rows carry an `audience` column directly. */
const FACTS_DIM_TAGS: Array<{ type: string; dim: string }> = [
  { type: "tactic", dim: "tactic" },
  { type: "aud", dim: "audience" },
  { type: "geo", dim: "geo" },
  { type: "creative", dim: "creative" },
  { type: "comment", dim: "comment" },
  { type: "message", dim: "message" },
  { type: "keyword", dim: "keyword" },
  { type: "flight", dim: "flight" },
  { type: "language", dim: "language" },
];

function autosize(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "auto";
  node.style.height = `${Math.min(Math.max(node.scrollHeight, 36), 160)}px`;
}

function entryDate(entry: PacingJournalEntryV1): string {
  return (entry.ts ?? "").slice(0, 10);
}

// ── Recents (per-pacing, last-used tags) ────────────────────────────────────
function recentsKey(slug: string) {
  return `oph:pacing-journal-tags:${slug}`;
}
function readRecents(slug: string): RecentTag[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentsKey(slug)) || "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && r.type && r.value) : [];
  } catch {
    return [];
  }
}
function pushRecent(slug: string, tag: RecentTag) {
  try {
    const cur = readRecents(slug).filter((r) => !(r.type === tag.type && r.value === tag.value));
    cur.unshift({ type: tag.type, value: tag.value });
    localStorage.setItem(recentsKey(slug), JSON.stringify(cur.slice(0, 12)));
  } catch {
    /* private mode — recents are best-effort */
  }
}

/** The shared caret-palette API a row editor plugs into - one palette portal, owned by the panel,
 *  serving whichever textarea (the composer or an inline row editor) last received input. */
export interface JournalTagPaletteApi {
  onInput: (ta: HTMLTextAreaElement, setValue: (value: string) => void) => void;
  onKeyDown: (e: React.KeyboardEvent) => boolean;
  close: () => void;
}

interface PaletteState {
  pos: PopoverPosition | null;
  items: RankedTagSource[];
  activeIdx: number;
  query: string;
  type: string | null;
  tokenStart: number;
}

export interface JournalPanelProps {
  slug: string;
  journal: PacingJournalEntryV1[];
  /** This pacing's flight window (`PacingRowV1.flightStart`/`flightEnd`), bounding the add/edit date
   *  pickers - a note dated outside the flight has nothing to report on. */
  flightStart?: string;
  flightEnd?: string;
  /** Tag-source input: LI id → its plan, for the `#LI:`/`#ch:` palette sources. */
  planByLineItem?: Record<string, PacingLineItemPlanV1>;
  /** Tag-source input: the pacing's raw daily facts, passed through byte-for-byte - see
   *  `PacingDashboardV1.factsDaily` - for the `#dsp:`/`#tactic:`/`#geo:`/… palette sources. */
  factsDaily?: FactRow[];
  /** Sets the chart's journal marker date when an entry row is clicked - page-level state in
   *  `pacing-dashboard.tsx`, not a store. */
  onHighlightDate?: (date: string | null) => void;
  /** Routes a clicked entry's tags into the dashboard filters (§15 follow-up/STEP 8): `#LI:` ->
   *  `selection`, `#ch:` -> `channels`, `#dsp:` -> `platforms`, `#label:` -> `labels`, `#aud:` and
   *  every breakdown tag -> `brk`/`brkf`, plus the range set to +/-7 days around the entry's date.
   *  From `useUrlFilters()` in `pacing-dashboard.tsx`. */
  setFilters?: (patch: DashboardFiltersPatch) => void;
}

/**
 * The journal panel (§15 of the migration plan, US-139): a free-text note log per pacing, with the
 * retired SPA's tag system ported in full (`#LI:`/`#ch:`/`#aud:`/`#dsp:`/… tags, the caret-at-cursor
 * palette, filter pills, the chart highlight). Behaviour matches `JournalPanel.jsx`/`JournalEntry.jsx`:
 * sorting, date bounds/validation, inline edit-in-row, two-step delete, first-6 + Show all/Collapse,
 * the "Saved" toast and the anti-double-click cooldown.
 *
 * Renders even when the journal is empty: an empty-state line plus the add form, so writing the first
 * note has somewhere to happen.
 */
export function JournalPanel({
  slug,
  journal,
  flightStart,
  flightEnd,
  planByLineItem,
  factsDaily,
  onHighlightDate,
  setFilters,
}: JournalPanelProps) {
  const today = todayISO();
  const maxDate = flightEnd && flightEnd < today ? flightEnd : today;
  const minDate = flightStart || "";

  const addEntry = useAddJournalEntry(slug);
  const updateEntry = useUpdateJournalEntry(slug);
  const deleteEntry = useDeleteJournalEntry(slug);

  const [message, setMessage] = useState("");
  const [date, setDate] = useState(maxDate);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Anti-double-click cooldown (2s) ───────────────────────────────────────
  // Not a rate limit of its own - the real one is server-side (Pacing's `journal` bucket, 6/min,
  // answered as 429 too_fast → the Hub's OPH_058). A longer client lockout here would just read as
  // "saving is slow" when the actual round trip is ~0.1-0.2s.
  const [cooldown, setCooldown] = useState(false);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startCooldown = useCallback(() => {
    setCooldown(true);
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => setCooldown(false), 2000);
  }, []);
  useEffect(
    () => () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    },
    []
  );

  const sortedEntries = useMemo(
    () => [...journal].sort((a, b) => entryDate(b).localeCompare(entryDate(a))),
    [journal]
  );
  const filteredEntries = useMemo(() => {
    if (!activeTag) return sortedEntries;
    return sortedEntries.filter((entry) => parseTags(entry.msg).some((t) => t.raw === activeTag));
  }, [sortedEntries, activeTag]);
  const visibleEntries = expanded ? filteredEntries : filteredEntries.slice(0, VISIBLE_LIMIT);

  // ── Tag sources (LI / channel / dsp / tactic / geo / …) + usage frequency ─
  // The core (`tags-core.ts`) reads a plan entry's channel under the short key `ch` (its own,
  // faithfully-ported internal convention - see the golden tests); the Hub's own
  // `PacingLineItemPlanV1` names the field `channel`, so this adapts the shape rather than reshaping
  // the ported core to match one caller.
  const liPlanForTags = useMemo(() => {
    const out: Record<string, { ch?: string }> = {};
    for (const [id, p] of Object.entries(planByLineItem || {})) out[id] = { ch: p.channel };
    return out;
  }, [planByLineItem]);

  const sources = useMemo(
    () =>
      buildTagSources({
        liPlan: liPlanForTags,
        platforms: derivePlatforms(factsDaily).map((raw) => ({ value: raw, display: formatPlatform(raw) })),
        breakdowns: FACTS_DIM_TAGS.map(({ type, dim }) => ({ type, values: deriveDimValues(factsDaily, dim) })),
      }),
    [liPlanForTags, factsDaily]
  );
  const freq = useMemo(() => tagFrequencies(journal || []), [journal]);
  const availableTypes = useMemo(() => new Set(sources.map((s) => s.type)), [sources]);

  // Slug -> raw label, for the same tag types the filters match on raw values (channels, labels,
  // breakdown dims, audience) - built off the same `sources` the palette already reads.
  const tagResolver = useMemo(() => buildTagResolver(sources, ["ch", "aud", "label", ...FACTS_DIMS]), [sources]);

  /** A journal row click (§15/STEP 8): sets the chart highlight and routes the entry's tags into
   *  the dashboard filters, with the range set to +/-7 days around the entry's own date. Ported
   *  from the reference's `JournalPanel.jsx:handleEntryClick`. */
  const handleEntryClick = useCallback(
    (entry: PacingJournalEntryV1, date: string) => {
      onHighlightDate?.(date || null);
      if (!setFilters) return;

      const resolveRaw = (type: string, value: string) => tagResolver.get(`${type}:${value}`) ?? value;
      const liIds: string[] = [];
      const channels: string[] = [];
      const platforms: string[] = [];
      const labels: string[] = [];
      const brkfPairs: string[] = [];
      let brkDim: string | null = null;
      for (const tag of parseTags(entry.msg)) {
        if (tag.type === "LI") liIds.push(tag.value);
        else if (tag.type === "ch") channels.push(resolveRaw("ch", tag.value));
        else if (tag.type === "dsp") platforms.push(tag.value);
        else if (tag.type === "label") labels.push(resolveRaw("label", tag.value));
        else if (tag.type === "aud" || FACTS_DIMS.includes(tag.type)) {
          // Multi-dim brkf: every breakdown tag applies. 'aud' maps to the 'audience' dim; every
          // other breakdown token equals its dim name.
          const dim = tag.type === "aud" ? "audience" : tag.type;
          const pair = `${dim}:${resolveRaw(tag.type, tag.value)}`;
          if (!brkfPairs.includes(pair)) brkfPairs.push(pair);
          if (!brkDim) brkDim = dim;
        }
      }

      const patch: DashboardFiltersPatch = {};
      if (liIds.length) patch.selection = liIds;
      if (channels.length) patch.channels = channels;
      if (platforms.length) patch.platforms = platforms;
      if (labels.length) patch.labels = labels;
      if (brkfPairs.length) {
        patch.brk = brkDim ?? "";
        patch.brkf = brkfPairs;
      }
      if (date) {
        const d = new Date(`${date}T00:00:00Z`);
        const from = new Date(d);
        from.setUTCDate(from.getUTCDate() - 7);
        const to = new Date(d);
        to.setUTCDate(to.getUTCDate() + 7);
        patch.range = "custom";
        patch.customRange = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
      }
      setFilters(patch);
    },
    [onHighlightDate, setFilters, tagResolver]
  );

  const [recents, setRecents] = useState<RecentTag[]>(() => readRecents(slug));
  useEffect(() => setRecents(readRecents(slug)), [slug]);

  // ── Tag palette state ─────────────────────────────────────────────────────
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [chipType, setChipType] = useState<string | null>(null);
  // The palette serves ONE textarea at a time — the composer or an inline row editor. Whoever
  // received input last registers here as the target; recompute/pick/reposition all act on it.
  const paletteTargetRef = useRef<{ ta: HTMLTextAreaElement; setValue: (value: string) => void } | null>(null);

  const closePalette = useCallback(() => setPalette(null), []);

  /** Recompute the palette for the current caret. Closes it when there's no # token. */
  const recompute = useCallback(
    (value: string, caret: number, chip: string | null = chipType) => {
      const token = findActiveToken(value, caret);
      if (!token) {
        setPalette(null);
        return;
      }
      const effType = token.type || chip || null;
      // Tags already typed into THIS entry are excluded from the palette.
      const exclude = new Set(parseTags(value).map((t) => `${t.type}:${t.value}`));
      const items = rankSources(sources, { type: effType, query: token.query, recents, freq, exclude });

      const ta = paletteTargetRef.current?.ta;
      let pos: PopoverPosition | null = null;
      if (ta) {
        const rect = ta.getBoundingClientRect();
        const c = getCaretCoordinates(ta, caret);
        if (c) {
          pos = clampPopoverPosition({
            caret: { left: rect.left + c.left, top: rect.top + c.top, lineHeight: c.height },
            size: { w: PALETTE_W, h: Math.min(320, 90 + items.length * 30) },
            viewport: { w: window.innerWidth, h: window.innerHeight },
          });
        } else {
          pos = { left: rect.left, top: rect.bottom + 6, placement: "below" };
        }
      }
      setPalette({ pos, items, activeIdx: 0, query: token.query, type: effType, tokenStart: token.start });
    },
    [sources, recents, freq, chipType]
  );

  // Reposition / dismiss the palette as the page scrolls or resizes.
  useEffect(() => {
    if (!palette) return undefined;
    const onWin = () => {
      const ta = paletteTargetRef.current?.ta;
      if (ta && document.activeElement === ta) recompute(ta.value, ta.selectionStart ?? ta.value.length);
      else setPalette(null);
    };
    window.addEventListener("scroll", onWin, true);
    window.addEventListener("resize", onWin);
    return () => {
      window.removeEventListener("scroll", onWin, true);
      window.removeEventListener("resize", onWin);
    };
  }, [palette, recompute]);

  /** Insert the picked tag in place of the active # token; record as recent. */
  const pick = useCallback(
    (item: RankedTagSource) => {
      const target = paletteTargetRef.current;
      if (!target?.ta || !palette) return;
      const ta = target.ta;
      const val = ta.value;
      const start = palette.tokenStart;
      const caret = ta.selectionStart ?? val.length;
      const tag = `#${item.type}:${item.value}`;
      const newVal = val.slice(0, start) + tag + " " + val.slice(caret);
      target.setValue(newVal);
      pushRecent(slug, { type: item.type, value: item.value });
      setRecents(readRecents(slug));
      setPalette(null);
      requestAnimationFrame(() => {
        const p = start + tag.length + 1;
        ta.selectionStart = ta.selectionEnd = p;
        ta.focus();
      });
    },
    [palette, slug]
  );

  const onTypeChange = useCallback(
    (next: string | null) => {
      setChipType(next);
      const ta = paletteTargetRef.current?.ta;
      if (ta) recompute(ta.value, ta.selectionStart ?? ta.value.length, next);
    },
    [recompute]
  );

  /** Shared input processing: register target, `\`→`#` convert, recompute. */
  const paletteOnInput = useCallback(
    (ta: HTMLTextAreaElement, setValue: (value: string) => void) => {
      const caret = ta.selectionStart ?? ta.value.length;
      const conv = maybeConvertTrigger(ta.value, caret);
      if (conv.converted) {
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = caret;
        });
      }
      paletteTargetRef.current = { ta, setValue };
      setValue(conv.value);
      recompute(conv.value, caret);
    },
    [recompute]
  );

  /** Shared palette keyboard nav. Returns true when the event was consumed. */
  const paletteOnKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!palette) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPalette((p) => p && { ...p, activeIdx: p.items.length ? (p.activeIdx + 1) % p.items.length : 0 });
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPalette((p) => p && { ...p, activeIdx: p.items.length ? (p.activeIdx - 1 + p.items.length) % p.items.length : 0 });
        return true;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        // Walk the category chips (All → LI → ch → aud → dsp → tactic).
        e.preventDefault();
        const order: Array<string | null> = [null, ...CHIP_TYPES.filter((t) => availableTypes.has(t))];
        const cur = order.indexOf(palette.type ?? null);
        const base = cur < 0 ? 0 : cur;
        const next = e.key === "ArrowRight" ? order[(base + 1) % order.length] : order[(base - 1 + order.length) % order.length];
        onTypeChange(next);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        // Never submit while the palette is open.
        e.preventDefault();
        e.stopPropagation();
        if (palette.items.length) pick(palette.items[palette.activeIdx]);
        else setPalette(null);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPalette(null);
        return true;
      }
      return false;
    },
    [palette, availableTypes, pick, onTypeChange]
  );

  // Compact API handed to inline row editors (JournalEntryRow).
  const tagPalette: JournalTagPaletteApi = useMemo(
    () => ({ onInput: paletteOnInput, onKeyDown: paletteOnKeyDown, close: closePalette }),
    [paletteOnInput, paletteOnKeyDown, closePalette]
  );

  async function handleAdd() {
    const trimmed = message.trim();
    if (!trimmed || addEntry.isPending || cooldown) return;
    const dateError = validateJournalDate(date, { minDate, maxDate, flightEnd, today });
    if (dateError) {
      setFormError(dateError);
      return;
    }
    setFormError("");
    try {
      await addEntry.mutateAsync({ message: trimmed, date: date || undefined });
      setMessage("");
      setToast("Saved");
      window.setTimeout(() => setToast(""), 2000);
      startCooldown();
    } catch (error) {
      setFormError(formatError(error));
      // Pacing answers a 6th write inside a minute with 429/too_fast, mapped by the Hub to
      // 429/OPH_058 (see `PacingJournalControllerMvcTest`) - the same guard as a genuine
      // double-click, so it starts the same cooldown.
      if (error instanceof ApiError && error.status === 429) startCooldown();
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (paletteOnKeyDown(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !cooldown) {
      e.preventDefault();
      void handleAdd();
    }
  }

  return (
    <>
      <section className="journal-panel">
        <div className="journal-panel__header">
          <h2 className="journal-panel__title">Journal</h2>
          {sortedEntries.length > 0 && <span className="journal-panel__badge">{sortedEntries.length}</span>}
        </div>

        <JournalTagPills entries={sortedEntries} active={activeTag} onToggle={setActiveTag} />

        <div className="journal-panel__form">
          <input
            type="date"
            className="journal-panel__date-input"
            value={date}
            min={minDate || undefined}
            max={maxDate}
            onChange={(e) => {
              setDate(e.target.value);
              setFormError("");
            }}
            aria-label="Note date"
          />
          <textarea
            ref={textareaRef}
            className="journal-panel__textarea"
            value={message}
            role="combobox"
            aria-expanded={!!palette}
            aria-controls="journal-tag-listbox"
            aria-activedescendant={palette ? `tagopt-${palette.activeIdx}` : undefined}
            aria-autocomplete="list"
            onChange={(e) => {
              autosize(e.target);
              setFormError("");
              paletteOnInput(e.target, setMessage);
            }}
            onKeyDown={handleTextareaKeyDown}
            onBlur={() => setTimeout(closePalette, 150)}
            placeholder="Add a note… (type # or \ to tag)"
            rows={1}
            aria-label="New journal note"
          />
          <button
            type="button"
            className="button button--primary button--sm"
            onClick={() => void handleAdd()}
            disabled={addEntry.isPending || cooldown || !message.trim()}
          >
            {addEntry.isPending ? "Adding…" : "Add"}
          </button>
          {toast && <span className="journal-panel__toast">{toast}</span>}
        </div>
        {formError && <p className="journal-panel__error">{formError}</p>}

        {filteredEntries.length === 0 ? (
          <p className="journal-panel__empty">{activeTag ? "No entries match this tag." : "No entries yet."}</p>
        ) : (
          <ul className="journal-panel__list">
            {visibleEntries.map((entry) => (
              <JournalEntryRow
                key={entry.id}
                entry={entry}
                sources={sources}
                isEditing={editingId === entry.id}
                dateMin={minDate}
                dateMax={maxDate}
                tagPalette={tagPalette}
                onRowClick={(d) => handleEntryClick(entry, d)}
                onStartEdit={() => setEditingId(entry.id)}
                onCancelEdit={() => {
                  setEditingId(null);
                  closePalette();
                }}
                onSaveEdit={async (nextMessage, nextDate) => {
                  const dateError = validateJournalDate(nextDate, { minDate, maxDate, flightEnd, today });
                  if (dateError) return { ok: false, error: dateError };
                  try {
                    await updateEntry.mutateAsync({
                      entryId: entry.id,
                      body: { message: nextMessage, date: nextDate || undefined },
                    });
                    setEditingId(null);
                    closePalette();
                    return { ok: true };
                  } catch (error) {
                    return { ok: false, error: formatError(error) };
                  }
                }}
                onDelete={async () => {
                  await deleteEntry.mutateAsync(entry.id);
                }}
              />
            ))}
          </ul>
        )}

        {filteredEntries.length > VISIBLE_LIMIT && (
          <div className="journal-panel__footer">
            <button type="button" className="journal-panel__toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? `Collapse to ${VISIBLE_LIMIT}` : `Show all (${filteredEntries.length})`}
            </button>
          </div>
        )}
      </section>

      {palette && (
        <TagPalette
          position={palette.pos}
          query={palette.query}
          type={palette.type}
          items={palette.items}
          availableTypes={availableTypes}
          activeIdx={palette.activeIdx}
          onPick={pick}
          onHover={(i) => setPalette((p) => p && { ...p, activeIdx: i })}
          onTypeChange={onTypeChange}
        />
      )}
    </>
  );
}
