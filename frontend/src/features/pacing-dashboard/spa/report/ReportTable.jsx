import { highlightTextStyle, highlightTitle } from '../ui/highlight-style.js';
// workspace/src/pages/Dashboard/components/Widgets/Report/ReportTable.jsx
//
// The v2 report's TABLE view (widget-builder v2 spec 2026-08-19 §5.2; P2 plan Task 6).
// It draws `buildReportTableModel`'s answer: every number, every column name, the row
// labels and the totals arrive on `model`, and the only questions answered here are the
// ones about looking at a table — what a header click does, how far the body scrolls,
// how many rows a first read shows.
//
// PROPS, and no STORE: the tile, the layout preview and the gallery miniature all render
// this component, and a zustand hook inside it would answer with the store's INITIAL state
// on every surface that has no provider. That is also why the row-axis label and the
// dimension's human name arrive on the model — they come from the pacing's own config,
// which reaches the model through `sources` and never reaches this file.
//
// The two `useState`s below are this component's OWN, and they are the reason it has hooks
// at all where ReportChart has none: §5.2 makes a viewer's re-sort local to that viewer and
// never persisted, and the page count is a reading position, not a setting.
//
// The visual skeleton is local to the canonical Table View so its authored model and viewer
// state remain explicit and reviewable.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fD } from '../format.js';
import { parseUTC } from '../date-utils.js';
import { columnExtremes, EM, fmtV2, fmtReportTableCell as cellText, primaryChip, sortReportRows, SHARE_SORT_KEY, SUB_SORT_KEY } from '../report-render.js';
import { ROW_SORT_KEY } from '../report-v2.js';

/** How many rows one page adds once the table is expanded past the authored limit. */
const PAGE_SIZE = 200;
/** The label column is capped and ellipsized; the numeric ones never are — without a
 *  ceiling one long dimension value pushes every value column out of the tile. */
const LABEL_MAX_PX = 320;

/** The rows' height is read before paint in a browser, so a table that fills its tile never
 *  paints one frame at its old cap. A plain effect where there is no document: the server
 *  renderer warns about a layout effect, and has no layout to read anyway. */
const useLayoutRead = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/**
 * useRowsHeight(boxRef, present) → the height in CSS pixels that everything inside the rows'
 * box needs (the table, the «Show more» line, and a horizontal scrollbar where the columns
 * overflow), or null until it has been read.
 *
 * It is the one number CSS cannot know. A tile whose row is taller than the tile lets this box
 * grow past its step cap, but never past its own rows (index.css, the stretch chain): a short
 * table keeps its height and the lines under it stay under it. So it is read off the CONTENT,
 * never off the box, whose height is what it sizes.
 *
 * Read again after every commit (rows sorted, filtered, paged) and whenever the table's own
 * size moves without one: a web font landing, a width change that adds a scrollbar.
 */
function useRowsHeight(boxRef, present) {
  const [height, setHeight] = useState(null);
  const last = useRef(null);
  const read = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    let content = box.offsetHeight - box.clientHeight;
    for (const child of box.children) content += child.getBoundingClientRect().height;
    // Up to the browser's own layout step (1/64px), not to a whole pixel: a box a hair short
    // of its rows shows a scrollbar, and a whole pixel over would make a short table taller.
    const next = Math.ceil(content * 64) / 64;
    if (next === last.current) return;
    last.current = next;
    setHeight(next);
  }, [boxRef]);
  useLayoutRead(read);
  useEffect(() => {
    const table = present ? boxRef.current?.firstElementChild : null;
    if (!table || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(table);
    return () => observer.disconnect();
  }, [present, read, boxRef]);
  return height;
}

// The gap uses the shared spacing scale's 4px step.
// Spacing is the one place this skeleton is not copied literally: new code takes it from the
// grid as Tailwind utilities (DESIGN-BASE §Spacing), and one pixel on an arrow's left margin
// is not a look anybody chose.
function SortArrow({ active, dir }) {
  return (
    <span className="text-9 ml-1" style={{ opacity: active ? 1 : 0.4, color: active ? 'var(--status-blue)' : 'inherit' }}>
      {active ? (dir === 'asc' ? '▲' : '▼') : '▼'}
    </span>
  );
}

/** §6's ⇄ marks the columns that FOLLOW the metric switch, and it is visible to the
 *  viewer, not only to the author — the same mark the chart's legend carries. */
