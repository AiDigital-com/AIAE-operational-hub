// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/PeriodChipPopover.jsx
//
// The Data row's PERIOD (widget-builder v2 §6): the window this widget reads, when it does
// not simply follow the dashboard's own filter.
//
// It is `spec.period` and nothing else — one required key whose null means «follows the
// dashboard filter», which is why the panel's first option is a real option and not an empty
// state. §6's precedence, restated on the panel: a Period SWITCH beats this, and this beats
// the dashboard filter.
//
// ONE Seg radiogroup, stacked (owner 2026-08-26 — the radio list wrapped into an unreadable
// soup): «Follows the dashboard» spans its own line because it is the always-legal answer
// and the longest label, and the six ranges share the next line as equals. One Tab stop,
// arrows walk all seven.
//
// TWO REFUSALS, AND THEY ARE NOT THE SAME SHAPE. On a CM360 dataset the widget has no period
// of its own at all, and the chip that opens this panel is disabled with the grammar's own
// sentence — a CM360 draft always carries `period: null`, so there is nothing here to fix and
// nothing to lose. On `scope.time: "absolute"` the widget opts out of every period source,
// and the panel STAYS reachable: the author may have pinned the scope while a period was
// already set, and the only way out of that draft is this panel. So each range carries the
// refusal and «Follows the dashboard» does not — the one answer that is always legal. The
// current range stays pickable too: it is the state being escaped, not a new mistake.
//
// AND ONE STATE THAT IS NOT A REFUSAL AT ALL (2026-08-26). With a Period SWITCH on the widget
// the precedence stops being a rule to keep in mind and becomes the state this widget is in:
// the grammar refuses a switch and a window together, so a range picked here is not a write
// but a TRANSACTION — pin the range, take the switch — which the builder names in a confirm
// before it happens (`askPinPeriod`). Nothing is dimmed, because nothing here is illegal; the
// note says the override instead, so the state is legible before any click, and «Follows the
// dashboard» stays the plain write it always was, since the switch IS that answer already.
import { RANGE_VALUES } from '../report-v2.js';
import Popover from '../Popover.jsx';
import { RANGE_LABEL } from '../report/ReportWidget.jsx';
import { PopRow, Seg } from './rows.jsx';

/** §6's precedence line, in the words the mockup prints under this panel. */
const NOTE = 'A Period switch beats this; this beats the dashboard filter.';
/** …and the same line once the switch is actually THERE. The precedence stops being a rule to
 *  keep in mind and becomes the state this widget is in, so it is said as one — and it says
 *  what the next click does, because that click is a transaction and not a plain write: the
 *  grammar refuses a switch and a window together, so pinning a range takes the switch. */
const SWITCH_ON = 'A Period switch is on this Widget and overrides the window. Picking a range removes the switch.';
/** The always-legal answer, and the one the two period confirms send an author back to.
 *  Exported so the builder's «adding a switch resets the window» sentence names the segment
 *  by the words that segment actually wears — a second spelling would be the reader looking
 *  for an option this panel does not have. */
export const FOLLOWS = 'Follows the dashboard';
/** The Seg value for `spec.period: null` — a sentinel, because a Seg matches by value and
 *  null is what an unanswered group looks like. Never stored: `pick` maps it back. */
const FOLLOW = 'follow';

/**
 * PeriodChipPopover — the widget's own window.
 *
 *   widget      the draft (only `spec.period` is read)
 *   anchorRef   the chip this panel hangs from
 *   rangeWhy    the grammar's sentence for a private period on this draft, or null. It
 *               arrives from the builder because it is the validator's own words about the
 *               draft in hand (an absolute scope), never a second wording of them.
 *   hasSwitch   does this widget carry a Period switch? Not derived from `widget` even though
 *               it could be: the builder is where the pick's CONSEQUENCE is owned (it removes
 *               that switch), and one answer feeding both the note and the write is what keeps
 *               the sentence and the mutation from drifting apart.
 *   onPick      the builder's write for one window — `null` for «follows the dashboard», a
 *               RangeValue otherwise. It is not `patch`: under a switch the pick is a named
 *               transaction the builder confirms first, and this panel may not decide that.
 *
 * No firstRef: the Popover's default `initialFocus: 'first'` lands on the Seg's roving
 * segment — the ScopePopover precedent.
 */
export default function PeriodChipPopover({ widget, anchorRef, rangeWhy, hasSwitch, onPick, onClose }) {
  const cur = (widget.spec && widget.spec.period) || null;
  const pick = (value) => onPick(value === FOLLOW ? null : value);
  const noteId = 'rb-period-note';

  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Data period" width={340}>
      {/* A REFUSAL first where there is one: it disables the ranges, which is a stronger
          fact about this panel than what a legal pick would cost. */}
      <PopRow label="Window" note={rangeWhy || (hasSwitch ? SWITCH_ON : NOTE)} noteId={rangeWhy ? noteId : undefined}>
        <Seg
          stack
          label="Data period"
          value={cur === null ? FOLLOW : cur}
          describedBy={rangeWhy ? noteId : undefined}
          options={[
            [FOLLOW, FOLLOWS, null],
            ...RANGE_VALUES.map((range) => [
              range,
              RANGE_LABEL[range] || range,
              rangeWhy && cur !== range ? rangeWhy : null,
            ]),
          ]}
          onPick={pick}
        />
      </PopRow>
    </Popover>
  );
}
