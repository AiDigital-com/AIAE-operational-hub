// Additional-source mapping — ONE screen that asks one question: here is your
// sheet, what does each column mean.
//
// Spec: docs/superpowers/specs/2026-08-14-additional-data-one-screen.md
//
// It used to ask five questions across two tabs — source fields, then line-item
// matching, then a library per column, each its own screen — which made a person
// learn the system's shape before describing their own file. Now: a list of the
// sheet's columns, each with a role, and two ways deeper for the two long jobs:
//
//   Route the names →   which line item each source name belongs to
//   Tidy up values →    merge spellings of one thing inside one breakdown
//
// Both of those are the SAME screens as before; only the ceremony around them is
// gone. Storage is untouched: origin.columns keeps {date, line_item, dims[],
// metrics{}, custom_metrics[]}, binding and groups keep their shapes.
//
// Data owns only the connection. Display/widgets own presentation. Neither is
// rendered here. The drawer owns Save, and Save is what schedules the read —
// nothing on this screen reads the sheet by itself.

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './settings-api.js';
import {
  DIM_METRIC_SLOTS, describeTabColumns, freeColumns,
  renameBreakdown, repointBreakdown, removeBreakdown,
  reservedDimKeys, widgetsUsingBreakdown, acceptBindings, setBreakdownDim,
} from './sheet-source-norm.js';
import {
  GROUPS, OFF_PREVIEW, SEARCH_FROM, CARDINALITY_LIMIT,
  columnRows, roleChoices, applyRole, applySingleLineItem, costOfRole,
  statusOf, sizeOf, addCustomMetric, customMetricsOf,
} from './mapping-columns.js';
import {
  additionalMappingStage, lineItemMatches, lineItemNameKey,
  librarySourceValues, libraryValuesFromRows, libraryModel, libraryReadSignature,
  lineItemVocabularySignature, lineItemValuesFromAux, foldedMetricWeights, libraryMetricView,
  removedLibrarySnapshot, restoreRemovedLibrary,
} from './additional-mapping.js';
import { fold, groupCandidates } from './dim-groups.js';
import { FILTERABLE_DIMS } from './breakdown-filter.js';
import {
  createGroup, addToGroup, renameGroup, splitGroup, ungroup,
  ignoreValues, unignoreValues, dismissSuggestion, undismissSuggestion, isDismissed,
  pushHistory, canUndo, undoLabel, undo, reviewModel, searchValues,
} from './dim-value-editor.js';
import { valueTally } from './dim-group-rules.js';
import LiSelect from './LiSelect.jsx';

