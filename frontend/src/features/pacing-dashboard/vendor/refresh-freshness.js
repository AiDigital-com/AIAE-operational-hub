/**
 * refresh-freshness.js — which DSP's data is late (dashboard refresh spec 2026-10-01).
 *
 * Pure, dependency-free, ES5. dash-gate requires it (merge.mjs, refresh-status.mjs,
 * api-routes.mjs); the workspace imports it through the alias door
 * workspace/src/lib/dashboard/refresh-freshness.js.
 * Browser: global `RefreshFreshness`. Node: module.exports.
 *
 * The rule: a platform is EXPECTED to deliver while a line with rows on it ends after
 * its newest data day; it is LATE when that newest day is 3+ days old, or 2 days old
 * once DELIVERY_ALLOWANCE_HOURS have passed since midnight in the campaign timezone.
 * Data through yesterday is never late. The BigQuery query takes whole days only, so
 * "yesterday" is the newest day a refresh can bring.
 */
(function (root) {
'use strict';

var DELIVERY_ALLOWANCE_HOURS = 15;
var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

/**
 * One pass over the facts rows: per platform, the newest date and the line items seen.
 * Rows with an empty platform are ignored. Output sorted by platform, ids sorted, so the
 * blob bytes (and the ETag) are stable across builds of the same facts.
 * @param {Array<{date, line_item_id, platform}>} factsDaily
 * @returns {Array<{platform:string, latestDate:string|null, lineItemIds:string[]}>}
 */
function summarizeRows(factsDaily) {
  var rows = Array.isArray(factsDaily) ? factsDaily : [];
  var byPlatform = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r) continue;
    var platform = r.platform == null ? '' : String(r.platform).trim();
    if (!platform) continue;
    var date = r.date == null ? '' : String(r.date);
    var id = r.line_item_id == null ? '' : String(r.line_item_id);
    if (!has(byPlatform, platform)) byPlatform[platform] = { latestDate: '', ids: {} };
    var e = byPlatform[platform];
    if (date > e.latestDate) e.latestDate = date;
    if (id) e.ids[id] = true;
  }
  return Object.keys(byPlatform).sort().map(function (p) {
    return { platform: p, latestDate: byPlatform[p].latestDate || null, lineItemIds: Object.keys(byPlatform[p].ids).sort() };
  });
}

/**
 * The verdict-free per-platform facts the blob carries: the newest data day and the
 * latest flight end among the platform's lines. `lineEnds` is {lineItemId: 'YYYY-MM-DD'}
 * with paused lines already left out by the caller; `excludedLineIds` are sheet-bound lines.
 * @returns {Array<{platform:string, latestDate:string|null, maxLineEnd:string|null}>}
 */
function platformSummary(rowSummary, lineEnds, excludedLineIds) {
  var excluded = {};
  (excludedLineIds || []).forEach(function (id) { excluded[String(id)] = true; });
  var ends = lineEnds || {};
  return (rowSummary || []).map(function (p) {
    var maxLineEnd = null;
    var ids = Array.isArray(p.lineItemIds) ? p.lineItemIds : [];
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i]);
      if (has(excluded, id) || !has(ends, id) || !ends[id]) continue;
      if (maxLineEnd === null || ends[id] > maxLineEnd) maxLineEnd = ends[id];
    }
    return { platform: p.platform, latestDate: p.latestDate || null, maxLineEnd: maxLineEnd };
  });
}

/** 'YYYY-MM-DD' of the instant in the timezone (en-CA prints ISO order). */
function todayInTz(nowMs, tz) {
  try { return new Date(nowMs).toLocaleDateString('en-CA', { timeZone: tz || 'America/Chicago' }); }
  catch (e) { return new Date(nowMs).toISOString().slice(0, 10); }
}

function hoursSinceMidnight(nowMs, tz) {
  try {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date(nowMs));
    var h = 0, m = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'hour') h = Number(parts[i].value) % 24;
      if (parts[i].type === 'minute') m = Number(parts[i].value);
    }
    return h + m / 60;
  } catch (e) {
    var d = new Date(nowMs);
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  }
}

function dayDiff(from, to) {
  var a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  var b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * The verdict, computed with a clock: expected / late per platform.
 * @param {Array<{platform, latestDate, maxLineEnd}>} platforms
 * @param {number} nowMs
 * @param {string} tz
 */
function platformFreshness(platforms, nowMs, tz) {
  var today = todayInTz(nowMs, tz);
  var hours = hoursSinceMidnight(nowMs, tz);
  return (platforms || []).map(function (p) {
    var latest = p.latestDate || null;
    var maxEnd = p.maxLineEnd || null;
    var expected = !!(latest && maxEnd && maxEnd > latest);
    var gapDays = latest ? dayDiff(latest, today) : null;
    var late = expected && gapDays !== null
      && (gapDays >= 3 || (gapDays === 2 && hours >= DELIVERY_ALLOWANCE_HOURS));
    return { platform: p.platform, latestDate: latest, maxLineEnd: maxEnd, expected: expected, late: late, gapDays: gapDays };
  });
}

function lateList(freshness) { return (freshness || []).filter(function (f) { return f && f.late; }); }

/** The late platforms as sorted `platform:latestDate` pairs; '' when nothing is late. */
function lateFingerprint(freshness) {
  return lateList(freshness).map(function (f) { return f.platform + ':' + f.latestDate; }).sort().join(';');
}

function latePlatforms(freshness) {
  return lateList(freshness).map(function (f) { return f.platform; }).sort();
}

var RefreshFreshness = {
  DELIVERY_ALLOWANCE_HOURS: DELIVERY_ALLOWANCE_HOURS,
  summarizeRows: summarizeRows,
  platformSummary: platformSummary,
  todayInTz: todayInTz,
  platformFreshness: platformFreshness,
  lateFingerprint: lateFingerprint,
  latePlatforms: latePlatforms,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RefreshFreshness;
} else {
  root.RefreshFreshness = RefreshFreshness;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
