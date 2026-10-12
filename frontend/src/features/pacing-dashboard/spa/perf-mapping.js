// workspace/src/lib/settings/perf-mapping.js
//
// The Performance-source tab as a list of columns, each with one job.
//
// Plan: docs/2026-09-16-performance-source-editor-plan.md. The Additional-data
// screen asks "here is your sheet, what does each column mean"; this module asks
// the same question of a data.sheet tab binding. Storage is untouched: every
// function reads and rewrites the tab shape validateSheetConfig stores today
// ({line_item_id | split, platform_label, columns, conversion_actions, dims}),
// and the round-trip test proves sheetPayload of a tab built here is what the
// server stores byte for byte.
//
// Roles, in the vocabulary the picker uses:
//   'ignored' · 'date' · 'impressions' | 'clicks' | 'spend' | 'completes'
//   'conversions' (the tab total) · 'dim:audience' | 'dim:tactic' | 'dim:creative'
//   'action:<i>' (the count column of conversion_actions[i]) · 'revenue:<i>'
//   'action:new' (a picker choice only: creates an action from this column)
// Split membership is not a role: a split column keeps whatever job it has and
// carries a "Routes rows" badge, because the validator never claims it.
//
// No React, no DOM: plain ESM so host tests import it directly.

import SheetConvert from '@shared/sheet-convert';
import {
  COLUMN_SLOTS, DIM_SLOTS, nativeSlot, bindingLineItemIds, bindingErrors, hasDateColumn,
} from './sheet-source-norm.js';
import { automaticLineItem } from './additional-mapping.js';
import { factsFor, profileFor, profileFromTab } from './sheet-tab-facts.js';

