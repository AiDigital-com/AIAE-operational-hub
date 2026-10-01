/**
 * mapping-dims.js — dimension engine for Mapping v3 (per pacing).
 *
 * The team's mental model is their spreadsheet: DIMENSIONS with value libraries
 * classify BOTH sides (delivery LIs + CM360 placements) into shared values; the
 * comparison is then "both sides grouped by shared dimension values". There is
 * NO per-placement→LI matching (that was v1/v2 and it lost to naming variance).
 *
 * Pure UMD `MappingDims`. No fs / no network / no clock — the month name comes
 * ONLY from a date passed in. Consumed by dash-gate (createRequire), the
 * Workspace widget/Settings (Vite import), and host tests.
 *
 * Public API (see docs/superpowers/specs/2026-07-05-mapping-v3-dimensions-design.md §2-§3):
 *   mineTokens({liNames, cm360Rows, deliveryCreativeNames?}) -> [{token, count, side}]
 *   classifyRow(row, dim, overrides)            -> value | null
 *   classifyAll({deliveryRows, cm360Rows, mapping, deliveryCreatives?})
 *                                               -> {deliveryCells, cm360Cells, perDim, unresolvedCount}
 *   deriveAutoValues(deliveryRows, autoKind)    -> string[]   (channel|tactic distinct field values)
 *   pivotCompare({deliveryDaily, cm360Daily, deliveryCells, cm360Cells, dims, mode, range?})
 *                                               -> {rows:[{…, scope}], unmapped, lastCommonDay}
 *
 * classifyRow priority chain (BINDING):
 *   1. cell_override  overrides[side][key][dim.id] — wins over all, but for a
 *                     library dim the value must exist in dim.values (unknown
 *                     override value is ignored → falls through the chain)
 *   2. auto_kind      'month' from row.date (both sides); 'channel'|'tactic'
 *                     from row.fields on the DELIVERY side. On the CM360 side an
 *                     auto channel/tactic dim has no field, so it FALLS THROUGH
 *                     to step 4 and classifies by token/alias over its values
 *                     (v3.1 — auto dims may carry values with aliases, e.g.
 *                     Audio ← 'Programmatic-Audio' on a placement).
 *   3. delivery only  structured-field EQUALITY vs value/alias (short-circuits)
 *   4. token/alias    word-boundary match over the composed name (delivery: LI
 *                     name — classifyAll extends it with the LI's creative names
 *                     when deliveryCreatives is supplied (v3.1); cm360: caller
 *                     passes placement + ' ' + creative as row.name)
 *   5. exactly-one    0 hits -> null; >=2 DISTINCT surviving values -> null;
 *                     multiple hits of the SAME value -> fine.
 *
 * Specificity within step 4/5 (TOKEN-BOUNDARY dominance): when one matched
 * value's evidence TOKENS appear as a contiguous token run inside another
 * matched value's evidence tokens (['skippable'] inside ['non','skippable'] /
 * ['ctv','skippable']), the shorter is dominated and dropped, so the most-
 * specific alias wins. Character substrings do NOT dominate: 'US' vs 'AUS',
 * 'IN' vs 'China', 'Rich' vs 'Enriched' are distinct tokens → genuinely
 * ambiguous → null. This is what lets the same word-boundary matcher reproduce
 * the humans' YouTube-type column without collapsing real ambiguity.
 *
 * pivotCompare accepts ISO daily dates and optional inclusive range boundaries
 * ONLY (YYYY-MM-DD): lastCommonDay, day-mode and range filtering rely on lexical
 * date ordering, so a non-ISO date throws (with the offending date named).
 * classifyRow's month auto still tolerates M/D/YYYY.
 */
