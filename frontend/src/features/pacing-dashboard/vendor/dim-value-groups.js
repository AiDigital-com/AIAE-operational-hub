/**
 * dim-value-groups.js — value groups of a line item (Settings → Pacing → Value groups).
 *
 * A line item can say that several raw values of one naming dimension read as one named
 * value: "on this line PMax_Brand and Search_Brand of Audience read as Brand". Stored in
 * config.line_items[].dim_groups:
 *
 *     [{ dim_key: 'audience', name: 'Brand', values: ['PMax_Brand', 'Search_Brand'] }]
 *
 * The rows are rewritten where they are first read (PacingCore.applyDimGroups), so a dim
 * split on "Brand" is an ordinary split with one shared target. This module is the other
 * half: what a dictionary may hold. The save validates with it, the Settings editor runs
 * the same rules on its draft, so Save is blocked on exactly what the server refuses.
 *
 * Membership is trimmed and ignores case (PacingCore.dimGroupFold; `fold` here restates it,
 * pinned by tests/dim-value-groups-test.mjs, so this module needs no other).
 *
 * Runtimes: dash-gate (lib/db.mjs), the workspace (`@shared/dim-value-groups`, through the
 * door workspace/src/lib/dashboard/dim-value-groups.js) and the visual mock. No n8n copy.
 *
 * ES5 on purpose (var + function), like the other shared UMDs.
 * Browser/Vite: globalThis.DimValueGroups; Node: module.exports.
 */
