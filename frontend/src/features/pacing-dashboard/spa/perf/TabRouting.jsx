// workspace/src/pages/Dashboard/components/Settings/PerformanceSourceEditor/TabRouting.jsx
//
// "Route the values": which line item each value combination of a split tab
// belongs to. The Additional-data matching screen's layout and voice, over the
// data.sheet split shape (1 to 3 columns, up to 200 rules).
//
// The values come from the exhaustive read (/dim-source-values: the whole tab
// counted, the 500 most frequent combinations back), folded the way the
// converter matches them, so a value routed here is a value the refresh routes.
// A stored rule whose value the read did not return stays on the list, marked;
// it is never dropped behind the person's back.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../settings-api.js';
import LiSelect from '../LiSelect.jsx';
import { probeErrorText } from '../sheet-source-norm.js';
import {
  splitColumns, setSplitColumn, addSplitColumn, removeSplitColumn, routeValue, mergeValueRows,
  routeAutomatic, canAddRule, ruleKey, lineItemLabel, RULE_CAP, SPLIT_COLUMN_CAP,
} from '../perf-mapping.js';

const clean = (v) => String(v == null ? '' : v).trim();
const int = (n) => Number(n || 0).toLocaleString('en-US');
export const PAGE_SIZE = 25;

/** What a failed read says. The probe's table already has the sharing and size cases. */
export function readErrorText(error, shareWith = null) {
  if (error === 'rate_limited') return 'Too many reads in a minute; try again shortly.';
  if (error === 'sheet_header_mismatch') return 'A split column is not in the sheet now; pick another.';
  return probeErrorText(error, shareWith);
}

/**
 * The exhaustive value read for a split tab. Mounted in TabColumns, not here,
 * so leaving and returning to the routing screen does not read the sheet again.
 *
 * Every outcome is kept by key (the columns it was read with): leaving the
 * screen mid-read does not lose the answer, coming back to a key already read
 * costs nothing, and only "Read the values again" forgets a key. A result is
 * only ever shown for the columns it was read with.
 */
export function useValueRead({ slug, spreadsheetId, sheetId, columns, headerRow, enabled }) {
  const cols = (columns || []).map(clean);
  const readKey = slug && spreadsheetId && Number.isInteger(sheetId) && cols.length && cols.every(Boolean)
    ? JSON.stringify([slug, spreadsheetId, sheetId, headerRow || 0, cols]) : null;
  const key = enabled ? readKey : null;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key: null, loading: false, result: null, error: null, shareWith: null });
  const cache = useRef(new Map());     // key -> { result, error, shareWith }
  const inflight = useRef(new Map());  // key -> promise of that outcome
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const settle = (outcome) => { if (live) setState({ key, loading: false, ...outcome }); };
    const hit = cache.current.get(key);
    if (hit) { settle(hit); return () => { live = false; }; }
    setState({ key, loading: true, result: null, error: null, shareWith: null });
    let promise = inflight.current.get(key);
    if (!promise) {
      promise = api.sheetDimValues(slug, spreadsheetId, sheetId, cols, headerRow || 0)
        .then((r) => (!r || r.ok !== true
          ? { result: null, error: r?.error || 'values_failed', shareWith: r?.share_with || null }
          : { result: r, error: null, shareWith: null }))
        .catch((e) => ({ result: null, error: e?.status === 429 ? 'rate_limited' : (e?.message || 'values_failed'), shareWith: null }))
        .then((outcome) => { cache.current.set(key, outcome); inflight.current.delete(key); return outcome; });
      inflight.current.set(key, promise);
    }
    promise.then(settle);
    return () => { live = false; };
  }, [key, attempt]);
  const current = state.key === readKey ? state : { loading: false, result: null, error: null, shareWith: null };
  return {
    ready: !!readKey, loading: !!current.loading, result: current.result, error: current.error, shareWith: current.shareWith,
    retry: () => { if (readKey) { cache.current.delete(readKey); inflight.current.delete(readKey); } setAttempt((n) => n + 1); },
  };
}