(function (root) {
"use strict";

/* ── string helpers (copied verbatim from shared/third-party-compare.js) ────── */
function normalizeStr(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function fold(s) { return normalizeStr(s).toLowerCase(); }
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

function tokenMatches(placementFolded, right) {
  var r = fold(right);
  if (!r) return false;
  var esc = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])').test(placementFolded);
}

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'];

/** Month name from a PASSED date only (YYYY-MM-DD preferred; M/D/YYYY tolerated). Pure. */
function monthName(dateStr) {
  var s = String(dateStr == null ? '' : dateStr);
  var mo = null;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) mo = parseInt(m[2], 10);
  else {
    var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m2) mo = parseInt(m2[1], 10);
  }
  if (!(mo >= 1 && mo <= 12)) return null;
  return MONTHS[mo - 1];
}

/* ── token mining ───────────────────────────────────────────────────────────── */

function isPureNumber(t) { return /^[0-9]+$/.test(t); }
function isDateToken(t) {
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t);
}

/** LI name candidate tokens: positions 5-16 (1-indexed) split by '_'; drop '-', pure numerics (covers LI ids). */
function liNameTokens(name) {
  var parts = String(name == null ? '' : name).split('_');
  var slice = parts.slice(4, 16);              // positions 5..16 (1-indexed)
  var out = [];
  for (var i = 0; i < slice.length; i++) {
    var t = normalizeStr(slice[i]);
    if (t === '' || t === '-') continue;
    if (isPureNumber(t)) continue;             // LI ids + counts
    out.push(t);
  }
  return out;
}

