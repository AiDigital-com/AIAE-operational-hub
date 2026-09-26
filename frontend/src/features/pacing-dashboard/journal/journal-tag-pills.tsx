import { collectAllTags, type TaggableEntry } from "./tags-core";

/**
 * A row of clickable tag pills above the journal list, filtering it down to entries that carry the
 * active tag. A faithful port of the retired SPA's `JournalTags.jsx` (BEM instead of Tailwind - see
 * `journal-tags.css`). Colors mirror the same type palette `TaggedText`/`TagPalette` use.
 */

// Only LI/ch/aud carry a dedicated color in the reference's own `TYPE_STYLES` - every other tag type
// (dsp, tactic, a breakdown dim, …) falls back to the channel color there (`TYPE_STYLES[type] ??
// TYPE_STYLES.ch`), so this mirrors that fallback rather than inventing a neutral one.
const TYPE_MODIFIER: Record<string, string> = {
  LI: "jtag-pill--li",
  ch: "jtag-pill--ch",
  aud: "jtag-pill--aud",
};
const DEFAULT_MODIFIER = "jtag-pill--ch";

export interface JournalTagPillsProps {
  entries: readonly TaggableEntry[];
  active: string | null;
  onToggle: (raw: string | null) => void;
}

export function JournalTagPills({ entries, active, onToggle }: JournalTagPillsProps) {
  const tags = collectAllTags(entries);
  if (!tags.length) return null;

  return (
    <div className="jtag-pills">
      {tags.map((tag) => {
        const isActive = active === tag.raw;
        return (
          <button
            key={tag.raw}
            type="button"
            onClick={() => onToggle(isActive ? null : tag.raw)}
            className={`jtag-pill ${TYPE_MODIFIER[tag.type] || DEFAULT_MODIFIER}${isActive ? " jtag-pill--active" : ""}`}
            title={`Filter by ${tag.raw}`}
          >
            <span className="jtag-pill__type">{tag.type}</span>
            <span className="jtag-pill__value">{tag.value}</span>
          </button>
        );
      })}
      {active && (
        <button type="button" className="jtag-pill jtag-pill--clear" onClick={() => onToggle(null)} title="Clear filter">
          Clear ×
        </button>
      )}
    </div>
  );
}
