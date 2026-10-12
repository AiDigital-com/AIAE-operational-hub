// workspace/src/pages/Dashboard/components/Settings/DimSourceEditor.jsx
//
// CONNECTING a sheet-backed dimension source — and nothing else.
//
// This product splits the two halves and has done since 2026-08-02: Data
// connects a source, Mapping configures it. So this file owns the link, the tab
// and the name; every column, LI route and value library lives in the separate
// Additional-data workflow on the Mapping tab.
//
// Two pieces, both slotting into ThirdPartySection, which already owns
// "+ Add source", the type picker and the block list:
//
//   DimSourceFlow   the connect flow, rendered as one more `sp-tp-flow`
//   DimSourceBlock  one connected source, rendered as one more `sp-tp-block`

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './settings-api.js';
import {
  isDimSourceMapped, probeErrorText, widgetsUsingSource, dimSourceFingerprint,
} from './sheet-source-norm.js';
import Lbl from './Lbl.jsx';
import { DIM_SOURCE_AXES } from './dim-sources-norm.js';

/**
 * A stable id from the title, unique against what is already stored — AND
 * against the built-in catalogue.
 *
 * A source titled "Devices" minted `devices`, which is a catalogue key: the
 * saved source was fine and every widget on `ds:devices:…` was then refused,
 * because both validators resolve that id through the catalogue. The server
 * refuses the collision now; this is what stops it being minted at all.
 */
function idFrom(title, taken) {
  const base = String(title || 'source').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'source';
  const reserved = [...taken, ...Object.keys(DIM_SOURCE_AXES)];
  let id = /^[a-z]/.test(base) ? base : 's_' + base;
  let n = 2;
  while (reserved.includes(id)) { id = (base + '_' + n).slice(0, 40); n += 1; }
  return id;
}

/* ── connect ───────────────────────────────────────────────────────────────── */