const clean = (v) => String(v == null ? '' : v).trim();
const int = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many}`;

/** The four delivery metrics; the conversions total is its own role. */
export const METRIC_SLOTS = Object.freeze(COLUMN_SLOTS.filter((s) => s.key !== 'date' && s.key !== 'conversions'));

// The server's caps (dash-gate/lib/sheet-source.mjs), restated so the screen
// can refuse before the save does.
export const TAB_CAP = 12;
export const RULE_CAP = 200;
export const SPLIT_COLUMN_CAP = 3;
export const ACTION_CAP = 10;
/** The delivery read refuses a tab whose grid is over this many rows (sheet-source.json, Plan Ranges). */
export const TAB_ROW_CAP = 20001;
export const TAB_CELL_CAP = 1000000;

export const GROUPS = Object.freeze([
  { key: 'structure', title: 'Structure', hint: 'what a row is and where it belongs' },
  { key: 'delivery', title: 'Delivery', hint: 'these numbers replace BigQuery' },
  { key: 'conversions', title: 'Conversions', hint: 'counted actions and their revenue' },
  { key: 'off', title: 'Not imported', hint: 'nothing from these reaches the dashboard' },
]);

/* ── reading a tab ─────────────────────────────────────────────────────────── */

export function actionsOf(tab) {
  return Array.isArray(tab?.conversion_actions) ? tab.conversion_actions : [];
}

export function splitColumns(tab) {
  return tab?.split && Array.isArray(tab.split.columns) ? tab.split.columns.map(clean) : [];
}

export function isSplitColumn(tab, column) {
  const name = clean(column);
  return !!name && splitColumns(tab).includes(name);
}

/** The role a column currently holds. */
export function roleOf(tab, column) {
  const name = clean(column);
  if (!name || !tab) return 'ignored';
  const cols = tab.columns || {};
  if (clean(cols.date) === name) return 'date';
  for (const s of METRIC_SLOTS) if (clean(cols[s.key]) === name) return s.key;
  for (const s of DIM_SLOTS) if (clean((tab.dims || {})[s.key]) === name) return `dim:${s.key}`;
  const acts = actionsOf(tab);
  for (let i = 0; i < acts.length; i++) if (clean(acts[i]?.column) === name) return `action:${i}`;
  for (let i = 0; i < acts.length; i++) if (clean(acts[i]?.revenue_column) === name) return `revenue:${i}`;
  if (clean(cols.conversions) === name) return 'conversions';
  return 'ignored';
}

/** Which column-facts check applies to a role. */
export function roleKind(role) {
  if (role === 'date') return 'date';
  if (role === 'ignored' || role.startsWith('dim:')) return 'text';
  return 'number';
}

export function groupOf(role) {
  if (role === 'ignored') return 'off';
  if (role === 'date' || role.startsWith('dim:')) return 'structure';
  if (role.startsWith('action:') || role.startsWith('revenue:')) return 'conversions';
  return 'delivery';
}

const actionName = (a) => clean(a?.action) || 'unnamed action';

export function roleLabel(tab, role) {
  if (role === 'ignored') return 'Not imported';
  if (role === 'date') return 'Date';
  if (role === 'conversions') return 'Conversions (total)';
  const metric = METRIC_SLOTS.find((s) => s.key === role);
  if (metric) return metric.label;
  if (role.startsWith('dim:')) return (DIM_SLOTS.find((s) => s.key === role.slice(4)) || {}).label || role;
  if (role === 'action:new') return '+ New conversion action…';
  if (role.startsWith('action:')) return `Action · ${actionName(actionsOf(tab)[Number(role.slice(7))])}`;
  if (role.startsWith('revenue:')) return `Revenue of ${actionName(actionsOf(tab)[Number(role.slice(8))])}`;
  return role;
}

/** The roles a column of this tab can take, as [value, label] pairs. */
export function roleChoices(tab) {
  const acts = actionsOf(tab);
  return [
    ['ignored', 'Not imported'],
    ['date', 'Date'],
    ...METRIC_SLOTS.map((s) => [s.key, s.label]),
    ['conversions', 'Conversions (total)'],
    ...DIM_SLOTS.map((s) => [`dim:${s.key}`, s.label]),
    ...acts.map((a, i) => [`action:${i}`, `Action · ${actionName(a)}`]),
    ...acts.map((a, i) => [`revenue:${i}`, `Revenue of ${actionName(a)}`]),
    ...(acts.length < ACTION_CAP ? [['action:new', '+ New conversion action…']] : []),
  ];
}

/** The choices for ONE column: an action's count column is not offered its own revenue slot. */
export function roleChoicesFor(tab, column) {
  const current = roleOf(tab, column);
  const own = current.startsWith('action:') ? `revenue:${current.slice(7)}` : null;
  return roleChoices(tab).filter(([value]) => value !== own);
}

/* ── giving a column a role ────────────────────────────────────────────────── */

/**
 * Take a column out of every job it holds. A conversion action goes with its
 * count column (the action IS that column, counted); a revenue pointer is just
 * cleared; the conversions total that pointed at the column is cleared too.
 */
export function release(tab, column) {
  const name = clean(column);
  if (!name || !tab) return tab;
  let next = tab;
  const cols = { ...(tab.columns || {}) };
  let changed = false;
  for (const s of COLUMN_SLOTS) if (clean(cols[s.key]) === name) { cols[s.key] = null; changed = true; }
  if (changed) next = { ...next, columns: cols };
  const dims = { ...(tab.dims || {}) };
  changed = false;
  for (const s of DIM_SLOTS) if (clean(dims[s.key]) === name) { dims[s.key] = null; changed = true; }
  if (changed) next = { ...next, dims };
  const acts = actionsOf(tab);
  const kept = [];
  changed = false;
  for (const a of acts) {
    if (clean(a?.column) === name) { changed = true; continue; }
    if (clean(a?.revenue_column) === name) { kept.push({ ...a, revenue_column: null }); changed = true; } else kept.push(a);
  }
  if (changed) next = { ...next, conversion_actions: kept };
  return next;
}

// An action is addressed by index in the picker but by identity here: releasing
// a column can remove an action and shift every index after it.
function findAction(list, target) {
  let i = list.indexOf(target);
  if (i >= 0) return i;
  i = list.findIndex((a) => a && target && a.action === target.action && a.column === target.column);
  return i;
}

/**
 * Give a column a role. Every role is a single-holder job: taking it hands it
 * over, so two columns can never both claim to be the date. Pure; the caller
 * decides whether to ask first (costOfRole).
 */
export function applyRole(tab, column, nextRole, opts = {}) {
  const name = clean(column);
  if (!name || !tab) return tab;
  const current = roleOf(tab, name);
  if (current === nextRole) return tab;
  const actsBefore = actionsOf(tab);
  let next = release(tab, name);
  if (nextRole === 'ignored') return next;
  if (nextRole === 'date' || nextRole === 'conversions' || METRIC_SLOTS.some((s) => s.key === nextRole)) {
    return { ...next, columns: { ...(next.columns || {}), [nextRole]: name } };
  }
  if (nextRole.startsWith('dim:')) {
    const key = nextRole.slice(4);
    if (!DIM_SLOTS.some((s) => s.key === key)) return tab;
    return { ...next, dims: { ...(next.dims || {}), [key]: name } };
  }
  if (nextRole === 'action:new') return addAction(next, name, opts.name);
  if (nextRole.startsWith('action:')) {
    const target = actsBefore[Number(nextRole.slice(7))];
    const list = actionsOf(next);
    const i = findAction(list, target);
    if (i < 0) return tab;
    const total = clean((next.columns || {}).conversions);
    const sharedTotal = !!total && total === clean(list[i].column);
    next = { ...next, conversion_actions: list.map((a, j) => (j === i ? { ...a, column: name } : a)) };
    // The shared total follows the action to its new column.
    if (sharedTotal) next = { ...next, columns: { ...(next.columns || {}), conversions: name } };
    return next;
  }
  if (nextRole.startsWith('revenue:')) {
    const target = actsBefore[Number(nextRole.slice(8))];
    const list = actionsOf(next);
    const i = findAction(list, target);
    if (i < 0) return tab;
    return { ...next, conversion_actions: list.map((a, j) => (j === i ? { ...a, revenue_column: name } : a)) };
  }
  return tab;
}

/**
 * What a role change would DESTROY, named so a confirm can say it. Only one
 * change takes stored work with it: a conversion action leaves with its count
 * column. Everything else is undone by changing it back. Null = just do it.
 */
export function costOfRole(tab, column, nextRole) {
  const current = roleOf(tab, column);
  if (current === nextRole || !current.startsWith('action:')) return null;
  // "Revenue of X" on X's own count column changes nothing (applyRole refuses it),
  // so it must not ask about a loss that will not happen.
  if (nextRole === `revenue:${current.slice(7)}`) return null;
  const a = actionsOf(tab)[Number(current.slice(7))];
  if (!a) return null;
  const total = clean((tab.columns || {}).conversions);
  const parts = [`Removes the conversion action “${actionName(a)}”`];
  if (clean(a.revenue_column)) parts.push(`releases its revenue column “${clean(a.revenue_column)}”`);
  if (total && total === clean(a.column)) parts.push('clears the conversions total that shares its column');
  const sentence = parts.length === 1 ? `${parts[0]}.`
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
  return { kind: 'action', label: actionName(a), sentence };
}

/* ── conversion actions ────────────────────────────────────────────────────── */

export function addAction(tab, column, name = '') {
  if (!tab || actionsOf(tab).length >= ACTION_CAP) return tab;
  const col = clean(column);
  const next = col ? release(tab, col) : tab;
  return { ...next, conversion_actions: [...actionsOf(next), { action: clean(name), column: col, revenue_column: null }] };
}

export function renameAction(tab, i, name) {
  const acts = actionsOf(tab);
  if (!acts[i]) return tab;
  return { ...tab, conversion_actions: acts.map((a, j) => (j === i ? { ...a, action: clean(name) } : a)) };
}

/** Point an action's revenue at a column (released from any other job), or at nothing. */
export function setActionRevenue(tab, i, column) {
  const target = actionsOf(tab)[i];
  if (!target) return tab;
  const col = clean(column);
  const next = col ? release(tab, col) : tab;
  const list = actionsOf(next);
  const k = findAction(list, target);
  if (k < 0) return tab;
  return { ...next, conversion_actions: list.map((a, j) => (j === k ? { ...a, revenue_column: col || null } : a)) };
}

export function removeAction(tab, i) {
  const acts = actionsOf(tab);
  const a = acts[i];
  if (!a) return tab;
  if (clean(a.column)) return release(tab, a.column);
  return { ...tab, conversion_actions: acts.filter((_, j) => j !== i) };
}

export function totalSharesAction(tab, i) {
  const a = actionsOf(tab)[i];
  const total = clean((tab?.columns || {}).conversions);
  return !!a && !!total && total === clean(a.column);
}

/** The one overlap the server allows: the conversions total read off an action's column. */
export function setTotalSharesAction(tab, i, on) {
  const a = actionsOf(tab)[i];
  if (!a || !clean(a.column)) return tab;
  const cols = { ...(tab.columns || {}) };
  if (on) cols.conversions = clean(a.column);
  else if (clean(cols.conversions) === clean(a.column)) cols.conversions = null;
  else return tab;
  return { ...tab, columns: cols };
}

/* ── which line item gets the rows ─────────────────────────────────────────── */

/** Every row goes to one line item. Leaving split carries its first rule's line item. */
export function toSingle(tab, lineItemId) {
  if (!tab) return tab;
  const { split, ...rest } = tab;
  const fallback = split && Array.isArray(split.rules) && split.rules[0] ? split.rules[0].line_item_id : '';
  return { ...rest, line_item_id: String(lineItemId == null || lineItemId === '' ? fallback || '' : lineItemId) };
}

/** Rows are told apart by a column. Rules start empty; the values list fills them. */
export function toSplit(tab, column) {
  if (!tab) return tab;
  const { line_item_id, ...rest } = tab;
  return { ...rest, split: { columns: [clean(column)], rules: [] } };
}

export function addSplitColumn(tab, column = '') {
  if (!tab?.split) return tab;
  const cols = splitColumns(tab);
  if (cols.length >= SPLIT_COLUMN_CAP) return tab;
  return { ...tab, split: {
    columns: [...cols, clean(column)],
    rules: (tab.split.rules || []).map((r) => ({ ...r, values: [...(r.values || []), ''] })),
  } };
}

export function removeSplitColumn(tab, index) {
  if (!tab?.split) return tab;
  const cols = splitColumns(tab);
  if (cols.length <= 1 || index < 0 || index >= cols.length) return tab;
  return { ...tab, split: {
    columns: cols.filter((_, i) => i !== index),
    rules: (tab.split.rules || []).map((r) => ({ ...r, values: (r.values || []).filter((_, i) => i !== index) })),
  } };
}

export function setSplitColumn(tab, index, column) {
  if (!tab?.split) return tab;
  const cols = splitColumns(tab);
  if (index < 0 || index >= cols.length) return tab;
  return { ...tab, split: { ...tab.split, columns: cols.map((c, i) => (i === index ? clean(column) : c)) } };
}

/** The key a rule matches on: the converter's own fold, so "same value" means what it means at refresh time. */
export function ruleKey(values) {
  return SheetConvert.keyOf(Array.isArray(values) ? values : []);
}

export function findRule(tab, values) {
  const key = ruleKey(values);
  return (tab?.split?.rules || []).findIndex((r) => ruleKey(r.values) === key);
}

export function canAddRule(tab) {
  return (tab?.split?.rules || []).length < RULE_CAP;
}

/**
 * Route one value combination to a line item. An empty line item removes the
 * rule. A new rule keeps the sheet's own spelling of the value; an existing one
 * keeps the spelling it was stored with. `takenIds` (a Set) holds the ids every
 * OTHER tab feeds; a route onto one of them is refused.
 */
export function routeValue(tab, values, lineItemId, takenIds = null) {
  if (!tab?.split) return tab;
  const id = String(lineItemId == null ? '' : lineItemId).trim();
  // A line item another tab already feeds is not on offer: the server refuses the
  // whole save for it (sheetErrors says so on screen), so the helper never writes it.
  if (id && takenIds && takenIds.has(id)) return tab;
  const rules = tab.split.rules || [];
  const i = findRule(tab, values);
  if (!id) {
    if (i < 0) return tab;
    return { ...tab, split: { ...tab.split, rules: rules.filter((_, j) => j !== i) } };
  }
  if (i >= 0) {
    if (String(rules[i].line_item_id) === id) return tab;
    return { ...tab, split: { ...tab.split, rules: rules.map((r, j) => (j === i ? { ...r, line_item_id: id } : r)) } };
  }
  if (!canAddRule(tab)) return tab;
  return { ...tab, split: { ...tab.split, rules: [...rules, { values: (values || []).map(clean), line_item_id: id }] } };
}

/**
 * The routing list: every value the read returned, joined with the rules already
 * stored. A stored rule whose value the read did not return stays listed, marked,
 * never silently dropped. `values` is the read ([{values, rows}]) or null before
 * one; `lineItems` lets the automatic match (a line-item id as a token) be shown.
 */
export function mergeValueRows({ tab, values, lineItems, takenIds = null }) {
  const rules = tab?.split?.rules || [];
  const known = Array.isArray(lineItems) ? lineItems : [];
  const taken = (id) => !!(id && takenIds && takenIds.has(String(id)));
  const seen = new Set();
  const out = [];
  for (const v of Array.isArray(values) ? values : []) {
    const vals = (v?.values || []).map(clean);
    const key = ruleKey(vals);
    if (seen.has(key)) continue;
    seen.add(key);
    const i = rules.findIndex((r) => ruleKey(r.values) === key);
    const lineItemId = i >= 0 ? String(rules[i].line_item_id) : '';
    const auto = known.length ? automaticLineItem(vals.join('_'), known) : null;
    out.push({
      key, values: vals, rows: Number(v?.rows) || 0, inSheet: true, lineItemId,
      // The automatic match is only an offer when nobody else feeds that line item.
      automaticLineItemId: taken(auto) ? null : auto,
      takenLineItemId: taken(lineItemId),
    });
  }
  for (const r of rules) {
    const key = ruleKey(r.values);
    if (seen.has(key)) continue;
    seen.add(key);
    const lineItemId = String(r.line_item_id);
    out.push({
      key, values: (r.values || []).map(clean), rows: null, inSheet: !Array.isArray(values),
      lineItemId, automaticLineItemId: null, takenLineItemId: taken(lineItemId),
    });
  }
  return out;
}

/** "Match by the line-item number": route every unrouted value that carries one known id. */
export function routeAutomatic(tab, rows) {
  let next = tab;
  let routed = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.lineItemId || !r.automaticLineItemId) continue;
    const after = routeValue(next, r.values, r.automaticLineItemId);
    if (after !== next) { next = after; routed++; }
  }
  return { tab: next, routed };
}

export function setPlatform(tab, label) {
  return tab ? { ...tab, platform_label: clean(label) } : tab;
}

/* ── the list and the figures ──────────────────────────────────────────────── */

function uniqueHeaders(headers) {
  const out = [];
  const seen = new Set();
  for (const h of Array.isArray(headers) ? headers : []) {
    const name = clean(h);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** How many columns a probed tab offers: distinct, non-blank header names. */
export function columnCount(headers) {
  return uniqueHeaders(headers).length;
}

/** Every header the tab refers to, in role order. */
export function storedColumns(tab) {
  const out = [];
  const add = (v) => { const n = clean(v); if (n && !out.includes(n)) out.push(n); };
  add((tab?.columns || {}).date);
  for (const s of METRIC_SLOTS) add((tab?.columns || {})[s.key]);
  add((tab?.columns || {}).conversions);
  for (const s of DIM_SLOTS) add((tab?.dims || {})[s.key]);
  for (const a of actionsOf(tab)) { add(a?.column); add(a?.revenue_column); }
  for (const c of splitColumns(tab)) add(c);
  return out;
}

/**
 * Every column of the tab with its role, its group, its badges and its facts.
 * Stored columns the probe no longer returns are listed too, marked missing:
 * a mapping that points at a vanished header is exactly what needs attention.
 */
export function columnRows({ tab, headers, profile, reading = false }) {
  const present = uniqueHeaders(headers);
  const have = new Set(present);
  const names = [...present, ...storedColumns(tab).filter((n) => !have.has(n))];
  return names.map((name) => {
    const role = roleOf(tab, name);
    const kind = roleKind(role);
    const p = profileFor(profile, name);
    const routes = isSplitColumn(tab, name);
    // A column whose only job is telling the rows apart is structure, not "not
    // imported": it decides which line item every row belongs to.
    const routesOnly = routes && role === 'ignored';
    return {
      column: name,
      role,
      kind,
      group: routesOnly ? 'structure' : groupOf(role),
      label: routesOnly ? 'Routes rows' : roleLabel(tab, role),
      badges: {
        routes,
        total: role.startsWith('action:') && totalSharesAction(tab, Number(role.slice(7))),
        missing: !have.has(name),
        duplicate: !!(p && p.duplicate),
      },
      facts: have.has(name)
        ? factsFor({ profile, column: name, kind, mapped: role !== 'ignored' || routes, reading })
        : { text: 'Not in the sheet now', detail: 'The tab has no column with this header.', missing: true },
    };
  });
}

const lookupLi = (liById, id) => (liById instanceof Map ? liById.get(String(id)) : null);

export function lineItemLabel(liById, id) {
  const li = lookupLi(liById, id);
  const name = li ? clean(li.label || li.name) : '';
  if (!name) return `LI ${id}`;
  // The drawer's pickers carry labels that already start with the id.
  return name.startsWith(`LI ${id}`) ? name : `LI ${id} · ${name}`;
}

/** One line for the Tabs screen: where a tab's rows go. */
export function routeSummary(tab, liById) {
  if (tab?.split) {
    const rules = (tab.split.rules || []).length;
    const ids = bindingLineItemIds(tab).length;
    if (!rules) return 'Rows are split · no rules yet';
    return `${plural(rules, 'rule', 'rules')} → ${plural(ids, 'line item', 'line items')}`;
  }
  return tab?.line_item_id ? lineItemLabel(liById, tab.line_item_id) : 'No line item yet';
}

/**
 * The four figures at the top of the Columns screen, plus the errors that block
 * Save. `errors` is bindingErrors verbatim: one list, the same one the Save
 * button and the Mapping card read, so none of the three can disagree.
 */
export function figuresOf({ tab, headers, liById }) {
  // headers === null: the sheet has not been read, so only the stored columns are known.
  const unread = headers === null;
  const present = uniqueHeaders(unread ? storedColumns(tab) : headers);
  const ids = bindingLineItemIds(tab);
  const dims = DIM_SLOTS.filter((s) => clean((tab?.dims || {})[s.key])).map((s) => s.label);
  const oneRow = ['Day', ...(tab?.split ? ['Line item'] : []), ...dims].join(' × ');

  let goesTo;
  if (tab?.split) {
    const rules = (tab.split.rules || []).length;
    goesTo = {
      text: rules ? plural(ids.length, 'line item', 'line items') : 'Rows are split',
      detail: rules ? `${plural(rules, 'rule', 'rules')} on ${splitColumns(tab).filter(Boolean).join(' × ') || 'no column yet'}` : 'No rules yet',
      attention: !rules,
    };
  } else if (tab?.line_item_id) {
    goesTo = { text: 'One line item', detail: lineItemLabel(liById, tab.line_item_id), attention: false };
  } else {
    goesTo = { text: 'Nothing yet', detail: 'Pick the line item every row goes to', attention: true };
  }

  const mapped = METRIC_SLOTS.filter((s) => clean((tab?.columns || {})[s.key])).map((s) => s.label);
  const missingNative = ids.filter((id) => {
    const li = lookupLi(liById, id);
    return !clean((tab?.columns || {})[nativeSlot(li?.rate_type ?? li?.rateType)]);
  });
  const replaces = {
    text: mapped.length ? mapped.join(', ') : 'No delivery metric',
    detail: missingNative.length
      ? `${lineItemLabel(liById, missingNative[0])} is priced on a column that is not mapped`
      : (ids.length ? `for ${plural(ids.length, 'line item', 'line items')}` : 'for no line item yet'),
    attention: !mapped.length || missingNative.length > 0,
  };

  const used = present.filter((n) => roleOf(tab, n) !== 'ignored' || isSplitColumn(tab, n)).length;
  const columns = unread
    ? { text: `${int(used)} mapped`, detail: 'The rest of the tab is unknown until the sheet is read', attention: false }
    : { text: `${int(used)} used`, detail: `${int(present.length - used)} not imported`, attention: false };

  return { oneRow, goesTo, replaces, columns, errors: bindingErrors(tab || {}, liById) };
}

/** A probed tab's grid size as the loader counts it (padded rows × columns). */
export function cellsOf(probedTab) {
  return (Number(probedTab?.row_count) || 0) * (Number(probedTab?.col_count) || 0);
}

/**
 * A column the converter reads as dates, whatever its header says: the probe's
 * rows under the header, measured by the refresh's own parser (sheet-tab-facts).
 * A data-team export dates its rows in `report_date`; judged by the header name
 * alone that tab was a dead end, while the Columns screen takes any column as
 * Date (2026-09-17).
 */
function anyDateColumn(probedTab) {
  return profileFromTab(probedTab).columns.some((c) => c.date_good > 0);
}

/**
 * Why "Use this tab" is off, or null. The gates the save or the refresh would
 * otherwise hit later: no date column (the tab cannot be delivery), the server's
 * tab cap, and the delivery read's two size caps (the refresh fails whole). The
 * row cap is per tab; the cell cap is the SUM over every tab the refresh reads,
 * so `cellsInUse` is the cells of the tabs already bound.
 *
 * The date gate is by VALUES first: a tab passes when some column's sampled
 * cells read as dates, or (a header-only tab, no rows in the probe yet) when a
 * header is named like a date. Save still refuses the tab until the Date role
 * is picked (bindingErrors), so nothing dateless gets stored.
 */
export function useTabReason({ probedTab, tabsInUse, cellsInUse = 0 }) {
  const headers = Array.isArray(probedTab?.headers) ? probedTab.headers : [];
  if (!hasDateColumn(headers) && !anyDateColumn(probedTab)) {
    return 'No date column; nothing in the first rows reads as a date, so this tab cannot be a delivery source';
  }
  if ((tabsInUse || 0) >= TAB_CAP) return `${TAB_CAP} tabs already feed delivery; stop using one first`;
  const rows = Number(probedTab?.row_count) || 0;
  if (rows > TAB_ROW_CAP) return `This tab has ${int(rows)} rows (empty rows count); the refresh reads a tab of up to ${int(TAB_ROW_CAP)}`;
  const total = (Number(cellsInUse) || 0) + cellsOf(probedTab);
  if (total > TAB_CELL_CAP) {
    return `With this tab the refresh would read ${int(total)} cells across the bound tabs; the limit is ${int(TAB_CELL_CAP)}`;
  }
  return null;
}
