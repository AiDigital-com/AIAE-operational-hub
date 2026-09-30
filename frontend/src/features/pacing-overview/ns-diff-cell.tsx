/**
 * A pacing's standing against NetSuite, as one table cell (§13, US-136).
 *
 * Lifted out of the retired `/pacing` table, which was the only screen that showed this. It moved
 * here rather than into the Overview because the answer it gives - "does this pacing still match
 * what NetSuite says" - belongs to the pacing, not to the screen listing it, and the campaign Pacing
 * tab is the obvious second home.
 *
 * Three states, deliberately unequal in weight: never checked is a dash, in sync is plain coloured
 * text, and only a real count of differences gets a badge. A table full of healthy pacings must not
 * compete for attention with the one that needs looking at.
 */
import { Tooltip } from "../../shared/ui/tooltip/tooltip";
import { fmtDate } from "../pacing/mock/format";
import { nsDiffBreakdownLines, totalNsDiffCount } from "./format";
import type { PacingRowV1 } from "./types";
import "./ns-diff-cell.css";

/** How many lines a badge's tooltip shows before it says how many more there are. */
const TOOLTIP_LINES = 8;

/**
 * The body behind a count badge: a heading, a line per class of difference, and when the check ran.
 * Its own component because a tooltip that only repeats "7" tells nobody which seven. Uses the
 * shared Tooltip's own `tooltip__*` classes, so every tooltip in the product reads the same.
 *
 * @param title  what the count is
 * @param lines  one per class of difference; capped, with the remainder named rather than dropped
 * @param footer optional closing line, e.g. when the check ran
 */
export function BadgeDetail({ title, lines, footer }: { title: string; lines: string[]; footer?: string }) {
  const shown = lines.slice(0, TOOLTIP_LINES);
  const hidden = lines.length - shown.length;
  return (
    <>
      <span className="tooltip__title">{title}</span>
      <ul className="tooltip__lines">
        {/* Keyed by position as well as text: two line items can raise word-for-word the same
            difference, and a duplicate key would drop one of them. */}
        {shown.map((line, index) => (
          <li key={`${index}-${line}`}>{line}</li>
        ))}
        {hidden > 0 && (
          // Says there is more rather than pretending the list ended - the count is the badge's own
          // number, and a tooltip that silently showed eight of twelve would contradict it.
          <li className="tooltip__more">+{hidden} more — open the pacing to see them all</li>
        )}
      </ul>
      {footer && <span className="tooltip__foot">{footer}</span>}
    </>
  );
}

/**
 * @param row the pacing, read for its `nsDiffSummary` only
 */
export function NsDiffCell({ row }: { row: PacingRowV1 }) {
  const summary = row.nsDiffSummary;

  if (summary == null) {
    return (
      <span className="ns-diff__none" title="Not yet checked against NetSuite">
        —
      </span>
    );
  }

  if (summary.inSync) {
    return (
      <span
        className="ns-diff__ok"
        title={`Checked on ${fmtDate(summary.computedAt)} — in sync with NetSuite as of that check.`}
      >
        In sync
      </span>
    );
  }

  const count = totalNsDiffCount(summary);
  return (
    <Tooltip
      content={
        <BadgeDetail
          title={`${count} ${count === 1 ? "difference" : "differences"} vs NetSuite`}
          lines={nsDiffBreakdownLines(summary)}
          footer={`Checked on ${fmtDate(summary.computedAt)}`}
        />
      }
    >
      <span className="ns-diff__badge">{count}</span>
    </Tooltip>
  );
}