const columnName = (c) => (c.bound ? `${c.label} ⇄` : c.label);

/** Read by own-key, for the reason the model states: a column id is a NodeId and
 *  `constructor` is a legal one, so a bare lookup would hang an error badge on a column
 *  that has no error. */
const colErrorOf = (model, id) => (
  Object.prototype.hasOwnProperty.call(model.colErrors, id) ? model.colErrors[id] : null
);

/** The muted chip a line that is paused RIGHT NOW wears beside its name, in the legacy
 *  section's own words and weight (DailyTable.jsx:499). */
function PausedChip() {
  return <span className="text-9 rpt-chip">paused</span>;
}

/** The chip a Conversion Action row wears when line items in view chose that action as a
 *  primary conversion (spec §4). A label, not a control: `rpt-chip-static` gives the pointer
 *  back, and the whole sentence is in its title. */
function PrimaryChip({ primary }) {
  const chip = primaryChip(primary);
  if (!chip) return null;
  return <span className="text-9 rpt-chip rpt-chip-static" title={chip.title}>{chip.text}</span>;
}

/** The Totals tooltip while a search box narrows the rows: the cut's count is about rows that
 *  are no longer on screen, so the subset says only why. */
const CV_SUBSET_NOTE = 'A line item in these rows cannot show conversions here';

/* ── the plan half of a dimension table (2026-09-12) ─────────────────────────
   A dimension value carries a plan only where a container declares a target for it, so a
   plan column on this grain is mostly empty BY DESIGN and one row in it can be short of the
   delivery beside it. Three quiet marks, and not one of them is a rail, a stripe or a fill:
   the empty cells recede, ONE footnote character per row sits on the first plan column, and
   a line under the table decodes both. */

/** Read by own-key, for the reason `colErrorOf` above gives: a column id is a NodeId, and
 *  `constructor` is a legal one. */
const isPlanCol = (model, id) => (
  !!model.planColumns && Object.prototype.hasOwnProperty.call(model.planColumns, id)
);

/** The ONE column that carries the row's mark. The shortfall belongs to the row, not to a
 *  column — every plan-derived cell in it is short by the same fraction — so repeating the
 *  glyph across four plan columns would paint a band and say one thing four times. */
const markColumnId = (model, cols) => {
  if (!model.planColumns) return null;
  const first = cols.find((c) => isPlanCol(model, c.id));
  return first ? first.id : null;
};

const pct = (ratio) => `${Math.round(ratio * 100)}%`;

/** What a marked row says on hover. The RATIO first, because it is the number that tells a
 *  reader how far off the comparison is; the line items second, named, because that is what
 *  they would go and check. `missing` holds the lines that did NOT declare. */
function partialTitle(p) {
  if (!p) return null;
  // The ratio is absent where the two sides buy in different units and there is no shared
  // number to take a share of. The line counts always answer, and they are the fact.
  const said = p.ratio == null ? [] : [`Plan covers ${pct(p.ratio)} of this row's delivery.`];
  if (p.ofLines) {
    said.push(`${p.lines} of ${p.ofLines} line items in this row ${p.lines === 1 ? 'declares' : 'declare'} a target.`);
  }
  const all = p.missing || [];
  const named = all.slice(0, 3);
  const rest = all.length - named.length;
  if (named.length) {
    const tail = rest > 0 ? `${named.join(', ')} and ${rest} more do not.`
      : `${named.join(', ')} ${named.length === 1 ? 'does' : 'do'} not.`;
    said.push(tail);
  }
  return said.join(' ');
}

/** …and the Totals row's, which knows the ratio and nothing else: the shortfall there is
 *  spread over every undeclared value and every line that declared none, so there is no
 *  single row to count line items over. */
const totalsPartialTitle = (p) => (
  p ? `The totals plan covers ${pct(p.ratio)} of the delivery below it.` : null
);

/** The reserved gutter on the marked column. Rendered on EVERY cell of it, empty where the
 *  row is whole, so a marked row's number does not sit one glyph left of an unmarked one. */
function PlanMark({ partial }) {
  return <span className="rpt-plan-mark" aria-hidden="true">{partial ? '*' : null}</span>;
}

/** Two native titles on one cell, joined the way `highlightTitle` joins its own. */
const joinTitles = (a, b) => [a, b].filter(Boolean).join('\n') || undefined;

