/**
 * dash-blocks.js — the ONE list of code-rendered functional blocks, and the read
 * rule for `config_json.display.enabled` (widget-library spec 2026-08-14 §4/§5).
 *
 * Two runtimes must agree or a switch silently does nothing:
 *   - dash-gate/lib/widgets-validate.mjs decides which ids may be STORED,
 *   - the workspace registry / grid / gallery decide which ids are RENDERED.
 * Spec §8 makes that one source of truth, so it lives here beside pacing-core and
 * flight-span and both sides import THIS file.
 * Browser/Vite: globalThis.DashBlocks; Node: module.exports.
 *
 * SCOPE: enabled{} covers the 8 functional block ids and canonical `w_` Widget instance
 * ids, and that is the WHOLE switch domain. Standard templates, Hero, Finance and every
 * Chart are ordinary inline Widget instances, so they reach enabled{} through the instance
 * half and FUNCTIONAL_BLOCK_IDS stays exactly the same 8 ids. Do not widen it.
 * The frame domain lives beside it: display.groups[] (normGroups /
 * sweepGroups below) is arrangement state with no switch — a `g_` id never enters
 * enabled{}.
 */
(function (root) {
"use strict";

// FLOW_REGISTRY (workspace/src/pages/Dashboard/tile-registry.jsx) exactly. Hero and
// Finance are Widgets rather than functional ids, so the two lists are the same eight
// ids with no exceptions. tests/dashboard/dash-blocks.test.js pins this and the order.
var FUNCTIONAL_BLOCK_IDS = [
  'launchPlan', 'alerts', 'targets', 'lineItems',
  'thirdParty', 'breakdown', 'dailyTable', 'journal'
];

var FUNCTIONAL_SET = {};
for (var i = 0; i < FUNCTIONAL_BLOCK_IDS.length; i++) FUNCTIONAL_SET[FUNCTIONAL_BLOCK_IDS[i]] = true;

// The single source of the widget-instance id pattern:
// dash-gate/lib/widgets-validate.mjs aliases this as WIDGET_ID, and the workspace
// reads it from here too. Never re-type the literal anywhere else.
var WIDGET_INSTANCE_RE = /^w_[a-z0-9]{4,16}$/;

/** Is `id` a key enabled{} may carry at all? Own-key checked, so 'constructor'
 *  and friends cannot answer for a real block. */
function isEnabledKey(id) {
  if (typeof id !== 'string') return false;
  if (Object.prototype.hasOwnProperty.call(FUNCTIONAL_SET, id)) return true;
  return WIDGET_INSTANCE_RE.test(id);
}

/** Absent ≡ ON. Only an explicit `false` hides a tile (spec §4). */
function tileEnabled(display, id) {
  var map = display && display.enabled;
  if (!map || typeof map !== 'object') return true;
  if (!Object.prototype.hasOwnProperty.call(map, id)) return true;
  return map[id] !== false;
}

/**
 * The single-ENTRY patch a switch sends through the view-pref merge lane: OFF
 * stores `false`, ON DELETES the key (`null` is the lane's deletion marker), so a
 * default-on tile never accumulates a redundant `true` and the map stays the size
 * of what the user actually turned off.
 *
 * The domain is closed after cutover. An unknown id is a caller bug and is refused
 * here, before a request can claim that a switch was saved. The server enforces the
 * same rule for both full-display and per-entry writes.
 */
function enabledPatch(id, on) {
  if (!isEnabledKey(id)) throw new TypeError('Unknown dashboard tile id "' + String(id) + '"');
  var p = {};
  p[id] = on ? null : false;
  return p;
}

// ── Groups (widget-library spec 2026-08-14 §4/§6.4, phase 4) ────────────────
// A group is ARRANGEMENT state: {id, title?, tileIds[], bg, hideTitle?} — refs
// only, so the Overview strip that drops display.widgets stays valid. Members
// are `w_` instances ONLY (functional blocks are never group members — owner
// semantics), a tile sits in at most one group, and `bg` comes from the closed
// tint palette (full-surface tints; the left-stripe ban applies to frames like
// everything else) — or 'none' (owner 2026-08-16): the dashboard draws no mat
// and no border at all; Layout mode keeps a neutral dashed outline so the group
// stays manageable. `hideTitle` (same date) is SPARSE — stored only when true,
// the enabled{} discipline — and means: the name stays in the system (Layout
// strip, library, share) but the view-mode chip is not drawn.
var GROUP_ID_RE = /^g_[a-z0-9]{4,16}$/;
var GROUP_TINTS = ['slate', 'blue', 'teal', 'amber', 'violet', 'rose'];
// The tints are the token families (--grp-*-bg/-line, swatch row, token guards
// iterate exactly six); 'none' has no tokens, so acceptance widens through
// GROUP_BGS while GROUP_TINTS stays the palette.
var GROUP_BGS = GROUP_TINTS.concat(['none']);
var GROUP_LIMITS = { groups: 16, tiles: 24, title: 80 };

var BG_SET = {};
for (var ti = 0; ti < GROUP_BGS.length; ti++) BG_SET[GROUP_BGS[ti]] = true;

/** {ok:true, out} with fresh normalized objects, or {ok:false, detail} naming the
 *  group that broke it, so widgets-validate can `throw bad(...)` the detail verbatim. */
function normGroups(groups) {
  if (!Array.isArray(groups)) return { ok: false, detail: 'must be an array' };
  if (groups.length > GROUP_LIMITS.groups) return { ok: false, detail: 'over ' + GROUP_LIMITS.groups + ' groups' };
  var out = [], seenIds = {}, seenTiles = {};
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, detail: 'group #' + i + ': not an object' };
    if (typeof g.id !== 'string' || !GROUP_ID_RE.test(g.id)) return { ok: false, detail: 'group #' + i + ': bad id (expected g_<4-16 alphanumerics>)' };
    if (Object.prototype.hasOwnProperty.call(seenIds, g.id)) return { ok: false, detail: 'duplicate group id ' + g.id };
    seenIds[g.id] = true;
    if (!Object.prototype.hasOwnProperty.call(BG_SET, g.bg)) return { ok: false, detail: 'group ' + g.id + ': unknown bg "' + String(g.bg).slice(0, 24) + '"' };
    if (!Array.isArray(g.tileIds) || g.tileIds.length < 1) return { ok: false, detail: 'group ' + g.id + ': needs at least one tile' };
    if (g.tileIds.length > GROUP_LIMITS.tiles) return { ok: false, detail: 'group ' + g.id + ': over ' + GROUP_LIMITS.tiles + ' tiles' };
    var ids = [];
    for (var j = 0; j < g.tileIds.length; j++) {
      var id = g.tileIds[j];
      if (typeof id !== 'string' || !WIDGET_INSTANCE_RE.test(id)) return { ok: false, detail: 'group ' + g.id + ': "' + String(id).slice(0, 24) + '" is not a widget instance id' };
      if (Object.prototype.hasOwnProperty.call(seenTiles, id)) return { ok: false, detail: 'tile ' + id + ' is in two groups' };
      seenTiles[id] = true;
      ids.push(id);
    }
    var norm = { id: g.id, tileIds: ids, bg: g.bg };
    var t = (typeof g.title === 'string') ? g.title.slice(0, GROUP_LIMITS.title).replace(/^\s+|\s+$/g, '') : '';
    if (t) norm.title = t;
    if (g.hideTitle === true) norm.hideTitle = true; // sparse: only true stores (owner 2026-08-16)
    out.push(norm);
  }
  return { ok: true, out: out };
}

