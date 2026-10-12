// workspace/src/lib/settings/sheet-source-norm.js
//
// Pure helpers for the Settings → Data "Google Sheet delivery" section.
// No React, no DOM — so the mapping dictionary and the native-unit rule are
// unit-testable (tests/sheet-source-ui-test.mjs).
//
// Spec: docs/superpowers/specs/2026-08-02-sheet-source.md §9.

// Header aliases, checked case-insensitively against the tab's own header row.
// Order inside a slot is preference order; a header already claimed by an
// earlier slot is never reused (the server enforces one-header-one-slot).
import MetricRegistry from '@shared/metric-registry';

const COLUMN_ALIASES = {
  date: ['date', 'day', 'report_date', 'report date'],
  impressions: ['impressions', 'impr', 'imps'],
  clicks: ['link clicks', 'clicks'],
  spend: ['amount spent', 'spend', 'cost'],
  completes: ['video views', 'views', 'completes', 'video completions'],
  conversions: ['conversions', 'results', 'purchases'],
};
const DIM_ALIASES = {
  audience: ['ad set name', 'adset name', 'ad set', 'audience'],
  tactic: ['tactic'],
  creative: ['ad name', 'creative name', 'creative'],
};

export const COLUMN_SLOTS = [
  { key: 'date', label: 'Date' },
  { key: 'impressions', label: 'Impressions' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'spend', label: 'Spend' },
  { key: 'completes', label: 'Video views' },
  { key: 'conversions', label: 'Conversions' },
];
export const DIM_SLOTS = [
  { key: 'audience', label: 'Audience' },
  { key: 'tactic', label: 'Tactic' },
  { key: 'creative', label: 'Creative' },
];

const clean = (h) => String(h == null ? '' : h).trim();

/** The column a line item is PRICED on — it must be mapped or the LI reads zero
 *  delivery forever. Unknown or absent rate type behaves as CPM, exactly as the
 *  server validator and the refresh path do. */
export function nativeSlot(rateType) {
  const rt = String(rateType || 'CPM').toUpperCase();
  return rt === 'CPC' ? 'clicks' : rt === 'CPV' ? 'completes' : 'impressions';
}