/** CM360 candidate tokens from placement+creative: word tokens >=2 chars; drop pure numbers/dates/BA:<id>; keep sizes (300x250). */
function cm360Tokens(text) {
  var s = String(text == null ? '' : text);
  s = s.replace(/BA:\d+/gi, ' ');              // ad-server ids, not values
  s = s.replace(/\d{4}-\d{1,2}-\d{1,2}/g, ' '); // ISO dates
  s = s.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ');
  var raw = s.split(/[^A-Za-z0-9x]+/);          // '300x250' and '30s' survive intact
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = normalizeStr(raw[i]);
    if (t.length < 2) continue;
    if (isPureNumber(t)) continue;
    if (isDateToken(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * mineTokens({liNames:[string], cm360Rows:[{placement, creative}], deliveryCreativeNames?:[string]})
 *   -> [{token, count, side}]
 * Merged (case-insensitive) counts; side 'delivery'|'cm360'|'both'; sorted count desc then token asc; cap 100.
 * deliveryCreativeNames (v3.1): free-form delivery creative names — word-boundary
 * tokenized like CM360 text but attributed to the DELIVERY side.
 */
function mineTokens(input) {
  input = input || {};
  var liNames = input.liNames || [];
  var cm360Rows = input.cm360Rows || [];
  var deliveryCreativeNames = input.deliveryCreativeNames || [];
  var map = {};                                // foldedToken -> {token, count, dSide, cSide}
  function bump(tok, side) {
    var k = fold(tok);
    if (!k) return;
    var e = map[k];
    if (!e) e = map[k] = { token: tok, count: 0, d: false, c: false };
    e.count += 1;
    if (side === 'delivery') e.d = true; else e.c = true;
  }
  for (var i = 0; i < liNames.length; i++) {
    var lt = liNameTokens(liNames[i]);
    for (var a = 0; a < lt.length; a++) bump(lt[a], 'delivery');
  }
  for (var j = 0; j < cm360Rows.length; j++) {
    var r = cm360Rows[j] || {};
    var ct = cm360Tokens((r.placement == null ? '' : r.placement) + ' ' + (r.creative == null ? '' : r.creative));
    for (var b = 0; b < ct.length; b++) bump(ct[b], 'cm360');
  }
  for (var dc = 0; dc < deliveryCreativeNames.length; dc++) {
    var dct = cm360Tokens(deliveryCreativeNames[dc]);   // free-form: word-boundary tokens
    for (var e = 0; e < dct.length; e++) bump(dct[e], 'delivery');
  }
  var list = [];
  var keys = Object.keys(map);
  for (var k = 0; k < keys.length; k++) {
    var e = map[keys[k]];
    list.push({ token: e.token, count: e.count, side: e.d && e.c ? 'both' : (e.d ? 'delivery' : 'cm360') });
  }
  list.sort(function (x, y) {
    return y.count - x.count || (fold(x.token) < fold(y.token) ? -1 : (fold(x.token) > fold(y.token) ? 1 : 0));
  });
  return list.slice(0, 100);
}

/**
 * deriveAutoValues(deliveryRows, autoKind) -> string[]
 * Distinct DELIVERY-side field values for an auto dim (channel|tactic): first-seen
 * casing, deduped case-insensitively, sorted (folded). The UI syncs these into an
 * auto dim's stored values[] as read-only labels so the CM360 side can carry
 * per-value aliases. 'month' is date-derived, never field-derived -> [].
 */
function deriveAutoValues(deliveryRows, autoKind) {
  deliveryRows = deliveryRows || [];
  if (autoKind !== 'channel' && autoKind !== 'tactic') return [];
  var seen = {}, out = [];
  for (var i = 0; i < deliveryRows.length; i++) {
    var fields = (deliveryRows[i] || {}).fields || {};
    var v = normalizeStr(fields[autoKind]);
    if (v === '') continue;
    var k = fold(v);
    if (Object.prototype.hasOwnProperty.call(seen, k)) continue;
    seen[k] = true;
    out.push(v);
  }
  out.sort(function (a, b) { var fa = fold(a), fb = fold(b); return fa < fb ? -1 : (fa > fb ? 1 : 0); });
  return out;
}

/* ── classification ─────────────────────────────────────────────────────────── */

/** Every matchable string for a value: the value itself + its aliases. */
function valueStrings(v) {
  var out = [v.value];
  var al = v.aliases || [];
  for (var i = 0; i < al.length; i++) out.push(al[i]);
  return out;
}

/** Collect delivery structured-equality hits: any field value fold-equals a value/alias string. */
function structuredHits(values, fields) {
  var hits = [];
  var fs = [];
  var keys = fields ? Object.keys(fields) : [];
  for (var i = 0; i < keys.length; i++) fs.push(fold(fields[keys[i]]));
  for (var v = 0; v < values.length; v++) {
    var strs = valueStrings(values[v]);
    for (var s = 0; s < strs.length; s++) {
      var ef = fold(strs[s]);
      if (ef && fs.indexOf(ef) >= 0) { hits.push({ value: values[v].value, evidence: ef }); break; }
    }
  }
  return hits;
}

/** Collect word-boundary token hits of any value/alias over the folded name. */
function tokenHits(values, name) {
  var nameFold = fold(name);
  var hits = [];
  for (var v = 0; v < values.length; v++) {
    var strs = valueStrings(values[v]);
    var best = null;
    for (var s = 0; s < strs.length; s++) {
      if (tokenMatches(nameFold, strs[s])) {
        var ef = fold(strs[s]);
        if (best === null || ef.length > best.length) best = ef;   // most-specific evidence for this value
      }
    }
    if (best !== null) hits.push({ value: values[v].value, evidence: best });
  }
  return hits;
}

/** Split a folded evidence string into word tokens ('non-skippable' -> ['non','skippable']). */
function evidenceTokens(e) {
  var raw = String(e == null ? '' : e).split(/[^a-z0-9]+/);
  var out = [];
  for (var i = 0; i < raw.length; i++) { if (raw[i]) out.push(raw[i]); }
  return out;
}

/** True when `small` appears as a contiguous token run inside the STRICTLY longer `big`. */
function tokenRunContains(big, small) {
  if (!small.length || big.length <= small.length) return false;
  for (var i = 0; i + small.length <= big.length; i++) {
    var hit = true;
    for (var j = 0; j < small.length; j++) { if (big[i + j] !== small[j]) { hit = false; break; } }
    if (hit) return true;
  }
  return false;
}

/**
 * Resolve a hit list to a single value|null under the exactly-one rule with
 * TOKEN-BOUNDARY specificity dominance. hits = [{value, evidence}]; multiple
 * hits of the same value collapse; a value whose (longest) evidence tokens
 * appear as a contiguous token run inside another value's strictly-longer
 * evidence tokens is dominated and dropped ('skippable' ⊂ 'non-skippable').
 * Character substrings never dominate ('us' vs 'aus' stays ambiguous → null).
 */
function resolveHits(hits) {
  if (!hits.length) return null;
  var byVal = {}, order = [];
  for (var i = 0; i < hits.length; i++) {
    var v = hits[i].value, e = hits[i].evidence || '';
    if (!Object.prototype.hasOwnProperty.call(byVal, v)) { byVal[v] = ''; order.push(v); }
    if (e.length > byVal[v].length) byVal[v] = e;                   // longest evidence per value
  }
  var toks = {};
  for (var t = 0; t < order.length; t++) toks[order[t]] = evidenceTokens(byVal[order[t]]);
  var survivors = [];
  for (var k = 0; k < order.length; k++) {
    var val = order[k], dominated = false;
    for (var m = 0; m < order.length; m++) {
      if (order[m] === val) continue;
      if (tokenRunContains(toks[order[m]], toks[val])) { dominated = true; break; }
    }
    if (!dominated) survivors.push(val);
  }
  return survivors.length === 1 ? survivors[0] : null;
}

/** True when the override value fold-equals one of the dim's canonical values. */
function overrideValueExists(values, ov) {
  var f = fold(ov);
  for (var i = 0; i < values.length; i++) { if (fold(values[i].value) === f) return true; }
  return false;
}

/**
 * classifyRow(row, dim, overrides) -> value|null
 *   row: {side:'delivery'|'cm360', key, name, fields?, date?}
 *   overrides: {delivery:{[key]:{[dimId]:value}}, cm360:{...}}
 */
function classifyRow(row, dim, overrides) {
  row = row || {};
  dim = dim || {};
  var side = row.side === 'cm360' ? 'cm360' : 'delivery';

  // 1. cell override wins over everything — but for a library dim the value
  //    must exist in dim.values (unknown/stale override → ignored, fall through).
  if (overrides && overrides[side] && overrides[side][row.key] &&
      Object.prototype.hasOwnProperty.call(overrides[side][row.key], dim.id)) {
    var ovVal = overrides[side][row.key][dim.id];
    if (dim.auto_kind || overrideValueExists(dim.values || [], ovVal)) return ovVal;
  }

  // 2. auto dimensions.
  //    month: from the passed date (both sides — dates exist everywhere).
  //    channel/tactic: DELIVERY reads the structured field (authoritative); the
  //      CM360 side has no such field, so it FALLS THROUGH to token/alias
  //      matching over the dim's values (v3.1 — auto dims may now carry
  //      values with aliases, e.g. Audio ← 'Programmatic-Audio' on a placement).
  if (dim.auto_kind === 'month') return monthName(row.date);
  if (dim.auto_kind === 'channel' || dim.auto_kind === 'tactic') {
    if (side === 'delivery') {
      var fv = normalizeStr((row.fields || {})[dim.auto_kind]);
      return fv === '' ? null : fv;
    }
    // cm360: no structured field — fall through to the token/alias matcher below.
  } else if (dim.auto_kind) {
    return null;   // unknown auto_kind — nothing to classify
  }

  var values = dim.values || [];
  if (!values.length) return null;

  // 3. delivery structured-field equality — authoritative, short-circuits.
  if (side === 'delivery') {
    var sh = structuredHits(values, row.fields);
    if (sh.length) return resolveHits(sh);
  }

  // 4. word-boundary token/alias match over the composed name; 5. exactly-one.
  return resolveHits(tokenHits(values, row.name));
}

/* ── classifyAll ────────────────────────────────────────────────────────────── */

/** True for auto dims (Channel/Tactic/Month) — they never "need a pick". */
function isAuto(dim) { return !!dim.auto_kind; }

/**
 * classifyAll({deliveryRows, cm360Rows, mapping, deliveryCreatives?})
 *   deliveryRows: [{key, name, fields}]        (one per LI; side forced to 'delivery')
 *   cm360Rows:    [{key, name}]                (one per placement group; side forced to 'cm360';
 *                                               caller composes name = placement + ' ' + creative)
 *   deliveryCreatives?: {[liKey]: [creativeName]}   (v3.1) when present, an LI's
 *                     token-matching surface is EXTENDED with its creative names
 *                     (structured-field equality still runs first, unchanged);
 *                     the exactly-one rule still guards ambiguity.
 * -> { deliveryCells:{[key]:{[dimId]:v|null}}, cm360Cells:{...},
 *      perDim:[{dimId,dCount,dTotal,cCount,cTotal}], unresolvedCount }
 */
function classifyAll(input) {
  input = input || {};
  var deliveryRows = input.deliveryRows || [];
  var cm360Rows = input.cm360Rows || [];
  var mapping = input.mapping || {};
  var dims = mapping.dimensions || [];
  var overrides = mapping.cell_overrides || {};
  var deliveryCreatives = input.deliveryCreatives || null;

  var deliveryCells = {}, cm360Cells = {};
  var perDim = [];
  var unresolvedCount = 0;

  // Precompute each delivery row's token-matching surface once: the LI name,
  // plus (when creatives are supplied for that LI) its creative names joined in.
  // Structured-field equality is unaffected — it reads row.fields, not the name.
  var deliverySurface = {};
  for (var s = 0; s < deliveryRows.length; s++) {
    var sr = deliveryRows[s];
    var name = sr.name == null ? '' : String(sr.name);
    var crs = deliveryCreatives && deliveryCreatives[sr.key];
    if (crs && crs.length) name = name + ' ' + crs.join(' ');
    deliverySurface[sr.key] = name;
  }

  for (var d = 0; d < dims.length; d++) {
    var dim = dims[d];
    var dCount = 0, cCount = 0;
    for (var i = 0; i < deliveryRows.length; i++) {
      var dr = deliveryRows[i];
      var key = dr.key;
      var cell = classifyRow({ side: 'delivery', key: key, name: deliverySurface[key], fields: dr.fields, date: dr.date }, dim, overrides);
      (deliveryCells[key] || (deliveryCells[key] = {}))[dim.id] = cell;
      if (cell != null) dCount++;
      else if (!isAuto(dim)) unresolvedCount++;
    }
    for (var j = 0; j < cm360Rows.length; j++) {
      var cr = cm360Rows[j];
      var ckey = cr.key;
      var ccell = classifyRow({ side: 'cm360', key: ckey, name: cr.name, fields: cr.fields, date: cr.date }, dim, overrides);
      (cm360Cells[ckey] || (cm360Cells[ckey] = {}))[dim.id] = ccell;
      if (ccell != null) cCount++;
      else if (!isAuto(dim)) unresolvedCount++;
    }
    perDim.push({ dimId: dim.id, dCount: dCount, dTotal: deliveryRows.length, cCount: cCount, cTotal: cm360Rows.length });
  }
  return { deliveryCells: deliveryCells, cm360Cells: cm360Cells, perDim: perDim, unresolvedCount: unresolvedCount };
}

/* ── pivot comparison ───────────────────────────────────────────────────────── */

function zeroMetric() { return { impressions: 0, clicks: 0, completions: 0 }; }
function addMetric(acc, row) {
  acc.impressions += num(row.impressions);
  acc.clicks += num(row.clicks);
  acc.completions += num(row.completions);
}
function ratio(cm, d) { return d ? (cm - d) / d : null; }
function deltaOf(delivery, cm360) {
  return {
    impressions: ratio(cm360.impressions, delivery.impressions),
    clicks: ratio(cm360.clicks, delivery.clicks),
    completions: ratio(cm360.completions, delivery.completions),
  };
}

/** Resolve one daily row's value for a dim: month from date; else from cells. null => unmapped. */
function dimValueFor(dim, dailyRow, cells) {
  if (dim.auto_kind === 'month') return monthName(dailyRow.date);
  var c = cells[dailyRow.key];
  var v = c ? c[dim.id] : undefined;
  return v == null ? null : v;
}

/**
 * pivotCompare({deliveryDaily, cm360Daily, deliveryCells, cm360Cells, dims, mode, range?})
 *   deliveryDaily/cm360Daily: [{key, date, impressions, clicks, completions}]
 *   dims: selected dimensions, in order (the grouping axes)
 *   mode: 'flight' | 'month' | 'day'
 *   range: optional inclusive {from, to}; filters totals but NOT tuple scope
 * -> { rows:[{key:[values], delivery, cm360, delta, scope, months?}], unmapped:{...}, lastCommonDay }
 *
 * scope (v3.1): 'overlap' | 'delivery_only' | 'cm360_only' — a tuple's side
 * membership, basis = impressions. It is computed on FLIGHT-WIDE per-side
 * impression totals (summed over ALL daily rows) regardless of `mode`, so a
 * tuple never flips scope between flight/month/day (a 1-LI pacing vs a
 * whole-campaign export must not read a foreign CM360 slice as delivery-only
 * just because a given day view is one-sided). Δ is meaningful only for
 * 'overlap'; it is still computed for every row (the UI decides what to show).
 * The Unmapped bucket is unchanged and carries no scope.
 */
function pivotCompare(input) {
  input = input || {};
  var deliveryDaily = input.deliveryDaily || [];
  var cm360Daily = input.cm360Daily || [];
  var deliveryCells = input.deliveryCells || {};
  var cm360Cells = input.cm360Cells || {};
  var dims = input.dims || [];
  var mode = input.mode || 'flight';
  var range = input.range || null;

  // Daily dates MUST be ISO (lastCommonDay/day-mode rely on lexical ordering).
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function assertIsoDate(date, src) {
    if (!ISO_DATE.test(String(date == null ? '' : date))) {
      throw new Error('pivotCompare: non-ISO date "' + date + '" in ' + src + ' (expected YYYY-MM-DD)');
    }
  }
  if (range) {
    assertIsoDate(range.from, 'range.from');
    assertIsoDate(range.to, 'range.to');
    if (range.from > range.to) {
      throw new Error('pivotCompare: range.from must be on or before range.to');
    }
  }

  // last common day = latest date present in BOTH datasets.
  var dDates = {}, cDates = {}, di;
  for (di = 0; di < deliveryDaily.length; di++) { assertIsoDate(deliveryDaily[di].date, 'deliveryDaily'); dDates[deliveryDaily[di].date] = true; }
  for (di = 0; di < cm360Daily.length; di++) { assertIsoDate(cm360Daily[di].date, 'cm360Daily'); cDates[cm360Daily[di].date] = true; }
  var lastCommonDay = null;
  var dk = Object.keys(dDates);
  for (di = 0; di < dk.length; di++) {
    if (cDates[dk[di]] && (lastCommonDay === null || dk[di] > lastCommonDay)) lastCommonDay = dk[di];
  }

  var groups = {};      // groupKey -> {key:[], delivery, cm360, monthsD:{}, monthsC:{} }
  var order = [];
  var unmapped = { key: [], delivery: zeroMetric(), cm360: zeroMetric(), monthsD: {}, monthsC: {} };

  // Tuple values for one daily row over the selected dims; null when any dim is
  // unresolved for the row (→ Unmapped). Shared by ingest and the scope pass so
  // both group by the IDENTICAL tuple.
  function tupleValsFor(row, cells) {
    var vals = [];
    for (var g = 0; g < dims.length; g++) {
      var v = dimValueFor(dims[g], row, cells);
      if (v === null) return null;
      vals.push(v);
    }
    return vals;
  }

  // v3.1 scope pass — FLIGHT-WIDE per-tuple impression totals per side, summed
  // over ALL daily rows with NO mode filter (deliberate: scope must be identical
  // across flight/month/day — see the doc above). Unmapped rows carry no scope.
  // Keyed by JSON.stringify(vals): collision-free for string tuples, independent
  // of ingest's group keying.
  var flightImpr = {};   // JSON tuple -> {d, c}
  function scopePass(dailyRows, cells, sideProp) {
    for (var i = 0; i < dailyRows.length; i++) {
      var vals = tupleValsFor(dailyRows[i], cells);
      if (vals === null) continue;
      var sk = JSON.stringify(vals);
      var e = flightImpr[sk] || (flightImpr[sk] = { d: 0, c: 0 });
      e[sideProp] += num(dailyRows[i].impressions);
    }
  }
  scopePass(deliveryDaily, deliveryCells, 'd');
  scopePass(cm360Daily, cm360Cells, 'c');

  // Scope from flight-wide impressions: >0 on both sides → overlap; on one side
  // only → that side's scope. Degenerate all-zero tuple (rows exist, zero
  // impressions everywhere) stays 'overlap' so it renders in the default view.
  function scopeOf(vals) {
    var e = flightImpr[JSON.stringify(vals)] || { d: 0, c: 0 };
    if (e.d > 0 && e.c > 0) return 'overlap';
    if (e.d > 0) return 'delivery_only';
    if (e.c > 0) return 'cm360_only';
    return 'overlap';
  }

  function ingest(dailyRows, cells, sideField) {
    for (var i = 0; i < dailyRows.length; i++) {
      var row = dailyRows[i];
      if (mode === 'day') { if (lastCommonDay === null || row.date !== lastCommonDay) continue; }
      if (range && (row.date < range.from || row.date > range.to)) continue;

      var vals = tupleValsFor(row, cells);

      var target;
      if (vals === null) {
        target = unmapped;
      } else {
        var gk = vals.join('');
        target = groups[gk];
        if (!target) { target = groups[gk] = { key: vals, delivery: zeroMetric(), cm360: zeroMetric(), monthsD: {}, monthsC: {} }; order.push(gk); }
      }

      addMetric(target[sideField], row);
      if (mode === 'month') {
        var mo = monthName(row.date);
        if (mo) {
          var bucket = sideField === 'delivery' ? target.monthsD : target.monthsC;
          if (!bucket[mo]) bucket[mo] = zeroMetric();
          addMetric(bucket[mo], row);
        }
      }
    }
  }

  ingest(deliveryDaily, deliveryCells, 'delivery');
  ingest(cm360Daily, cm360Cells, 'cm360');

  function monthsArray(monthsD, monthsC) {
    var names = {}, out = [], names2 = [];
    Object.keys(monthsD).forEach(function (m) { names[m] = true; });
    Object.keys(monthsC).forEach(function (m) { names[m] = true; });
    names2 = Object.keys(names);
    names2.sort(function (a, b) { return MONTHS.indexOf(a) - MONTHS.indexOf(b); });
    for (var i = 0; i < names2.length; i++) {
      var m = names2[i];
      var d = monthsD[m] || zeroMetric(), c = monthsC[m] || zeroMetric();
      out.push({ month: m, delivery: d, cm360: c, delta: deltaOf(d, c) });
    }
    return out;
  }

  function finalize(g) {
    var r = { key: g.key, delivery: g.delivery, cm360: g.cm360, delta: deltaOf(g.delivery, g.cm360), scope: scopeOf(g.key) };
    if (mode === 'month') r.months = monthsArray(g.monthsD, g.monthsC);
    return r;
  }

  var rows = [];
  for (di = 0; di < order.length; di++) rows.push(finalize(groups[order[di]]));

  var unmappedOut = { delivery: unmapped.delivery, cm360: unmapped.cm360, delta: deltaOf(unmapped.delivery, unmapped.cm360) };
  if (mode === 'month') unmappedOut.months = monthsArray(unmapped.monthsD, unmapped.monthsC);

  return { rows: rows, unmapped: unmappedOut, lastCommonDay: lastCommonDay };
}

/* ── export ─────────────────────────────────────────────────────────────────── */

var MappingDims = {
  normalizeStr: normalizeStr,
  fold: fold,
  tokenMatches: tokenMatches,
  monthName: monthName,
  liNameTokens: liNameTokens,
  cm360Tokens: cm360Tokens,
  mineTokens: mineTokens,
  deriveAutoValues: deriveAutoValues,
  classifyRow: classifyRow,
  classifyAll: classifyAll,
  pivotCompare: pivotCompare,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MappingDims;
} else {
  root.MappingDims = MappingDims;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
