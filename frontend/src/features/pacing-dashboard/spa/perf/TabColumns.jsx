// workspace/src/pages/Dashboard/components/Settings/PerformanceSourceEditor/TabColumns.jsx
//
// One Performance-source tab as a list of columns, each with one job. The
// Additional-data screen's layout and voice (am-* classes), over the data.sheet
// tab shape: every decision lives in lib/settings/perf-mapping.js, every fact in
// lib/settings/sheet-tab-facts.js, and this file only draws them.
//
// The first row of the Structure group is the question no column carries:
// which line item gets these rows. The two radios of the old card are gone;
// the shape is the answer, visible without opening anything.

import { useEffect, useMemo, useState } from 'react';
import LiSelect from '../LiSelect.jsx';
import { bindingLineItemIds, nativeSlot } from '../sheet-source-norm.js';
import {
  GROUPS, roleChoicesFor, columnRows, figuresOf, applyRole, costOfRole, storedColumns,
  actionsOf, splitColumns, isSplitColumn, totalSharesAction, setTotalSharesAction, renameAction,
  setActionRevenue, removeAction, toSingle, toSplit, setPlatform, routeSummary, lineItemLabel,
} from '../perf-mapping.js';
import { profileFromTab } from '../sheet-tab-facts.js';
import { liMapOf } from './index.jsx';
import TabRouting, { useValueRead } from './TabRouting.jsx';

const clean = (v) => String(v == null ? '' : v).trim();
const int = (n) => Number(n || 0).toLocaleString('en-US');
// The same numbers the Additional-data screen uses (lib/settings/mapping-columns.js).
const OFF_PREVIEW = 8;
const SEARCH_FROM = 12;