export function headerList(headers) {
  const out = [];
  const seen = new Set();
  for (const h of (headers || [])) {
    const v = clean(h);
    if (!v || seen.has(v)) continue;   // blank and duplicate headers are unmappable
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** True when a tab has something that could plausibly be its date column.
 *  A tab without one cannot be bound (spec §0.4). */
export function hasDateColumn(headers) {
  return pickHeader(headerList(headers), COLUMN_ALIASES.date, new Set()) !== null;
}

function pickHeader(headers, aliases, taken) {
  for (const alias of aliases) {
    for (const h of headers) {
      if (taken.has(h)) continue;
      if (h.toLowerCase() === alias) return h;
    }
  }
  return null;
}

/** Deterministic first guess at the mapping — the user can change every slot. */
export function prefillMapping(headers) {
  const list = headerList(headers);
  const taken = new Set();
  const columns = {};
  for (const { key } of COLUMN_SLOTS) {
    const hit = pickHeader(list, COLUMN_ALIASES[key], taken);
    columns[key] = hit;
    if (hit) taken.add(hit);
  }
  const dims = {};
  for (const { key } of DIM_SLOTS) {
    const hit = pickHeader(list, DIM_ALIASES[key], taken);
    dims[key] = hit;
    if (hit) taken.add(hit);
  }
  return { columns, dims };
}

/** A fresh binding for one probed tab. */
export function newBinding(tab, lineItemId) {
  const { columns, dims } = prefillMapping(tab.headers);
  return {
    sheet_id: tab.sheet_id,
    title: clean(tab.title),
    line_item_id: String(lineItemId || ''),
    platform_label: clean(tab.title),
    columns,
    conversion_actions: [],
    dims,
  };
}

/** Line items a binding feeds — one (single shape) or many (split shape). */
export function bindingLineItemIds(binding) {
  if (binding?.split) {
    const out = [];
    for (const r of (binding.split.rules || [])) {
      const id = String(r?.line_item_id ?? '');
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  }
  return binding?.line_item_id ? [String(binding.line_item_id)] : [];
}

/** Everything wrong with a binding, in the order the user should fix it.
 *  Mirrors the server validator so the drawer can block Save instead of
 *  round-tripping to a 400.
 *
 *  `liById` is a Map(id → line item) — a split binding needs several of them,
 *  and the native-unit rule has to hold for each. */
export function bindingErrors(binding, liById) {
  const errs = [];
  const lookup = (id) => (liById instanceof Map ? liById.get(String(id)) : liById);
  const ids = bindingLineItemIds(binding);

  if (binding?.split) {
    const cols = binding.split.columns || [];
    const rules = binding.split.rules || [];
    if (!cols.length) errs.push('Pick at least one column that tells the rows apart');
    // The server refuses a blank or a repeated split column (sheet-source.mjs); the
    // seed and the selects can both produce one, so the screen has to say so first.
    else if (cols.some((c) => !clean(c))) errs.push('Pick a column for every split slot');
    if (new Set(cols.map(clean)).size !== cols.length) errs.push('The same column is chosen twice for the split');
    if (!rules.length) errs.push('Add at least one rule');
    if (rules.some((r) => (r.values || []).length !== cols.length || (r.values || []).some((v) => !String(v ?? '').trim()))) {
      errs.push('Every rule needs a value for each chosen column');
    }
    if (rules.some((r) => !r.line_item_id)) errs.push('Every rule needs a line item');
    // The server caps a rule value at 200 characters (sheet-source.mjs MAX_STR).
    if (rules.some((r) => (r.values || []).some((v) => String(v ?? '').trim().length > 200))) {
      errs.push('A value over 200 characters cannot be a rule; narrow the split columns');
    }
    const seen = new Set();
    for (const r of rules) {
      // NUL-joined, exactly like the server's duplicate check (sheet-source.mjs) and
      // the converter's row matcher (sheet-convert.js keyOf). Both of those hold a RAW
      // NUL byte inside their join string, which terminals draw as nothing at all, so a
      // reader sees join(' ') there; it is the same byte as this '\x00'.
      const key = (r.values || []).map((v) => String(v ?? '').trim().toLowerCase()).join('\x00');
      if (seen.has(key)) { errs.push('Two rules match the same value'); break; }
      seen.add(key);
    }
  } else if (!binding.line_item_id) {
    errs.push('Pick a line item');
  }

  // platform_label rides every payload and the server refuses an empty string, so
  // clearing the field used to fail the whole save with nothing on screen to say why.
  if (!clean(binding.platform_label)) errs.push('Give this tab a platform label');
  if (!binding.columns?.date) errs.push('Pick the date column');
  const metrics = ['impressions', 'clicks', 'spend', 'completes', 'conversions'];
  if (!metrics.some((k) => binding.columns?.[k])) errs.push('Map at least one metric column');
  for (const id of ids) {
    const li = lookup(id);
    // The server refuses an id outside the pacing ("does not belong"); with the
    // whole map at hand this is known before Save. A bare object (the old
    // single-binding callers) carries no such knowledge and is not judged.
    if (liById instanceof Map && !li) {
      errs.push(`Line item ${id} is no longer in this pacing; ${binding?.split ? 'route its rows again' : 'pick another line item for this tab'}`);
      continue;
    }
    const slot = nativeSlot(li?.rate_type ?? li?.rateType);
    if (!binding.columns?.[slot]) {
      const label = COLUMN_SLOTS.find((s) => s.key === slot)?.label || slot;
      const who = binding?.split ? `Line item ${li?.label || id} is` : 'This line item is';
      errs.push(`${who} priced on ${label.toLowerCase()}; map that column`);
    }
  }
  const used = new Map();
  const claim = (h, what) => {
    if (!h) return;
    if (used.has(h)) errs.push(`"${h}" is mapped to both ${used.get(h)} and ${what}`);
    else used.set(h, what);
  };
  for (const { key, label } of COLUMN_SLOTS) if (key !== 'conversions') claim(binding.columns?.[key], label.toLowerCase());
  for (const a of (binding.conversion_actions || [])) {
    claim(a.column, `action "${a.action || '?'}"`);
    claim(a.revenue_column, `revenue of "${a.action || '?'}"`);
  }
  for (const { key, label } of DIM_SLOTS) claim(binding.dims?.[key], label.toLowerCase());
  // The conversions TOTAL may reuse one action's column (on a real meta export
  // Purchases is both the sensible total and the primary action).
  const total = binding.columns?.conversions;
  if (total) {
    const owner = used.get(total);
    const sharesWithAction = (binding.conversion_actions || []).some((a) => a.column === total);
    if (owner && !sharesWithAction) errs.push(`"${total}" is mapped to both ${owner} and conversions`);
  }
  for (const a of (binding.conversion_actions || [])) {
    if (!String(a.action || '').trim()) errs.push('Every conversion action needs a name');
    else if (!a.column) errs.push(`Action "${a.action}" needs a count column`);
  }
  const names = (binding.conversion_actions || []).map((a) => String(a.action || '').trim().toLowerCase());
  if (new Set(names.filter(Boolean)).size !== names.filter(Boolean).length) {
    errs.push('Conversion action names must be unique');
  }
  return errs;
}

/**
 * Errors that belong to the SHEET, not to one tab: a line item may take its
 * delivery from exactly one place (sheet-source.mjs). The old editor could not
 * produce this (its pickers grey out ids other tabs own); a bulk route can, so the
 * drawer's Save gate reads this beside the per-tab bindingErrors.
 */
export function sheetErrors(sheet, liById) {
  const owners = new Map();
  for (const t of (sheet?.tabs || [])) {
    for (const id of bindingLineItemIds(t)) owners.set(id, (owners.get(id) || 0) + 1);
  }
  const errs = [];
  for (const [id, n] of owners) {
    if (n < 2) continue;
    const li = liById instanceof Map ? liById.get(String(id)) : null;
    const label = clean(li?.label) || String(id);
    // The drawer's labels already start with "LI <id>".
    errs.push(`${label.startsWith('LI ') ? label : `Line item ${label}`} takes delivery from more than one tab`);
  }
  return errs;
}

/** Canonical string for dirty detection — key order fixed, so re-rendering or
 *  re-hydrating identical state never marks the drawer dirty.
 *
 *  Three distinct states, not two (2026-08-02): NOT CONNECTED ('') · connected
 *  with nothing bound · connected with bindings. Collapsing the middle one into
 *  '' would leave "connect a spreadsheet" undetected, so Save would stay disabled
 *  and the connection could never be persisted — and swapping one unbound
 *  spreadsheet for another would look like no change at all. */
export function normSheet(sheet) {
  if (!sheet || !clean(sheet.spreadsheet_id)) return '';
  return JSON.stringify([
    clean(sheet.spreadsheet_id),
    (sheet.tabs || []).map((t) => [
      t.sheet_id, clean(t.title), String(t.line_item_id || ''), clean(t.platform_label),
      // A rule edit re-routes rows between line items — as material as re-binding.
      t.split
        ? [t.split.columns || [], (t.split.rules || []).map((r) => [r.values || [], String(r.line_item_id || '')])]
        : null,
      COLUMN_SLOTS.map((s) => t.columns?.[s.key] || null),
      (t.conversion_actions || []).map((a) => [clean(a.action), clean(a.column), a.revenue_column ? clean(a.revenue_column) : null]),
      DIM_SLOTS.map((s) => t.dims?.[s.key] || null),
    ]),
  ]);
}

export function cloneSheet(sheet) {
  return sheet ? JSON.parse(JSON.stringify(sheet)) : null;
}

/** What goes on the wire. `null` means DISCONNECT and is produced only by a null
 *  draft — an empty tab list is a connected-but-unmapped source and is sent as
 *  such (the server stores it; see validateSheetConfig). */
export function sheetPayload(sheet) {
  if (!sheet || !clean(sheet.spreadsheet_id)) return null;
  return {
    spreadsheet_id: clean(sheet.spreadsheet_id),
    tabs: (sheet.tabs || []).map((t) => ({
      sheet_id: t.sheet_id,
      title: clean(t.title),
      // Exactly ONE shape travels: a split binding has no line_item_id, and the
      // server rejects a payload carrying both meanings.
      ...(t.split
        ? { split: {
            columns: (t.split.columns || []).map(clean),
            rules: (t.split.rules || []).map((r) => ({
              values: (r.values || []).map(clean),
              line_item_id: String(r.line_item_id || ''),
            })),
          } }
        : { line_item_id: String(t.line_item_id) }),
      platform_label: clean(t.platform_label),
      columns: Object.fromEntries(COLUMN_SLOTS.map((s) => [s.key, t.columns?.[s.key] || null])),
      conversion_actions: (t.conversion_actions || []).map((a) => ({
        action: clean(a.action),
        column: clean(a.column),
        revenue_column: a.revenue_column ? clean(a.revenue_column) : null,
      })),
      dims: Object.fromEntries(DIM_SLOTS.map((s) => [s.key, t.dims?.[s.key] || null])),
    })),
  };
}

/** Every failure class the sheet-source workflow can report on a probe, with
 *  the copy the user sees. ONE table: the section renders it and a contract test
 *  asserts the workflow emits nothing outside it (a class with no message would
 *  degrade to the generic line — the defect this table exists to prevent). */
export const PROBE_ERRORS = {
  sheet_not_accessible: (email) => (email
    ? `Not shared with us yet; share the spreadsheet with ${email} (Viewer), then retry.`
    : 'Not shared with us yet; share the spreadsheet with our Google account (Viewer), then retry.'),
  sheet_too_many_tabs: () => 'That spreadsheet has more than 50 tabs.',
  sheet_tab_missing: () => 'A bound tab is no longer in that spreadsheet.',
  sheet_too_big: () => 'That spreadsheet is too large to read (over 20 000 rows in a tab).',
  bad_url: () => 'That does not look like a Google Sheets link.',
};

export function probeErrorText(error, shareWith) {
  const fn = PROBE_ERRORS[error];
  return fn ? fn(shareWith) : 'Could not read that spreadsheet. Try again in a moment.';
}

/* ── dimension sources (2026-08-10) ─────────────────────────────────────────
 * The same file format, used the other way round: the tab does NOT replace
 * delivery, it adds a breakdown beside it. So the header conventions are the
 * same and the alias table above is reused verbatim — only the SLOTS differ,
 * because a dimension source carries widget metric keys (im/cl/sp/…) rather than
 * delivery columns, plus a line-item column and one or more breakdown columns.
 *
 * Client cost (`dc`) is deliberately not a slot: it is derived here from spend
 * and margin, never imported, and a sheet column claiming to be one would arrive
 * in an unknown currency (wave-3 spec §4.4).
 */

// The seven, from the registry both runtimes read (shared/metric-registry.js).
// They used to be declared here AND in dash-gate AND in FormulaField AND in the
// Breakdown panel, and the four had already drifted — `co` was "Completes" here
// and "Completes / listens" there. One list now, and it is the same list the
// save validator enforces.
export const DIM_METRIC_SLOTS = Object.freeze(MetricRegistry.BUILT_IN);

/**
 * Every metric this SOURCE may map: the seven, then the ones it declares for
 * itself. Anything rendering a metric label or offering a metric slot must use
 * this rather than DIM_METRIC_SLOTS, or a source's own metric is invisible in
 * exactly the screen that created it.
 */
export function metricSlotsFor(source) {
  return MetricRegistry.metricsOf(((source || {}).origin || {}).columns || {});
}

/** The label to print for a metric key — never the bare key. */
export function metricLabelFor(source, key) {
  return MetricRegistry.labelOf(((source || {}).origin || {}).columns || {}, key);
}

const LINE_ITEM_ALIASES = ['line item', 'line item name', 'li', 'li name', 'insertion order line'];
const EXTRA_METRIC_ALIASES = {
  pc: ['post-click conversions', 'post click conversions'],
  pv: ['post-view conversions', 'post view conversions'],
  // The mart metrics added 2026-09-08 (registry entries with alias: null). `lc` has no
  // alias on purpose: COLUMN_ALIASES.clicks already claims «link clicks» for `cl`, and
  // moving that header would change every existing prefill — Link clicks is mapped by hand.
  st: ['starts', 'video starts'],
  q1: ['first quartiles', 'first quartile', 'video 25%'],
  q2: ['midpoints', 'midpoint', 'video 50%'],
  q3: ['third quartiles', 'third quartile', 'video 75%'],
  rc: ['reach'],
  vi: ['viewable impressions', 'viewable'],
};
const RATIO_RE = /^(cpm|cpc|cpa|cpv|ctr|cr|vcr|share|%|.*rate|.*per (click|view|impression))$/i;

/**
 * A derived column: a ratio of two others. Never importable — summing a
 * percentage across dates and line items is meaningless, and every ratio the UI
 * shows is recomputed from the additive metrics. Offered as ignorable, never as
 * a metric or a dimension.
 *
 * The ONE definition: the column proposal below and the live Additional Mapping
 * setup both call this. They diverged once, and the setup offered CPC and CPA as
 * dimensions while the proposal was quietly ignoring them.
 */
export function isDerivedColumn(header) {
  return RATIO_RE.test(String(header == null ? '' : header).trim());
}

/** A column header becomes a stored dimension key. Mirrors dash-gate/lib/dim-sources.mjs. */
export function dimKeyFromHeader(header) {
  const s = String(header == null ? '' : header).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  if (!s) return null;
  const key = /^[a-z][a-z0-9_]*$/.test(s) ? s : ('d_' + s).slice(0, 40);
  // `constructor` passes the charset and is an Object.prototype member; the
  // server refuses it, so the client must not propose it.
  return key === 'constructor' ? 'd_constructor' : key;
}

/**
 * Mint a breakdown key ONCE, unique against everything it must not collide with.
 *
 * The key is what a widget stores (`ds:<source>:<key>`). Deriving it from the
 * header every time a column is picked is the defect §6.1 records: header
 * "App/URL" gives `app_url`, header "App" gives `app`, so re-pointing a
 * breakdown minted a NEW key and orphaned every widget on the old one — and
 * because the drawer sends the whole widgets array with every save, that made
 * every save from the drawer fail until the page was reloaded.
 *
 * `taken` is the sibling keys AND the keys of removed breakdowns that widgets
 * still reference (§6.3c). A new breakdown may not silently inherit a key whose
 * tiles are waiting for it — those tiles would come back to life showing
 * whatever the new column contains.
 */
export function mintDimKey(header, taken) {
  const base = dimKeyFromHeader(header) || 'dim';
  const used = taken instanceof Set ? taken : new Set(taken || []);
  let key = base;
  let n = 2;
  while (used.has(key)) { key = (base + '_' + n).slice(0, 40); n += 1; }
  return key;
}

/**
 * First pass over a tab's headers for a DIMENSION source. Everything is a
 * proposal — the user confirms each one, because a wrong guess here silently
 * measures the wrong column.
 */
export function prefillDimMapping(headers) {
  const list = headerList(headers);
  const taken = new Set();
  const out = { date: null, line_item: null, dims: [], metrics: {}, ignored: [], duplicates: [] };

  // A repeated header is an ADDRESSING problem, not a mapping choice: columns are
  // matched by text and the loader takes the first hit, so a second column of the
  // same name can never be read. Counted on the RAW headers — headerList already
  // drops duplicates, which is right for mapping and would hide this entirely.
  const seen = new Set();
  for (const raw of (headers || [])) {
    const h = String(raw == null ? '' : raw).trim();
    if (!h) continue;
    if (seen.has(h) && !out.duplicates.includes(h)) out.duplicates.push(h);
    seen.add(h);
  }

  out.date = pickHeader(list, COLUMN_ALIASES.date, taken);
  if (out.date) taken.add(out.date);
  out.line_item = pickHeader(list, LINE_ITEM_ALIASES, taken);
  if (out.line_item) taken.add(out.line_item);

  for (const slot of DIM_METRIC_SLOTS) {
    const aliases = slot.alias ? COLUMN_ALIASES[slot.alias] : (EXTRA_METRIC_ALIASES[slot.key] || []);
    const hit = pickHeader(list, aliases, taken);
    if (hit) { out.metrics[slot.key] = hit; taken.add(hit); }
  }

  for (const h of list) {
    if (taken.has(h)) continue;
    if (isDerivedColumn(h)) { out.ignored.push(h); continue; }
    const key = dimKeyFromHeader(h);
    if (!key) { out.ignored.push(h); continue; }
    let candidate = key;
    let n = 2;
    while (out.dims.some((d) => d.key === candidate)) { candidate = (key + '_' + n).slice(0, 40); n += 1; }
    out.dims.push({ key: candidate, label: h, column: h });
    taken.add(h);
  }
  return out;
}

/**
 * Is a dimension source configured enough to be read?
 *
 * The ONE definition — three screens ask this (the block on Data, the card on
 * Mapping, the "Re-read now" button) and they answered differently: two of them
 * demanded a line-item COLUMN, which a tab covering a single line item does not
 * have. Such a source is bound to that one line item instead, the server takes
 * it and the loader reads it, so those two screens called a working source
 * unmapped and hid its Re-read button.
 *
 * Mirrors what dash-gate/lib/dim-sources.mjs requires: a date column, at least
 * one breakdown, at least one metric, and a way to reach a line item.
 */
export function isDimSourceMapped(source) {
  const cols = (source?.origin || {}).columns || {};
  const bound = !!(cols.line_item || (source?.binding || {}).line_item_id);
  return !!(cols.date && bound
    && Array.isArray(cols.dims) && cols.dims.length
    && Object.keys(cols.metrics || {}).length);
}

/**
 * Choose the line-item column — and the binding that must go with it.
 *
 * ONE decision, not two. The server pairs them strictly: `single` mode is
 * refused next to a line-item column, and the other modes are refused without
 * one. Setting the column alone would build a shape the save then rejects, with
 * the error three tabs away from the control that caused it.
 *
 *   a header  → id_in_name, matching rows by the line-item id inside the text
 *   null      → single, the whole tab being one line item (which one is asked
 *               for separately, and is null until answered)
 */
export function withLineItemColumn(source, header) {
  const origin = source?.origin || {};
  const columns = origin.columns || {};
  const binding = source?.binding || {};
  return {
    ...source,
    origin: { ...origin, columns: { ...columns, line_item: header || null } },
    binding: header
      ? { mode: 'id_in_name', map: (binding.mode === 'single' ? {} : binding.map) || {} }
      : { mode: 'single', line_item_id: binding.line_item_id || null, map: {} },
  };
}

/* ── one breakdown at a time (2026-08-11, §3.2 / §6.1 / §6.3 / §6.5) ─────────
 * A breakdown is a thing, not a setting on a source. These four are the whole
 * vocabulary the Mapping screen needs, and each keeps an invariant the screen
 * cannot be trusted to remember:
 *   add       mints the key once, against siblings AND reserved keys
 *   repoint   changes the column and NEVER the key
 *   rename    changes the label and NEVER the key
 *   remove    takes the dictionary with it, or the next save is refused
 */

/** Which role each physical column already has — §6.5, one column one role. */
export function columnRoles(source) {
  const cols = ((source || {}).origin || {}).columns || {};
  const out = new Map();
  const claim = (col, role) => { if (col && !out.has(col)) out.set(col, role); };
  claim(cols.date, 'the date');
  claim(cols.line_item, 'the line item');
  for (const d of Array.isArray(cols.dims) ? cols.dims : []) claim(d && d.column, 'a breakdown');
  for (const k of Object.keys(cols.metrics || {})) {
    claim(cols.metrics[k], (DIM_METRIC_SLOTS.find((s) => s.key === k) || {}).label || k);
  }
  return out;
}

/**
 * Columns a breakdown may be pointed at: physical columns of the tab that no
 * other role has taken, plus `keep` (the one this breakdown already uses, which
 * must stay in its own select or the control renders blank).
 * A derived column — a ratio — is never offered: summing a percentage across
 * dates and line items is meaningless.
 */
export function freeColumns(source, headers, keep) {
  const taken = columnRoles(source);
  const out = [];
  for (const h of headerList(headers)) {
    if (h === keep) { out.push(h); continue; }
    if (taken.has(h) || isDerivedColumn(h)) continue;
    out.push(h);
  }
  if (keep && !out.includes(keep)) out.unshift(keep);
  return out;
}

/** Add a breakdown on `column`, with a key minted once (§6.1) against `reserved`. */
export function addBreakdown(source, column, reserved) {
  const origin = (source || {}).origin || {};
  const cols = origin.columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  const taken = new Set(dims.map((d) => d && d.key).filter(Boolean));
  for (const k of reserved || []) taken.add(k);
  const key = mintDimKey(column, taken);
  return { ...source, origin: { ...origin, columns: { ...cols,
    dims: [...dims, { key, label: String(column), column: String(column) }] } } };
}

/** Point a breakdown at another column. The key does not move (§6.1). */
export function repointBreakdown(source, key, column) {
  const origin = (source || {}).origin || {};
  const cols = origin.columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  return { ...source, origin: { ...origin, columns: { ...cols,
    dims: dims.map((d) => (d && d.key === key ? { ...d, column: String(column) } : d)) } } };
}

/** Rename a breakdown. The key does not move, and no widget title is touched. */
/**
 * Declare (or clear) which dashboard breakdown this library answers for.
 *
 * The library's canonical values become the values the dashboard filter compares
 * against, so the dictionary already being maintained is what reconciles the
 * sheet's spellings with delivery's. One dimension may be claimed by one library
 * only — the server refuses a second claim, and two answers to one question is
 * not a state a person can reason about.
 */
export function setBreakdownDim(source, key, brkDim) {
  const origin = (source || {}).origin || {};
  const cols = origin.columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  const wanted = brkDim ? String(brkDim) : '';
  return { ...source, origin: { ...origin, columns: { ...cols, dims: dims.map((d) => {
    if (!d) return d;
    if (d.key === key) {
      if (!wanted) { const { brk_dim: _drop, ...rest } = d; return rest; }
      return { ...d, brk_dim: wanted };
    }
    // Moving a claim is one action, not "clear the other one, then set this one":
    // the intermediate state would be saved if the drawer were saved between them.
    if (wanted && d.brk_dim === wanted) { const { brk_dim: _taken, ...rest } = d; return rest; }
    return d;
  }) } } };
}

export function renameBreakdown(source, key, label) {
  const origin = (source || {}).origin || {};
  const cols = origin.columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  return { ...source, origin: { ...origin, columns: { ...cols,
    dims: dims.map((d) => (d && d.key === key ? { ...d, label: String(label) } : d)) } } };
}

/**
 * Remove a breakdown — AND its group dictionary.
 *
 * Leaving the dictionary behind is a live, verified bug: the server refuses a
 * source whose `groups` name a dimension it does not carry, and because the
 * drawer sends everything at once, EVERY save from that drawer then fails until
 * the page is reloaded (§6.3).
 */
export function removeBreakdown(source, key) {
  const origin = (source || {}).origin || {};
  const cols = origin.columns || {};
  const dims = Array.isArray(cols.dims) ? cols.dims : [];
  const groups = { ...((source || {}).groups || {}) };
  delete groups[key];
  const dismissed = { ...((source || {}).dismissed || {}) };
  delete dismissed[key];
  const next = { ...source, groups,
    origin: { ...origin, columns: { ...cols, dims: dims.filter((d) => d && d.key !== key) } } };
  if (Object.keys(dismissed).length) next.dismissed = dismissed;
  else delete next.dismissed;
  return next;
}

/**
 * Keys that a new breakdown may NOT take, because tiles are still pointing at
 * them (§6.3c). Derived from the widgets rather than from a stored stub: a stub
 * would be a dimension with no column, which the server refuses, and this
 * answers the same question from the state that actually decides it.
 */
export function reservedDimKeys(widgets, sourceId, liveKeys) {
  const prefix = `ds:${sourceId}:`;
  const live = new Set(liveKeys || []);
  const out = new Set();
  const read = (axis) => {
    if (!axis || typeof axis !== 'object' || typeof axis.dim !== 'string') return;
    if (!axis.dim.startsWith(prefix)) return;
    const key = axis.dim.slice(prefix.length);
    if (key && !live.has(key)) out.add(key);
  };
  for (const w of Array.isArray(widgets) ? widgets : []) {
    if (!w) continue;
    read(w.rows);
    read(w.xAxis);
  }
  return [...out];
}

/** The widgets that would go blank if THIS breakdown went away. */
export function widgetsUsingBreakdown(widgets, sourceId, dimKey) {
  const axis = `ds:${sourceId}:${dimKey}`;
  const uses = (a) => a && typeof a === 'object' && a.dim === axis;
  return (Array.isArray(widgets) ? widgets : [])
    .filter((w) => w && (uses(w.rows) || uses(w.xAxis)))
    .map((w) => w.title || w.id);
}

/**
 * The metric the coverage figures are measured in (§4.1).
 *
 * Impressions, because every source maps at least one metric and this is the one
 * they share. When a source does not carry them it is the first mapped metric —
 * NAMED on screen rather than substituted silently, which is why this returns the
 * label too.
 */
export function coverageMetricFor(source) {
  const metrics = (((source || {}).origin || {}).columns || {}).metrics || {};
  const key = metrics.im ? 'im' : DIM_METRIC_SLOTS.map((s) => s.key).find((k) => metrics[k]);
  if (!key) return null;
  return { key, label: (DIM_METRIC_SLOTS.find((s) => s.key === key) || {}).label || key,
    isImpressions: key === 'im' };
}

/**
 * Accept the AI's binding proposals into the manual map.
 *
 * A pure function because the button that calls it cannot be reached by a static
 * render, and "Accept all writes nothing" is a mistake no screenshot would show.
 * A proposal never overwrites an answer the user has already given — the AI is
 * the weaker source of the two, and silently replacing a hand-made binding is
 * how a user stops trusting the button.
 */
export function acceptBindings(map, proposals) {
  const next = { ...(map || {}) };
  for (const b of Array.isArray(proposals) ? proposals : []) {
    if (!b || typeof b.value !== 'string' || !b.value) continue;
    const id = String(b.line_item_id == null ? '' : b.line_item_id);
    if (!id) continue;
    if (Object.prototype.hasOwnProperty.call(next, b.value)) continue;
    next[b.value] = id;
  }
  return next;
}

/* `acceptGroups` lived here until 2026-08-11 and is gone on purpose. Review
 * values applies every merge — the AI's included — through
 * `dim-value-editor.js:createGroup`, which REFUSES a colliding label and says
 * why; this one silently SKIPPED it, which reads as the button having done
 * nothing. Two ways to accept a proposal, one of them quietly weaker, sitting
 * beside the screen that had just stopped using it, is an invitation to wire the
 * wrong one back in. `acceptBindings` above stays: BindingPane's "Accept all" is
 * its only caller and there is no second implementation of it.
 */

/* ── which row is the header ────────────────────────────────────────────────
 * Row 1 was assumed everywhere — the probe, the value sampler and the nightly
 * fetch. A DV360 UI export puts a report title and a filter block above its
 * header, and a hand-made sheet often carries a title too. Such a file parsed
 * its banner as column names, so every column resolved to nothing and the
 * screen blamed the sheet for having no date column.
 *
 * MIRRORED in the sheet-source workflow's `Code: Shape Or Stage`, which cannot
 * import from here. `tests/sheet-header-row-test.mjs` runs both against the same
 * fixtures — the same arrangement dimKeyFromHeader and normaliseDimKey already
 * live under.
 */

/** How many of the first rows are worth considering. Beyond this a "title
 *  block" is not a title block, it is a differently-shaped file. */
export const HEADER_SCAN_ROWS = 15;

const isNumericCell = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return /^-?[\d\s.,%$€£]+$/.test(s) && /\d/.test(s);
};

/**
 * Score one row as a candidate header. Higher is better; 0 means "not a header".
 *
 * A header row is several non-empty text cells with no repeats. A title row is
 * one cell and a lot of nothing. A data row is mostly numbers. The alias hit is
 * the strong signal and is worth more than the shape ones, because a row that
 * says `Date` and `Impressions` is a header whatever else it looks like.
 */
export function headerRowScore(row, next) {
  const cells = (Array.isArray(row) ? row : []).map((c) => String(c == null ? '' : c).trim());
  const filled = cells.filter(Boolean);
  if (filled.length < 2) return 0;                       // a title, not a header

  const numeric = filled.filter(isNumericCell).length;
  if (numeric > filled.length / 2) return 0;             // a data row

  const distinct = new Set(filled.map((c) => c.toLowerCase())).size;
  let score = filled.length + distinct;

  // Alias hits — the reason this beats every shape heuristic.
  const known = new Set();
  for (const list of Object.values(COLUMN_ALIASES)) for (const a of list) known.add(a);
  for (const a of LINE_ITEM_ALIASES) known.add(a);
  score += cells.filter((c) => known.has(c.toLowerCase())).length * 5;

  // The row under a header is data: as many columns, and some of them numbers.
  const below = (Array.isArray(next) ? next : []).map((c) => String(c == null ? '' : c).trim());
  const belowFilled = below.filter(Boolean);
  if (belowFilled.length >= filled.length - 1 && belowFilled.length > 0) score += 3;
  if (belowFilled.some(isNumericCell)) score += 3;

  return score;
}

/**
 * The index of the header row in a grid, or -1 when nothing looks like one.
 * `expected` is a hint — the row a previous read used — and only breaks ties.
 */
export function findHeaderRow(grid, expected = null) {
  const rows = Array.isArray(grid) ? grid : [];
  let bestIdx = -1;
  let best = 0;
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i += 1) {
    const s = headerRowScore(rows[i], rows[i + 1]);
    if (s <= 0) continue;
    const tie = s === best && bestIdx >= 0;
    if (s > best || (tie && expected != null && i === expected)) { best = s; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Where the stored mapping's own column names live NOW.
 *
 * The mapping IS the signature, so a read never trusts a remembered row number:
 * insert one row above the header and an absolute index points at the wrong row
 * for ever, silently, with every column then reading somebody's banner. Returns
 * -1 when the names are not in the grid at all — which is a changed sheet, not a
 * moved header, and must be reported rather than guessed around.
 */
export function findHeaderRowByNames(grid, names, expected = null) {
  const want = (Array.isArray(names) ? names : [])
    .map((n) => String(n == null ? '' : n).trim().toLowerCase()).filter(Boolean);
  if (!want.length) return findHeaderRow(grid, expected);
  const rows = Array.isArray(grid) ? grid : [];
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  const order = [];
  if (expected != null && expected >= 0 && expected < limit) order.push(expected);
  for (let i = 0; i < limit; i += 1) if (i !== expected) order.push(i);
  for (const i of order) {
    const have = new Set((rows[i] || []).map((c) => String(c == null ? '' : c).trim().toLowerCase()));
    if (want.every((n) => have.has(n))) return i;
  }
  return -1;
}

/**
 * What we made of every column in a tab — the whole assignment, in order, each
 * with a real value from the sheet beside it.
 *
 * The connect step used to show a tab's name and its row count, and nothing
 * else; the six other fields the probe returns went unused. A person deciding
 * whether this tool understood their file needs to SEE the understanding, on
 * their own data, before they commit to anything.
 *
 * A column the alias table does not recognise is `ignored` — never a breakdown.
 * An unknown column is as likely to be an internal id, a comment or junk, and
 * importing it silently multiplies the file and can produce a dimension of forty
 * thousand values.
 *
 * @returns {{roles: Array, ok: boolean, missing: string[]}}
 *   roles: [{ column, role, key, label, sample }] in sheet order.
 */
export function describeTabColumns(headers, sampleRow) {
  const list = Array.isArray(headers) ? headers : [];
  const sample = Array.isArray(sampleRow) ? sampleRow : [];
  const m = prefillDimMapping(list);
  const metricByHeader = new Map();
  for (const slot of DIM_METRIC_SLOTS) {
    if (m.metrics[slot.key]) metricByHeader.set(m.metrics[slot.key], slot);
  }
  const dimByColumn = new Map(m.dims.map((d) => [d.column, d]));

  // prefillDimMapping turns EVERY leftover column into a breakdown. That is too
  // confident for "the user may bring any data": an unknown column is as likely
  // to be an internal id, a comment or junk, and each extra breakdown multiplies
  // the row count of the file the browser downloads.
  //
  // So exactly ONE is taken by default — the minimum that makes a valid source —
  // and the sample row is what picks it: a column whose first value is a number
  // is a poor breakdown (`Deal ID` → 9283746), one whose value is text is a good
  // one (`App/URL` → "Hulu - Roku (2285)"). Sheet order settles the rest. Every
  // other leftover is offered, never assumed.
  const sampleAt = (col) => {
    const i = list.findIndex((h) => String(h == null ? '' : h).trim() === col);
    return i < 0 ? '' : String(sample[i] == null ? '' : sample[i]).trim();
  };
  const numericish = (v) => !!v && /^-?[\d\s.,%$€£]+$/.test(v) && /\d/.test(v);
  // Ranked, then taken ONLY if the winner is clearly better than the runner-up.
  //
  // The sample row separates a number from text — `Deal ID` → 9283746 loses to
  // `App/URL` → "Hulu - Roku (2285)". It cannot separate two text columns, and
  // falling back to sheet order made `Notes` beat `App/URL` purely for standing
  // first, then declared the shape valid and locked the roles read-only. A
  // confident wrong guess is worse than no guess: nobody checks what the screen
  // presents as settled.
  //
  // So a tie among text columns takes NOTHING, and the card asks. `looksLikeId`
  // demotes the columns that are never breakdowns whatever their type.
  const looksLikeId = (col) => /\b(id|uuid|guid|key|code)\b/i.test(col);
  const scoreOf = (d) => {
    let sc = 0;
    if (numericish(sampleAt(d.column))) sc -= 2;
    if (looksLikeId(d.column)) sc -= 2;
    return sc;
  };
  const candidates = m.dims.slice().sort((a, b) => {
    const diff = scoreOf(b) - scoreOf(a);
    if (diff !== 0) return diff;
    return list.indexOf(a.column) - list.indexOf(b.column);
  });
  const decisive = candidates.length === 1
    || (candidates.length > 1 && scoreOf(candidates[0]) > scoreOf(candidates[1]));
  const chosen = decisive ? [candidates[0]] : [];
  // What was NOT taken because the choice was a coin toss — the card says so
  // rather than presenting a guess as an answer.
  const ambiguous = decisive ? [] : candidates.map((d) => d.column);
  const dimByColumnChosen = new Map(chosen.map((d) => [d.column, d]));

  const roles = [];
  const seen = new Set();
  list.forEach((raw, i) => {
    const column = String(raw == null ? '' : raw).trim();
    if (!column || seen.has(column)) return;   // a repeat is unreachable — m.duplicates says so
    seen.add(column);
    const cell = String(sample[i] == null ? '' : sample[i]).trim();
    if (column === m.date) roles.push({ column, role: 'date', label: 'Date', sample: cell });
    else if (column === m.line_item) roles.push({ column, role: 'line_item', label: 'Line item', sample: cell });
    else if (metricByHeader.has(column)) {
      const slot = metricByHeader.get(column);
      roles.push({ column, role: 'metric', key: slot.key, label: slot.label, sample: cell });
    } else if (dimByColumnChosen.has(column)) {
      const d = dimByColumnChosen.get(column);
      roles.push({ column, role: 'dim', key: d.key, label: 'Breakdown', sample: cell });
    } else if (dimByColumn.has(column)) {
      // A usable column, just not the one taken by default. Offered, not assumed.
      const d = dimByColumn.get(column);
      roles.push({ column, role: 'available', key: d.key, label: 'Not imported', sample: cell });
    } else {
      roles.push({
        column, role: 'ignored',
        label: isDerivedColumn(column) ? 'Not imported — a ratio' : 'Not imported',
        sample: cell,
      });
    }
  });

  // What the server would refuse, named here instead of after a failed save.
  const missing = [];
  if (!m.date) missing.push('a date column');
  if (!chosen.length) missing.push('a breakdown column');
  if (!Object.keys(m.metrics).length) missing.push('a metric');
  // The proposal a connect would store: the same mapping, with only the chosen
  // breakdown in it.
  const proposal = { ...m, dims: chosen };
  return { roles, ok: missing.length === 0, missing, ambiguous, duplicates: m.duplicates, proposal };
}

/** Every role a column may be given on the connect screen, in the order they
 *  are offered. `available` is not here: it is what "not imported" is called
 *  when the column COULD be a breakdown, and both store the same thing. */
export const ROLE_OPTIONS = Object.freeze([
  ['ignored', 'Not imported'],
  ['date', 'Date'],
  ['line_item', 'Line item'],
  ['dim', 'Breakdown'],
  ...DIM_METRIC_SLOTS.map((s) => [`metric:${s.key}`, s.label]),
]);

/**
 * The roles offered for one column of THIS source: the fixed four, the seven
 * built-in metrics, then whatever metrics this source declared for itself.
 * A source's own metric has to be offerable or the screen that created it could
 * not point a second column at it.
 */
export function roleOptionsFor(source) {
  return [
    ['ignored', 'Not imported'],
    ['date', 'Date'],
    ['line_item', 'Line item'],
    ['dim', 'Breakdown'],
    ...metricSlotsFor(source).map((s) => [`metric:${s.key}`, s.label]),
  ];
}

/** The stored role of a described column, in the vocabulary ROLE_OPTIONS uses. */
export function roleValue(r) {
  if (!r) return 'ignored';
  if (r.role === 'metric') return `metric:${r.key}`;
  if (r.role === 'available') return 'ignored';
  return r.role;
}

/**
 * Roles back into `origin.columns`.
 *
 * The screen edits roles because that is how a person reads a spreadsheet — one
 * column, one job. The server stores the inverse, keyed by job. Round-tripping
 * here rather than in the component keeps the two directions in one place, and
 * testable without a render.
 *
 * Last one wins for date / line item, so picking a second silently replaces the
 * first: two columns claiming to be the date is not a state worth modelling.
 */
export function columnsFromRoles(roles) {
  const out = { date: null, line_item: null, dims: [], metrics: {} };
  for (const r of Array.isArray(roles) ? roles : []) {
    const v = r && r.value !== undefined ? r.value : roleValue(r);
    const column = r && r.column;
    if (!column) continue;
    if (v === 'date') out.date = column;
    else if (v === 'line_item') out.line_item = column;
    else if (v === 'dim') {
      const key = r.key || dimKeyFromHeader(column);
      if (key && !out.dims.some((d) => d.key === key)) {
        out.dims.push({ key, label: column, column });
      }
    } else if (typeof v === 'string' && v.startsWith('metric:')) {
      out.metrics[v.slice(7)] = column;
    }
  }
  return out;
}

/**
 * The widgets that would go blank if this source were removed.
 *
 * Removing a source is a one-line filter today, and any widget built on its
 * axis stays on the dashboard as an empty table with nothing to explain it.
 * Both outcomes are legitimate — somebody may be re-adding the source under a
 * new name — but the choice has to be made knowingly, and this is what makes it
 * possible to state.
 */
export function widgetsUsingSource(widgets, sourceId) {
  const prefix = `ds:${sourceId}:`;
  const uses = (axis) => typeof axis === 'object' && axis
    && typeof axis.dim === 'string' && axis.dim.startsWith(prefix);
  return (Array.isArray(widgets) ? widgets : [])
    .filter((w) => w && (uses(w.rows) || uses(w.xAxis)))
    .map((w) => w.title || w.id);
}

/**
 * A stable fingerprint of a dimension source, for "is this saved?".
 *
 * Comparing a draft to what came back with JSON.stringify made a SAVED source
 * read as unsaved: the client writes metrics in sheet-column order and the
 * server rebuilds them in its own fixed order (im, cl, sp, co, cv, pc, pv), so
 * `{im, cl, pv, pc}` came back `{im, cl, pc, pv}` — same mapping, different
 * bytes. The block then said "Mapped, not saved yet" and hid Re-read until the
 * drawer was reopened. Key ORDER is not information here, so the fingerprint
 * removes it.
 */
export function dimSourceFingerprint(source) {
  if (!source || typeof source !== 'object') return '';
  const o = source.origin || {};
  const c = o.columns || {};
  const b = source.binding || {};
  const sortedKeys = (obj) => Object.keys(obj || {}).sort();
  return JSON.stringify([
    source.id, source.loader, source.title || '',
    o.spreadsheet_id, o.sheet_id, o.title || '', o.header_row ?? 0,
    c.date ?? null, c.line_item ?? null,
    (Array.isArray(c.dims) ? c.dims : []).map((d) => [d.key, d.label, d.column]),
    sortedKeys(c.metrics).map((k) => [k, c.metrics[k]]),
    // `ranking_metric` is deliberately absent (§6.4). It was a view preference
    // stored as a fact about the data, the server no longer keeps it, and
    // leaving it here would make a saved source read as unsaved for ever.
    b.mode || '', b.line_item_id ?? null,
    sortedKeys(b.map).map((k) => [k, b.map[k]]),
    (Array.isArray(b.exclude) ? b.exclude : [])
      .map((name) => String(name).trim().toLowerCase()).filter(Boolean).sort(),
    sortedKeys(source.groups).map((k) => [k,
      (Array.isArray(source.groups[k]) ? source.groups[k] : [])
        .map((g) => [g.label, !!g.drop, (g.members || []).slice().sort()])]),
    sortedKeys(source.dismissed).map((k) => [k,
      (Array.isArray(source.dismissed[k]) ? source.dismissed[k] : []).slice().sort()]),
  ]);
}

/**
 * A widget that shows the top N of one dimension, ready to be appended.
 *
 * The design called this the terminal step and the release shipped without it:
 * a person finished the mapping and the product went quiet — the data existed
 * only for someone who already knew to build a custom widget on a `ds:` axis.
 *
 * The SORT is the load-bearing part. buildTabularModel slices the limit AFTER
 * sorting and the stored default is `__row__ asc`, so a widget created with a
 * limit and no sort shows the first N rows BY NAME and calls itself a top N.
 */
export function topNWidgetFor(source, dim, n = 20) {
  const metrics = ((source.origin || {}).columns || {}).metrics || {};
  // What to rank by is the WIDGET's choice, never the source's (§6.4). The
  // prefill opens on impressions when they are there, because that is the unit
  // every other figure on these screens is measured in; the editor is where it
  // gets changed, and it opens for the user to see before anything is created.
  const ranking = metrics.im ? 'im' : Object.keys(metrics)[0];
  const slots = metricSlotsFor(source);
  const order = slots.map((s2) => s2.key).filter((k) => metrics[k]);
  const ranked = [ranking, ...order.filter((k) => k !== ranking)].filter(Boolean);
  // Label and format both come from the registry: a source's own metric arrives
  // with the name its author gave it and the shape they chose, instead of `c1`
  // formatted by a ternary that knew one special case.
  const columns = ranked.map((k, i) => ({
    id: `c${i + 1}`,
    label: (slots.find((s2) => s2.key === k) || {}).label || k,
    format: (slots.find((s2) => s2.key === k) || {}).format || 'int',
    source: { field: k },
  }));
  return {
    kind: 'table',
    title: dim.label || dim.key,
    rows: { dim: `ds:${source.id}:${dim.key}` },
    columns,
    sort: { col: columns.length ? columns[0].id : '__row__', dir: 'desc' },
    limit: n,
    totals: true,
  };
}
