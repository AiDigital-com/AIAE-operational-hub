// workspace/src/pages/Dashboard/components/Widgets/Report/ReportCompare.jsx
//
// The v2 report's COMPARE view (widget-builder v2 spec 2026-08-19 §5.5; P2 plan Task 10).
// Delivery beside CM360: the same two lines, the same four row classes, the same expansion
// and the same words as the panel on the page below — because it is the same two components.
//
// NOTHING about the comparison is computed here. The numbers arrive on the §8.5 seams'
// output (T8): `projection` carries the pivot, the membership and the daily series, and
// `status` carries which of the fourteen states the comparison is in and what the person
// looking at it can do about it. This file answers three questions and no others: what the
// state's sentence SAYS, what a source that has not answered yet looks like, and which row
// the focus is on. It also WRITES the freshness and scope runs (`compareMetaRuns`) without
// drawing them — since section-widget parity those sit in the tile's control row, above the
// numbers they qualify, exactly where the legacy panel keeps them.
//
// CompareTable and CompareChart are imported, not re-implemented (plan Task 10: "if a prop
// is panel-shaped, add a prop — never fork the visual language"). Neither needed a new prop:
// the panel already drives row focus through `focusedId`/`onFocusRow`, which is the same
// wire §5.6 declares.
//
// PROPS ONLY, like the other four view renderers: the tile owns the fetch, the seams and the
// focus state, so this component reads no store and holds nothing across renders.
import CompareChart from '../thirdparty/CompareChart.jsx';
import CompareTable from '../thirdparty/CompareTable.jsx';
import { tupleKeyOf, UNMAPPED_KEY } from '../third-party-range.js';

/**
 * The copy, one sentence per `messageKey` the resolver names (compare-state.js keeps the
 * keys and leaves the words to whoever draws them). Two states are missing on purpose:
 * `loading` has no sentence (it draws the skeleton) and `ready` has nothing to say.
 *
 * The panel's own wording, with its dashes rewritten as sentences: the v2 copy rules keep
 * the em dash for the empty-cell placeholder and nothing else.
 */
const MESSAGES = {
  __proto__: null,
  noSourceConfigured: 'No CM360 source configured. Add one in Settings → Data.',
  pullingCm360: 'Pulling CM360 data…',
  pullFailed: 'CM360 pull failed. Retry from Settings → Data.',
  noCm360Rows: 'No CM360 rows landed yet, so there is nothing to compare.',
  noMappingYet: 'No mapping yet. Create one in Settings → Mapping.',
  creativesNotFetched: 'This mapping compares creatives, but delivery creatives are not fetched. Enable “Fetch creatives” in Settings → Data.',
  nothingClassified: 'Nothing classified yet. Build the library in Settings → Mapping.',
  unexpectedDateFormat: 'Could not build the comparison: unexpected date format in the data.',
  comparisonFailed: 'Could not build the comparison.',
  mappingSubstituted: 'The mapping this view was showing is gone. These numbers come from another one.',
  sourceStale: 'The CM360 file is older than the delivery it is compared against.',
};

/**
 * §7.7, the one state that must never be answered generically: a widget PINNED to a mapping
 * that is no longer on this pacing. It names the id it was pinned to and where to go — and
 * the tile shows no comparison at all, because quietly comparing against a different mapping
 * is a wrong answer with no symptom.
 *
 * The two repair kinds differ in where they send you, which the resolver has already decided:
 * a picker is a repair only when there is something in it.
 */
function fixedMappingSentence(repair) {
  const named = repair && repair.missingId ? `“${repair.missingId}”` : 'a mapping';
  return repair && repair.kind === 'createMapping'
    ? `This widget compares against ${named}, and this pacing has no mapping at all. Create one in Settings → Mapping.`
    : `This widget compares against ${named}, which is no longer on this pacing. Choose a mapping in Settings → Mapping.`;
}

export function compareStateSentence(status) {
  if (!status) return null;
  if (status.state === 'unsupportedFilters') return status.filterReason;
  if (status.state === 'fixedMappingMissing') return fixedMappingSentence(status.repairAction);
  const key = status.messageKey;
  return (key && Object.prototype.hasOwnProperty.call(MESSAGES, key) && MESSAGES[key]) || null;
}

/** 'YYYY-MM-DDTHH:MM:SSZ' → local 'HH:MM'; null when unparseable (the panel's own). */
function fmtUpdated(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** ISO 'YYYY-MM-DD' → 'Sep 30'; falls back to the raw string (the panel's own). */
function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso));
  return m ? `${MON[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}` : String(iso == null ? '' : iso);
}

/**
 * What the two sides cover, in the panel's own words: when the source was last read, how far
 * the comparison has common days, and — at creative level — how much of delivery the named
 * creatives account for. §8.3: freshness describes the SOURCE, never the selected window.
 */
function coverageLine(dataset, projection, status) {
  const parts = [];
  const updated = fmtUpdated(status && status.freshness && status.freshness.fetchedAt);
  if (updated) parts.push(`CM360 updated ${updated}`);
  const through = projection && projection.pivot && projection.pivot.lastCommonDay;
  if (through) parts.push(`data through ${fmtDay(through)}`);
  const cov = dataset && dataset.creativeCoverage;
  if (cov != null && cov < 0.995) parts.push(`creative rows cover ${Math.round(cov * 100)}% of delivery`);
  return parts.join(' · ');
}