const NO_STYLE = Object.freeze({});

/**
 * What one Totals cell holds: the fact, optionally the plan stacked under it (§5.2 — fact on
 * top, target beneath, both flush right so they line up under the column name), and the plan
 * mark on the one column that carries it.
 *
 * A function rather than inline JSX so a cell with no mark keeps a SINGLE child: two adjacent
 * expressions in JSX always produce an array, and this cell's children are read directly.
 */
function totalsCell(totals, model, c, planMarkCol, subset) {
  // Over a subset (the rows a search box kept) neither the plan mark nor the target is
  // SAID: the mark is a statement about the whole cut's coverage, and the target under the
  // fact is the window's. Both keep their BOX — the mark's gutter and the stack's second
  // line — so the column stays aligned and the sticky head keeps its height while the
  // reader types.
  const marked = c.id === planMarkCol;
  const mark = marked ? <PlanMark partial={!subset && !!model.totalsPartial} /> : null;
  // With a plan stacked under the fact, the mark belongs INSIDE the stack's first line: the
  // stack is a flex COLUMN, so a sibling after it would drop onto a third line of its own and
  // take the cell's height with it.
  if (c.target && c.target.value != null) {
    return (
      <span className="rpt-tot-stack">
        <span>{cellText(totals[c.id], c)}{mark}</span>
        <span className="text-10 rpt-tot-tgt">{subset ? '\u00a0' : fmtV2(c.target.value, c.target.format)}</span>
      </span>
    );
  }
  const body = cellText(totals[c.id], c);
  if (!marked) return body;
  return <>{body}{mark}</>;
}

/** A row's share of the view, as the legacy Breakdown table prints it beside the name: one
 *  decimal, muted, and nothing at all where the column it is a share of has no total. */
const shareText = (share) => (Number.isFinite(share) ? `${share.toFixed(1)}%` : '');

/** The colour a tinted column gives ONE cell. By VALUE, like the legacy panel: a re-sort
 *  moves rows and must not move the mark, and two rows that tie both earn it. `ex` is the
 *  column's own pair — the model's, or the one recomputed over the rows the box left. */
function extremeColor(ex, value) {
  if (!ex || !Number.isFinite(value)) return undefined;
  if (value === ex.best) return 'var(--status-green)';
  if (value === ex.worst) return 'var(--status-red)';
  return undefined;
}

/** The word for one row of this table, in the two sentences that need it: the segment box's
 *  placeholder and the note beside the Totals. «Segments» is the legacy Breakdown panel's own
 *  word for a dimension's values; the three fixed grains say what their rows are, so a date
 *  table does not offer to filter «segments» over dates. The date × line grain says «rows»,
 *  because the box matches BOTH halves of its label and «dates» would undersell it. */
const ROW_WORD = { __proto__: null, dim: 'segments', date: 'dates', dateLi: 'rows', li: 'line items' };
const rowWord = (model) => ROW_WORD[model.rowType] || 'rows';

/** The second line under a line item's name: its raw id and its channel — and the CHANNEL
 *  alone where nobody renamed the line, because «LI 900101» is then the name above it too
 *  (the legacy section's own rule, DailyTable.jsx:511). */
const subUnder = (r) => (r.sub === r.subId ? r.subNote : [r.subId, r.subNote].filter(Boolean).join(' · '));
/** …and the whole cell as one string, for the tooltip a clipped name needs. */
const subTitle = (r) => [r.sub, subUnder(r)].filter(Boolean).join(' · ');

