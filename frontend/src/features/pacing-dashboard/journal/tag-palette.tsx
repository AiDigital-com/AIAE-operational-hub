import { forwardRef } from "react";
import { CHIP_TYPES, type PopoverPosition, type RankedTagSource } from "./tags-core";

/**
 * Inline-at-caret "spotlight" tag palette. Presentational + controlled: all state (open, query,
 * type, items, activeIdx, position) lives in `JournalPanel`. Focus stays in the textarea -
 * `onMouseDown` is prevented so clicking the palette never blurs the composer. `position: fixed`
 * because a card ancestor is `overflow: hidden` - `absolute` would clip the popover. No vertical
 * stripes. A faithful port of the retired SPA's `TagPalette.jsx` (BEM instead of Tailwind/inline
 * styles - see `journal-tags.css`).
 */

const CHIP_LABELS: Record<string, string> = { LI: "LI", ch: "Channel", aud: "Audience", dsp: "DSP", tactic: "Tactic" };
const CHIPS: Array<{ key: string | null; label: string }> = [
  { key: null, label: "All" },
  ...CHIP_TYPES.map((t) => ({ key: t, label: CHIP_LABELS[t] || t })),
];

export interface TagPaletteProps {
  position: PopoverPosition | null;
  query: string;
  type: string | null;
  items: RankedTagSource[];
  activeIdx: number;
  availableTypes: Set<string> | null;
  onPick: (item: RankedTagSource) => void;
  onHover: (index: number) => void;
  onTypeChange: (next: string | null) => void;
}

export const TagPalette = forwardRef<HTMLDivElement, TagPaletteProps>(function TagPalette(
  { position, query, type, items, activeIdx, availableTypes, onPick, onHover, onTypeChange },
  ref
) {
  // Only show chips for types that actually have sources (no empty DSP/Tactic/… chip).
  const visibleChips = availableTypes ? CHIPS.filter((c) => c.key === null || availableTypes.has(c.key)) : CHIPS;

  return (
    <div
      ref={ref}
      id="journal-tag-listbox"
      role="listbox"
      aria-label="Insert tag"
      className="jtag-palette"
      onMouseDown={(e) => e.preventDefault()}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
    >
      {/* Spotlight header — echoes the live query (focus stays in the textarea) */}
      <div className="jtag-palette__header">
        <span className="jtag-palette__search-icon" aria-hidden="true">
          🔎
        </span>
        <span className={`jtag-palette__query${query ? "" : " jtag-palette__query--placeholder"}`}>
          {query || "Search LI / channel / audience"}
        </span>
      </div>

      {/* Type chips */}
      <div className="jtag-palette__chips">
        {visibleChips.map((c) => {
          const active = (type ?? null) === c.key;
          return (
            <button
              key={c.label}
              type="button"
              className={`jtag-palette__chip${active ? " jtag-palette__chip--active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onTypeChange(active && c.key ? null : c.key);
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <div className="jtag-palette__results">
        {items.length === 0 ? (
          <div className="jtag-palette__empty">No matches</div>
        ) : (
          items.map((item, i) => (
            <div
              key={`${item.type}:${item.value}`}
              id={`tagopt-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={`jtag-palette__option${i === activeIdx ? " jtag-palette__option--active" : ""}`}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
              }}
            >
              <span className={`jtag-palette__option-dot jtag-palette__option-dot--${item.type}`} />
              <span className="jtag-palette__option-label">{item.display}</span>
              {item.recent && <span className="jtag-palette__option-recent">recent</span>}
              <span className="jtag-palette__option-type">{item.type}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