const VALUE_CACHE = new Map();
const VALUE_CACHE_MS = 30000;
const LI_PAGE_SIZE = 25;
const VALUE_PAGE_SIZE = 50;
const int = (n) => Number(n || 0).toLocaleString('en-US');
const pct = (n) => `${Number(n || 0).toFixed(Number(n || 0) >= 10 ? 0 : 1)}%`;
const metricAmount = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const noun = (n, one, many = `${one}s`) => `${int(n)} ${Number(n) === 1 ? one : many}`;
// Megabytes for humans: 6.6 MB, 24 MB — never 6.6015625.
const mb = (bytes) => {
  const v = Number(bytes || 0) / 1048576;
  if (v < 0.05) return 'under 0.1 MB';   // "0.0 MB" is not a size anyone can act on
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} MB`;
};

function probeError(error) {
  if (!error) return null;
  if (error === 'sheet_not_shared' || error === 'sheet_not_accessible') return 'The spreadsheet is no longer accessible.';
  if (error === 'rate_limited') return 'Too many sheet checks just now — try again in a minute.';
  return 'Could not read the spreadsheet structure. Try again.';
}

function useSourceProbe(slug, source, enabled = true) {
  const spreadsheetId = source?.origin?.spreadsheet_id;
  const sheetId = source?.origin?.sheet_id;
  const [state, setState] = useState({ loading: false, response: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const keyRef = useRef(null);

  useEffect(() => {
    if (!enabled || !slug || !spreadsheetId) return undefined;
    const key = `${slug}|${spreadsheetId}|${attempt}`;
    if (keyRef.current === key) return undefined;
    keyRef.current = key;
    let live = true;
    let completed = false;
    setState({ loading: true, response: null, error: null });
    api.sheetProbe(slug, `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`)
      .then((r) => {
        completed = true;
        if (!live) return;
        if (!r || r.ok !== true) setState({ loading: false, response: null, error: r?.error || 'probe_failed' });
        else setState({ loading: false, response: r, error: null });
      })
      .catch(() => {
        completed = true;
        if (live) setState({ loading: false, response: null, error: 'probe_failed' });
      });
    return () => {
      live = false;
      // If navigation cancelled an in-flight check, the same task must be able
      // to start it again. Completed responses stay reusable within this editor.
      if (!completed && keyRef.current === key) keyRef.current = null;
    };
  }, [enabled, slug, spreadsheetId, attempt]);

  const tab = (state.response?.tabs || []).find((t) => t.sheet_id === sheetId) || null;
  const wanted = source?.origin?.header_row;
  const grid = Array.isArray(tab?.grid) ? tab.grid : null;
  const row = Number.isInteger(wanted) && grid?.[wanted] ? wanted : tab?.header_row;
  // The detected row has a full A:CV header/sample. `grid` exists for manual
  // header correction and used to be clipped; preferring it here hid columns
  // 31-100 even on an ordinary detected header.
  const detected = row === tab?.header_row && Array.isArray(tab?.headers) && tab.headers.length;
  const headers = detected ? tab.headers : row >= 0 && grid?.[row] ? grid[row] : [];
  const sample = detected ? ((tab?.sample || [])[0] || [])
    : row >= 0 && grid?.[row + 1] ? grid[row + 1] : [];
  return { ...state, tab, headers: headers.map((h) => String(h == null ? '' : h).trim()), sample,
    retry: () => { keyRef.current = null; setAttempt((n) => n + 1); } };
}

function useSourceValues(slug, source, columns, enabled = true) {
  const spreadsheetId = source?.origin?.spreadsheet_id;
  const sheetId = source?.origin?.sheet_id;
  const clean = (columns || []).filter(Boolean);
  const headerRow = source?.origin?.header_row ?? 0;
  const key = enabled && slug && spreadsheetId && Number.isInteger(sheetId) && clean.length
    ? `${slug}|${spreadsheetId}|${sheetId}|${headerRow}|${clean.join('\u0000')}` : null;
  const [attempt, setAttempt] = useState(0);
  const cached = key ? VALUE_CACHE.get(key) : null;
  const [state, setState] = useState(() => (cached && Date.now() - cached.at < VALUE_CACHE_MS
    ? { loading: false, result: cached.value, error: null }
    : { loading: false, result: null, error: null }));

  useEffect(() => {
    if (!key) { setState({ loading: false, result: null, error: null }); return undefined; }
    const hit = VALUE_CACHE.get(key);
    if (hit && Date.now() - hit.at < VALUE_CACHE_MS) {
      setState({ loading: false, result: hit.value, error: null });
      return undefined;
    }
    let live = true;
    setState({ loading: true, result: null, error: null });
    api.sheetDimValues(slug, spreadsheetId, sheetId, clean, headerRow)
      .then((r) => {
        if (!live) return;
        if (!r || r.ok !== true) setState({ loading: false, result: null, error: r?.error || 'values_failed' });
        else {
          VALUE_CACHE.set(key, { value: r, at: Date.now() });
          setState({ loading: false, result: r, error: null });
        }
      })
      .catch(() => { if (live) setState({ loading: false, result: null, error: 'values_failed' }); });
    return () => { live = false; };
  }, [key, attempt]);

  return { ...state, retry: () => {
    if (key) VALUE_CACHE.delete(key);
    setAttempt((n) => n + 1);
  } };
}

function statusText(stage) {
  if (stage === 'connected') return 'Source setup not started';
  if (stage === 'source_setup') return 'Source setup incomplete';
  if (stage === 'no_libraries') return 'Ready for its first library';
  return 'Ready';
}

function mappingStatus(stage, saved, runtime) {
  if (!saved) return 'Changes not saved';
  if (runtime?.reading) return 'Reading current mapping…';
  if (stage !== 'ready') return statusText(stage);
  if (runtime?.status === 'stale') return runtime?.rows > 0
    ? `Last read failed · previous values remain available${runtime.error ? ` · ${runtime.error}` : ''}`
    : `Could not read this mapping${runtime.error ? ` · ${runtime.error}` : ''}`;
  if (runtime?.status === 'ok' || runtime?.fetched_at) return `Ready · ${int(runtime?.rows)} rows read`;
  return 'Saved · waiting for the first read';
}

function StructureNotice({ issue, onRetry }) {
  if (!issue) return null;
  return <div className={`am-state${issue.error ? ' am-state--error' : ''}`}>
    <span>{issue.message}</span>
    {onRetry && <button type="button" className="am-text-button" onClick={onRetry}>Retry source check</button>}
  </div>;
}

export default function AdditionalMappingEditor({
  source, savedSource, slug, lineItems, rows, bound, unbound, runtime, saved, initialView,
  profile, widgets, onRemoveWidgetsForDim, onRestoreWidgetsForDim, onOpenBreakdown,
  onCreateWidget, onChange,
  // Opens the Add-LI dialog from a line-item picker (LiSelect picks the first
  // added id back into it). Absent = plain pickers.
  onAddLineItem = null,
}) {
  const [view, setView] = useState(() => (initialView === 'binding' ? 'line-items' : 'columns'));
  const [undoState, setUndoState] = useState(null);
  // The one screen IS the task that needs sheet structure, so it probes on open.
  // The list renders from the stored mapping meanwhile; the sample column fills
  // in when the probe lands.
  const probe = useSourceProbe(slug, source, true);

  useEffect(() => { setUndoState(null); }, [source.id]);

  const structureReady = !!probe.tab && !probe.loading && !probe.error;
  const structureIssue = probe.error ? {
    error: false,
    message: `${probeError(probe.error)} Roles, names and value libraries stay editable; only pointing a role at another column needs the sheet.`,
  } : probe.response && !probe.tab ? {
    error: true,
    message: 'The connected tab no longer exists. Existing library values remain editable, but source fields and columns cannot be changed.',
  } : null;

  // One slot, because one accidental keystroke is what it is for. Restoring puts
  // back the whole source — role, dictionary, binding — plus any dashboard block
  // the same act removed.
  const remember = (label, widgetSnapshots = []) => setUndoState({ source, label, widgetSnapshots });
  const undoLast = () => {
    if (!undoState) return;
    onChange(undoState.source);
    if (undoState.widgetSnapshots.length) onRestoreWidgetsForDim?.(undoState.widgetSnapshots);
    setUndoState(null);
  };

  if (view === 'line-items') {
    return (
      <LineItemMatching
        key={source.id}
        source={source}
        savedSource={savedSource}
        slug={slug}
        lineItems={lineItems}
        bound={bound}
        unbound={unbound}
        saved={saved}
        onChange={onChange}
        onDone={() => setView('columns')}
        onAddLineItem={onAddLineItem}
      />
    );
  }

  if (view.startsWith('library:')) {
    const key = view.slice(8);
    const dim = (source.origin?.columns?.dims || []).find((d) => d.key === key);
    if (dim) {
      return (
        <ValueLibrary
          key={dim.key}
          source={source}
          savedSource={savedSource}
          dim={dim}
          slug={slug}
          lineItems={lineItems}
          saved={saved}
          runtime={runtime}
          rows={rows}
          headers={probe.headers}
          structureReady={structureReady}
          structureIssue={structureIssue}
          onRetryStructure={probe.retry}
          widgets={widgets}
          onRemoveLibrary={(removeWidgets) => {
            const snapshot = removedLibrarySnapshot(source, dim.key, widgets, removeWidgets);
            remember(`removing “${dim.label || dim.key}”`, snapshot ? snapshot.widgetSnapshots : []);
            if (removeWidgets) onRemoveWidgetsForDim?.(source.id, dim.key);
            onChange(removeBreakdown(source, dim.key));
            setView('columns');
          }}
          onOpenBreakdown={onOpenBreakdown}
          onCreateWidget={onCreateWidget}
          onChange={onChange}
          onBack={() => setView('columns')}
        />
      );
    }
  }

  return (
    <ColumnScreen
      source={source}
      savedSource={savedSource}
      lineItems={lineItems}
      rows={rows}
      bound={bound}
      unbound={unbound}
      runtime={runtime}
      saved={saved}
      profile={profile}
      widgets={widgets}
      headers={probe.headers}
      sampleRow={probe.sample}
      probing={probe.loading}
      structureReady={structureReady}
      structureIssue={structureIssue}
      onRetryStructure={probe.retry}
      undoState={undoState}
      onRemember={remember}
      onUndo={undoLast}
      onRemoveWidgetsForDim={onRemoveWidgetsForDim}
      onOpenLineItems={() => setView('line-items')}
      onOpenLibrary={(key) => setView(`library:${key}`)}
      onOpenBreakdown={onOpenBreakdown}
      onCreateWidget={onCreateWidget}
      onChange={onChange}
      onAddLineItem={onAddLineItem}
    />
  );
}

/* ── the one screen ────────────────────────────────────────────────────────── */

function ColumnScreen({
  source, savedSource, lineItems, rows, bound, unbound, runtime, saved, profile, widgets,
  headers, sampleRow, probing, structureReady, structureIssue, onRetryStructure,
  undoState, onRemember, onUndo, onRemoveWidgetsForDim,
  onOpenLineItems, onOpenLibrary, onOpenBreakdown, onCreateWidget, onChange,
  onAddLineItem = null,
}) {
  const [query, setQuery] = useState('');
  const [showAllOff, setShowAllOff] = useState(false);
  const [open, setOpen] = useState(null);              // column name
  const [confirm, setConfirm] = useState(null);        // { column, role, cost }
  const [newMetric, setNewMetric] = useState(null);    // { column, name, format, error }

  const cols = source.origin?.columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  // The mapping is the fallback list of columns: a failed probe must not empty
  // the screen of the roles somebody already set.
  const known = useMemo(() => {
    const list = (headers || []).map((h) => String(h == null ? '' : h).trim()).filter(Boolean);
    if (list.length) return list;
    const fromProfile = (profile?.columns || []).map((c) => c.name).filter(Boolean);
    if (fromProfile.length) return fromProfile;
    return [cols.date, cols.line_item, ...dims.map((d) => d.column),
      ...Object.values(cols.metrics || {})].filter(Boolean);
  }, [headers, profile, cols, dims]);

  const description = useMemo(() => (headers?.length
    ? describeTabColumns(headers, sampleRow) : null), [headers, sampleRow]);
  const list = useMemo(() => columnRows({
    source, headers: known, sampleRow, profile, rows,
    ambiguous: description?.ambiguous || [], duplicates: description?.duplicates || [],
  }), [source, known, sampleRow, profile, rows, description]);
  const status = useMemo(() => statusOf({ source, profile, rows, lineItems, runtime, bound, unbound }),
    [source, profile, rows, lineItems, runtime, bound, unbound]);
  const choices = useMemo(() => roleChoices(source), [source]);

  const matches = (row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return row.column.toLowerCase().includes(q)
      || String(row.dim?.label || '').toLowerCase().includes(q);
  };
  const found = list.filter(matches);

  const write = (next, label, widgetSnapshots = []) => {
    onRemember(label, widgetSnapshots);
    onChange(next);
  };

  const setRole = (column, role) => {
    if (role === '__new_metric__') {
      setNewMetric({ column, name: column, format: 'int', error: null });
      setOpen(column);
      return;
    }
    const cost = costOfRole(source, column, role, widgets);
    if (cost) { setConfirm({ column, role, cost }); return; }
    write(applyRole(source, column, role, { reserved: reservedDimKeys(widgets, source.id, dims.map((d) => d.key)) }),
      `the role of “${column}”`);
    setOpen(column);
  };

  const applyConfirmed = (removeWidgets) => {
    if (!confirm) return;
    const { column, role, cost } = confirm;
    let snapshots = [];
    if (cost.kind === 'breakdown') {
      const snapshot = removedLibrarySnapshot(source, cost.dimKey, widgets, removeWidgets);
      snapshots = snapshot ? snapshot.widgetSnapshots : [];
      if (removeWidgets) onRemoveWidgetsForDim?.(source.id, cost.dimKey);
    }
    write(applyRole(source, column, role, { reserved: reservedDimKeys(widgets, source.id, dims.map((d) => d.key)) }),
      `the role of “${column}”`, snapshots);
    setConfirm(null);
    setOpen(column);
  };

  const addMetric = () => {
    if (!newMetric) return;
    const r = addCustomMetric(source, newMetric.name, newMetric.format);
    if (!r.ok) { setNewMetric({ ...newMetric, error: r.error }); return; }
    write(applyRole(r.source, newMetric.column, `metric:${r.key}`), `the role of “${newMetric.column}”`);
    setNewMetric(null);
    setOpen(newMetric.column);
  };

  const stage = additionalMappingStage(source);
  const offCount = list.filter((r) => r.group === 'off').length;

  return (
    <div className="am-page">
      <header className="am-header">
        <div>
          <div className="am-eyebrow">Additional data</div>
          <h3>{source.title || source.id}</h3>
          <p>
            {source.origin?.title || 'Google Sheet'}
            {Number.isInteger(source.origin?.header_row) && source.origin.header_row > 0
              ? ` · headers on row ${source.origin.header_row + 1}` : ''}
            {' · '}{mappingStatus(stage, saved, runtime)}
          </p>
        </div>
        {canUndoRole(undoState) && (
          <div className="am-header-actions">
            <button type="button" className="sp-btn sp-btn-s am-undo-button"
              title={`Undo ${undoState.label}`} onClick={onUndo}>Undo {undoState.label}</button>
          </div>
        )}
      </header>

      <StructureNotice issue={structureIssue} onRetry={structureIssue?.error ? null : onRetryStructure} />

      <StatusStrip status={status} onOpenLineItems={onOpenLineItems} />

      {/* What the SERVER's readable rule wants (dim-sources.mjs isReadableSheetSource).
          Saving an unfinished mapping is legal and keeps the work; it is simply
          never read, and nothing on the old screen said so. */}
      {status.missing.length > 0 && (
        <div className="am-note">
          <strong>Still needs {status.missing.join(', ')}.</strong>
          <span>Saving keeps what you have set — the sheet is read once the mapping is complete.</span>
        </div>
      )}

      <section className="am-section">
        <div className="am-section-head">
          <div>
            <h4>Columns in this sheet</h4>
            <p>Each column has one job. Change any of them — the figures above follow.</p>
          </div>
          {known.length >= SEARCH_FROM && (
            <div className="am-search-box">
              <input className="sp-inp" value={query} placeholder="Find a column"
                aria-label="Find a column" onChange={(e) => { setQuery(e.target.value); setOpen(null); }} />
              {!!query.trim() && <span className="am-count">{found.length} of {known.length} columns</span>}
            </div>
          )}
        </div>

        {probing && !known.length && <div className="am-state">Reading the sheet structure…</div>}

        {GROUPS.map((group) => {
          const all = found.filter((r) => r.group === group.key);
          const single = source.binding?.mode === 'single';
          // In single mode NO column says which line item, so there is no column
          // row to carry the question — and without this the answer would be
          // unreachable the moment somebody chose it.
          const singleRow = group.key === 'structure' && single && !query.trim();
          if (!all.length && !singleRow) return null;
          const clipped = group.key === 'off' && !query.trim() && !showAllOff && all.length > OFF_PREVIEW;
          const shown = clipped ? all.slice(0, OFF_PREVIEW) : all;
          return (
            <div className="am-col-group" key={group.key}>
              <div className="am-group-head">{group.title} <span>· {group.hint}</span></div>
              {singleRow && (
                <SingleLineItemRow
                  lineItems={lineItems}
                  lineItemId={source.binding?.line_item_id || ''}
                  freeColumns={list.filter((r) => r.role === 'ignored').map((r) => r.column)}
                  onPick={(id) => write(applySingleLineItem(source, id), 'the line item every row goes to')}
                  onUseColumn={(column) => write(applyRole(source, column, 'line_item'), 'how rows find a line item')}
                  onAddLineItem={onAddLineItem}
                />
              )}
              {shown.map((row) => (
                <ColumnRow
                  key={row.column}
                  row={row}
                  choices={choices}
                  open={open === row.column}
                  confirm={confirm && confirm.column === row.column ? confirm : null}
                  newMetric={newMetric && newMetric.column === row.column ? newMetric : null}
                  source={source}
                  profile={profile}
                  rows={rows}
                  lineItems={lineItems}
                  runtime={runtime}
                  saved={saved}
                  structureReady={structureReady}
                  onToggle={() => { setOpen(open === row.column ? null : row.column); setConfirm(null); setNewMetric(null); }}
                  onRole={(role) => setRole(row.column, role)}
                  onConfirm={applyConfirmed}
                  onCancelConfirm={() => setConfirm(null)}
                  onMetricDraft={(patch) => setNewMetric({ ...newMetric, ...patch, error: null })}
                  onMetricAdd={addMetric}
                  onMetricCancel={() => setNewMetric(null)}
                  onRename={(label) => write(renameBreakdown(source, row.dim.key, label), `the name of “${row.dim.label || row.dim.key}”`)}
                  onBrkDim={(value) => write(setBreakdownDim(source, row.dim.key, value), `the filter “${row.dim.label || row.dim.key}” answers`)}
                  onOpenLineItems={onOpenLineItems}
                  onOpenLibrary={onOpenLibrary}
                  onSingleLineItem={(id) => write(applySingleLineItem(source, id), 'how rows find a line item')}
                  onColumnMode={() => write(applyRole(source, row.column, 'line_item'), 'how rows find a line item')}
                />
              ))}
              {clipped && (
                <button type="button" className="am-text-button" onClick={() => setShowAllOff(true)}>
                  Show {all.length - OFF_PREVIEW} more unused {all.length - OFF_PREVIEW === 1 ? 'column' : 'columns'}
                </button>
              )}
              {group.key === 'off' && showAllOff && !query.trim() && offCount > OFF_PREVIEW && (
                <button type="button" className="am-text-button" onClick={() => setShowAllOff(false)}>Show fewer</button>
              )}
            </div>
          );
        })}

        {!found.length && !!query.trim() && (
          <div className="am-empty">No column here is called “{query.trim()}”.</div>
        )}
      </section>

      <TerminalSection
        source={source}
        dims={dims}
        profile={profile}
        rows={rows}
        runtime={runtime}
        saved={saved}
        onOpenBreakdown={onOpenBreakdown}
        onCreateWidget={onCreateWidget}
      />
    </div>
  );
}

function canUndoRole(undoState) {
  return !!(undoState && undoState.label);
}

function StatusStrip({ status, onOpenLineItems }) {
  const size = status.size;
  const sizeClass = !size.ok ? ' am-fig--bad' : size.pct >= 70 ? ' am-fig--warn' : '';
  return (
    <dl className="am-figures">
      <div className="am-fig">
        <dt>One row is</dt>
        <dd>{status.oneRow}
          <span className="am-fig-sub">{status.rowCount === null
            ? 'Rows arrive with the first read'
            : `${int(status.rowCount)} rows after mapping`}</span>
        </dd>
      </div>
      <div className="am-fig">
        <dt>Reaches the dashboard</dt>
        <dd className={status.reach.attention ? 'am-fig--warn' : ''}>{status.reach.text}
          <span className="am-fig-sub">{status.reach.detail}</span>
          {status.reach.unmatched > 0 && (
            <button type="button" className="am-text-button" onClick={onOpenLineItems}>Route the names →</button>
          )}
        </dd>
      </div>
      <div className="am-fig">
        <dt>Size</dt>
        <dd className={sizeClass.trim()}>
          {size.unknown ? 'Not measured yet' : `${size.measured ? '' : 'about '}${mb(size.bytes)}`}
          <span className="am-fig-sub">{size.unknown
            ? 'The next read will measure the file'
            : !size.ok ? `Over the ${size.limitMB} MB limit`
              : size.pct >= 70 ? `Close to the ${size.limitMB} MB limit`
                : `${size.pct}% of the ${size.limitMB} MB limit`}</span>
        </dd>
      </div>
      <div className="am-fig">
        <dt>Columns</dt>
        <dd>{status.used} used
          <span className="am-fig-sub">{status.columns === null
            ? 'of what the sheet holds'
            : `${Math.max(0, status.columns - status.used)} not imported`}</span>
        </dd>
      </div>
    </dl>
  );
}

/* ── the line item, when no column says which ──────────────────────────────── */

// Not a column, so it cannot be a column row — and yet it is the same question
// the Line item role answers, which is why it sits in the same group rather than
// in a settings fold somebody has to go looking for.
function SingleLineItemRow({ lineItems, lineItemId, freeColumns, onPick, onUseColumn, onAddLineItem = null }) {
  const chosen = (lineItems || []).find((li) => String(li.id) === String(lineItemId));
  return (
    <div className="am-col is-open">
      <div className="am-col-row">
        <span className="am-col-name"><strong>The whole tab</strong></span>
        <span className="am-col-facts">
          <b>{chosen ? chosen.label : 'No line item chosen'}</b>
          <em> · every row goes to it</em>
        </span>
        <span className="am-role-static">Line item</span>
        <span />
      </div>
      <div className="am-col-body">
        <div className="am-form-grid">
          <label className="am-field"><span>Pacing line item</span>
            <LiSelect value={lineItemId} onChange={onPick} lineItems={lineItems}
              placeholder="Choose a line item" onAddLineItem={onAddLineItem} /></label>
          {freeColumns.length > 0 && (
            <label className="am-field"><span>Or a column says which</span>
              <select className="sp-inp" value="" onChange={(e) => e.target.value && onUseColumn(e.target.value)}>
                <option value="">Keep one line item</option>
                {freeColumns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="am-hint">Picking a column brings back per-name routing.</span></label>
          )}
        </div>
        {!chosen && (
          <div className="am-state am-state--error">
            Choose the line item these rows belong to — until then nothing from this source is placed.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── one column ────────────────────────────────────────────────────────────── */

function ColumnRow({
  row, choices, open, confirm, newMetric, source, profile, rows, lineItems, runtime, saved,
  structureReady, onToggle, onRole, onConfirm, onCancelConfirm, onMetricDraft, onMetricAdd,
  onMetricCancel, onRename, onBrkDim, onOpenLineItems, onOpenLibrary, onSingleLineItem, onColumnMode,
}) {
  const off = row.role === 'ignored';
  const facts = row.facts;
  return (
    <div className={`am-col${open ? ' is-open' : ''}${off ? ' is-off' : ''}`}>
      <div className="am-col-row">
        <button type="button" className="am-col-name" aria-expanded={open} onClick={onToggle}>
          <strong>{row.column}</strong>
          {row.attention === 'duplicate' && <span className="am-pill">Repeated header</span>}
          {row.attention === 'ambiguous' && <span className="am-pill">Could be a breakdown</span>}
        </button>
        <span className="am-col-facts">
          <b>{facts.text}</b>{facts.detail ? <em> · {facts.detail}</em> : null}
        </span>
        {/* A role has to LOOK changeable, so the native caret stays; only the
            frame is quieted until the pointer arrives. Eleven filled inputs were
            a grey wall, eleven bare words were furniture nobody clicked. */}
        <select className="am-role" value={row.role} aria-label={`What ${row.column} is`}
          onChange={(e) => onRole(e.target.value)}>
          {choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="__new_metric__">+ New metric…</option>
        </select>
        <button type="button" className="am-col-chev" aria-label={`${open ? 'Collapse' : 'Expand'} ${row.column}`}
          onClick={onToggle}>{open ? '▲' : '▼'}</button>
      </div>

      {confirm && (
        <div className="am-col-body">
          <div className="am-confirm">
            <strong>{confirm.role === 'ignored'
              ? `Stop importing “${confirm.column}”?`
              : `Change what “${confirm.column}” is?`}</strong>
            <span>{confirm.cost.sentence}</span>
            <div className="am-actions">
              {confirm.cost.kind === 'breakdown' && confirm.cost.widgets.length > 0 && (
                <button type="button" className="sp-btn sp-btn-s" onClick={() => onConfirm(true)}>
                  Change and remove {confirm.cost.widgets.length === 1 ? 'the block' : 'the blocks'}
                </button>
              )}
              <button type="button" className="sp-btn sp-btn-p" onClick={() => onConfirm(false)}>
                {confirm.cost.kind === 'breakdown' && confirm.cost.widgets.length
                  ? 'Change and keep them disconnected' : 'Change it'}
              </button>
              <button type="button" className="sp-btn sp-btn-s" onClick={onCancelConfirm}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {newMetric && (
        <div className="am-col-body">
          <div className="am-form-grid">
            <label className="am-field"><span>Metric name</span>
              <input className="sp-inp" autoFocus value={newMetric.name} maxLength={40}
                placeholder="Engaged views" onChange={(e) => onMetricDraft({ name: e.target.value })} /></label>
            <label className="am-field"><span>Shown as</span>
              <select className="sp-inp" value={newMetric.format}
                onChange={(e) => onMetricDraft({ format: e.target.value })}>
                <option value="int">Whole number</option>
                <option value="money">Money</option>
              </select></label>
          </div>
          <div className="am-note">Your own metric is summed like any other number and appears in
            tables and charts. It stays out of pacing math, because there is no plan, goal or margin
            for it — and a ratio such as CTR is not imported at all: the dashboard recalculates ratios
            from the numbers it holds.</div>
          {newMetric.error && <div className="am-state am-state--error">{newMetric.error}</div>}
          <div className="am-actions">
            <button type="button" className="sp-btn sp-btn-p" onClick={onMetricAdd}>Add metric</button>
            <button type="button" className="sp-btn sp-btn-s" onClick={onMetricCancel}>Cancel</button>
          </div>
        </div>
      )}

      {open && !confirm && !newMetric && (
        <div className="am-col-body">
          {row.role === 'date' && (
            <div className="am-note">One day per row. Rows outside a line item’s flight dates are dropped.</div>
          )}

          {row.role === 'line_item' && (
            <>
              <div className="am-choice">
                <label>
                  <input type="radio" name={`limode-${row.column}`} checked readOnly onChange={onColumnMode} />
                  <span><strong>Rows say which line item</strong>
                    <span>Read from “{row.column}”.</span></span>
                </label>
                <label>
                  <input type="radio" name={`limode-${row.column}`} checked={false}
                    onChange={() => onSingleLineItem('')} />
                  <span><strong>The whole tab is one line item</strong>
                    <span>Every row goes to the same one — you choose which.</span></span>
                </label>
              </div>
              <div className="am-row-actions">
                <button type="button" className="sp-btn sp-btn-s" onClick={onOpenLineItems}>Check the names →</button>
              </div>
            </>
          )}

          {row.role === 'dim' && row.dim && (
            <BreakdownBody
              source={source} dim={row.dim} column={row.column} profile={profile} rows={rows}
              lineItems={lineItems} runtime={runtime} saved={saved}
              onRename={onRename} onBrkDim={onBrkDim} onOpenLibrary={onOpenLibrary} />
          )}

          {row.role.startsWith('metric:') && (
            <div className="am-note">Summed per day, line item and breakdown. Empty cells count as zero.
              {' '}{metricNote(source, row.role.slice(7))}</div>
          )}

          {row.role === 'ignored' && (
            <IgnoredBody source={source} column={row.column} profile={profile} rows={rows}
              lineItems={lineItems} facts={row.facts} structureReady={structureReady} />
          )}
        </div>
      )}
    </div>
  );
}

function metricNote(source, key) {
  const own = customMetricsOf(source).find((m) => m.key === key);
  if (!own) return '';
  return `Your own metric, shown as ${own.format === 'money' ? 'money' : 'a whole number'} — it appears in tables and charts, not in pacing math.`;
}

function BreakdownBody({ source, dim, column, profile, rows, lineItems, runtime, saved, onRename, onBrkDim, onOpenLibrary }) {
  const [label, setLabel] = useState(dim.label || dim.key);
  useEffect(() => { setLabel(dim.label || dim.key); }, [dim.label, dim.key]);
  const size = sizeOf({ source, profile, rows, lineItems });
  const health = runtime?.breakdowns?.[dim.key];
  return (
    <>
      {!size.ok && (
        <div className="am-state am-state--error">
          <strong>Together with the other breakdowns this is over the {size.limitMB} MB limit.</strong>
          <span>{size.worst.join(' × ')} is what drives it — drop one, or give this column a source of its own.</span>
        </div>
      )}
      {size.ok && size.pct >= 70 && (
        <div className="am-note">About {mb(size.bytes)} of {size.limitMB} MB — one more breakdown will not fit.</div>
      )}
      {health === 'broken' && (
        <div className="am-state am-state--error">Column “{column}” was not in the sheet on the last read.</div>
      )}
      {health === 'not_read' && (
        <div className="am-note">Changed since the last read — its rows arrive with the next one.</div>
      )}
      <div className="am-form-grid">
        <label className="am-field"><span>Name on the dashboard</span>
          <input className="sp-inp" value={label} maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              const next = label.trim();
              if (next && next !== (dim.label || dim.key)) onRename(next);
              else setLabel(dim.label || dim.key);
            }} /></label>
        <label className="am-field"><span>Answers the dashboard filter</span>
          <select className="sp-inp" value={dim.brk_dim || ''} onChange={(e) => onBrkDim(e.target.value)}>
            <option value="">Not linked</option>
            {FILTERABLE_DIMS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <span className="am-hint">Set this when the column holds the same thing the dashboard filters
            by. Then a block on this source follows that filter instead of ignoring it.</span></label>
      </div>
      <div className="am-row-actions">
        <button type="button" className="sp-btn sp-btn-s" onClick={() => onOpenLibrary(dim.key)}>
          Tidy up values →
        </button>
        <span className="am-hint">{saved
          ? 'Values are used exactly as the sheet writes them until you merge spellings.'
          : 'Save to read this column, then tidy its values.'}</span>
      </div>
    </>
  );
}

function IgnoredBody({ source, column, profile, rows, lineItems, facts, structureReady }) {
  // Both sides projected the same way, or the sentence compares measured history
  // with a forecast and reads as though the file were about to shrink.
  const now = sizeOf({ source, profile, rows, lineItems, forceEstimate: true });
  const withIt = sizeOf({ source, profile, rows, lineItems, extraColumn: column });
  return (
    <>
      <div className="am-note">Nothing from this column reaches the dashboard.</div>
      {!structureReady && (
        <div className="am-hint">The sheet could not be read just now, so this column cannot take a
          new role until the check succeeds.</div>
      )}
      {facts.unknown ? (
        <div className="am-hint">Nobody has measured this column yet — the next read will say how many
          values it holds and what a breakdown on it would cost.</div>
      ) : (
        <div className={`am-note${withIt.ok ? '' : ' am-note--bad'}`}>
          <strong>As a breakdown it would take the file from {mb(now.bytes)} to about {mb(withIt.bytes)}
            {withIt.ok ? '.' : ` — over the ${withIt.limitMB} MB limit.`}</strong>
          <span>{facts.text} split every day and line item{facts.numericish
            ? '. This column reads as numbers rather than names, which usually belongs in a metric.' : '.'}</span>
        </div>
      )}
    </>
  );
}

/* ── what a breakdown gives you ────────────────────────────────────────────── */

function TerminalSection({ source, dims, profile, rows, runtime, saved, onOpenBreakdown, onCreateWidget }) {
  if (!dims.length) {
    return (
      <section className="am-section">
        <div className="am-section-head"><div><h4>On the dashboard</h4>
          <p>A breakdown does not appear by itself — this is where you put it on the page.</p></div></div>
        <div className="am-empty">
          <strong>No breakdown yet</strong>
          <span>Set one column to Breakdown and it appears here.</span>
        </div>
      </section>
    );
  }
  return (
    <section className="am-section">
      <div className="am-section-head"><div><h4>On the dashboard</h4>
        <p>A breakdown does not appear by itself — this is where you put it on the page.</p></div></div>
      {dims.map((dim) => {
        const count = distinctOf({ dim, profile, rows });
        const ready = !!(saved && runtime?.breakdowns?.[dim.key] === 'ready' && !runtime?.reading);
        const big = count === null ? null : count > CARDINALITY_LIMIT;
        return (
          <div className="am-terminal-row" key={dim.key}>
            <div>
              <strong>{dim.label || dim.key}</strong>
              <div className="am-terminal-meta">{count === null
                ? 'Its values arrive with the first read — then this says where it can go.'
                : big
                  ? `${int(count)} values — too many for the Breakdown block under each line item, so it goes in a table of its own.`
                  : `${int(count)} values — fits the Breakdown block under every line item.`}
                {dim.brk_dim ? ` Follows the ${dim.brk_dim} filter.` : ''}</div>
            </div>
            <button type="button" className="sp-btn sp-btn-p sp-btn-s" disabled={!ready || big === null}
              title={ready ? undefined : 'Save and read this source first'}
              onClick={() => (big ? onCreateWidget?.(source, dim) : onOpenBreakdown?.(source, dim))}>
              {big ? 'Create a table of the top 20' : 'Open the Breakdown'}
            </button>
          </div>
        );
      })}
    </section>
  );
}

function distinctOf({ dim, profile, rows }) {
  if (Array.isArray(rows) && rows.length) {
    const values = new Set();
    for (const r of rows) {
      const v = String(r?.dims?.[dim.key] == null ? '' : r.dims[dim.key]).trim();
      if (v) values.add(v);
    }
    if (values.size) return values.size;
  }
  const p = (profile?.columns || []).find((c) => String(c?.name || '').trim() === String(dim.column || '').trim());
  return p ? p.distinct : null;
}

function LineItemMatching({ source, savedSource, slug, lineItems, bound, unbound, saved, onChange, onDone, onAddLineItem = null }) {
  const cols = source.origin?.columns || {};
  const single = source.binding?.mode === 'single';
  const sample = useSourceValues(slug, source, cols.line_item ? [cols.line_item] : [], !single);
  const direct = useMemo(() => lineItemMatches(sample.result?.values, source, lineItems),
    [sample.result, source, lineItems]);
  const routingCurrent = !!savedSource
    && lineItemVocabularySignature(source) === lineItemVocabularySignature(savedSource);
  const fallback = useMemo(() => {
    // A successful empty response is authoritative. Aux names are only a
    // resilience fallback for the exact routing revision that produced them;
    // after changing the LI column, showing the old names would let a person
    // save rules for the wrong physical column.
    if (sample.result) return direct;
    if (!routingCurrent) return [];
    const values = lineItemValuesFromAux(bound, unbound, source.binding?.exclude);
    return lineItemMatches(values, source, lineItems);
  }, [sample.result, direct, routingCurrent, bound, unbound, source, lineItems]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [history, setHistory] = useState([]);
  const previousSaved = useRef(saved);
  useEffect(() => {
    if (saved && previousSaved.current === false) setHistory([]);
    previousSaved.current = saved;
  }, [saved]);
  const shown = fallback.filter((r) => !query.trim() || r.raw.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(shown.length / LI_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = shown.slice(safePage * LI_PAGE_SIZE, (safePage + 1) * LI_PAGE_SIZE);
  const matched = fallback.filter((r) => r.lineItemId);
  const open = fallback.filter((r) => r.method === 'unmatched');
  const excludedByHand = fallback.filter((r) => r.method === 'excluded');
  const unresolvedRows = open.reduce((n, r) => n + r.rows, 0);
  const manuallyExcludedRows = excludedByHand.reduce((n, r) => n + r.rows, 0);
  const excludedRows = unresolvedRows + manuallyExcludedRows;
  const exclusionCount = open.length + excludedByHand.length;
  const manualExclusionRowsUnknown = !sample.result && excludedByHand.some((row) => row.rows === 0);
  const exclusionCopy = !manualExclusionRowsUnknown
    ? `${int(excludedRows)} rows excluded`
    : `${exclusionCount} source ${exclusionCount === 1 ? 'name' : 'names'} excluded · row count unavailable`;
  const canFinish = !!sample.result || (routingCurrent && fallback.length > 0);
  const map = source.binding?.map || {};
  const excludedNames = Array.isArray(source.binding?.exclude) ? source.binding.exclude : [];

  const writeBinding = (binding, label) => {
    if (JSON.stringify(binding) === JSON.stringify(source.binding || {})) return;
    setHistory((current) => pushHistory(current, source.binding || {}, label));
    onChange({ ...source, binding });
  };

  const undoBinding = () => {
    const previous = undo(history);
    if (!previous) return;
    setHistory(previous.history);
    onChange({ ...source, binding: previous.snapshot });
  };

  const set = (raw, value) => {
    const next = { ...map };
    const nextExcluded = excludedNames.filter((name) => lineItemNameKey(name) !== lineItemNameKey(raw));
    for (const key of Object.keys(next)) {
      if (lineItemNameKey(key) === lineItemNameKey(raw)) delete next[key];
    }
    if (value === '__exclude__') nextExcluded.push(raw);
    else if (value !== '__auto__' && value) next[raw] = value;
    writeBinding({ ...source.binding, map: next, exclude: nextExcluded }, `route “${raw}”`);
  };

  const acceptAllAi = () => {
    const next = acceptBindings(map, ai);
    writeBinding({ ...source.binding, map: next }, 'AI matches');
    setAi(null);
  };

  const askAi = async () => {
    setAiBusy(true); setAiError(null);
    try {
      const response = await api.dimSourceSuggest(slug, source.id, {
        kind: 'bindings', unbound: open.slice(0, 300).map((r) => ({ value: r.raw, rows: r.rows })),
      });
      if (response?.ok) setAi(response.bindings || []);
      else setAiError(response?.error || 'suggest_failed');
    } catch (error) {
      setAiError(error?.status === 503 ? 'AI is not configured.'
        : error?.status === 409 || !saved ? 'Save the source setup before asking AI.' : 'AI could not suggest matches. Try again.');
    } finally { setAiBusy(false); }
  };

  if (single) {
    const selectedExists = (lineItems || []).some((li) => String(li.id) === String(source.binding?.line_item_id || ''));
    return (
      <div className="am-page am-page--task">
        <header className="am-header"><div><div className="am-eyebrow">Line item</div><h3>Line-item matching</h3>
          <p>Every row in this tab belongs to one pacing line item.</p></div>
          {canUndo(history) && <div className="am-header-actions"><button type="button"
            className="sp-btn sp-btn-s am-undo-button" title={`Undo ${undoLabel(history)}`} onClick={undoBinding}>
            Undo {undoLabel(history)}
          </button></div>}
        </header>
        <label className="am-field am-field--wide">
          <span>Every source row →</span>
          <LiSelect value={source.binding?.line_item_id || ''} lineItems={lineItems} onAddLineItem={onAddLineItem}
            onChange={(id) => writeBinding({ mode: 'single', line_item_id: id, map: {} }, 'line-item choice')}>
            <option value="">Choose a line item</option>
            {!selectedExists && source.binding?.line_item_id && (
              <option value={source.binding.line_item_id} disabled>Previously selected LI {source.binding.line_item_id} no longer exists</option>
            )}
          </LiSelect>
        </label>
        <div className="am-actions"><button type="button" className="sp-btn sp-btn-p"
          disabled={!selectedExists} onClick={onDone}>Done</button></div>
      </div>
    );
  }

  return (
    <div className="am-page am-page--task">
      <header className="am-header">
        <div><div className="am-eyebrow">Line item · the names in the sheet</div><h3>Which line item each row belongs to</h3>
          <p>Each source name routes its rows to one pacing line item. Automatic matches remain editable.</p></div>
        <div className="am-header-actions">
          {canUndo(history) && <button type="button" className="sp-btn sp-btn-s am-undo-button"
            title={`Undo ${undoLabel(history)}`} onClick={undoBinding}>
            Undo {undoLabel(history)}
          </button>}
          <button type="button" className="sp-btn sp-btn-s" disabled={sample.loading} onClick={sample.retry}>Refresh names</button>
          <button type="button" className="sp-btn sp-btn-s" disabled={!saved || !open.length || aiBusy} onClick={askAi}
            title={!saved ? 'Save this mapping before asking AI' : undefined}>
            {aiBusy ? 'Asking AI…' : 'Suggest unmatched with AI'}
          </button>
        </div>
      </header>

      <div className="am-summary">
        <strong>{matched.length} of {fallback.length} names routed</strong>
        <span>{exclusionCount
          ? `${open.length ? `${open.length} unmatched` : ''}${open.length && excludedByHand.length ? ' · ' : ''}${excludedByHand.length ? `${excludedByHand.length} excluded by hand` : ''} · ${exclusionCopy}`
          : 'No unresolved or excluded source names'}</span>
      </div>
      {sample.loading && <div className="am-state">Reading line-item names…</div>}
      {sample.error && <div className="am-state am-state--error">Could not read the line-item names.
        <button type="button" className="am-text-button" onClick={sample.retry}>Retry</button></div>}
      {sample.result?.truncated && <div className="am-note">Showing the 500 most frequent source names.</div>}
      {typeof aiError === 'string' && <div className="am-state am-state--error">{aiError}</div>}
      {!saved && open.length > 0 && <div className="am-note">Manual matching is available now. Save the source setup to enable AI suggestions.</div>}
      {(ai || []).length > 0 && (
        <div className="am-summary"><strong>AI suggested {(ai || []).length} matches</strong>
          <span>Review them below. Nothing changes until you apply a suggestion.</span>
          <div className="am-actions"><button type="button" className="sp-btn sp-btn-p" onClick={acceptAllAi}>Accept all</button>
            <button type="button" className="sp-btn sp-btn-s" onClick={() => setAi(null)}>Dismiss all</button></div>
        </div>
      )}

      <input className="sp-inp am-search" value={query} placeholder={`Search ${fallback.length} source names`}
        onChange={(e) => { setQuery(e.target.value); setPage(0); }} />

      {shown.length > 0 && <div className="am-list-nav">
        <span>{int(safePage * LI_PAGE_SIZE + 1)}–{int(Math.min(shown.length, (safePage + 1) * LI_PAGE_SIZE))} of {int(shown.length)} names</span>
        {pageCount > 1 && <div className="am-actions">
          <button type="button" className="sp-btn sp-btn-s" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}>Previous</button>
          <button type="button" className="sp-btn sp-btn-s" disabled={safePage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}>Next</button>
        </div>}
      </div>}

      <div className="am-match-list">
        {pageRows.map((row) => {
          const proposal = (ai || []).find((p) => p.value === row.raw);
          return (
            <div className="am-match-row" key={row.raw}>
              <div className="am-match-name"><strong>{row.raw}</strong><span>{int(row.rows)} rows</span></div>
              <div className="am-match-result">
                <LiSelect value={row.method === 'manual' ? row.lineItemId
                  : row.method === 'automatic' ? '__auto__' : row.method === 'excluded' ? '__exclude__' : ''}
                  lineItems={lineItems} onAddLineItem={onAddLineItem}
                  onChange={(v) => set(row.raw, v)}>
                  {row.automaticLineItemId && <option value="__auto__">Automatic · {lineItems.find((li) => li.id === row.automaticLineItemId)?.label || `LI ${row.automaticLineItemId}`}</option>}
                  {row.method === 'unmatched' && <option value="">{row.missingLineItemId
                    ? 'Not matched — choose a route' : 'Not matched — rows excluded'}</option>}
                  <option value="__exclude__">Exclude from this source</option>
                </LiSelect>
                {row.missingLineItemId && <span className="am-inline-warning">Previously matched LI {row.missingLineItemId} no longer exists.</span>}
                {proposal && <button type="button" className="sp-btn sp-btn-s" onClick={() => {
                  set(row.raw, proposal.line_item_id);
                  setAi((cur) => (cur || []).filter((p) => p.value !== row.raw));
                }}>
                  Apply AI match
                </button>}
              </div>
            </div>
          );
        })}
      </div>
      {!shown.length && !sample.loading && <div className="am-empty">No source name matches that search.</div>}
      <div className="am-actions"><button type="button" className="sp-btn sp-btn-p" disabled={!canFinish} onClick={onDone}>
        {exclusionCount ? `Continue with ${exclusionCopy}` : 'Done'}
      </button></div>
    </div>
  );
}

function ValueLibrary({ source, savedSource, dim, slug, lineItems, saved, runtime, rows, headers,
  structureReady = true, structureIssue, onRetryStructure, widgets, onRemoveLibrary,
  onOpenBreakdown, onCreateWidget, onChange, onBack }) {
  const cols = source.origin?.columns || {};
  const sampled = useSourceValues(slug, source, [...(cols.line_item ? [cols.line_item] : []), dim.column]);
  const loadedValues = useMemo(() => libraryValuesFromRows(rows, dim.key), [rows, dim.key]);
  const groups = source.groups?.[dim.key] || [];
  const dismissed = source.dismissed?.[dim.key] || [];
  const [query, setQuery] = useState('');
  const [valuePage, setValuePage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAliases, setNewAliases] = useState('');
  const [openGroup, setOpenGroup] = useState(null);
  const [groupName, setGroupName] = useState('');
  const [proposalName, setProposalName] = useState('');
  // Per-canonical-value AI: "which unassigned values are also this?" A far
  // narrower question than clustering the whole column, and its answer is
  // checkable in one glance because it names one thing.
  const [aliasAi, setAliasAi] = useState(null);           // { label, members }
  const [aliasAiBusy, setAliasAiBusy] = useState(null);   // label being asked about
  const [aliasAiError, setAliasAiError] = useState(null);
  const [alias, setAlias] = useState('');
  const [error, setError] = useState(null);
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [labelDraft, setLabelDraft] = useState(dim.label || '');
  const [changingColumn, setChangingColumn] = useState(false);
  const [columnConfirm, setColumnConfirm] = useState(false);
  const [columnDraft, setColumnDraft] = useState(dim.column);
  const [history, setHistory] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const reviewMetrics = useMemo(() => DIM_METRIC_SLOTS
    .filter((metric) => !!cols.metrics?.[metric.key]), [cols.metrics]);
  const defaultReviewMetric = reviewMetrics.some((metric) => metric.key === 'im')
    ? 'im' : reviewMetrics[0]?.key || '';
  // A viewing choice, not mapping data: changing it neither dirties nor saves
  // the source and does not become a widget setting.
  const [reviewMetric, setReviewMetric] = useState(defaultReviewMetric);
  const previousSaved = useRef(saved);
  const usedBy = useMemo(() => widgetsUsingBreakdown(widgets, source.id, dim.key),
    [widgets, source.id, dim.key]);
  const columnOptions = useMemo(() => freeColumns(source, headers, dim.column),
    [source, headers, dim.column]);
  const readState = runtime?.breakdowns?.[dim.key];
  const rawCurrent = !!savedSource
    && libraryReadSignature(source, dim.key) === libraryReadSignature(savedSource, dim.key);
  const loadedCurrent = rawCurrent && !runtime?.reading && readState === 'ready';
  const aiReady = !!(saved && !runtime?.reading && !runtime?.error
    && runtime?.status !== 'stale' && runtime?.rows > 0 && readState === 'ready');
  const effectiveRowsRaw = runtime?.rowCount?.[dim.key];
  const distinctRaw = runtime?.distinct?.[dim.key];
  const effectiveRowCount = Number.isFinite(Number(effectiveRowsRaw)) ? Number(effectiveRowsRaw) : null;
  const distinctCount = Number.isFinite(Number(distinctRaw)) ? Number(distinctRaw) : null;
  const handoffReady = !!(saved && loadedCurrent && runtime?.status !== 'stale' && !runtime?.error
    && effectiveRowCount !== null);
  const handoffToBreakdown = handoffReady && effectiveRowCount <= 50;
  const handoffAction = handoffToBreakdown ? onOpenBreakdown : onCreateWidget;
  const sourceValues = useMemo(() => (loadedCurrent
    ? loadedValues : librarySourceValues(sampled.result?.values, source, lineItems)),
  [loadedCurrent, loadedValues, sampled.result, source, lineItems]);
  const model = useMemo(() => libraryModel(sourceValues.values, groups), [sourceValues, groups]);

  useEffect(() => { setLabelDraft(dim.label || ''); }, [dim.label]);
  useEffect(() => { if (!changingColumn) setColumnDraft(dim.column); }, [dim.column, changingColumn]);
  useEffect(() => {
    setHistory([]); setDeleteConfirm(null); setValuePage(0); setQuery('');
    setAliasAi(null); setAliasAiError(null); setAssignment(null);
  }, [dim.key]);
  useEffect(() => {
    if (saved && previousSaved.current === false) setHistory([]);
    previousSaved.current = saved;
  }, [saved]);
  useEffect(() => {
    if (!reviewMetrics.some((metric) => metric.key === reviewMetric)) {
      setReviewMetric(defaultReviewMetric);
    }
  }, [reviewMetrics, reviewMetric, defaultReviewMetric]);

  const applyColumn = () => {
    onChange(repointBreakdown(source, dim.key, columnDraft));
    setColumnConfirm(false);
    setChangingColumn(false);
  };

  const snapshot = () => ({ groups, dismissed });
  const writeLibraryState = (nextGroups, nextDismissed) => {
    const nextGroupsByDim = { ...(source.groups || {}), [dim.key]: nextGroups };
    const nextDismissedByDim = { ...(source.dismissed || {}) };
    if (nextDismissed.length) nextDismissedByDim[dim.key] = nextDismissed;
    else delete nextDismissedByDim[dim.key];
    const next = { ...source, groups: nextGroupsByDim };
    if (Object.keys(nextDismissedByDim).length) next.dismissed = nextDismissedByDim;
    else delete next.dismissed;
    onChange(next);
  };

  const remember = (label) => setHistory((current) => pushHistory(current, snapshot(), label));

  const assign = (result, label = 'last library edit') => {
    if (!result) return false;
    if (result.error) { setError(result.error); return false; }
    if (result.list === groups) return true;
    remember(label);
    setError(null);
    setAssignment(null);
    writeLibraryState(result.list, dismissed);
    return true;
  };

  const lineItemLabels = useMemo(() => new Map((lineItems || []).map((item) => [
    String(item?.id || ''), item?.label || `LI ${item?.id || ''}`,
  ])), [lineItems]);
  const lineItemContext = (row) => {
    const labels = (row.lineItemIds || []).map((id) => lineItemLabels.get(String(id)) || `LI ${id}`);
    if (!labels.length) return { short: 'No routed line item in this preview', full: '' };
    const short = labels.length === 1 ? labels[0]
      : `${labels.length} line items · ${labels.slice(0, 2).join(' · ')}${labels.length > 2 ? ` · +${labels.length - 2} more` : ''}`;
    return { short, full: labels.join(' · ') };
  };
  const metricKey = reviewMetrics.some((metric) => metric.key === reviewMetric)
    ? reviewMetric : defaultReviewMetric || null;
  const metricLabel = DIM_METRIC_SLOTS.find((metric) => metric.key === metricKey)?.label?.toLowerCase() || metricKey;
  const liPlan = useMemo(() => Object.fromEntries((lineItems || []).map((item) => [String(item.id), {
    fs: item.fs || null, fe: item.fe || null,
  }])), [lineItems]);
  const rawWeights = useMemo(() => {
    if (loadedCurrent && metricKey) return valueTally(rows, dim.key, metricKey, { liPlan });
    return sourceValues.values.map((value) => ({ value: value.value, weight: Number(value.rows) || 0 }));
  }, [loadedCurrent, metricKey, rows, dim.key, liPlan, sourceValues.values]);
  const metricWeights = useMemo(() => foldedMetricWeights(rawWeights), [rawWeights]);
  const rankedUnassigned = useMemo(() => libraryMetricView(model.unassigned, metricWeights),
    [model.unassigned, metricWeights]);
  const allSuggestions = useMemo(() => groupCandidates(rankedUnassigned.map((value) => ({
    value: value.value,
    weight: value.metricInScope ? value.metricWeight : 0,
  }))), [rankedUnassigned]);
  const review = useMemo(() => reviewModel(metricWeights, groups, {
    dimKey: dim.key, candidates: allSuggestions, dismissed,
  }), [metricWeights, groups, dim.key, allSuggestions, dismissed]);
  const hasMetricReview = !!(loadedCurrent && metricKey);
  const metricByValue = useMemo(() => new Map(metricWeights.map((value) => [fold(value.value), value.weight])),
    [metricWeights]);
  const metricForMembers = (members) => {
    const keys = new Set((members || []).map(fold).filter(Boolean));
    let inScope = false;
    let weight = 0;
    for (const key of keys) {
      if (!metricByValue.has(key)) continue;
      inScope = true;
      weight += metricByValue.get(key) || 0;
    }
    return { inScope, weight };
  };
  const metricDetail = ({ inScope, weight }) => {
    if (!hasMetricReview) return null;
    if (!inScope) return 'Outside current line-item/flight scope';
    const amount = `${metricAmount(weight)} ${metricLabel}`;
    return review.named > 0
      ? `${amount} · ${pct((weight / review.named) * 100)} of named ${metricLabel}`
      : `${amount} in current line-item/flight scope`;
  };
  const canonicalRanked = [...model.canonical].sort((a, b) => {
    const am = metricForMembers(a.members);
    const bm = metricForMembers(b.members);
    if (am.inScope !== bm.inScope) return am.inScope ? -1 : 1;
    if (am.weight !== bm.weight) return bm.weight - am.weight;
    return String(a.label).localeCompare(String(b.label));
  });
  const ignoredRanked = model.ignored.map((value) => ({ value, ...metricForMembers([value]) }))
    .sort((a, b) => {
      if (a.inScope !== b.inScope) return a.inScope ? -1 : 1;
      if (a.weight !== b.weight) return b.weight - a.weight;
      return String(a.value).localeCompare(String(b.value));
    });
  const queryKey = fold(query);
  const visible = searchValues(rankedUnassigned, query);
  const filteredCanonical = canonicalRanked.filter((group) => !queryKey
    || fold(group.label).includes(queryKey)
    || group.members.some((member) => fold(member).includes(queryKey)));
  const filteredIgnored = ignoredRanked.filter((entry) => !queryKey || fold(entry.value).includes(queryKey));
  const valuePageCount = Math.max(1, Math.ceil(visible.length / VALUE_PAGE_SIZE));
  const safeValuePage = Math.min(valuePage, valuePageCount - 1);
  const visiblePage = visible.slice(safeValuePage * VALUE_PAGE_SIZE, (safeValuePage + 1) * VALUE_PAGE_SIZE);
  const suggestions = allSuggestions.filter((suggestion) => !isDismissed(dismissed, suggestion.members)).slice(0, 8);
  const hiddenSuggestions = allSuggestions.filter((suggestion) => isDismissed(dismissed, suggestion.members));

  // A suggestion IS a canonical value one state earlier — same shape, same
  // decision. Keeping them in two sections meant the proposal showed only its
  // name while the accepted one showed its members, so the evidence arrived
  // AFTER the choice. One list: proposals first, each opening on the spellings
  // it is made of. The AI answer replaces the heuristic one while it is on
  // screen; both are proposals and neither changes anything until accepted.
  const proposals = useMemo(() => {
    const rows = (ai || []).length
      ? ai.map((row, index) => ({ id: `ai${index}`, index, label: row.label, members: row.members, fromAi: true }))
      : suggestions.map((row, index) => ({ id: `heur${index}`, index, label: row.label, members: row.members, fromAi: false }));
    return rows.filter((row) => !queryKey || fold(row.label).includes(queryKey)
      || (row.members || []).some((member) => fold(member).includes(queryKey)));
  }, [ai, suggestions, queryKey]);


  const setDismissed = (result, label = 'suggestion choice') => {
    if (!result) return false;
    if (result.error) { setError(result.error); return false; }
    if (result.list === dismissed) return true;
    remember(label);
    setError(null);
    writeLibraryState(groups, result.list);
    return true;
  };

  const undoLast = () => {
    const previous = undo(history);
    if (!previous) return;
    setHistory(previous.history);
    writeLibraryState(previous.snapshot.groups || [], previous.snapshot.dismissed || []);
    setDeleteConfirm(null);
    setAssignment(null);
    setError(null);
  };

  const acceptProposal = (proposal) => {
    const label = (proposalName.trim() || proposal.label).trim();
    if (!label) return;
    if (assign(createGroup(groups, label, proposal.members), `accept “${label}”`)) {
      if (proposal.fromAi) setAi((cur) => (cur || []).filter((_, i) => i !== proposal.index));
      setOpenGroup(null);
    }
  };

  const hideProposal = (proposal) => {
    if (proposal.fromAi) { setAi((cur) => (cur || []).filter((_, i) => i !== proposal.index)); setOpenGroup(null); return; }
    if (setDismissed(dismissSuggestion(dismissed, proposal.members), `hide “${proposal.label}”`)) setOpenGroup(null);
  };

  const create = () => {
    const aliases = newAliases.split('\n').map((v) => v.trim()).filter(Boolean);
    if (assign(createGroup(groups, newName, aliases.length ? aliases : [newName]), `add “${newName.trim()}”`)) {
      setCreating(false); setNewName(''); setNewAliases('');
    }
  };

  const assignSourceValue = (value, label, asNew = false) => {
    const next = asNew ? createGroup(groups, label, [value]) : addToGroup(groups, label, [value]);
    if (!assign(next, `${asNew ? 'create' : 'assign'} “${value}”`)) return;
    setOpenGroup(`g:${label}`);
    setGroupName(label);
    setAlias('');
    setAssignment({ value, label });
  };

  const askAliasAi = async (label) => {
    setAliasAiBusy(label); setAliasAiError(null); setAliasAi(null);
    try {
      const r = await api.dimSourceSuggest(slug, source.id, { kind: 'aliases', dim: dim.key, label });
      if (r?.ok) setAliasAi({ label, members: r.members || [] });
      else setAliasAiError(r?.error || 'suggest_failed');
    } catch (e) {
      // A rate limit is a wait, not a failure, and saying "try again" for it sent
      // people looking for a broken feature.
      setAliasAiError(e?.status === 503 ? 'AI is not configured.'
        : e?.status === 429 ? 'Too many AI requests just now — try again in a minute.'
          : e?.status === 409 ? 'Save and read this library before asking AI.'
            : 'AI could not suggest aliases. Try again.');
    } finally { setAliasAiBusy(null); }
  };

  const askAi = async () => {
    setAiBusy(true); setAiError(null);
    try {
      const r = await api.dimSourceSuggest(slug, source.id, {
        kind: 'groups', dim: dim.key,
        candidates: suggestions.map((s) => ({ label: s.label, members: s.members })),
      });
      if (r?.ok) setAi(r.groups || []);
      else setAiError(r?.error || 'suggest_failed');
    } catch (e) {
      setAiError(e?.status === 503 ? 'AI is not configured.'
        : e?.status === 409 || !saved || !runtime?.rows
          ? 'Save and read this library before asking AI.' : 'AI could not suggest values. Try again.');
    } finally { setAiBusy(false); }
  };

  return (
    <div className="am-page am-page--task am-value-library">
      <header className="am-header">
        <div>
          <button type="button" className="am-back" onClick={onBack}>← Columns</button>
          <h3>{dim.label}</h3>
          <p>Source column · {dim.column}</p>
        </div>
        <div className="am-header-actions">
          {canUndo(history) && <button type="button" className="sp-btn sp-btn-s am-undo-button"
            title={`Undo ${undoLabel(history)}`} onClick={undoLast}>
            Undo {undoLabel(history)}
          </button>}
          <button type="button" className="sp-btn sp-btn-s" disabled={!aiReady || aiBusy || sourceValues.values.length < 2} onClick={askAi}
            title={!aiReady ? 'Save and read this library before asking AI' : undefined}>
            {aiBusy ? 'Asking AI…' : 'Suggest with AI'}
          </button>
          <button type="button" className="sp-btn sp-btn-p" onClick={() => setCreating(true)}>+ Add value</button>
        </div>
      </header>

      <StructureNotice issue={structureIssue} onRetry={structureIssue?.error ? null : onRetryStructure} />

      {sampled.loading && !loadedCurrent && <div className="am-state">Reading source values…</div>}
      {sampled.error && !loadedCurrent && <div className="am-state am-state--error">Could not read values from this column.
        <button type="button" className="am-text-button" onClick={sampled.retry}>Retry</button></div>}
      {sampled.error && loadedCurrent && <div className="am-note">Could not refresh the preview. Showing values from the last successful read.</div>}
      {sampled.result?.truncated && !loadedCurrent && <div className="am-note">Showing the 500 most frequent source combinations.</div>}
      {sourceValues.excludedRows > 0 && <div className="am-note">{int(sourceValues.excludedRows)} {sourceValues.excludedRows === 1 ? 'row is' : 'rows are'} excluded because the line-item name is not routed.</div>}
      {error && <div className="am-state am-state--error">{error}</div>}
      {aiError && <div className="am-state am-state--error">{aiError}</div>}
      {/* MEASURED: 45 s for a 6,222-value library. A disabled button and no
          sentence reads as a hang, and the second click is a second bill. */}
      {aiBusy && <div className="am-state">Asking AI to read {int(sourceValues.values.length)} source
        {sourceValues.values.length === 1 ? ' value' : ' values'}. On a large library this takes up to a minute.</div>}
      {!saved && sourceValues.values.length > 1 && <div className="am-note">Manual editing is available now. {rawCurrent ? 'Save these edits' : 'Save and read this column'} to enable AI suggestions.</div>}
      {saved && !aiReady && sourceValues.values.length > 1 && <div className="am-note">AI suggestions become available after this library has been read successfully. Manual editing is available now.</div>}
      <div className="am-library-toolbar">
      <input className="sp-inp am-search" value={query} type="search"
        aria-label="Find a canonical value, alias, or source value"
        placeholder="Find a canonical value, alias, or source value"
        onChange={(event) => { setQuery(event.target.value); setValuePage(0); }} />
      {hasMetricReview && reviewMetrics.length > 1 && <label className="am-field am-library-metric">
        <span>Review by</span>
        <select className="sp-inp" value={metricKey} onChange={(event) => setReviewMetric(event.target.value)}>
          {reviewMetrics.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}
        </select>
      </label>}
      </div>
      {hasMetricReview && <div className="am-library-coverage">
        <strong>{review.total > 0
          ? `Names ${metricAmount(review.named)} of ${metricAmount(review.total)} imported ${metricLabel} · ${pct((review.named / review.total) * 100)}`
          : review.values.length > 0
            ? `0 ${metricLabel} in current line-item/flight scope`
            : `No source values inside current line-item/flight scope`}</strong>
        <details><summary>Scope</summary>
          <p>Values are ordered by this metric. Amounts and shares below use only current pacing line items and their flight dates.</p>
        </details>
      </div>}
      {assignment && <div className="am-assignment" role="status">
        <span><strong>{assignment.value}</strong> → <strong>{assignment.label}</strong></span>
        <button type="button" className="am-text-button" onClick={() => setAssignment(null)} aria-label="Dismiss assignment confirmation">×</button>
      </div>}

      {creating && (
        <section className="am-create-value">
          <label className="am-field"><span>Canonical value</span>
            <input className="sp-inp" autoFocus value={newName} maxLength={120} placeholder="Hulu"
              onChange={(e) => setNewName(e.target.value)} /></label>
          <label className="am-field"><span>Aliases · one per line</span>
            <textarea className="sp-inp" value={newAliases} rows={3} placeholder={'Hulu Roku\nHulu iOS'}
              onChange={(e) => setNewAliases(e.target.value)} /></label>
          <div className="am-actions"><button type="button" className="sp-btn sp-btn-p" disabled={!newName.trim()} onClick={create}>Add value</button>
            <button type="button" className="sp-btn" onClick={() => setCreating(false)}>Cancel</button></div>
        </section>
      )}


      <div className="am-library-columns">
      <section className="am-section am-library-canonical">
        <div className="am-section-head"><div><h4>Canonical values</h4>
          <p>{noun(model.canonical.length, 'value')}{proposals.length ? ` · ${noun(proposals.length, 'proposal')} waiting` : ''}</p></div></div>
        {proposals.length === 0 && filteredCanonical.length === 0
          ? <div className="am-empty">{queryKey ? 'No canonical value or alias matches this search.' : 'No canonical values yet.'}</div>
          : (
            <div className="am-canonical-list">
              {proposals.map((proposal) => {
                const rowId = `p:${proposal.id}`;
                const open = openGroup === rowId;
                return (
                  <div className={`am-canonical am-canonical--proposed${open ? ' is-open' : ''}`} key={rowId}>
                    <button type="button" className="am-canonical-head" onClick={() => {
                      setOpenGroup(open ? null : rowId); setProposalName(proposal.label);
                    }}>
                      <strong>{proposal.label}</strong>
                      <span>Proposed · {noun(proposal.members.length, 'source value')}{hasMetricReview ? ` · ${metricDetail(metricForMembers(proposal.members))}` : ''}</span>
                      <span>{open ? '↑' : '↓'}</span>
                    </button>
                    {open && (
                      <div className="am-canonical-body">
                        <div className="am-inline-edit"><input className="sp-inp" value={proposalName} maxLength={120}
                          aria-label="Canonical value name" onChange={(event) => setProposalName(event.target.value)} /></div>
                        {proposal.members.map((member) => <div className="am-alias" key={member}>
                          <span>{member}{hasMetricReview ? ` · ${metricDetail(metricForMembers([member]))}` : ''}</span></div>)}
                        <div className="am-actions">
                          <button type="button" className="sp-btn sp-btn-p" onClick={() => acceptProposal(proposal)}>Accept</button>
                          <button type="button" className="sp-btn sp-btn-s" onClick={() => hideProposal(proposal)}>
                            {proposal.fromAi ? 'Skip' : 'Hide'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {proposals.length > 0 && filteredCanonical.length > 0
                && <div className="am-canonical-divider">Accepted</div>}

              {filteredCanonical.map((group) => {
                const rowId = `g:${group.label}`;
                const open = openGroup === rowId;
                return (
                  <div className={`am-canonical${open ? ' is-open' : ''}`} key={rowId}>
                    <button type="button" className="am-canonical-head" onClick={() => {
                      setOpenGroup(open ? null : rowId); setGroupName(group.label); setAlias('');
                    }}><strong>{group.label}</strong><span>{noun(group.members.length, 'alias', 'aliases')}{hasMetricReview ? ` · ${metricDetail(metricForMembers(group.members))}` : ''}</span><span>{open ? '↑' : '↓'}</span></button>
                    {open && (
                      <div className="am-canonical-body">
                        <div className="am-inline-edit"><input className="sp-inp" value={groupName} maxLength={120}
                          aria-label="Canonical value name" onChange={(e) => setGroupName(e.target.value)} />
                          <button type="button" className="sp-btn sp-btn-s" onClick={() => {
                            if (assign(renameGroup(groups, group.label, groupName), `rename “${group.label}”`)) setOpenGroup(`g:${groupName.trim()}`);
                          }}>Rename</button></div>
                        {group.members.map((member) => <div className="am-alias" key={member}>
                          <span>{member}{hasMetricReview ? ` · ${metricDetail(metricForMembers([member]))}` : ''}</span>
                          <button type="button" className="am-text-button" onClick={() => assign(splitGroup(groups, group.label, [member]), `remove alias “${member}”`)}>Remove</button></div>)}
                        <div className="am-inline-edit"><input className="sp-inp" value={alias} placeholder="Add an alias"
                          aria-label="Add an alias" onChange={(e) => setAlias(e.target.value)} />
                          <button type="button" className="sp-btn sp-btn-s" disabled={!alias.trim()} onClick={() => {
                            if (assign(addToGroup(groups, group.label, [alias]), `add alias “${alias.trim()}”`)) setAlias('');
                          }}>Add alias</button></div>
                        <div className="am-actions">
                          <button type="button" className="sp-btn sp-btn-s"
                            disabled={!aiReady || aliasAiBusy === group.label}
                            title={!aiReady ? 'Save and read this library before asking AI' : undefined}
                            onClick={() => askAliasAi(group.label)}>
                            {aliasAiBusy === group.label ? 'Asking AI…' : 'Find more aliases with AI'}
                          </button>
                        </div>
                        {aliasAiBusy === group.label && <div className="am-state">
                          Asking AI which unassigned values are also “{group.label}”. This takes up to a minute.</div>}
                        {aliasAiError && aliasAiBusy === null && aliasAi === null
                          && <div className="am-state am-state--error">{aliasAiError}</div>}
                        {aliasAi && aliasAi.label === group.label && (
                          aliasAi.members.length === 0
                            ? <div className="am-note">AI found nothing else that belongs to “{group.label}”.</div>
                            : <div className="am-proposed-aliases">
                              <strong>{noun(aliasAi.members.length, 'proposed alias', 'proposed aliases')}</strong>
                              {aliasAi.members.map((member) => (
                                <div className="am-alias" key={member}>
                                  <span>{member}{hasMetricReview ? ` · ${metricDetail(metricForMembers([member]))}` : ''}</span>
                                  <button type="button" className="am-text-button" onClick={() => {
                                    if (assign(addToGroup(groups, group.label, [member]), `add alias “${member}”`)) {
                                      setAliasAi((cur) => (cur ? { ...cur, members: cur.members.filter((m) => m !== member) } : cur));
                                    }
                                  }}>Add</button>
                                </div>
                              ))}
                              <div className="am-actions">
                                <button type="button" className="sp-btn sp-btn-p" onClick={() => {
                                  if (assign(addToGroup(groups, group.label, aliasAi.members),
                                    `add ${noun(aliasAi.members.length, 'alias', 'aliases')} to “${group.label}”`)) setAliasAi(null);
                                }}>Add all</button>
                                <button type="button" className="sp-btn sp-btn-s" onClick={() => setAliasAi(null)}>Dismiss</button>
                              </div>
                            </div>
                        )}
                        {deleteConfirm === group.label ? <div className="am-confirm">
                          <strong>Delete “{group.label}”?</strong>
                          <span>Its aliases become unassigned source values. Nothing is deleted from the source.</span>
                          <div className="am-actions">
                            <button type="button" className="sp-btn sp-btn-s" onClick={() => {
                              if (assign(ungroup(groups, group.label), `delete “${group.label}”`)) {
                                setDeleteConfirm(null); setOpenGroup(null);
                              }
                            }}>Delete canonical value</button>
                            <button type="button" className="sp-btn sp-btn-s" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                          </div>
                        </div> : <button type="button" className="am-text-button am-text-button--danger"
                          onClick={() => setDeleteConfirm(group.label)}>Delete canonical value</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        {hiddenSuggestions.length > 0 && (
          <details className="am-hidden-suggestions">
            <summary>Hidden proposals ({hiddenSuggestions.length})</summary>
            <div className="am-suggestion-list">
              {hiddenSuggestions.map((suggestion, index) => (
                <div className="am-suggestion" key={`hidden${index}`}>
                  <strong>{suggestion.label}</strong><span>{noun(suggestion.members.length, 'source value')}{hasMetricReview ? ` · ${metricDetail(metricForMembers(suggestion.members))}` : ''}</span>
                  <div><button type="button" className="sp-btn sp-btn-s"
                    onClick={() => setDismissed(undismissSuggestion(dismissed, suggestion.members), `restore “${suggestion.label}”`)}>Restore</button></div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="am-section am-library-source">
        <div className="am-section-head"><div><h4>Source values</h4>
          <p>Unassigned · shown as written until mapped</p></div>
          <button type="button" className="am-text-button" disabled={sampled.loading} onClick={sampled.retry}>Refresh source values</button></div>
        {visible.length > 0 && <div className="am-list-nav">
          <span>{int(safeValuePage * VALUE_PAGE_SIZE + 1)}–{int(Math.min(visible.length, (safeValuePage + 1) * VALUE_PAGE_SIZE))} of {int(visible.length)} source values</span>
          {valuePageCount > 1 && <div className="am-actions">
            <button type="button" className="sp-btn sp-btn-s" disabled={safeValuePage === 0}
              onClick={() => setValuePage(Math.max(0, safeValuePage - 1))}>Previous</button>
            <button type="button" className="sp-btn sp-btn-s" disabled={safeValuePage >= valuePageCount - 1}
              onClick={() => setValuePage(Math.min(valuePageCount - 1, safeValuePage + 1))}>Next</button>
          </div>}
        </div>}
        <div className="am-source-values">
          {visiblePage.map((row) => (
            <div className="am-value-row" key={row.value}>
              <div><strong>{row.value}</strong><span title={lineItemContext(row).full}>{lineItemContext(row).short}{hasMetricReview ? ` · ${metricDetail({ inScope: row.metricInScope, weight: row.metricWeight || 0 })}` : ''}</span></div>
              <div>
                <button type="button" className="am-text-button" onClick={() => assignSourceValue(row.value, row.value, true)}>Use as value</button>
                <select className="sp-inp" value="" aria-label={`Add ${row.value} as alias`} onChange={(e) => {
                  if (e.target.value) assignSourceValue(row.value, e.target.value);
                }}><option value="">Add as alias…</option>{model.canonical.map((g) => <option key={g.label} value={g.label}>{g.label}</option>)}</select>
                <button type="button" className="am-text-button" onClick={() => assign(ignoreValues(groups, [row.value]), `ignore “${row.value}”`)}>Ignore</button>
              </div>
            </div>
          ))}
        </div>
        {!visible.length && <div className="am-empty">{queryKey ? 'No unassigned source value matches this search.' : 'Every source value is assigned or ignored.'}</div>}
      </section>

      </div>

      {model.ignored.length > 0 && (
        <section className="am-section"><div className="am-section-head"><div><h4>Ignored values</h4><p>Excluded from this library, never deleted from the source.</p></div></div>
          {filteredIgnored.length ? filteredIgnored.map((entry) => <div className="am-alias" key={entry.value}><span>{entry.value}{hasMetricReview ? ` · ${metricDetail(entry)}` : ''}</span>
            <button type="button" className="am-text-button" onClick={() => assign(unignoreValues(groups, [entry.value]), `restore “${entry.value}”`)}>Restore</button></div>)
            : <div className="am-empty">No ignored value matches this search.</div>}
        </section>
      )}

      {handoffReady && typeof handoffAction === 'function' && <section className="am-summary">
        <strong>{int(effectiveRowCount)} {effectiveRowCount === 1 ? 'row' : 'rows'} after mapping</strong>
        <span>{distinctCount === null ? 'The saved library is ready to use.'
          : `${int(distinctCount)} distinct source ${distinctCount === 1 ? 'value' : 'values'} before aliases and grouping.`}</span>
        <div className="am-actions">
          <button type="button" className="sp-btn sp-btn-p" onClick={() => handoffAction(source, dim)}>
            {handoffToBreakdown ? 'See in Breakdown' : 'Create widget'}
          </button>
        </div>
      </section>}

      <details className="am-library-settings">
        <summary>Library settings</summary>
        <div className="am-section">
          <div className="am-section-head"><div><h4>Name and source column</h4><p>Use this when a source header changes or the library needs a clearer name.</p></div></div>
          <div className="am-form-grid">
            <label className="am-field"><span>Library name</span>
              <input className="sp-inp" value={labelDraft} maxLength={120} onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={() => {
                  const label = labelDraft.trim();
                  if (label) onChange(renameBreakdown(source, dim.key, label));
                  else setLabelDraft(dim.label || '');
                }} /></label>
            <label className="am-field"><span>Dashboard dimension</span>
              <select className="sp-inp" value={dim.brk_dim || ''}
                onChange={(event) => onChange(setBreakdownDim(source, dim.key, event.target.value))}>
                <option value="">Not linked</option>
                {FILTERABLE_DIMS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <div className="am-note">Link this when the column holds the same thing the dashboard
                filters by. Then a widget on this source follows that filter instead of ignoring it,
                and the canonical values above are what the filter is compared against.</div>
            </label>
            <div className="am-field"><span>Source column</span>
              {changingColumn ? <>
                <select className="sp-inp" value={columnDraft} onChange={(e) => {
                  setColumnDraft(e.target.value); setColumnConfirm(false);
                }}>
                  {columnOptions.map((column) => <option key={column} value={column}>{column}</option>)}
                </select>
                <div className="am-note">Use this to repair a renamed column. Choosing different data keeps this library's aliases and changes everything that uses it.</div>
                <div className="am-actions"><button type="button" className="sp-btn sp-btn-p"
                  disabled={!columnDraft || columnDraft === dim.column} onClick={() => {
                    if (usedBy.length) setColumnConfirm(true); else applyColumn();
                  }}>Use this column</button>
                  <button type="button" className="sp-btn sp-btn-s" onClick={() => {
                    setColumnDraft(dim.column); setColumnConfirm(false); setChangingColumn(false);
                  }}>Cancel</button></div>
                {columnConfirm && <div className="am-confirm">
                  <strong>This changes what {usedBy.length === 1 ? 'one dashboard block' : `${usedBy.length} dashboard blocks`} means.</strong>
                  <span>{usedBy.slice(0, 3).join(', ')}{usedBy.length > 3 ? ` and ${usedBy.length - 3} more` : ''} will stay connected to this library and use “{columnDraft}”.</span>
                  <div className="am-actions"><button type="button" className="sp-btn sp-btn-p" onClick={applyColumn}>Change column</button>
                    <button type="button" className="sp-btn sp-btn-s" onClick={() => setColumnConfirm(false)}>Cancel</button></div>
                </div>}
              </> : <div className="am-readonly-field"><strong>{dim.column}</strong>
                <button type="button" className="am-text-button" disabled={!structureReady}
                  title={!structureReady ? 'Retry the source check before changing columns' : undefined}
                  onClick={() => setChangingColumn(true)}>Change</button></div>}
            </div>
          </div>
        </div>
      </details>

      <div className="am-danger-zone">
        {removeConfirm ? (
          <>
            <span>
              Remove “{dim.label || dim.key}”? This removes {noun(model.canonical.length, 'canonical value')},
              {' '}{noun(model.canonical.reduce((count, group) => count + group.members.length, 0), 'alias', 'aliases')},
              and every manual decision in this library. The connected sheet stays unchanged.
              {usedBy.length
                ? ` It is used by ${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? ` and ${usedBy.length - 3} more` : ''}.`
                : ''}
            </span>
            <div className="am-actions">
              {usedBy.length > 0 && <button type="button" className="sp-btn sp-btn-s"
                onClick={() => onRemoveLibrary(true)}>Remove with dependent dashboard {usedBy.length === 1 ? 'block' : 'blocks'}</button>}
              <button type="button" className="sp-btn sp-btn-s" onClick={() => onRemoveLibrary(false)}>
                {usedBy.length ? 'Keep dashboard blocks disconnected' : 'Remove library'}
              </button>
              <button type="button" className="sp-btn sp-btn-s" onClick={() => setRemoveConfirm(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <><span>Remove this library, its canonical values, aliases, and manual decisions from the mapping.</span>
            <button type="button" className="am-text-button am-text-button--danger"
              onClick={() => setRemoveConfirm(true)}>Remove library</button></>
        )}
      </div>
    </div>
  );
}

export { ColumnScreen, StatusStrip, ColumnRow, TerminalSection, LineItemMatching, ValueLibrary, useSourceValues };
