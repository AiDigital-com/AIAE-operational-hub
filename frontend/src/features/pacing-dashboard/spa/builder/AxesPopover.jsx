// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/AxesPopover.jsx
//
// The chart's two axis SCALES (widget-builder v2 §5.1, Table D), per side. A different
// question from a cell's format — this one is how the ticks
// on the left and the right of the chart are written — and the grammar keeps two vocabularies
// for exactly that reason.
//
// Both sides are always shown, even when nothing sits on the right yet: the scale is a
// property of the CHART, a series moved across later lands on whatever is set here, and a
// row that appeared and disappeared with the series would be a setting the reader cannot find
// twice. §5.1 attaches no family→scale mapping, so a count drawn on a `kilo` axis is a choice
// and this panel refuses nothing.
//
// The metric-picked default (`autoAxisFormat`) writes here too, but only into a scale nobody
// has chosen — see `cards/chart-axis.js`. This panel is the explicit choice that stops it.
import Popover from '../Popover.jsx';
import { CHART_FORMATS } from '../report-v2.js';
import { PopRow } from './rows.jsx';

/**
 * Product words for the closed chart-scale vocabulary. This map lives with the only
 * Builder that edits those values and is exhaustively pinned against CHART_FORMATS.
 */
const SCALE_LABEL = {
  __proto__: null,
  number: 'Number', kilo: 'Kilo (120k)', count1: 'Count · 1 decimal',
  currency: 'Currency', currency4: 'Currency 4dp',
  percent: 'Percent', percent1: 'Percent 1dp', percent2: 'Percent 2dp',
};

/**
 * AxesPopover — the axis-scale pair of one chart.
 *
 *   view        the chart (its `formats` pair is what this writes)
 *   anchorRef   the `Axes` chip it hangs from
 *   onFormat    `(side, format) => void` — the card owns the mutator and the patch
 */
export default function AxesPopover({ view, anchorRef, onClose, onFormat }) {
  const formats = view.formats || {};
  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Axis scales" width={260}>
      {['left', 'right'].map((side) => (
        <PopRow key={side} label={side === 'left' ? 'Left' : 'Right'}>
          <select
            className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
            aria-label={`${side === 'left' ? 'Left' : 'Right'} axis scale`}
            value={formats[side]}
            onChange={(e) => onFormat(side, e.target.value)}
          >
            {CHART_FORMATS.map((f) => <option key={f} value={f}>{SCALE_LABEL[f]}</option>)}
          </select>
        </PopRow>
      ))}
    </Popover>
  );
}