/** How much of the pivot is actually comparable, shown only when something is one-sided
 *  (v3.1 §10-1): the overlap count leads, so the compared set is legible against the noise. */
function scopeLine(projection) {
  const counts = (projection && projection.scopeCounts) || null;
  if (!counts || (counts.deliveryOnly === 0 && counts.cm360Only === 0)) return '';
  const parts = [`${counts.overlap} ${counts.overlap === 1 ? 'slice' : 'slices'} compared`];
  if (counts.deliveryOnly > 0) parts.push(`${counts.deliveryOnly} delivery-only`);
  if (counts.cm360Only > 0) parts.push(`${counts.cm360Only} CM360-only`);
  return parts.join(' · ');
}

/**
 * The tile's source meta, as the panel writes it (ThirdPartyPanel.jsx:513-520): what the
 * CM360 file covers, then how much of the comparison is two-sided.
 *
 * TWO runs, kept apart. The panel prints two spans with a gap and this view used to join
 * all five fragments with ` · `, which reads as one chain nobody finishes
 * (section-widget parity 2026-09-04, third-party audit rows 1 and 6). It is EXPORTED
 * because the tile draws it now: the two lines qualify every number under them, so they
 * belong at the top of the tile beside the switch rather than at the foot of the table,
 * where a long comparison puts them off screen.
 */
export function compareMetaRuns({ dataset = null, projection = null, status = null } = {}) {
  return [coverageLine(dataset, projection, status), scopeLine(projection)].filter(Boolean);
}

export default function ReportCompare({
  view, projection, status, metric = 'impressions',
  focusedKey = null, onFocusRow = null, onOpenMapping = null,
}) {
  const sentence = compareStateSentence(status);
  const ready = !!(status && status.modelReady) && !!projection;
  const focusedId = focusedKey != null ? JSON.stringify(focusedKey) : null;
  const getMembers = (rowKey) => (
    (projection.memberOrder && projection.memberOrder.get(rowKey === 'unmapped' ? UNMAPPED_KEY : tupleKeyOf(rowKey)))
    || { delivery: [], cm360: [] }
  );

  return (
    <div className="rpt-view">
      {view?.title ? <div className="text-11 rpt-view-title">{view.title}</div> : null}
      {!ready ? (
        // A source still being read is not a sentence. The panel draws a box the size of the
        // comparison that is coming (ThirdPartyPanel.jsx:136-145) so the page under it does not
        // jump when the numbers land; the word «Loading…» in a 120px box moved the tile 400px
        // (section-widget parity 2026-09-04, third-party audit row 3). Every other state below
        // has something to SAY, and says it.
        status && status.state === 'loading'
          ? <div className="rpt-compare-skel" />
          : <div className="rpt-state">{sentence || 'Loading…'}</div>
      ) : (
        <div className="rpt-compare">
          {/* A note that still draws numbers (a substituted mapping, a stale file) sits ABOVE
              them: it changes how every number below should be read. */}
          {sentence && <div className="rpt-note">{sentence}</div>}
          <CompareChart daily={projection.chartDaily} />
          {/* The scope note row is always rendered at a fixed height (the panel's own rule),
              so a chip appearing and disappearing never shifts what is under it. */}
          <div className="tp-chart-note-row">
            {focusedKey != null ? (
              <button
                type="button"
                className="tp-focus-chip"
                // The panel's own wording, which names WHAT the focus is on
                // (ThirdPartyPanel.jsx:540). Its long dash is a colon here: the copy rule keeps
                // the em dash for the empty-cell placeholder and nothing else.
                aria-label={`Clear chart focus: ${focusedKey.join(' · ')}`}
                onClick={() => onFocusRow && onFocusRow(focusedKey)}
              >
                {focusedKey.join(' · ')}
                <span className="tp-focus-x" aria-hidden="true">✕</span>
              </button>
            ) : (projection.selectedDims.length > 0 && projection.chartDaily.length > 0
              ? <span className="tp-chart-note">Overlap only</span>
              : null)}
          </div>
          <CompareTable
            rows={projection.pivot.rows}
            unmapped={projection.pivot.unmapped}
            dims={projection.selectedDims}
            metric={metric}
            getMembers={getMembers}
            focusedId={focusedId}
            onFocusRow={onFocusRow || undefined}
            // The Unmapped row's «Classify →» (CompareTable.jsx:293-315): the hint, the
            // cursor, the click and the Enter/Space, all of which the component has always
            // had and this view used to withhold by passing nothing. `undefined` and not
            // `null` — the component branches on truthiness and reads the absent prop as
            // "no route", which is what a surface with no drawer behind it should get.
            onOpenMapping={onOpenMapping || undefined}
          />
          {/* No meta line here any more: `compareMetaRuns` above is drawn by the tile, in the
              control row's right-hand slot — the panel's own placement. */}
        </div>
      )}
    </div>
  );
}