/** A spreadsheet id out of anything a person might paste. */
function sheetIdFrom(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,120})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/** One tab, as a connection card. No column gets a business meaning in Data. */
// Exported for tests: the probed state lives in DimSourceFlow's own state and a
// static render never reaches it, so this is the only way to check the screen
// that decides everything rather than the text of the file that draws it.
export function TabCard({ tab, selected, onSelect, headerRow, onHeaderRow }) {
  // The row in use: what the detector chose, or what the person corrected it to.
  // Detection is a guess with good odds, and a guess shown without a way to
  // change it is a dead end for whoever it guessed wrong about.
  const grid = Array.isArray(tab.grid) ? tab.grid : null;
  const hr = headerRow != null ? headerRow : tab.header_row;
  const headers = grid && hr >= 0 ? (grid[hr] || []) : (hr === tab.header_row ? (tab.headers || []) : []);
  const sample = grid && hr >= 0 ? (grid[hr + 1] || []) : (hr === tab.header_row ? ((tab.sample || [])[0] || []) : []);
  const unusable = hr < 0 || headers.length === 0;
  const cleanHeaders = headers.map((h) => String(h == null ? '' : h).trim()).filter(Boolean);
  const duplicates = cleanHeaders.filter((h, i) => cleanHeaders.indexOf(h) !== i)
    .filter((h, i, all) => all.indexOf(h) === i);
  const proof = cleanHeaders.slice(0, 5).map((h) => {
    const i = headers.findIndex((x) => String(x == null ? '' : x).trim() === h);
    const value = i >= 0 ? String(sample[i] == null ? '' : sample[i]).trim() : '';
    return value ? `${h}: ${value}` : h;
  });

  return (
    <div className={`sp-tp-block${selected ? ' sp-tp-block--on' : ''}`}>
      <label className="sp-tp-block-row sp-tp-camp">
        <input type="radio" name="dim-tab" checked={selected} disabled={unusable} onChange={onSelect} />
        <span className="sp-tp-block-count">{tab.title}</span>
        <span className="text-11">{Number(tab.row_count || 0).toLocaleString('en-US')} rows</span>
      </label>

      {unusable ? (
        <div className="sp-tp-status sp-tp-status-error">
          Nothing in the first rows looks like a header — this tab cannot be a source.
        </div>
      ) : (
        <>
          {/* Silent on an ordinary sheet that is not the one being taken: "Headers
              on row 1" is noise on every well-behaved tab. Stated whenever it is
              NOT row 1 — that is a fact about the file — and on the selected tab,
              where the correction control has to live. */}
          {(hr > 0 || selected) && (
          <div className="sp-tp-status sp-tp-status-muted">
            {hr > 0
              ? `Headers on row ${hr + 1}${hr === 1 ? ' — the row above is skipped' : ` — the ${hr} rows above are skipped`}`
              : 'Headers on row 1'}
            {selected && grid && (
              <>
                <input
                  className="sp-inp sp-inp--sm sp-tp-hdr-row"
                  type="number" min="1" max={Math.min(grid.length, 15)}
                  value={hr + 1}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(grid.length, 15, Number(e.target.value) || 1));
                    onHeaderRow(n - 1);
                  }}
                />
                {headerRow != null && headerRow !== tab.header_row && (
                  <button type="button" className="sp-tp-link" onClick={() => onHeaderRow(null)}>
                    Use the one we found
                  </button>
                )}
              </>
            )}
          </div>
          )}
          <div className="sp-tp-status sp-tp-status-muted">
            {`${cleanHeaders.length} columns found`}
            {proof.length ? ` · ${proof.join(' · ')}${cleanHeaders.length > proof.length ? '…' : ''}` : ''}
          </div>
          {duplicates.length > 0 && (
            <div className="sp-tp-status sp-tp-status-error">
              Repeated header{duplicates.length > 1 ? 's' : ''}: {duplicates.join(', ')} —
              columns are matched by name, so only the first of each can be read.
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function DimSourceFlow({ slug, sources, onAdd, onCancel }) {
  const stored = Array.isArray(sources) ? sources : [];
  const [url, setUrl] = useState('');
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);
  const [err, setErr] = useState(null);
  const [tabId, setTabId] = useState(null);
  const [title, setTitle] = useState('');
  // A corrected header row, or null to trust the detector.
  const [headerRow, setHeaderRow] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const probedRef = useRef(null);

  // Reads on paste. A "Read tabs" button asked the person to confirm the one
  // thing they had already decided by pasting the link.
  //
  // `attempt` counts retries, so the effect re-runs on the SAME url when Retry is
  // pressed. Keying only on the id meant a failed probe was remembered for ever:
  // the copy said "share it and paste again", pasting the same link did nothing
  // at all, and there was no Retry either — the flow simply ended.
  //
  // Typing a NEW link clears the old result first. Without that, a probe that
  // failed left the previous spreadsheet's cards and its Add button live under a
  // url pointing somewhere else — one click from storing the wrong file.
  useEffect(() => {
    const id = sheetIdFrom(url);
    if (!id) {
      // Not a spreadsheet link. Say so once there is enough text to judge, rather
      // than sitting silent — an unrecognised link looked identical to a slow one.
      setProbe(null); setTabId(null);
      setErr(url.trim().length > 12 ? probeErrorText('bad_url') : null);
      return undefined;
    }
    const key = id + '#' + attempt;
    if (probedRef.current === key) return undefined;
    probedRef.current = key;
    let live = true;
    setProbe(null); setTabId(null); setHeaderRow(null);
    setProbing(true); setErr(null);
    api.sheetProbe(slug, url)
      .then((r) => {
        if (!live) return;
        if (r.ok !== true) { setErr(probeErrorText(r.error, r.share_with)); return; }
        setProbe(r);
        setTitle(r.title || 'Sheet source');
        const usable = (r.tabs || []).filter((t) => t && t.header_row >= 0);
        const first = usable[0] || (r.tabs || [])[0];
        if (first) setTabId(first.sheet_id);
      })
      .catch(() => { if (live) setErr(probeErrorText('probe_failed')); })
      .finally(() => { if (live) setProbing(false); });
    return () => { live = false; };
  }, [url, slug, attempt]);

  const tab = (probe?.tabs || []).find((t) => t.sheet_id === tabId) || null;

  const effHeaderRow = headerRow != null ? headerRow : (tab ? tab.header_row : -1);
  const duplicate = !!tab && stored.some((source) => source?.loader === 'sheet'
    && source.origin?.spreadsheet_id === probe?.spreadsheet_id
    && source.origin?.sheet_id === tab.sheet_id);
  const ready = !!tab && effHeaderRow >= 0 && !!title.trim() && !duplicate;

  const connect = () => {
    onAdd([...stored, {
      id: idFrom(title, stored.map((x) => x.id)),
      loader: 'sheet',
      title: title.trim().slice(0, 60) || 'Sheet source',
      origin: {
        spreadsheet_id: probe.spreadsheet_id,
        sheet_id: tab.sheet_id,
        title: tab.title || '',
        // A hint for later reads, never an instruction: the loader re-finds the
        // header by the mapping's own column names, because a row inserted above
        // it would leave a stored index pointing at somebody's banner for ever.
        header_row: effHeaderRow > 0 ? effHeaderRow : 0,
      },
    }]);
  };

  return (
    <div className="sp-tp-flow">
      <div className="sp-tp-block-row">
        <span className="sp-tp-badge">Sheet</span>
        <span className="sp-tp-block-count">
          {probe ? 'Choose the tab to connect' : 'Paste the spreadsheet link'}
        </span>
      </div>

      <input className="sp-inp" type="text" value={url}
        placeholder="https://docs.google.com/spreadsheets/d/…"
        onChange={(e) => setUrl(e.target.value)} />
      {probing && <div className="sp-tp-status sp-tp-status-muted">Reading the spreadsheet…</div>}
      {err && (
        <div className="sp-tp-status sp-tp-status-error">
          {err}
          <button type="button" className="sp-tp-link" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </div>
      )}

      {probe && (probe.tabs || []).map((t) => (
        <TabCard
          key={t.sheet_id}
          tab={t}
          selected={t.sheet_id === tabId}
          onSelect={() => { setTabId(t.sheet_id); setHeaderRow(null); }}
          headerRow={t.sheet_id === tabId ? headerRow : null}
          onHeaderRow={setHeaderRow}
        />
      ))}

      {probe && (
        <div className="sp-card-fields">
          <label className="sp-card-field">
            <Lbl>Name</Lbl>
            <input className="sp-inp" type="text" value={title} maxLength={60}
              onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
      )}

      {probe && tab && (
        <div className="sp-tp-status sp-tp-status-muted">
          Column meaning and line-item matching are configured separately in Mapping.
        </div>
      )}
      {duplicate && (
        <div className="sp-tp-status sp-tp-status-error">
          This tab is already connected as an additional source.
        </div>
      )}

      <div className="sp-tp-flow-foot">
        <button type="button" className="sp-btn sp-btn-p" disabled={!ready} onClick={connect}>
          Connect source
        </button>
        <button type="button" className="sp-btn sp-btn-s" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ── one connected source, as a block ──────────────────────────────────────── */

// SEAM: `onRead` replaces the SPA's own store write. After a re-read the figures on screen are
// stale, and the SPA pushed the fresh slice straight into its store; the Hub refetches the
// dashboard query, which only the host can do. Same job, one prop instead of a store import.
export function DimSourceBlock({ source, slug, runtime, coverage, saved, widgets, onRemove, onGoToMapping, onRead = null }) {
  const patchDimSource = (id, entry) => { if (onRead) onRead(id, entry); };
  // The DRAFT list, passed in — not the store's saved one. A tile added in this
  // same drawer session has to count, or the removal dialog understates what it
  // is about to disconnect.
  const usedBy = useMemo(() => widgetsUsingSource(widgets, source.id), [widgets, source.id]);
  const [reading, setReading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState(null);
  const mapped = isDimSourceMapped(source);
  // "Re-read now" goes to the server, which reads config_json — the SAVED
  // mapping, not the draft on this screen. Offering it on an edited source would
  // re-read with the old mapping and report success.
  //
  // Compared by fingerprint, not by bytes: the client writes metrics in
  // sheet-column order and the server rebuilds them in its own, so a source that
  // had just saved cleanly read as "not saved yet" and hid its own Re-read.
  const unsaved = !saved || dimSourceFingerprint(saved) !== dimSourceFingerprint(source);
  const parsedRuntimeRows = runtime?.rows == null ? null : Number(runtime.rows);
  const runtimeRows = Number.isFinite(parsedRuntimeRows) ? parsedRuntimeRows : null;
  const readComplete = mapped && runtime?.status !== 'stale'
    && (runtime?.status === 'ok' || !!runtime?.fetched_at);
  const hasPreviousRead = !!runtime?.fetched_at || (runtimeRows != null && runtimeRows > 0);
  const isReading = reading || !!runtime?.reading;

  const reread = async () => {
    setReading(true); setNote(null);
    try {
      const r = await api.dimSourceRead(slug, source.id);
      if (!r.ok) {
        // A FIRST read has no previous rows to fall back on, so it must not
        // borrow the re-read's "the previous rows are still shown" — there are
        // none, and saying otherwise sends someone looking for data that is not
        // there.
        setNote(r.stale
          ? `Could not read it: ${r.error} — the previous rows are still shown.`
          : `Could not read it: ${r.error}. Nothing has been imported yet.`);
      } else {
        setNote(`Read ${Number(r.rows || 0).toLocaleString('en-US')} rows.`);
      }
      // The read happened on the server and answered with a count; the rows
      // (or its stale carry-forward) arrive on the next fetch. Refresh on both
      // outcomes: returning early on stale left the store claiming `ok` while
      // the server had already recorded the failure.
      const blob = await api.dashboardData(slug);
      const fresh = blob && blob.dimSources && blob.dimSources[source.id];
      if (fresh) patchDimSource(source.id, fresh);
    } catch {
      setNote('Could not reach the sheet service.');
    } finally { setReading(false); }
  };

  // NO auto-read here. It used to fire one from an effect the moment a saved,
  // mapped source had no rows — a second read mechanism beside the drawer's Save
  // and the nightly one, invisible to the person it happened for. The drawer's
  // Save now schedules exactly what its own edit made stale (spec §7a), which is
  // the same job done once, where the user pressed something.

  return (
    <div className="sp-tp-block">
      <div className="sp-tp-block-row">
        <span className="sp-tp-badge">Sheet</span>
        <span className="sp-tp-block-count">{source.title || source.id}</span>
        <div className="sp-tp-block-actions">
          <a className="sp-tp-link"
            href={`https://docs.google.com/spreadsheets/d/${source.origin?.spreadsheet_id}/edit#gid=${source.origin?.sheet_id}`}
            target="_blank" rel="noreferrer">Open sheet</a>
          {onGoToMapping && (
            <button type="button" className="sp-tp-link"
              onClick={() => onGoToMapping(source.id, mapped ? null : 'create')}>
              {mapped ? 'Open mapping' : 'Set up mapping →'}
            </button>
          )}
          {mapped && !unsaved && (
            <button type="button" className="sp-tp-link" disabled={isReading} onClick={reread}>
              {isReading ? 'Reading…' : 'Re-read now'}
            </button>
          )}
          {/* With tiles on this source the choice is not yes/no — it is which of
              two legitimate outcomes (§5.9), so the dialog below asks it instead
              of a two-click confirm that can only do one of them. */}
          <button
            type="button"
            className={`sp-tp-link sp-tp-link-danger${confirm ? ' confirm' : ''}`}
            onClick={() => (confirm && !usedBy.length ? onRemove(false) : setConfirm(true))}
          >
            {confirm && !usedBy.length ? 'Remove?' : 'Remove'}
          </button>
        </div>
      </div>
      <div className="sp-tp-block-row">
        {unsaved ? (
          <span className="sp-tp-status sp-tp-status-muted">
            Connected to {source.origin?.title || 'the selected tab'} · not saved yet
          </span>
        ) : mapped && runtime?.status === 'stale' ? (
          <span className="sp-tp-status sp-tp-status-error">
            Connected · last read failed ({runtime.error || 'unknown'}) ·{' '}
            {hasPreviousRead
              ? `previous data from ${runtime.fetched_at ? runtime.fetched_at.slice(0, 10) : 'an earlier read'}`
              : 'Nothing has been imported yet.'}
          </span>
        ) : mapped && isReading ? (
          <span className="sp-tp-status sp-tp-status-muted">
            Connected to {source.origin?.title || 'the selected tab'} · reading current mapping…
          </span>
        ) : mapped && runtime?.behind ? (
          <span className="sp-tp-status sp-tp-status-pending">
            Connected · source data predates the current delivery refresh · re-read to verify coverage
          </span>
        ) : readComplete && runtimeRows === 0 ? (
          <span className="sp-tp-status sp-tp-status-ready">
            ✓ Connected to {source.origin?.title || 'the selected tab'}
            {runtime?.fetched_at ? ` · last read ${runtime.fetched_at.slice(0, 10)}` : ''}
            {' · read complete · 0 rows imported'}
          </span>
        ) : readComplete ? (
          <span className="sp-tp-status sp-tp-status-ready">
            ✓ Connected to {source.origin?.title || 'the selected tab'}
            {runtime?.fetched_at ? ` · last read ${runtime.fetched_at.slice(0, 10)}` : ''}
            {runtimeRows != null ? ` · ${runtimeRows.toLocaleString('en-US')} rows` : ''}
          </span>
        ) : mapped ? (
          <span className="sp-tp-status sp-tp-status-muted">
            Connected to {source.origin?.title || 'the selected tab'} · mapping saved · not read yet
          </span>
        ) : (
          <span className="sp-tp-status sp-tp-status-ready">
            ✓ Connected to {source.origin?.title || 'the selected tab'}
          </span>
        )}
      </div>
      {mapped && !unsaved && readComplete && !isReading && !runtime?.behind
        && coverage && Number.isFinite(coverage.ratio) && (
        <div className="sp-tp-block-row">
          <span className="sp-tp-status sp-tp-status-muted">
            {`This source covers ${coverage.ratio * 100 < 10
              ? (coverage.ratio * 100).toFixed(1)
              : Math.round(coverage.ratio * 100)}% of pacing ${String(coverage.metric || 'delivery').toLowerCase()}`}
          </span>
        </div>
      )}
      {/* Removing is a one-line filter, and a widget built on this axis stays on
          the dashboard as an empty table with nothing to explain it. Both
          outcomes are legitimate — somebody may be re-adding the source under a
          new name — so the choice stays the user's, but it is never made
          unknowingly. */}
      {confirm && usedBy.length > 0 && (
        <div className="sp-tp-block">
          <div className="sp-tp-status sp-tp-status-error">
            {`Remove \u201c${source.title || source.id}\u201d?`}
          </div>
          <div className="sp-tp-status sp-tp-status-muted">
            {`Used by: ${usedBy.slice(0, 4).join(', ')}${usedBy.length > 4 ? `, +${usedBy.length - 4}` : ''}.`}
          </div>
          <div className="sp-tp-block-actions">
            <button type="button" className="sp-btn sp-btn-s"
              onClick={() => { onRemove(true); setConfirm(false); }}>
              {usedBy.length === 1 ? 'Remove with that widget' : 'Remove with those widgets'}
            </button>
            <button type="button" className="sp-btn sp-btn-s"
              onClick={() => { onRemove(false); setConfirm(false); }}>
              Keep them, disconnected
            </button>
            <button type="button" className="sp-btn sp-btn-s" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
          <div className="sp-tp-status sp-tp-status-muted">
            A disconnected tile stays on the dashboard and says what it is missing, so it can be
            reconnected if this source comes back under another name.
          </div>
        </div>
      )}
      {note && <div className="sp-tp-block-row"><span className="sp-tp-status sp-tp-status-muted">{note}</span></div>}
    </div>
  );
}

/* ── which kind of source to add ───────────────────────────────────────────── */
// MOVED from the reference's ThirdPartySection: one question - "what are you connecting?" - with
// the three answers the product actually has. The Hub had two separate buttons in two separate
// blocks instead, which made the third kind (a tab that REPLACES delivery) look like it did not
// exist.
export function SourceTypeFlow({ sheetTaken, onPick, onCancel }) {
  return (
    <div className="sp-tp-flow">
      <div className="sp-tp-camp-list">
        <label className="sp-tp-camp">
          <input type="radio" name="sp-tp-kind" checked={false} onChange={() => onPick('cm360')} />
          <span className="sp-tp-camp-main">
            <span className="sp-tp-camp-name">CM360</span>
            <span className="sp-tp-camp-note">3rd-party ad-server data to compare delivery against</span>
          </span>
        </label>
        <label className="sp-tp-camp">
          <input
            type="radio"
            name="sp-tp-kind"
            checked={false}
            disabled={sheetTaken}
            onChange={() => onPick('sheet')}
          />
          <span className="sp-tp-camp-main">
            <span className="sp-tp-camp-name">Google Sheet — replaces delivery</span>
            <span className="sp-tp-camp-note">
              {sheetTaken
                ? 'One spreadsheet per pacing — remove the current one first'
                : 'a tab BECOMES the delivery of one line item, instead of BigQuery'}
            </span>
          </span>
        </label>
        {/* Additional inputs never replace pacing delivery. Data only connects
            them; their LI matching and value libraries are created in Mapping. */}
        <label className="sp-tp-camp">
          <input type="radio" name="sp-tp-kind" checked={false} onChange={() => onPick('dim-sheet')} />
          <span className="sp-tp-camp-main">
            <span className="sp-tp-camp-name">Google Sheet — additional data</span>
            <span className="sp-tp-camp-note">
              connect a tab without replacing delivery; create its mapping separately
            </span>
          </span>
        </label>
      </div>
      <div className="sp-tp-flow-foot">
        <button type="button" className="sp-btn sp-btn-s" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