export default function TabColumns({
  tab, sheet, probedTab, probeLoaded, probeTitle, probing, probeErrorText, onRetryProbe,
  slug, lineItems, onAddLineItem = null, onChange, onBack,
}) {
  const [view, setView] = useState('columns');       // 'columns' | 'routing'
  const [query, setQuery] = useState('');
  const [showAllOff, setShowAllOff] = useState(false);
  const [open, setOpen] = useState(null);              // column name, or '__li__'
  const [confirm, setConfirm] = useState(null);        // { column, role, cost }
  const [newAction, setNewAction] = useState(null);    // { column, name }

  const liById = useMemo(() => liMapOf(lineItems), [lineItems]);
  // Line items every OTHER tab feeds: not on offer here (a line item takes its
  // delivery from exactly one place).
  const takenIds = useMemo(() => {
    const out = new Set();
    for (const t of (sheet?.tabs || [])) {
      if (t.sheet_id === tab.sheet_id) continue;
      for (const id of bindingLineItemIds(t)) out.add(id);
    }
    return out;
  }, [sheet, tab.sheet_id]);

  const headers = useMemo(
    () => (Array.isArray(probedTab?.headers) ? probedTab.headers.map(clean).filter(Boolean) : []),
    [probedTab],
  );
  const profile = useMemo(() => (probedTab
    ? profileFromTab(probedTab, { names: storedColumns(tab), dateName: (tab.columns || {}).date })
    : null), [probedTab, tab]);
  // The columns are the ones under the header row the facts were measured from
  // (the refresh's answer, which can differ from the probe's guess on a tab with a
  // title block). A failed probe must not empty the screen of the roles somebody
  // already set, so then the stored mapping is the list.
  const known = useMemo(() => {
    if (profile && profile.header_found) return profile.columns.map((c) => c.name);
    return headers.length ? headers : storedColumns(tab);
  }, [profile, headers, tab]);
  const sheetRead = !!(profile && profile.header_found) || headers.length > 0;
  const reading = !!probing && !probedTab;
  const list = useMemo(() => columnRows({ tab, headers: known, profile, reading }), [tab, known, profile, reading]);
  const figures = useMemo(() => figuresOf({ tab, headers: sheetRead ? known : null, liById }), [tab, known, sheetRead, liById]);
  const freeColumns = list.filter((r) => r.role === 'ignored' && !r.badges.missing).map((r) => r.column);

  const matches = (row) => {
    const q = query.trim().toLowerCase();
    return !q || row.column.toLowerCase().includes(q) || row.label.toLowerCase().includes(q);
  };
  const found = list.filter(matches);
  const offCount = list.filter((r) => r.group === 'off').length;

  const startNewAction = (column) => {
    setNewAction({ column, name: column });
    setConfirm(null);
    setOpen(column);
  };
  const setRole = (column, role) => {
    // A column that already holds an action loses it on ANY change of role,
    // "+ New conversion action…" included: the same confirm, before anything moves.
    const cost = costOfRole(tab, column, role);
    if (cost) { setConfirm({ column, role, cost }); setNewAction(null); setOpen(column); return; }
    if (role === 'action:new') { startNewAction(column); return; }
    onChange(applyRole(tab, column, role));
    setOpen(column);
  };
  const applyConfirmed = () => {
    if (!confirm) return;
    const { column, role } = confirm;
    setConfirm(null);
    if (role === 'action:new') { startNewAction(column); return; }
    onChange(applyRole(tab, column, role));
    setOpen(column);
  };
  const addAction = () => {
    if (!newAction) return;
    onChange(applyRole(tab, newAction.column, 'action:new', { name: newAction.name }));
    setNewAction(null);
    setOpen(newAction.column);
  };

  const missingTab = probeLoaded && !probedTab;
  const hr = profile && profile.header_found ? profile.header_row : 0;

  // The value read for a split tab lives here, so the routing screen can be left
  // and reopened without reading the sheet again.
  const read = useValueRead({
    slug, spreadsheetId: sheet?.spreadsheet_id, sheetId: tab.sheet_id,
    columns: splitColumns(tab), headerRow: hr, enabled: view === 'routing' && !!tab.split,
  });
  useEffect(() => { if (!tab.split && view === 'routing') setView('columns'); }, [tab.split, view]);

  if (view === 'routing' && tab.split) {
    return (
      <TabRouting
        tab={tab}
        columns={known}
        lineItems={lineItems}
        liById={liById}
        takenIds={takenIds}
        read={read}
        onChange={onChange}
        onBack={() => setView('columns')}
        onAddLineItem={onAddLineItem}
      />
    );
  }

  return (
    <div className="am-page">
      <button type="button" className="am-back" onClick={onBack}>← Tabs</button>
      <header className="am-header">
        <div>
          <div className="am-eyebrow">Performance source · columns</div>
          <h3>{tab.title || probedTab?.title || `#${tab.sheet_id}`}</h3>
          <p>
            {probeTitle || 'Google Sheet'}
            {probedTab ? ` · ${int(probedTab.row_count)} rows` : ''}
            {hr > 0 ? ` · headers on row ${hr + 1}` : ''}
          </p>
        </div>
      </header>

      {probing && <div className="sp-tp-status sp-tp-status-muted">Reading the sheet…</div>}
      {probeErrorText && (
        <div className="am-note">
          <strong>{probeErrorText}</strong>
          <span>Roles, the line item and the platform stay editable; only pointing a role at another column needs the sheet.</span>
          {onRetryProbe && <button type="button" className="am-text-button" onClick={onRetryProbe}>Retry</button>}
        </div>
      )}
      {missingTab && (
        <div className="am-state am-state--error">
          This tab is no longer in the spreadsheet; stop using it on the Tabs screen, or restore the tab.
        </div>
      )}

      <dl className="am-figures">
        <div className="am-fig">
          <dt>One row is</dt>
          <dd>{figures.oneRow}
            <span className="am-fig-sub">{probedTab ? `${int(probedTab.row_count)} rows in the tab` : 'Rows are counted when the sheet is read'}</span>
          </dd>
        </div>
        <div className="am-fig">
          <dt>Goes to</dt>
          <dd className={figures.goesTo.attention ? 'am-fig--warn' : ''}>{figures.goesTo.text}
            <span className="am-fig-sub">{figures.goesTo.detail}</span>
          </dd>
        </div>
        <div className="am-fig">
          <dt>Replaces BigQuery</dt>
          <dd className={figures.replaces.attention ? 'am-fig--warn' : ''}>{figures.replaces.text}
            <span className="am-fig-sub">{figures.replaces.detail}</span>
          </dd>
        </div>
        <div className="am-fig">
          <dt>Columns</dt>
          <dd>{figures.columns.text}
            <span className="am-fig-sub">{figures.columns.detail}</span>
          </dd>
        </div>
      </dl>

      {figures.errors.length > 0 && (
        <div className="am-state am-state--error ps-blocked">
          <strong>Save is blocked until this tab is fixed.</strong>
          <ul>{figures.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <section className="am-section">
        <div className="am-section-head">
          <div>
            <h4>Columns in this tab</h4>
            <p>Each column has one job. Change any of them and the figures above follow.</p>
          </div>
          {list.length >= SEARCH_FROM && (
            <div className="am-search-box">
              <input className="sp-inp" value={query} placeholder="Find a column"
                aria-label="Find a column" onChange={(e) => { setQuery(e.target.value); setOpen(null); }} />
              {!!query.trim() && <span className="am-count">{found.length} of {list.length} columns</span>}
            </div>
          )}
        </div>

        {probing && !known.length && <div className="am-state">Reading the sheet structure…</div>}

        {GROUPS.map((group) => {
          const all = found.filter((r) => r.group === group.key);
          const liRow = group.key === 'structure' && !query.trim();
          if (!all.length && !liRow) return null;
          const clipped = group.key === 'off' && !query.trim() && !showAllOff && all.length > OFF_PREVIEW;
          const shown = clipped ? all.slice(0, OFF_PREVIEW) : all;
          return (
            <div className="am-col-group" key={group.key}>
              <div className="am-group-head">{group.title} <span>· {group.hint}</span></div>
              {liRow && (
                <LineItemRow
                  tab={tab}
                  liById={liById}
                  lineItems={lineItems}
                  takenIds={takenIds}
                  freeColumns={freeColumns}
                  open={open === '__li__'}
                  onToggle={() => { setOpen(open === '__li__' ? null : '__li__'); setConfirm(null); setNewAction(null); }}
                  onAddLineItem={onAddLineItem}
                  onPick={(id) => onChange(toSingle(tab, id))}
                  onSplitBy={(column) => { onChange(toSplit(tab, column)); setView('routing'); }}
                  onToSingle={(lastSingleLi) => onChange(toSingle(tab, lastSingleLi))}
                  onOpenRouting={() => setView('routing')}
                />
              )}
              {shown.map((row) => (
                <ColumnRow
                  key={row.column}
                  row={row}
                  tab={tab}
                  liById={liById}
                  choices={roleChoicesFor(tab, row.column)}
                  freeColumns={freeColumns}
                  open={open === row.column}
                  confirm={confirm && confirm.column === row.column ? confirm : null}
                  newAction={newAction && newAction.column === row.column ? newAction : null}
                  onToggle={() => { setOpen(open === row.column ? null : row.column); setConfirm(null); setNewAction(null); }}
                  onRole={(role) => setRole(row.column, role)}
                  onConfirm={applyConfirmed}
                  onCancelConfirm={() => setConfirm(null)}
                  onActionDraft={(name) => setNewAction({ ...newAction, name })}
                  onActionAdd={addAction}
                  onActionCancel={() => setNewAction(null)}
                  onChange={onChange}
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

      <PlatformSection tab={tab} onChange={onChange} />
    </div>
  );
}

/* ── which line item gets the rows ─────────────────────────────────────────── */

export function LineItemRow({
  tab, liById, lineItems, takenIds, freeColumns, open, onToggle, onAddLineItem,
  onPick, onSplitBy, onToSingle, onOpenRouting,
}) {
  const [confirmSingle, setConfirmSingle] = useState(false);
  // The line item the tab had before it was split, so a change of mind (or a
  // mis-click on the column select) gets it back. Held here, never on the
  // binding: normSheet hashes line_item_id, so a stale id would travel in the payload.
  const [lastSingleLi, setLastSingleLi] = useState('');
  useEffect(() => { if (!open) setConfirmSingle(false); }, [open]);
  const splitBy = (column) => { setLastSingleLi(tab.line_item_id || ''); onSplitBy(column); };
  const backToSingle = () => onToSingle(lastSingleLi);
  const split = !!tab.split;
  const rules = split ? (tab.split.rules || []).length : 0;
  const cols = splitColumns(tab).filter(Boolean);
  const ids = bindingLineItemIds(tab);
  const chosen = !split && tab.line_item_id ? lineItemLabel(liById, tab.line_item_id) : '';
  const facts = split
    ? { text: rules ? routeSummary(tab, liById) : 'Rows are split', detail: cols.length ? `by ${cols.join(' × ')}` : 'no column picked yet', attention: !rules }
    : chosen
      ? { text: chosen, detail: 'every row goes to it', attention: false }
      : { text: 'No line item chosen', detail: 'pick one, or a column that says which', attention: true };

  return (
    <div className={`am-col${open ? ' is-open' : ''}`}>
      <div className="am-col-row">
        <button type="button" className="am-col-name" aria-expanded={open} onClick={onToggle}>
          <strong>{split ? 'Rows are split' : 'The whole tab'}</strong>
        </button>
        <span className={`am-col-facts${facts.attention ? ' ps-facts--warn' : ''}`}>
          <b>{facts.text}</b><em> · {facts.detail}</em>
        </span>
        <span className="am-role-static">Line item</span>
        <button type="button" className="am-col-chev" aria-label={`${open ? 'Collapse' : 'Expand'} the line item`}
          onClick={onToggle}>{open ? '▲' : '▼'}</button>
      </div>

      {open && !split && (
        <div className="am-col-body">
          <div className="am-form-grid">
            <label className="am-field"><span>Pacing line item</span>
              <LiSelect value={tab.line_item_id || ''} onChange={onPick} lineItems={lineItems}
                takenIds={[...takenIds]} placeholder="Choose a line item" onAddLineItem={onAddLineItem} /></label>
            {freeColumns.length > 0 && (
              <label className="am-field"><span>Or columns say which</span>
                <select className="sp-inp" value="" onChange={(e) => e.target.value && splitBy(e.target.value)}>
                  <option value="">Keep one line item</option>
                  {freeColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="am-hint">Picking a column splits the rows between line items by its values.</span></label>
            )}
          </div>
          {!chosen && (
            <div className="am-state am-state--error">
              Choose the line item these rows belong to; until then this tab cannot be saved.
            </div>
          )}
        </div>
      )}

      {open && split && (
        <div className="am-col-body">
          <div className="am-note">
            <strong>{cols.length ? `Rows are told apart by ${cols.join(' × ')}.` : 'No split column is picked yet.'}</strong>
            <span>{rules
              ? `${int(rules)} rule${rules === 1 ? ' routes' : 's route'} them to ${int(ids.length)} line item${ids.length === 1 ? '' : 's'}.`
              : 'No rules yet: every row is skipped until a value is routed.'}</span>
          </div>
          {confirmSingle ? (
            <div className="am-confirm">
              <strong>Send the whole tab to one line item?</strong>
              <span>{rules ? `Removes ${int(rules)} rule${rules === 1 ? '' : 's'}. ` : ''}The split columns stay in the sheet; only the routing goes.</span>
              <div className="am-actions">
                <button type="button" className="sp-btn sp-btn-p" onClick={() => { setConfirmSingle(false); backToSingle(); }}>Send to one line item</button>
                <button type="button" className="sp-btn sp-btn-s" onClick={() => setConfirmSingle(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="am-row-actions">
              <button type="button" className="sp-btn sp-btn-s" onClick={onOpenRouting}>Route the values →</button>
              <button type="button" className="am-text-button" onClick={() => (rules ? setConfirmSingle(true) : backToSingle())}>
                Or send the whole tab to one line item
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── one column ────────────────────────────────────────────────────────────── */

function ColumnRow({
  row, tab, liById, choices, freeColumns, open, confirm, newAction,
  onToggle, onRole, onConfirm, onCancelConfirm, onActionDraft, onActionAdd, onActionCancel, onChange,
}) {
  const off = row.role === 'ignored';
  const facts = row.facts;
  const actionIndex = row.role.startsWith('action:') ? Number(row.role.slice(7))
    : row.role.startsWith('revenue:') ? Number(row.role.slice(8)) : null;
  return (
    <div className={`am-col${open ? ' is-open' : ''}${off && !row.badges.routes ? ' is-off' : ''}`}>
      <div className="am-col-row">
        <button type="button" className="am-col-name ps-col-name" aria-expanded={open} onClick={onToggle}>
          <strong>{row.column}</strong>
          {row.badges.duplicate && <span className="am-pill">Repeated header</span>}
          {row.badges.routes && <span className="am-pill">Routes rows</span>}
          {row.badges.total && <span className="am-pill">Also the tab total</span>}
          {row.badges.missing && <span className="am-pill">Not in the sheet now</span>}
        </button>
        <span className={`am-col-facts${facts.warn ? ' ps-facts--warn' : ''}`}>
          <b>{facts.text}</b>{facts.detail ? <em> · {facts.detail}</em> : null}
        </span>
        <select className="am-role" value={row.role} aria-label={`What ${row.column} is`}
          onChange={(e) => onRole(e.target.value)}>
          {choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
              <button type="button" className="sp-btn sp-btn-p" onClick={onConfirm}>Change it</button>
              <button type="button" className="sp-btn sp-btn-s" onClick={onCancelConfirm}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {newAction && (
        <div className="am-col-body">
          <div className="am-form-grid">
            <label className="am-field"><span>Action name</span>
              <input className="sp-inp" autoFocus value={newAction.name} maxLength={120}
                placeholder="Purchase" onChange={(e) => onActionDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onActionAdd(); } }} /></label>
          </div>
          <div className="am-note">This column counts the action per day and line item. A revenue column and the
            tab’s conversions total can be added once the action exists.</div>
          <div className="am-actions">
            <button type="button" className="sp-btn sp-btn-p" disabled={!clean(newAction.name)} onClick={onActionAdd}>Add action</button>
            <button type="button" className="sp-btn sp-btn-s" onClick={onActionCancel}>Cancel</button>
          </div>
        </div>
      )}

      {open && !confirm && !newAction && (
        <div className="am-col-body">
          {row.role === 'date' && (
            <div className="am-note">One day per row. Rows outside a line item’s flight dates are dropped.</div>
          )}
          {['impressions', 'clicks', 'spend', 'completes'].includes(row.role) && (
            <MetricBody tab={tab} role={row.role} liById={liById} />
          )}
          {row.role === 'conversions' && (
            <div className="am-note">The tab’s conversions total, read as written. It is never added up from the actions.</div>
          )}
          {row.role.startsWith('dim:') && (
            <div className="am-note">Kept on every row as {row.label}; the dashboard breaks delivery down by it.</div>
          )}
          {row.role.startsWith('action:') && actionIndex !== null && (
            <ActionBody tab={tab} index={actionIndex} column={row.column} freeColumns={freeColumns} onChange={onChange} />
          )}
          {row.role.startsWith('revenue:') && actionIndex !== null && (
            <div className="am-note">Read as money and stored as the revenue of
              “{clean(actionsOf(tab)[actionIndex]?.action) || 'unnamed action'}”.</div>
          )}
          {off && (
            <div className="am-note">
              {row.badges.routes
                ? 'This column tells the rows apart, so it is read for routing only; no number from it reaches the dashboard.'
                : 'Nothing from this column reaches the dashboard.'}
            </div>
          )}
          {row.badges.missing && (
            <div className="am-hint">The mapping names this column, but the sheet has no such header now. Point the role at a column that exists, or the refresh stops on it.</div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricBody({ tab, role, liById }) {
  const ids = bindingLineItemIds(tab);
  const pricedOnIt = ids.filter((id) => {
    const li = liById.get(String(id));
    return nativeSlot(li?.rate_type ?? li?.rateType) === role;
  });
  return (
    <>
      <div className="am-note">Summed per day and line item; this number replaces what BigQuery would report. Empty cells count as zero.</div>
      {pricedOnIt.length > 0 && (
        <div className="am-hint">
          {pricedOnIt.map((id) => lineItemLabel(liById, id)).join(', ')} {pricedOnIt.length === 1 ? 'is' : 'are'} priced on this, so it must stay mapped.
        </div>
      )}
    </>
  );
}

function ActionBody({ tab, index, column, freeColumns, onChange }) {
  const action = actionsOf(tab)[index];
  const [name, setName] = useState(clean(action?.action));
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setName(clean(action?.action)); }, [action?.action]);
  if (!action) return null;
  const revenue = clean(action.revenue_column);
  const revenueOptions = revenue && !freeColumns.includes(revenue) ? [revenue, ...freeColumns] : freeColumns;
  const shares = totalSharesAction(tab, index);
  const cost = costOfRole(tab, column, 'ignored');
  return (
    <>
      <div className="am-form-grid">
        <label className="am-field"><span>Action name</span>
          <input className="sp-inp" value={name} maxLength={120} placeholder="Purchase"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = clean(name);
              if (next !== clean(action.action)) onChange(renameAction(tab, index, next));
            }} /></label>
        <label className="am-field"><span>Revenue column</span>
          <select className="sp-inp" value={revenue} onChange={(e) => onChange(setActionRevenue(tab, index, e.target.value || null))}>
            <option value="">No revenue column</option>
            {revenueOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="am-hint">Read as money beside the count.</span></label>
      </div>
      <label className="ps-check">
        <input type="checkbox" checked={shares} onChange={(e) => onChange(setTotalSharesAction(tab, index, e.target.checked))} />
        <span><strong>Also the Conversions total for this tab</strong>
          <span>A Meta export often uses Purchases as both the action and the tab’s total.</span></span>
      </label>
      {confirmRemove ? (
        <div className="am-confirm">
          <strong>Remove the action “{clean(action.action) || 'unnamed action'}”?</strong>
          <span>{cost ? cost.sentence : ''} The column stays in the sheet and reads as not imported.</span>
          <div className="am-actions">
            <button type="button" className="sp-btn sp-btn-p" onClick={() => { setConfirmRemove(false); onChange(removeAction(tab, index)); }}>Remove it</button>
            <button type="button" className="sp-btn sp-btn-s" onClick={() => setConfirmRemove(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="am-row-actions">
          <button type="button" className="am-text-button am-text-button--danger" onClick={() => setConfirmRemove(true)}>Remove this action</button>
        </div>
      )}
    </>
  );
}

/* ── the platform: one field, not a column ─────────────────────────────────── */

function PlatformSection({ tab, onChange }) {
  const [label, setLabel] = useState(clean(tab.platform_label));
  useEffect(() => { setLabel(clean(tab.platform_label)); }, [tab.platform_label]);
  return (
    <section className="am-section">
      <div className="am-section-head">
        <div>
          <h4>Platform</h4>
          <p>The name these rows carry on the dashboard, where BigQuery rows carry their DSP.</p>
        </div>
      </div>
      <label className="am-field am-field--wide"><span>Platform label</span>
        <input className="sp-inp" value={label} maxLength={200} placeholder="meta"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => { if (clean(label) !== clean(tab.platform_label)) onChange(setPlatform(tab, label)); }} />
        {!clean(label) && <span className="am-hint">A label is required; the save refuses an empty one.</span>}
      </label>
    </section>
  );
}
