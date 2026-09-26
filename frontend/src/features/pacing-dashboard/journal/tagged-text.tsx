import { Fragment } from "react";
import { TAG_RE, isKnownTag, type TagSource } from "./tags-core";

/**
 * Shared renderer: journal message text → React nodes with `#LI:`/`#ch:`/`#aud:`/… rendered as
 * badges. Known tags (present in the current sources) get the type's own color; unknown tags
 * (typos, or a tag whose source has since disappeared) render muted with a dashed border, so a typo
 * stays visible rather than looking like a confirmed reference. A faithful port of the retired SPA's
 * `TaggedText.jsx`, used by both the composer's live preview (not built here - the add form has no
 * preview in the reference either) and `JournalEntryRow`.
 *
 * BEM classes, not the reference's Tailwind utility strings - see `journal-tags.css`. Colors come
 * from the existing chart-color tokens in `app/tokens.css` (already theme-aware), never a left-rail
 * stripe - full-badge fills only, per the project's standing ban.
 */

const KNOWN_MODIFIER: Record<string, string> = {
  LI: "jtag-badge--li",
  ch: "jtag-badge--ch",
  aud: "jtag-badge--aud",
  dsp: "jtag-badge--dsp",
  tactic: "jtag-badge--tactic",
};

/** Render `text` into an array of React nodes (strings + tag badge spans). */
export function renderTaggedText(text: unknown, sources: readonly TagSource[] | null | undefined) {
  const str = text == null ? "" : String(text);
  const re = new RegExp(TAG_RE.source, "g");
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={`t${last}`}>{str.slice(last, m.index)}</Fragment>);
    const type = m[1];
    const value = m[2];
    const known = isKnownTag(type, value, sources);
    const modifier = known ? KNOWN_MODIFIER[type] || "jtag-badge--dim" : "jtag-badge--unknown";
    nodes.push(
      <span
        key={m.index}
        className={`jtag-badge ${modifier}`}
        title={known ? `${type}: ${value}` : `unknown ${type}: ${value}`}
      >
        <span className="jtag-badge__type">{type}</span>
        <span className="jtag-badge__value">{value}</span>
        {!known && (
          <span className="jtag-badge__unknown-mark" aria-hidden="true">
            ?
          </span>
        )}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < str.length) nodes.push(<Fragment key={`t${last}`}>{str.slice(last)}</Fragment>);
  return nodes;
}

export function TaggedText({ text, sources }: { text: unknown; sources: readonly TagSource[] | null | undefined }) {
  return <>{renderTaggedText(text, sources)}</>;
}
