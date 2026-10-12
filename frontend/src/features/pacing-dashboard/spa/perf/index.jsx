// workspace/src/pages/Dashboard/components/Settings/PerformanceSourceEditor/index.jsx
//
// Settings · Mapping · Performance source, in the Additional-data kind of screen
// (plan: docs/2026-09-16-performance-source-editor-plan.md).
//
// Two screens. TABS: which tabs of the spreadsheet feed delivery, with the
// figures a person needs before opening anything. COLUMNS (TabColumns.jsx):
// one tab, every column with one job.
//
// The drawer owns the draft (`sheet`) and every edit flows up through
// onChange(nextSheet), exactly as the old mapper did, so the drawer's
// dirty / Save / Reset contract (normSheet, sheetPayload, bindingErrors,
// sheetInvalid) does not move. Nothing here connects or removes the
// spreadsheet: that stays on the Data tab.

import { useEffect, useState } from 'react';
import {
  bindingErrors, bindingLineItemIds, sheetErrors, newBinding,
} from '../sheet-source-norm.js';
import {
  routeSummary, useTabReason, cellsOf, actionsOf, lineItemLabel, columnCount, TAB_CAP, ACTION_CAP,
} from '../perf-mapping.js';
import TabColumns from './TabColumns.jsx';

const clean = (v) => String(v == null ? '' : v).trim();
const int = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many}`;

/** The drawer's line-item list as the map the helpers read. */
export function liMapOf(lineItems) {
  return new Map((lineItems || []).map((li) => [String(li.id), { rate_type: li.rate_type, label: li.label }]));
}

export default function PerformanceSourceEditor({
  sheet, onChange, slug, lineItems, probe, probing, probeErrorText, onRetryProbe,
  // Opens the Add-LI dialog from a line-item picker (LiSelect picks the first
  // added id back into it). Absent = plain pickers.
  onAddLineItem = null,
  initialTab = null,
}) {
  const tabs = Array.isArray(sheet?.tabs) ? sheet.tabs : [];
  // One bound tab is the common case, and for it the list is a click in the way:
  // open that tab's columns at once, the way the Additional-data screen opens on
  // its one tab. "← Tabs" still reaches the list (free tabs, stopping). With none
  // or several tabs the list is the answer to "which tabs", so it opens first.
  const [openTab, setOpenTab] = useState(initialTab != null ? initialTab : (tabs.length === 1 ? tabs[0].sheet_id : null));
  const current = openTab != null ? tabs.find((t) => t.sheet_id === openTab) || null : null;
  // A tab that stopped being used while open sends the screen back to the list.
  useEffect(() => { if (openTab != null && !current) setOpenTab(null); }, [openTab, current]);

  const probedTabs = Array.isArray(probe?.tabs) ? probe.tabs : [];
  const probedByGid = new Map(probedTabs.map((t) => [t.sheet_id, t]));

  const patchTab = (gid, next) => onChange({ ...sheet, tabs: tabs.map((t) => (t.sheet_id === gid ? next : t)) });
  // No line item is claimed on behalf of the person: the Columns screen asks.
  const useTab = (probedTab) => {
    onChange({ ...sheet, tabs: [...tabs, newBinding(probedTab, '')] });
    setOpenTab(probedTab.sheet_id);
  };
  const stopTab = (gid) => {
    onChange({ ...sheet, tabs: tabs.filter((t) => t.sheet_id !== gid) });
    if (openTab === gid) setOpenTab(null);
  };

  if (current) {
    return (
      <TabColumns
        key={current.sheet_id}
        tab={current}
        sheet={sheet}
        probedTab={probedByGid.get(current.sheet_id) || null}
        probeLoaded={!!probe && !probing}
        probeTitle={probe?.title || ''}
        probing={probing}
        probeErrorText={probeErrorText}
        onRetryProbe={onRetryProbe}
        slug={slug}
        lineItems={lineItems}
        onAddLineItem={onAddLineItem}
        onChange={(next) => patchTab(current.sheet_id, next)}
        onBack={() => setOpenTab(null)}
      />
    );
  }

  return (
    <TabsScreen
      sheet={sheet}
      probe={probe}
      probing={probing}
      probeErrorText={probeErrorText}
      onRetryProbe={onRetryProbe}
      lineItems={lineItems}
      onOpenTab={setOpenTab}
      onUseTab={useTab}
      onStopTab={stopTab}
    />
  );
}

/* ── the Tabs screen ───────────────────────────────────────────────────────── */

export function TabsScreen({
  sheet, probe, probing, probeErrorText, onRetryProbe, lineItems,
  onOpenTab, onUseTab, onStopTab,
}) {
  const [confirmStop, setConfirmStop] = useState(null);      // sheet_id
  const tabs = Array.isArray(sheet?.tabs) ? sheet.tabs : [];
  const probedTabs = Array.isArray(probe?.tabs) ? probe.tabs : [];
  const probedByGid = new Map(probedTabs.map((t) => [t.sheet_id, t]));
  const probeLoaded = !!probe && !probing;
  const liById = liMapOf(lineItems);

  const errorsOf = new Map(tabs.map((t) => [t.sheet_id, bindingErrors(t, liById)]));
  const toFix = tabs.filter((t) => errorsOf.get(t.sheet_id).length > 0).length;
  const acrossTabs = sheetErrors(sheet, liById);
  const fedIds = new Set(tabs.flatMap(bindingLineItemIds));
  const actionCount = tabs.reduce((n, t) => n + actionsOf(t).length, 0);
  const tabsWithActions = tabs.filter((t) => actionsOf(t).length > 0).length;
  const cellsInUse = tabs.reduce((n, t) => n + cellsOf(probedByGid.get(t.sheet_id)), 0);

  const bound = new Set(tabs.map((t) => t.sheet_id));
  const unbound = probedTabs.filter((t) => !bound.has(t.sheet_id));
  const gone = probeLoaded ? tabs.filter((t) => !probedByGid.has(t.sheet_id)) : [];

  const live = tabs.filter((t) => !gone.includes(t));
  const feeds = (n) => (n === 1 ? 'tab feeds' : 'tabs feed');
  const headline = tabs.length === 0
    ? 'No tab feeds delivery yet'
    : (probeLoaded
      ? `${tabs.length} of ${probedTabs.length} ${feeds(probedTabs.length)} delivery`
      : `${tabs.length} ${feeds(tabs.length)} delivery`)
      + (toFix ? ` · ${toFix} need${toFix === 1 ? 's' : ''} attention` : '');

  const stopSentence = (t) => {
    const ids = bindingLineItemIds(t);
    if (!ids.length) return 'Nothing changes on the dashboard: this tab feeds no line item yet.';
    const names = ids.map((id) => lineItemLabel(liById, id));
    const list = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
    return `${list} ${ids.length === 1 ? 'goes' : 'go'} back to BigQuery delivery at the next refresh.`;
  };

  return (
    <div className="am-page">
      <header className="am-header">
        <div>
          <div className="am-eyebrow">Performance source</div>
          <h3>{probe?.title || sheet?.spreadsheet_id || 'Google Sheet'}</h3>
          <p>{headline}</p>
        </div>
      </header>

      {probing && <div className="sp-tp-status sp-tp-status-muted">Reading tabs…</div>}
      {probeErrorText && (
        <div className="sp-tp-status sp-tp-status-error">
          {probeErrorText}
          <button type="button" className="sp-tp-link" onClick={onRetryProbe}>Retry</button>
        </div>
      )}

      <dl className="am-figures">
        <div className="am-fig">
          <dt>Tabs in use</dt>
          <dd>{tabs.length} of {TAB_CAP}
            <span className="am-fig-sub">{tabs.length >= TAB_CAP
              ? 'At the limit'
              : `${plural(TAB_CAP - tabs.length, 'more may be added', 'more may be added')}`}</span>
          </dd>
        </div>
        <div className="am-fig">
          <dt>Line items fed</dt>
          <dd className={fedIds.size ? '' : 'am-fig--warn'}>{fedIds.size ? int(fedIds.size) : 'None yet'}
            <span className="am-fig-sub">{fedIds.size
              ? 'Their delivery comes from this spreadsheet instead of BigQuery'
              : 'Open a tab and say which line item its rows belong to'}</span>
          </dd>
        </div>
        <div className="am-fig">
          <dt>Conversion actions</dt>
          <dd>{actionCount ? `${int(actionCount)} across ${plural(tabsWithActions, 'tab', 'tabs')}` : 'None'}
            <span className="am-fig-sub">Up to {ACTION_CAP} per tab</span>
          </dd>
        </div>
        <div className="am-fig">
          <dt>To fix</dt>
          <dd className={toFix || acrossTabs.length ? 'am-fig--warn' : ''}>
            {toFix ? plural(toFix, 'tab', 'tabs') : acrossTabs.length ? 'The sheet' : 'Nothing'}
            <span className="am-fig-sub">{toFix || acrossTabs.length
              ? 'Save stays off until it is fixed'
              : 'Every tab can be saved'}</span>
          </dd>
        </div>
      </dl>

      {acrossTabs.length > 0 && (
        <div className="am-state am-state--error ps-blocked">
          <strong>Save is blocked until this is fixed.</strong>
          <ul>{acrossTabs.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <section className="am-section">
        <div className="am-section-head">
          <div>
            <h4>Feeding delivery</h4>
            <p>These tabs replace BigQuery for the line items they name.</p>
          </div>
        </div>
        {live.length === 0 ? (
          <div className="am-empty">
            <strong>{tabs.length ? 'Every mapped tab has gone from the spreadsheet' : 'No tab feeds delivery yet'}</strong>
            <span>{!probeLoaded
              ? 'The tabs of this spreadsheet have not been read yet.'
              : tabs.length ? 'Stop using the missing tabs below, or restore them in the sheet.' : 'Pick one of the tabs below with “Use this tab”.'}</span>
          </div>
        ) : (
          <div className="ps-tabs">
            {live.map((t) => {
              const probed = probedByGid.get(t.sheet_id) || null;
              const errs = errorsOf.get(t.sheet_id);
              const hr = probed && Number.isInteger(probed.header_row) ? probed.header_row : 0;
              return (
                <div className="ps-tab" key={t.sheet_id}>
                  <div className="ps-tab-row">
                    <div className="ps-tab-main">
                      <strong>{t.title || probed?.title || `#${t.sheet_id}`}</strong>
                      <span className="ps-tab-meta">{probed
                        ? `${int(probed.row_count)} rows · ${plural(columnCount(probed.headers), 'column', 'columns')}`
                          + (hr > 0 ? ` · headers on row ${hr + 1}` : '')
                        : 'Not read yet'}</span>
                    </div>
                    <div className="ps-tab-route">
                      <span>{routeSummary(t, liById)}</span>
                      {errs.length > 0 && <span className="ps-fix">{plural(errs.length, 'to fix', 'to fix')}</span>}
                    </div>
                    <div className="ps-tab-actions">
                      <button type="button" className="sp-btn sp-btn-s" onClick={() => onOpenTab(t.sheet_id)}>Open</button>
                      <button type="button" className="am-text-button am-text-button--danger"
                        onClick={() => setConfirmStop(t.sheet_id)}>Stop using it</button>
                    </div>
                  </div>
                  {confirmStop === t.sheet_id && (
                    <div className="am-confirm">
                      <strong>Stop using “{t.title || `#${t.sheet_id}`}”?</strong>
                      <span>{stopSentence(t)}</span>
                      <div className="am-actions">
                        <button type="button" className="sp-btn sp-btn-p" onClick={() => { setConfirmStop(null); onStopTab(t.sheet_id); }}>Stop using it</button>
                        <button type="button" className="sp-btn sp-btn-s" onClick={() => setConfirmStop(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {gone.length > 0 && (
        <section className="am-section">
          <div className="am-section-head">
            <div>
              <h4>No longer in the spreadsheet</h4>
              <p>These tabs are mapped, but the spreadsheet has no tab with that id any more.</p>
            </div>
          </div>
          <div className="ps-tabs">
            {gone.map((t) => (
              <div className="ps-tab ps-tab--gone" key={t.sheet_id}>
                <div className="ps-tab-row">
                  <div className="ps-tab-main">
                    <strong>{t.title || `#${t.sheet_id}`}</strong>
                    <span className="sp-tp-status sp-tp-status-error">This tab is no longer in the spreadsheet; stop using it or restore the tab</span>
                  </div>
                  <div className="ps-tab-route"><span>{routeSummary(t, liById)}</span></div>
                  <div className="ps-tab-actions">
                    <button type="button" className="am-text-button am-text-button--danger"
                      onClick={() => setConfirmStop(t.sheet_id)}>Stop using it</button>
                  </div>
                </div>
                {confirmStop === t.sheet_id && (
                  <div className="am-confirm">
                    <strong>Stop using “{t.title || `#${t.sheet_id}`}”?</strong>
                    <span>{stopSentence(t)}</span>
                    <div className="am-actions">
                      <button type="button" className="sp-btn sp-btn-p" onClick={() => { setConfirmStop(null); onStopTab(t.sheet_id); }}>Stop using it</button>
                      <button type="button" className="sp-btn sp-btn-s" onClick={() => setConfirmStop(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {probeLoaded && (
        <section className="am-section">
          <div className="am-section-head">
            <div>
              <h4>Other tabs in this spreadsheet</h4>
              <p>Nothing is read from these.</p>
            </div>
          </div>
          {unbound.length === 0 ? (
            <div className="am-empty"><strong>Every tab is in use</strong></div>
          ) : (
            <div className="ps-tabs">
              {unbound.map((pt) => (
                <FreeTab key={pt.sheet_id} tab={pt}
                  reason={useTabReason({ probedTab: pt, tabsInUse: tabs.length, cellsInUse })}
                  onUse={() => onUseTab(pt)} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ── one tab nobody uses yet: the same row as a bound tab, one state apart ─── */

function FreeTab({ tab, reason, onUse }) {
  const headers = (Array.isArray(tab.headers) ? tab.headers : []).map(clean);
  const sample = Array.isArray(tab.sample) && Array.isArray(tab.sample[0]) ? tab.sample[0] : [];
  const names = headers.filter(Boolean);
  const distinct = names.filter((h, i) => names.indexOf(h) === i);
  const repeated = distinct.filter((h) => names.indexOf(h) !== names.lastIndexOf(h));
  const hr = Number.isInteger(tab.header_row) ? tab.header_row : 0;
  const proof = distinct.slice(0, 5).map((h) => {
    const i = headers.indexOf(h);
    const v = i >= 0 ? clean(sample[i]) : '';
    return v ? `${h}: ${v}` : h;
  });
  return (
    <div className="ps-tab ps-tab--free">
      <div className="ps-tab-row">
        <div className="ps-tab-main">
          <strong>{tab.title}</strong>
          <span className="ps-tab-meta">
            {`${int(tab.row_count)} rows · ${plural(distinct.length, 'column', 'columns')}`}
            {hr > 0 ? ` · headers on row ${hr + 1}` : ''}
          </span>
        </div>
        <div className="ps-tab-route">
          <span>{proof.length ? `${proof.join(' · ')}${distinct.length > proof.length ? '…' : ''}` : 'No headers found'}</span>
        </div>
        <div className="ps-tab-actions">
          <button type="button" className="sp-btn sp-btn-s" disabled={!!reason} title={reason || undefined} onClick={onUse}>
            Use this tab
          </button>
        </div>
      </div>
      {(reason || repeated.length > 0) && (
        <div className="ps-tab-notes">
          {reason && <span className="sp-tp-status sp-tp-status-muted">{reason}</span>}
          {repeated.length > 0 && (
            <span className="sp-tp-status sp-tp-status-error">
              Repeated header{repeated.length > 1 ? 's' : ''}: {repeated.join(', ')}; the refresh stops if a repeated header is mapped, so rename one of them in the sheet
            </span>
          )}
        </div>
      )}
    </div>
  );
}
