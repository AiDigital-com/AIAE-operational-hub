// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/popovers/SortPopover.jsx
//
// The AUTHORED sort of one table (widget-builder v2 §5.2): which column it is sorted by and
// in which direction. Two rows and a way out, on the same primitives every builder popover
// is made of.
//
// WHY A PANEL AND NOT A CLICK. The chip could have flipped the direction on click and hidden
// the column behind a second control — but §1.1.5 says a chip IS a thing and a click IS its
// settings, and a chip that did two things depending on where it was clicked would be the
// one control on this card that answers differently. So the chip opens this, and both halves
// of one setting are answered in one place.
//
// THE VIEWER'S CLICK IS NOT THIS. A reader clicking a table header re-sorts their own view
// and nothing is persisted (§5.2); this is the order the table ARRIVES in, and it is the
// only sort on the wire.
import Popover from '../Popover.jsx';
import { ROW_SORT_KEY, SORT_DIRS } from '../report-v2.js';
import { columnName, grainName } from './view-text.js';
import { PopRow, Seg } from './rows.jsx';

const arr = (v) => (Array.isArray(v) ? v : []);
/** The two directions in words. `Asc`/`Desc` are the wire's spelling, not a reader's — and
 *  the list they are read off is the grammar's own, so a third direction would show up
 *  named rather than missing. */
const DIR_LABEL = { __proto__: null, asc: 'Ascending', desc: 'Descending' };

/**
 * SortPopover — one table's authored sort.
 *
 *   view/spec   the table, and the spec its column names are derived from
 *   env         `{dims}` — what the store calls the dimension the rows run down
 *   sort        the EFFECTIVE pair the card shows: the authored one, or the grammar's own
 *               default (the row itself, ascending) when nothing has been authored
 *   onSort(next|null)   write the pair, or clear the key
 */
export default function SortPopover({ view, spec, env, sort, anchorRef, onClose, onSort }) {
  const columns = arr(view.columns);
  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} title="Sort">
      <PopRow label="Sort by">
        <select
          className="sp-inp sp-inp--sm sp-inp--sans sp-pop-sel"
          aria-label="Sort by"
          value={sort.columnId}
          onChange={(e) => onSort({ columnId: e.target.value, dir: sort.dir })}
        >
          {/* The row itself is a legal answer and the grammar has a word for it. It wears
              the grain's own name plus what that name MEANS here, because a column may
              well be called «Date» too. */}
          <option value={ROW_SORT_KEY}>{`${grainName(env, view.rows, spec)} (the row)`}</option>
          {view.share && <option value="__share__">Row share</option>}
          {columns.map((c) => (
            <option key={c.id} value={c.id}>{columnName(c, spec)}</option>
          ))}
        </select>
      </PopRow>

      <PopRow label="Direction">
        <Seg
          label="Direction"
          value={sort.dir}
          options={SORT_DIRS.map((d) => [d, DIR_LABEL[d] || d])}
          onPick={(d) => onSort({ columnId: sort.columnId, dir: d })}
        />
      </PopRow>

      {/* Only when there is something to clear: absence is what the grammar reads as «the
          default order», and this is the one control that can put the key back. */}
      {view.sort ? (
        <button type="button" className="sp-pop-rm" onClick={() => { onSort(null); onClose(); }}>
          Clear sort
        </button>
      ) : null}
    </Popover>
  );
}