export default function ReportTable({ view, model, maxHeightPx = 440, pick = null, quietEmpty = false, paired = null }) {
  // Per-viewer, per-session sort on top of the authored one. It re-orders the rows the
  // model already holds — there is no spec to rebuild a model from, because this click is
  // never stored (§5.2).
  const [sortOverride, setSortOverride] = useState(null);
  const [page, setPage] = useState(1);
  // …and two more of the same kind, both the legacy Breakdown panel's (section-widget parity
  // 2026-09-04): whether the author's row limit is expanded, and the box that narrows the rows
  // by name. Neither is stored, and neither changes a number — `search` narrows what is DRAWN.
  const [expanded, setExpanded] = useState(false);
  const [localQuery, setQuery] = useState('');
  const query = paired ? paired.query : localQuery;
  // Resolved identity, not the stored control id or the arriving data object.
  // Metric switches and fresh rows retain the reader's search on the same cut.
  useEffect(() => {
    setQuery('');
    setExpanded(false);
    setPage(1);
  }, [model?.rowType, model?.rowDimension]);
  useEffect(() => { if (paired) setPage(1); }, [paired?.query]);
  const sorted = useMemo(() => {
    if (!model) return [];
    return sortOverride ? sortReportRows(model.rows, sortOverride) : model.rows;
  }, [model, sortOverride]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => String(r.label).toLowerCase().includes(q)
      || (r.sub && String(r.sub).toLowerCase().includes(q)));
  }, [sorted, query]);
  // The best and worst reading, recomputed over the rows the box LEFT — the legacy panel
  // compares the rows it is showing (Breakdown.jsx:590, over `filteredRows`), and a green
  // mark on a row that is no longer on screen is a comparison the reader cannot see. Null
  // while the box is empty, which is every other table: the model's own answer stands and
  // nothing is recomputed.
  const narrowed = useMemo(() => {
    if (!model || !query.trim() || rows.length === model.rows.length) return null;
    const out = { __proto__: null };
    for (const c of model.columns) {
      if (c.highlightExtremes) out[c.id] = columnExtremes(rows, c.id, c.highlightDirection);
    }
    return out;
  }, [model, rows, query]);
  // …and the Totals row follows the same rows (owner ruling 2026-09-16, the legacy panel's
  // `breakdownTotals(filteredRows)`): the model re-totals the kept KEYS through its own
  // aggregate-then-compute path, because the cells here are finished values and a rate
  // re-summed from them would be a mean of percentages. Over `rows` — the filtered set — and
  // never `visible`: the number must not move on «Show more». Null while the box is empty,
  // and on a model that carries no `retotal` (a table is a props-only component).
  const narrowedTotals = useMemo(() => {
    if (!narrowed || !model.totals || typeof model.retotal !== 'function') return null;
    return model.retotal(new Set(rows.map((r) => r.key)));
  }, [narrowed, model, rows]);
  const boxRef = useRef(null);
  const rowsHeight = useRowsHeight(boxRef, !!model);

  if (!model) return null;
  const cols = model.columns;
  const sort = sortOverride || model.sort;
  // The authored limit is a SOFT page, not a cut (section-widget parity 2026-09-04): the legacy
  // panel collapses to ten rows and offers «Show all (N)», where this used to slice the list
  // and drop the rest with nothing on screen to say so — the totals above still counted them,
  // so the visible rows did not add up. `remaining` is what the 200-row page has left after
  // that, which is the affordance a very long table still needs.
  const collapsed = !!model.limit && !expanded && rows.length > model.limit;
  const visible = collapsed ? rows.slice(0, model.limit) : expanded ? rows : rows.slice(0, Math.max(model.limit || 0, PAGE_SIZE * page));
  const remaining = collapsed ? 0 : rows.length - visible.length;
  const onPick = pick && pick.onPick ? pick.onPick : null;
  const isOn = (r) => !!(pick && pick.active && pick.active.has(r.label));
  const extremesOf = (c) => (narrowed ? narrowed[c.id] : c.extremes);
  // The one column the plan mark rides on this table, or null off a dimension grain.
  const planMarkCol = markColumnId(model, cols);
  // The Totals row on screen: the kept rows' while the box narrows the body, the cut's otherwise.
  const totals = narrowedTotals || model.totals;
  const subsetTotals = !!narrowedTotals;
  // …and whether a mark is actually DRAWN, which is what decides the second half of the note
  // under the table: the rows on screen, and the Totals row only while it wears its own mark
  // (over a subset it does not, so the footnote must not decode a glyph nobody can see).
  const anyPartial = !!planMarkCol && ((!subsetTotals && !!model.totalsPartial) || rows.some((r) => r.planPartial));

  const handleSort = (columnId) => {
    setSortOverride((cur) => {
      const base = cur || model.sort;
      if (base.columnId === columnId) return { columnId, dir: base.dir === 'desc' ? 'asc' : 'desc' };
      // A first click on a number asks for the biggest; on either LABEL column, for the
      // first — which is the legacy section's own rule (`col === 'lineItem' ? 'asc' : 'desc'`).
      const isLabel = columnId === ROW_SORT_KEY || columnId === SUB_SORT_KEY;
      return { columnId, dir: isLabel ? 'asc' : 'desc' };
    });
    setPage(1);
  };

  // The header's COLOUR is not here: it lives on `.rpt-th`, because an inline colour
  // outranks every class and made the tile's switch-hover accent a no-op on exactly the
  // columns it is about (P2 handoff §5.4). `.rpt--hl .rpt-sw` can win against a class.
  const thStyle = (numeric) => ({
    background: 'var(--surface-alt)',
    padding: paired ? '5px 8px 5px 0' : '8px 12px 6px',
    textAlign: numeric ? 'right' : 'left',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    borderBottom: '1px solid var(--border-soft)',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    ...(numeric ? null : { maxWidth: paired ? 'var(--rpt-label-max, 320px)' : LABEL_MAX_PX, overflow: 'hidden', textOverflow: 'ellipsis' }),
  });
  const tdStyle = (numeric) => ({
    padding: paired ? '6px 8px 6px 0' : '5px 12px',
    borderBottom: '1px solid var(--border-softer)',
    fontSize: paired || numeric ? 12 : 13,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    textAlign: numeric ? 'right' : 'left',
    fontFamily: paired ? 'var(--font-sans)' : numeric ? 'var(--font-mono)' : undefined,
    fontVariantNumeric: 'tabular-nums',
    ...(numeric ? null : { maxWidth: paired ? 'var(--rpt-label-max, 320px)' : LABEL_MAX_PX, overflow: 'hidden', textOverflow: 'ellipsis' }),
  });
  const totStyle = (numeric) => ({
    ...tdStyle(numeric),
    padding: paired ? '6px 8px 6px 0' : '6px 12px',
    borderBottom: '1px solid var(--border-hover)',
    color: 'var(--text-primary)', fontWeight: 600,
    background: 'var(--surface-tertiary, var(--surface-alt))',
  });

  return (
    <div className={`rpt-view${paired ? ' rpt-table--compact' : ''}`}>
      {view?.title ? (
        <div className="text-11 rpt-view-title" style={{ padding: '10px 12px 0', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {view.title}
        </div>
      ) : null}
      {/* The legacy panel's «Filter segments…», in the same place: above the rows, to the
          right. It is the viewer's, like the sort — nothing is stored and no number moves. */}
      {model.search && !paired && (
        <div className="rpt-find">
          <input
            type="text"
            className="text-11 rpt-find-in"
            value={query}
            placeholder={`Filter ${rowWord(model)}...`}
            aria-label={`Filter ${model.rowLabel} rows`}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          />
        </div>
      )}
      {/* The cap rides a variable and not an inline max-height: an inline value outranks every
          rule, and a tile its row stretches has to lift the cap from the stylesheet. */}
      <div
        ref={boxRef}
        className={rowsHeight == null ? 'rpt-scroll' : 'rpt-scroll rpt-scroll--measured'}
        style={{
          overflowX: 'auto', overflowY: 'auto', position: 'relative', '--rpt-rows-max': `${maxHeightPx}px`,
          ...(rowsHeight == null ? null : { '--rpt-rows-h': `${rowsHeight}px` }),
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          {/* The totals row lives INSIDE the head, so it stays under the column names
              while the body scrolls — it is a reading of the whole window, not a last row. */}
          <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface-alt)', boxShadow: '0 1px 0 var(--border-soft)' }}>
            <tr>
              <th className="text-10 rpt-th" style={thStyle(false)} onClick={() => handleSort(ROW_SORT_KEY)}>
                {model.rowLabel}
                <SortArrow active={sort.columnId === ROW_SORT_KEY} dir={sort.dir} />
                {model.rows.some((row) => row.share != null) && <button type="button" className={`rpt-share-sort${model.shareBound ? ' rpt-sw' : ''}`}
                  onClick={(event) => { event.stopPropagation(); handleSort(SHARE_SORT_KEY); }} aria-label="Sort by row share">
                  Share <SortArrow active={sort.columnId === SHARE_SORT_KEY} dir={sort.dir} />
                </button>}
              </th>
              {/* The second label column, on the one grain whose rows are named by two things
                  (date × line item). Sortable like every other header, on a key the viewer
                  owns and no spec can store. */}
              {model.subLabel && (
                <th className="text-10 rpt-th" style={thStyle(false)} onClick={() => handleSort(SUB_SORT_KEY)}>
                  {model.subLabel}
                  <SortArrow active={sort.columnId === SUB_SORT_KEY} dir={sort.dir} />
                </th>
              )}
              {/* `rpt-sw` on a bound column: the tile's switch-hover highlight accents
                  exactly the columns that will move (§6). */}
              {cols.map((c) => (
                <th
                  key={c.id}
                  className={`text-10 rpt-th${c.bound ? ' rpt-sw' : ''}`}
                  style={thStyle(c.numeric)}
                  onClick={() => handleSort(c.id)}
                >
                  {columnName(c)}
                  {colErrorOf(model, c.id) && (
                    <span
                      className="ui-tip wgt-colerr"
                      data-tip={`Column error: ${colErrorOf(model, c.id)}; fix it in the widget builder`}
                    >
                      !
                    </span>
                  )}
                  <SortArrow active={sort.columnId === c.id} dir={sort.dir} />
                </th>
              ))}
            </tr>
            {model.totals && rows.length > 0 && (
              <tr>
                <td style={totStyle(false)}>
                  Totals
                  {/* While the box narrows the body, this row totals the rows it kept and says
                      how many of the cut that is («3 of 9 segments»). A model that cannot
                      re-total keeps the cut's own row and says so instead — unsaid, one visible
                      row under a total ten times its size is the «the rows do not add up» shape
                      the soft row limit was fixed for. The space rides in the text. */}
                  {narrowed ? (
                    <>
                      {' '}
                      <span className="text-10 rpt-tot-all">{subsetTotals
                        ? `· ${rows.length} of ${model.rows.length} ${rowWord(model)}`
                        : `· all ${model.rows.length} ${rowWord(model)}`}</span>
                    </>
                  ) : null}
                </td>
                {model.subLabel && <td style={totStyle(false)} />}
                {/* A highlight rule and the plan mark were judged against the WHOLE cut's total,
                    so neither is shown over a subset: a green badge computed from a number
                    that is no longer on the row would be a verdict about something else. */}
                {cols.map((c) => (
                  <td key={c.id} style={{ ...totStyle(c.numeric), ...highlightTextStyle(subsetTotals ? null : model.totalHighlights?.[c.id]) }}
                    title={joinTitles(subsetTotals ? null : joinTitles(highlightTitle(model.totalHighlights?.[c.id]),
                      c.id === planMarkCol ? totalsPartialTitle(model.totalsPartial) : null),
                      model.cvNote && model.cvCols?.has(c.id) && totals[c.id] == null
                      && !colErrorOf(model, c.id) && !isPlanCol(model, c.id)
                        ? (subsetTotals ? CV_SUBSET_NOTE : model.cvNote) : null)}>
                    {/* Fact on top, the plan under it — the whole point of this row on a
                        pacing: 2,140,269 impressions against 714,286 expected. Both flush
                        right, so they line up under the column name.
                        A plan with no NUMBER is CM-fed and the adapter has not answered yet
                        (the model keeps the slot so `attachCmData` has one to fill) — the
                        KPI's own reading of the same state, ReportKpi's `hasTarget`. */}
                    {/* The mark is the same one character the rows use, on the same column, so
                        the two line up. Its own predicate: the totals plan is short whenever
                        anything delivered outside a declaration — true even when every visible
                        row is whole, because the untagged remainder still delivers. Built as
                        one expression so a table off this grain keeps its single child. */}
                    {totalsCell(totals, model, c, planMarkCol, subsetTotals)}
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 && (
              // An honest sentence beats a lone "Totals —" line over an empty body.
              <tr>
                <td
                  colSpan={cols.length + (model.subLabel ? 2 : 1)}
                  className="text-12"
                  style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--text-faint)' }}
                >
                  {/* The model's own sentence when it knows WHY there is nothing — a dimension
                      this pacing does not carry, or a cut with no rows under the current
                      filter. The generic line sends a reader to the filters, which is the
                      wrong place for a fact about the pacing.
                      `quietEmpty` is the tile saying another view on this row has already said
                      it: two explanations of one fact read as two problems. The row it is on
                      still draws, so the pair keeps its shape. */}
                  {query.trim() && model.rows.length
                    ? `No segments match “${query.trim()}”`
                    : (quietEmpty ? '' : (model.emptyNote || "No rows yet: nothing matches this table's scope"))}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              // The weekend reads differently from the week, and a pacing is read by day —
              // the tint is the only thing on a row that comes from the label itself. It is a
              // CLASS and not an inline background, because an inline one outranks every rule
              // and is what made a hover tint on this table impossible.
              let weekend = false;
              if (r.isDate) {
                const wd = parseUTC(r.label).getUTCDay();
                weekend = wd === 0 || wd === 6;
              }
              // Clicking a row filters the dashboard by the value in it — the legacy panel's
              // own `brk`/`brkf` toggle. Every leftover refuses, exactly as the panel refuses
              // all four of its own: none of them is a value anything could be filtered by,
              // and the pair would scope the dashboard to nothing at all.
              const leftover = !!r.residual || !!r.leftover;
              const clickable = !!onPick && !leftover;
              const on = clickable && isOn(r);
              const cls = ['rpt-tr'];
              if (weekend) cls.push('rpt-tr--we');
              if (leftover) cls.push('rpt-tr--rest');
              if (clickable) cls.push('rpt-tr--pick');
              if (on) cls.push('is-on');
              return (
                <tr
                  key={r.key}
                  className={cls.join(' ')}
                  onClick={clickable ? () => {
                    if (globalThis.getSelection?.()?.type === 'Range') return;
                    onPick(r.label);
                  } : undefined}
                >
                  <td
                    style={tdStyle(false)}
                    // Clipped text is unreadable without this.
                    title={r.isDate ? undefined : r.label}
                  >
                    {r.primary ? (
                      // A Conversion Action row with a «primary» chip (spec §4): marker, name,
                      // share and chip in the `.rpt-sub-nm` flex row, so a long action name is
                      // what gives way and the chip keeps its width. The marker rides INSIDE the
                      // row: an inline marker before a flex box would push the name onto a second
                      // line. The spaces still ride in the text for `textContent`; a flex row
                      // does not draw whitespace-only text.
                      <span className="rpt-sub-nm">
                        {paired && (() => {
                          const marker = paired.markerFor(r);
                          return <span className="rpt-row-marker" style={{ background: marker.color }}
                            title={marker.title} aria-label={marker.title} />;
                        })()}
                        <span style={{ color: 'var(--text-primary)', fontWeight: paired ? 400 : 600 }}>{r.label}</span>
                        {r.share != null && (
                          <>{' '}<span className={`text-10 rpt-share${model.shareBound ? ' rpt-sw' : ''}`}>{shareText(r.share)}</span></>
                        )}
                        {' '}<PrimaryChip primary={r.primary} />
                      </span>
                    ) : (
                      <>
                        {paired && (() => {
                          const marker = paired.markerFor(r);
                          return <span className="rpt-row-marker" style={{ background: marker.color }}
                            title={marker.title} aria-label={marker.title} />;
                        })()}
                        <span style={{ color: 'var(--text-primary)', fontWeight: paired ? 400 : 600 }}>
                          {r.isDate ? fD(r.label) : r.label}
                        </span>
                        {/* The row's share of the view, beside the name and muted — where the
                            legacy Breakdown table prints it, and the reason a breakdown is read
                            at all. Its basis is the author's column or independent value. */}
                        {/* The space rides in the TEXT, the rule this product's other two-span
                            labels follow (ReportControls' window note): the margin draws the gap
                            on screen, and anything reading `textContent` — a screen reader
                            included — gets «Retargeting 55.9%» rather than «Retargeting55.9%». */}
                        {r.share != null && (
                          <>{' '}<span className={`text-10 ml-2 rpt-share${model.shareBound ? ' rpt-sw' : ''}`}>{shareText(r.share)}</span></>
                        )}
                      </>
                    )}
                    {/* The line's own name has moved to its own column on the date × line
                        grain, so `sub` reads inline only where it is a second fact about the
                        SAME thing (the channel of a line-item row). */}
                    {r.sub && !model.subLabel && (
                      <span className="text-11 ml-2" style={{ color: 'var(--text-muted)' }}>{r.sub}</span>
                    )}
                    {r.paused && !model.subLabel && <>{' '}<PausedChip /></>}
                  </td>
                  {model.subLabel && (
                    // Name over «LI <id> · Channel», the legacy section's own two lines. The
                    // title carries the whole cell, because this is the one that can clip —
                    // and a line nobody renamed is called «LI <id>» already, so its id is not
                    // said twice on either line.
                    <td style={tdStyle(false)} title={subTitle(r)}>
                      <span className="rpt-sub">
                        <span className="rpt-sub-nm">
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{r.sub}</span>
                          {r.paused && <PausedChip />}
                        </span>
                        <span className="text-11 rpt-sub-id">{subUnder(r)}</span>
                      </span>
                    </td>
                  )}
                  {cols.map((c) => {
                    const shown = cellText(r.cells[c.id], c);
                    const planCol = isPlanCol(model, c.id);
                    // `highlightTextStyle` answers undefined where there is no highlight, and
                    // the fade test below reads a key off it.
                    const hl = highlightTextStyle(r.highlights?.[c.id]) || NO_STYLE;
                    // An empty PLAN cell means «no target was declared for this value», which
                    // is an ordinary state on this grain and not missing data — so it recedes
                    // and the column reads as sparse rather than broken. Inline, because the
                    // cell's own colour is inline and no class can reach it; skipped where a
                    // Highlight painted the cell, which is the author speaking.
                    const faint = planCol && shown === EM && !colErrorOf(model, c.id) && !hl.color;
                    const marked = c.id === planMarkCol;
                    const tip = marked ? partialTitle(r.planPartial) : null;
                    // One child when there is no mark: a table off this grain keeps exactly
                    // the markup it had, which is what every reader of these cells expects.
                    const content = marked
                      ? <>{shown}<PlanMark partial={!!r.planPartial} /></>
                      : shown;
                    return (
                      <td
                        key={c.id}
                        // The best and worst reading in a tinted column, green and red — the
                        // legacy panel's own mark, and the fastest read on a breakdown: which
                        // segment is working. The remainder is never a data point, so it never
                        // carries one (the model leaves it out of the comparison).
                        style={{ ...tdStyle(c.numeric), color: extremeColor(extremesOf(c), r.cells[c.id]) || tdStyle(c.numeric).color, ...(faint ? { color: 'var(--text-muted)' } : null), ...hl }}
                        title={joinTitles(joinTitles(highlightTitle(r.highlights?.[c.id]), tip),
                          r.cvReason && model.cvCols?.has(c.id) && shown === EM && !planCol && !colErrorOf(model, c.id) ? r.cvReason : null)}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {remaining > 0 && (
          <div
            className="text-13"
            onClick={() => setPage((p) => p + 1)}
            style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--status-blue)', cursor: 'pointer', borderTop: '1px solid var(--border-soft)', userSelect: 'none' }}
          >
            Show more ({remaining} remaining)
          </div>
        )}
      </div>
      {/* The author's limit, expanded and collapsed again in the legacy panel's own words.
          OUTSIDE the scroll box, so the control that lengthens the table is not itself at the
          bottom of it — «Show more» above pages within what is already drawn and stays where
          it was. */}
      {model.limit && rows.length > model.limit && (
        <div className="rpt-more">
          <button type="button" className="text-11 rpt-more-btn" onClick={() => setExpanded((x) => !x)}>
            {expanded ? `Collapse to ${model.limit}` : `Show all (${rows.length})`}
          </button>
        </div>
      )}
      {/* What the dimension SOURCE behind these rows covers, how far it disagrees with
          delivery and how old its rows are — the model's sentence, in the pie's own note
          slot one view over. Outside the scroll box, because it is a statement about the
          whole table and not about the last row of it. */}
      {/* What the plan half of this table covers, said ONCE. Without it a column of em dashes
          reads as a broken column rather than as «most values here carry no declared target»,
          and the asterisk has nothing to decode it. Outside the scroll box, beside the other
          two notes, in their voice and their slot. */}
      {planMarkCol && model.planDeclarable > 0 && (
        <div className="text-10" style={{ padding: '6px 12px 8px', color: 'var(--text-muted)' }}>
          {`Plan: declared for ${model.planDeclared} of ${model.planDeclarable} ${model.planDeclarable === 1 ? 'value' : 'values'}`}
          {anyPartial ? ' · * covers only part of the delivery beside it' : ''}
        </div>
      )}
      {model.shareError && <div className="text-10" style={{ padding: '6px 12px 8px', color: 'var(--text-muted)' }}>Row share: {model.shareError}</div>}
      {model.note ? (
        <div className="text-10" style={{ padding: '6px 12px 8px', color: 'var(--text-muted)' }}>
          {model.note}
        </div>
      ) : null}
    </div>
  );
}