(function (root) {
"use strict";

/** The dimensions a dim split can be declared on, hence the ones a group can name. */
var DIM_KEYS = ['audience', 'comment', 'geo', 'creative', 'message', 'keyword', 'flight', 'language'];
var DIM_LABELS = {
  audience: 'Audience', comment: 'Comment', geo: 'Geo', creative: 'Creative',
  message: 'Message', keyword: 'Keyword', flight: 'Flight', language: 'Language'
};

var LIMITS = { groupsPerLine: 100, values: 50, name: 80, value: 300 };

/** Names the dashboard gives its own table rows (shared/value-labels.js RESERVED_LABELS,
 *  restated: a group named like one of them would fold into that row). */
var RESERVED_NAMES = ['Unclassified', 'Others', 'Other values', 'No value', 'Not covered'];

function fold(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function labelOf(dimKey) { return has(DIM_LABELS, dimKey) ? DIM_LABELS[dimKey] : String(dimKey); }

function article(word) { return /^[aeiou]/i.test(word) ? 'an' : 'a'; }

/** '-' is the delivered placeholder for "no value"; '__…' are filter and table keys. */
function isReservedToken(v) {
  var s = String(v == null ? '' : v).trim();
  return s === '-' || s.indexOf('__') === 0;
}

function isReservedName(name) {
  var f = fold(name);
  for (var i = 0; i < RESERVED_NAMES.length; i++) { if (fold(RESERVED_NAMES[i]) === f) return true; }
  return false;
}

/**
 * The stored form of a list: names and values trimmed, empty values dropped, a value
 * repeated inside one group kept once (first spelling). Never throws. What is NOT a list
 * comes back as it is, so the validator refuses it instead of a `null` silently clearing
 * a stored dictionary.
 */
function canon(groups) {
  if (!Array.isArray(groups)) return groups;
  var out = [];
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    if (!g || typeof g !== 'object' || Array.isArray(g)) { out.push(g); continue; }
    var values = [];
    var seen = {};
    var src = Array.isArray(g.values) ? g.values : [];
    for (var v = 0; v < src.length; v++) {
      var s = String(src[v] == null ? '' : src[v]).trim();
      var f = s.toLowerCase();
      if (!s || has(seen, f)) continue;
      seen[f] = true;
      values.push(s);
    }
    out.push({ dim_key: g.dim_key, name: String(g.name == null ? '' : g.name).trim(), values: values });
  }
  return out;
}

/**
 * A dim split whose value differs from a group's NAME only by case or outer spaces gets
 * exactly that name: buckets and filters match exactly, so a split on `brand` under the
 * group `Brand` would read zero. Returns the input array when nothing changes; copies only
 * the containers and entries it rewrites.
 */
function alignSplits(containers, groups) {
  if (!Array.isArray(containers) || !Array.isArray(groups) || !groups.length) return containers;
  // Null-prototype maps, and only the eight dimensions: this runs on a save's payload BEFORE
  // it is validated, so a group keyed `__proto__` must not reach an object every other
  // object inherits from.
  var names = Object.create(null);
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    if (!grp || DIM_KEYS.indexOf(grp.dim_key) < 0) continue;
    var name = String(grp.name == null ? '' : grp.name).trim();
    if (!name) continue;
    if (!names[grp.dim_key]) names[grp.dim_key] = Object.create(null);
    if (!has(names[grp.dim_key], fold(name))) names[grp.dim_key][fold(name)] = name;
  }
  var out = null;
  for (var i = 0; i < containers.length; i++) {
    var c = containers[i];
    var kids = (c && Array.isArray(c.dim_children)) ? c.dim_children : null;
    var nextKids = null;
    if (kids) {
      for (var j = 0; j < kids.length; j++) {
        var x = kids[j];
        var byName = x && names[x.dim_key];
        var f = byName ? fold(x.dim_value) : '';
        if (byName && f && has(byName, f) && x.dim_value !== byName[f]) {
          if (!nextKids) nextKids = kids.slice();
          var copy = {};
          for (var k in x) { if (has(x, k)) copy[k] = x[k]; }
          copy.dim_value = byName[f];
          nextKids[j] = copy;
        }
      }
    }
    if (nextKids) {
      if (!out) out = containers.slice();
      var cc = {};
      for (var ck in c) { if (has(c, ck)) cc[ck] = c[ck]; }
      cc.dim_children = nextKids;
      out[i] = cc;
    }
  }
  return out || containers;
}

function bad(reason) { return { ok: false, reason: reason }; }

/**
 * The sentence for a list whose pieces are not what a group is made of, or null. Judged on
 * what was SENT: canon turns everything into text, and a value that is not text (or a
 * number) would otherwise be stored as "[object Object]".
 */
function shapeProblem(raw) {
  if (!Array.isArray(raw)) return 'Value groups must be a list.';
  for (var i = 0; i < raw.length; i++) {
    var g = raw[i];
    if (!g || typeof g !== 'object' || Array.isArray(g)) return 'Value groups must be a list.';
    if (g.name != null && typeof g.name !== 'string' && typeof g.name !== 'number') return 'Value groups must be a list.';
    if (g.values != null && !Array.isArray(g.values)) return 'Value groups must be a list.';
    var values = g.values || [];
    for (var v = 0; v < values.length; v++) {
      if (values[v] != null && typeof values[v] !== 'string' && typeof values[v] !== 'number') {
        return 'A value in group "' + String(g.name == null ? '' : g.name).trim() + '" is not text.';
      }
    }
  }
  return null;
}

/**
 * One line item as it would be stored: { line_item_id, dim_groups, containers }.
 * → { ok: true, groups } (the canon list, [] when the line has none)
 * | { ok: false, reason } — a full sentence, shown as it is by the editor and the 400.
 */
function validateLine(lineItem) {
  var li = lineItem || {};
  var raw = li.dim_groups;
  var absent = raw === undefined;
  if (!absent && !Array.isArray(raw)) return bad('Value groups must be a list.');
  var containers = Array.isArray(li.containers) ? li.containers : [];
  var i, g, v;
  // Before canon turns everything into text.
  var shape = absent ? null : shapeProblem(raw);
  if (shape) return bad(shape);
  var groups = absent ? [] : canon(raw);

  if (groups.length > LIMITS.groupsPerLine) return bad('This line has more than ' + LIMITS.groupsPerLine + ' value groups.');
  for (i = 0; i < groups.length; i++) {
    g = groups[i];
    if (!g || typeof g !== 'object' || Array.isArray(g)) return bad('Value groups must be a list.');
    if (!g.name) return bad('A value group needs a name.');
    if (DIM_KEYS.indexOf(g.dim_key) < 0) return bad('Value group "' + g.name + '": unknown dimension "' + g.dim_key + '".');
    if (g.name.length > LIMITS.name) return bad('Value group name is longer than ' + LIMITS.name + ' characters.');
    if (isReservedToken(g.name) || isReservedName(g.name)) return bad('"' + g.name + '" cannot be used as a group name or value.');
    if (!g.values.length) return bad('Value group "' + g.name + '" has no values.');
    if (g.values.length > LIMITS.values) return bad('Value group "' + g.name + '" has more than ' + LIMITS.values + ' values.');
    for (v = 0; v < g.values.length; v++) {
      if (g.values[v].length > LIMITS.value) return bad('A value in group "' + g.name + '" is longer than ' + LIMITS.value + ' characters.');
      if (isReservedToken(g.values[v])) return bad('"' + g.values[v] + '" cannot be used as a group name or value.');
    }
  }

  // Rules 1–3, per dimension, by fold.
  // Null-prototype maps: the keys are user text (a group may be named `constructor`).
  var nameOwner = Object.create(null);    // dim → folded name → the group's name
  var valueOwner = Object.create(null);   // dim → folded value → the group's name
  for (i = 0; i < groups.length; i++) {
    g = groups[i];
    var dimLabel = labelOf(g.dim_key);
    if (!nameOwner[g.dim_key]) { nameOwner[g.dim_key] = Object.create(null); valueOwner[g.dim_key] = Object.create(null); }
    var nf = fold(g.name);
    if (has(nameOwner[g.dim_key], nf)) {
      return bad('This line already has ' + article(dimLabel) + ' ' + dimLabel + ' group named ' + g.name + '.');
    }
    nameOwner[g.dim_key][nf] = g.name;
    for (v = 0; v < g.values.length; v++) {
      var vf = fold(g.values[v]);
      if (has(valueOwner[g.dim_key], vf)) {
        return bad('"' + String(Array.isArray(raw[i] && raw[i].values) ? rawSpelling(raw[i].values, vf, g.values[v]) : g.values[v])
          + '" is in two ' + dimLabel + ' groups: "' + valueOwner[g.dim_key][vf] + '" and "' + g.name + '".');
      }
      valueOwner[g.dim_key][vf] = g.name;
    }
  }
  for (i = 0; i < groups.length; i++) {
    g = groups[i];
    var owner = has(valueOwner[g.dim_key], fold(g.name)) ? valueOwner[g.dim_key][fold(g.name)] : undefined;
    if (owner !== undefined && owner !== g.name) {
      return bad('Group name "' + g.name + '" is a value of another ' + labelOf(g.dim_key) + ' group ("' + owner + '").');
    }
  }

  // Rules 4 and 7, over the line's dim splits.
  for (var c = 0; c < containers.length; c++) {
    var ctn = containers[c];
    var kids = (ctn && Array.isArray(ctn.dim_children)) ? ctn.dim_children : [];
    var seenExact = Object.create(null);
    var seenFold = Object.create(null);
    for (var j = 0; j < kids.length; j++) {
      var x = kids[j];
      if (!x || x.dim_key == null || x.dim_value == null) continue;
      var value = String(x.dim_value).trim();
      if (!value) continue;
      var dim = x.dim_key;
      var grouped = has(valueOwner, dim);
      var f = fold(value);
      // Rule 4: a member with its own split (the group's own name is the group's split).
      if (grouped && has(valueOwner[dim], f) && !has(nameOwner[dim], f)) {
        return bad('"' + value + '" is in group "' + valueOwner[dim][f] + '" and has its own split in '
          + (ctn.name ? ctn.name : 'a container') + '.');
      }
      // Rule 7: exact after trim on every line; by fold only where the line groups this dimension.
      var exactKey = dim + ':' + value;
      var foldKey = dim + ':' + f;
      if (has(seenExact, exactKey) || (grouped && has(seenFold, foldKey))) {
        return bad('Container "' + (ctn.name || 'Container') + '" has two ' + labelOf(dim) + ' splits on "' + value + '".');
      }
      seenExact[exactKey] = true;
      seenFold[foldKey] = true;
    }
  }

  return { ok: true, groups: groups };
}

/** The spelling the save sent for a folded value (the message quotes what the user typed). */
function rawSpelling(values, folded, fallback) {
  for (var i = 0; i < values.length; i++) {
    if (fold(values[i]) === folded) return values[i];
  }
  return fallback;
}

/**
 * Every line item of a save, the merged ones (after the stored-value back-fill).
 * → { ok: true } | { ok: false, error: 'bad_dim_groups', detail, details: { line_item_id, reason } }
 */
function validateLineItems(lineItems) {
  var list = Array.isArray(lineItems) ? lineItems : [];
  for (var i = 0; i < list.length; i++) {
    var r = validateLine(list[i]);
    if (!r.ok) {
      var id = String((list[i] && list[i].line_item_id) || '');
      // `detail` is the sentence a save's caller shows as it is; `details` its machine half.
      return { ok: false, error: 'bad_dim_groups', detail: 'LI ' + id + ': ' + r.reason,
        details: { line_item_id: id, reason: r.reason } };
    }
  }
  return { ok: true };
}

/**
 * One line item on its way into storage, in place: the list in canon form, an empty list as
 * NO key (a line without groups stores nothing, so a pacing that never used them is
 * byte-identical after a save), and a split spelled like its group under the group's exact
 * name. What is not a well-formed list stays as sent, for validateLine to refuse: a `null`
 * must not clear a stored dictionary on its way through, and a value that is not text must
 * not become text. Returns the same object.
 */
function storeLine(lineItem) {
  if (!lineItem || typeof lineItem !== 'object' || !has(lineItem, 'dim_groups')) return lineItem;
  if (shapeProblem(lineItem.dim_groups)) return lineItem;
  var groups = canon(lineItem.dim_groups);
  if (groups.length === 0) { delete lineItem.dim_groups; return lineItem; }
  lineItem.dim_groups = groups;
  if (Array.isArray(lineItem.containers)) lineItem.containers = alignSplits(lineItem.containers, groups);
  return lineItem;
}

var DimValueGroups = {
  DIM_KEYS: DIM_KEYS,
  DIM_LABELS: DIM_LABELS,
  LIMITS: LIMITS,
  RESERVED_NAMES: RESERVED_NAMES,
  fold: fold,
  canon: canon,
  alignSplits: alignSplits,
  storeLine: storeLine,
  validateLine: validateLine,
  validateLineItems: validateLineItems
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DimValueGroups;
} else {
  root.DimValueGroups = DimValueGroups;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