/** Members not in liveIds drop; a group with none left dissolves. Pure — the ONE
 *  rule for both runtimes (db.mjs dead-member sweep, widget-ops withWidgetRemoved). */
function sweepGroups(groups, liveIds) {
  if (!Array.isArray(groups)) return [];
  var live = {};
  for (var i = 0; i < (liveIds || []).length; i++) live[liveIds[i]] = true;
  var out = [];
  for (var k = 0; k < groups.length; k++) {
    var g = groups[k];
    if (!g || !Array.isArray(g.tileIds)) continue;
    var keep = [];
    for (var j = 0; j < g.tileIds.length; j++) {
      if (Object.prototype.hasOwnProperty.call(live, g.tileIds[j])) keep.push(g.tileIds[j]);
    }
    if (!keep.length) continue;
    var copy = { id: g.id, tileIds: keep, bg: g.bg };
    if (g.title) copy.title = g.title;
    if (g.hideTitle === true) copy.hideTitle = true;
    out.push(copy);
  }
  return out;
}

var DashBlocks = {
  FUNCTIONAL_BLOCK_IDS: FUNCTIONAL_BLOCK_IDS,
  WIDGET_INSTANCE_RE: WIDGET_INSTANCE_RE,
  isEnabledKey: isEnabledKey,
  tileEnabled: tileEnabled,
  enabledPatch: enabledPatch,
  GROUP_ID_RE: GROUP_ID_RE,
  GROUP_TINTS: GROUP_TINTS,
  GROUP_BGS: GROUP_BGS,
  GROUP_LIMITS: GROUP_LIMITS,
  normGroups: normGroups,
  sweepGroups: sweepGroups
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DashBlocks;
} else {
  root.DashBlocks = DashBlocks;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