export default function TabRouting({
  tab, columns: knownColumns, lineItems, liById, takenIds, read, onChange, onBack, onAddLineItem = null,
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [hand, setHand] = useState(null);            // { values: [] } while a value is typed by hand
  const [extra, setExtra] = useState([]);            // values added by hand, not routed yet
  const [autoNote, setAutoNote] = useState(null);
  const [handNote, setHandNote] = useState(null);
  const columnsKey = splitColumns(tab).join('|');
  useEffect(() => { setExtra([]); setHand(null); setAutoNote(null); setHandNote(null); }, [columnsKey]);

  const cols = splitColumns(tab);
  const filled = cols.length > 0 && cols.every(Boolean);
  const rules = tab.split?.rules || [];
  const values = read.result?.values || null;
  const known = new Set((lineItems || []).map((li) => String(li.id)));

  const rows = useMemo(() => {
    const merged = mergeValueRows({ tab, values, lineItems, takenIds });
    const seen = new Set(merged.map((r) => r.key));
    for (const v of extra) {
      const key = ruleKey(v);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ key, values: v, rows: null, inSheet: true, lineItemId: '', automaticLineItemId: null, takenLineItemId: false, hand: true });
    }
    return merged;
  }, [tab, values, lineItems, takenIds, extra]);

  // A rule with a blank part (a split column just added) can match no row: not routed.
  const routed = rows.filter((r) => r.lineItemId && r.values.every(Boolean)).length;
  const counted = rows.filter((r) => r.rows !== null);
  const listedRows = counted.reduce((n, r) => n + r.rows, 0);
  // A truncated read lists the 500 most frequent values; the tab's rows beyond
  // them are unrouted too, so the totals come from the whole scan.
  const truncated = !!read.result?.truncated;
  const rowsTotal = truncated ? Math.max(listedRows, Number(read.result?.scanned_rows) || 0) : listedRows;
  const rowsRouted = counted.filter((r) => r.lineItemId && r.values.every(Boolean)).reduce((n, r) => n + r.rows, 0);
  const skipped = rowsTotal - rowsRouted;
  const autoCount = rows.filter((r) => !r.lineItemId && r.automaticLineItemId).length;
  const full = !canAddRule(tab);
  const rowsWord = (n) => `${int(n)} row${n === 1 ? '' : 's'}`;
  const valuesWord = (n) => `${int(n)} value${n === 1 ? '' : 's'}`;

  const shown = rows.filter((r) => !query.trim() || r.values.join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = shown.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const route = (rowValues, id) => { setAutoNote(null); setHandNote(null); onChange(routeValue(tab, rowValues, id, takenIds)); };
  const matchByNumber = () => {
    setHandNote(null);
    if (full) { setAutoNote(`Routing is full at ${int(RULE_CAP)} rules; ${valuesWord(autoCount)} that carry a line-item number ${autoCount === 1 ? 'is' : 'are'} still unrouted.`); return; }
    const { tab: next, routed: n } = routeAutomatic(tab, rows);
    if (n) { onChange(next); setAutoNote(`${valuesWord(n)} routed by the line-item number in ${n === 1 ? 'it' : 'them'}.`); }
    else setAutoNote('No unrouted value carries a line-item number of this pacing.');
  };
  const matchTitle = !read.result ? 'Read the values first'
    : full ? `Routing is full: ${int(RULE_CAP)} rules`
      : autoCount ? undefined : 'No unrouted value carries a line-item number';
  const addByHand = () => {
    if (!hand) return;
    const vals = (hand.values || []).map(clean);
    if (vals.length !== cols.length || vals.some((v) => !v)) return;
    const key = ruleKey(vals);
    const shown = vals.join(' ');
    setHand(null);
    setPage(0);
    // The search shows the row this click produced, wherever it sits in the list.
    setQuery(shown);
    if (rows.some((r) => r.key === key)) { setHandNote(`“${shown}” is already in the list.`); return; }
    setHandNote(null);
    setExtra((cur) => [...cur, vals]);
  };

  const otherChosen = (i) => new Set(cols.filter((_, j) => j !== i));
  // Every column of the tab may tell the rows apart, whatever else it does.
  const columnOptions = (i) => (knownColumns || []).filter((c) => !otherChosen(i).has(c));

  return (
    <div className="am-page am-page--task">
      <button type="button" className="am-back" onClick={onBack}>← Columns</button>
      <header className="am-header">
        <div>
          <div className="am-eyebrow">Line item · the values in the sheet</div>
          <h3>Which line item each value belongs to</h3>
          <p>Each value routes its rows to one pacing line item. Rows whose value matches no rule are skipped, and the refresh reports how many.</p>
        </div>
        <div className="am-header-actions">
          <button type="button" className="sp-btn sp-btn-s" disabled={!filled || read.loading} onClick={read.retry}
            title={filled ? undefined : 'Pick every split column first'}>
            {read.loading ? 'Reading…' : read.result ? 'Read the values again' : 'Read the values'}
          </button>
          <button type="button" className="sp-btn sp-btn-s" disabled={!autoCount || full} onClick={matchByNumber}
            title={matchTitle}>
            Match by the line-item number
          </button>
        </div>
      </header>

      <section className="am-section">
        <div className="am-section-head">
          <div>
            <h4>Rows are told apart by</h4>
            <p>Up to {SPLIT_COLUMN_CAP} columns; a rule names one value per column.</p>
          </div>
        </div>
        <div className="ps-split-cols">
          {cols.map((c, i) => (
            <label className="am-field" key={i}><span>{i === 0 ? 'Column' : 'and by'}</span>
              <select className="sp-inp" value={c} aria-label={i === 0 ? 'Split column' : `Split column ${i + 1}`}
                onChange={(e) => onChange(setSplitColumn(tab, i, e.target.value))}>
                <option value="">Pick a column</option>
                {(c && !columnOptions(i).includes(c)) && <option value={c}>{c}</option>}
                {columnOptions(i).map((name) => <option key={name} value={name}>{name}</option>)}
              </select></label>
          ))}
        </div>
        <div className="am-actions">
          {cols.length < SPLIT_COLUMN_CAP && (
            <button type="button" className="am-text-button" onClick={() => onChange(addSplitColumn(tab, ''))}>+ Add a column</button>
          )}
          {cols.length > 1 && (
            <button type="button" className="am-text-button" onClick={() => onChange(removeSplitColumn(tab, cols.length - 1))}>Remove the last column</button>
          )}
          {rules.length > 0 && (
            <span className="am-hint">Changing the columns changes what every rule matches; check the list afterwards.</span>
          )}
        </div>
      </section>

      <div className="am-summary">
        <strong>{int(routed)} of {valuesWord(rows.length)} routed</strong>
        <span>{values
          ? `${rowsWord(rowsRouted)} of ${int(rowsTotal)} go to a line item${skipped ? ` · ${rowsWord(skipped)} would be skipped` : ''}${truncated ? ' · the list holds the 500 most frequent values' : ''}`
          : rules.length
            ? `${int(rules.length)} stored rule${rules.length === 1 ? '' : 's'}; ${filled ? 'read the values' : 'pick every split column'} to see the rows behind them`
            : 'No rules yet'}</span>
      </div>

      {!filled && <div className="am-state">Pick every split column, then the values can be read.</div>}
      {read.loading && <div className="am-state">Reading the values…</div>}
      {read.error && (
        <div className="am-state am-state--error">{readErrorText(read.error, read.shareWith)}
          <button type="button" className="am-text-button" onClick={read.retry}>Retry</button></div>
      )}
      {read.result?.truncated && <div className="am-note">Showing the 500 most frequent values; narrow the split columns if what you need is missing.</div>}
      {full && <div className="am-note">Routing is full: {int(RULE_CAP)} rules. Remove one to add another.</div>}
      {autoNote && <div className="am-note">{autoNote}</div>}
      {handNote && <div className="am-note">{handNote}</div>}

      <input className="sp-inp am-search" value={query} placeholder={`Search ${int(rows.length)} value${rows.length === 1 ? '' : 's'}`}
        aria-label="Search values" onChange={(e) => { setQuery(e.target.value); setPage(0); }} />

      {shown.length > 0 && (
        <div className="am-list-nav">
          <span>{int(safePage * PAGE_SIZE + 1)}–{int(Math.min(shown.length, (safePage + 1) * PAGE_SIZE))} of {valuesWord(shown.length)}</span>
          {pageCount > 1 && (
            <div className="am-actions">
              <button type="button" className="sp-btn sp-btn-s" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}>Previous</button>
              <button type="button" className="sp-btn sp-btn-s" disabled={safePage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}>Next</button>
            </div>
          )}
        </div>
      )}

      <div className="am-match-list">
        {pageRows.map((row) => {
          const missing = !!row.lineItemId && !known.has(row.lineItemId);
          const blocked = !row.lineItemId && full;
          return (
            <div className="am-match-row" key={row.key}>
              <div className="am-match-name">
                <strong>{row.values.map((v) => v || '(blank)').join(' · ')}</strong>
                <span>{row.rows !== null ? `${int(row.rows)} row${row.rows === 1 ? '' : 's'}`
                  : row.hand ? 'added by hand' : row.inSheet ? 'stored rule' : 'not in the sheet’s values'}</span>
              </div>
              <div className="am-match-result">
                <LiSelect value={row.lineItemId} lineItems={lineItems} takenIds={[...takenIds]} disabled={blocked}
                  onAddLineItem={onAddLineItem} onChange={(v) => route(row.values, v)}>
                  <option value="">Not routed · rows are skipped</option>
                  {missing && <option value={row.lineItemId} disabled>Previously LI {row.lineItemId}; no longer in this pacing</option>}
                </LiSelect>
                {missing && <span className="am-inline-warning">Previously LI {row.lineItemId}; no longer in this pacing. Pick another, or clear the rule.</span>}
                {row.takenLineItemId && !missing && <span className="am-inline-warning">Another tab already feeds {lineItemLabel(liById, row.lineItemId)}; the save refuses two.</span>}
                {!row.lineItemId && row.automaticLineItemId && !blocked && (
                  <button type="button" className="am-text-button" onClick={() => route(row.values, row.automaticLineItemId)}>
                    Route to {lineItemLabel(liById, row.automaticLineItemId)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!shown.length && !read.loading && (
        <div className="am-empty">{rows.length ? 'No value matches that search.' : filled ? 'No values yet. Read the sheet, or add a value by hand.' : 'Pick the split columns first.'}</div>
      )}

      {hand ? (
        <div className="am-note">
          <strong>Add a value by hand</strong>
          <div className="ps-hand">
            {cols.map((c, i) => (
              <label className="am-field" key={i}><span>{c || `Column ${i + 1}`}</span>
                <input className="sp-inp" list={`ps-values-${i}`} value={hand.values[i] || ''} autoFocus={i === 0}
                  onChange={(e) => setHand({ values: hand.values.map((v, j) => (j === i ? e.target.value : v)) })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addByHand(); } }} />
                <datalist id={`ps-values-${i}`}>
                  {[...new Set((values || []).map((v) => clean((v.values || [])[i])).filter(Boolean))].slice(0, 200).map((v) => <option key={v} value={v} />)}
                </datalist></label>
            ))}
          </div>
          <div className="am-actions">
            <button type="button" className="sp-btn sp-btn-p" disabled={hand.values.length !== cols.length || hand.values.some((v) => !clean(v))} onClick={addByHand}>Add</button>
            <button type="button" className="sp-btn sp-btn-s" onClick={() => setHand(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="am-actions">
          <button type="button" className="am-text-button" disabled={!filled || full} onClick={() => setHand({ values: cols.map(() => '') })}>+ Add a value by hand</button>
        </div>
      )}

      <div className="am-actions">
        <button type="button" className="sp-btn sp-btn-p" onClick={onBack}>
          {values && skipped ? `Continue with ${rowsWord(skipped)} skipped` : 'Done'}
        </button>
      </div>
    </div>
  );
}
