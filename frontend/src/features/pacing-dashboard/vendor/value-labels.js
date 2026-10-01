/**
 * value-labels.js — display names for raw values (Settings → Mapping → Display names,
 * spec docs/2026-09-24-display-names.md).
 *
 * A pacing can give a raw conversion action or a raw creative name a readable name:
 * The Trade Desk sends conversion actions as "1", "2", "3", and the owner of the pacing
 * says 1 = "Login Button". Stored in config.data.value_labels:
 *
 *     { conversion_action: [{ raw: '1', label: 'Login Button' }, …],
 *       creative:          [{ raw: 'ad_300x250_v2', label: 'Spring banner' }, …] }
 *
 * The names are applied where a value is SHOWN, never where it is stored or matched: the
 * aux files keep raw values, Primary conversions choices stay raw, CM360 matching reads raw
 * names. Two raw values given one name show as one row, summed.
 *
 * Matching is the rule every reader of these values already uses (PrimaryCvRule.canonNames,
 * the delivery pivot, the dashboard's aux cut): trimmed, then exact. Never case- or
 * space-folded — "Lead" and "lead" are two actions.
 *
 * Runtimes:
 *   - dash-gate validates a save with `validate` (lib/db.mjs) and the settings audit reads it;
 *   - the workspace (`@shared/value-labels`) reads `lookup` in the dashboard engine and the
 *     Mapping editor runs `validate` on its draft, so Save is blocked on what the server refuses;
 *   - shared/pacing-build.js requires it for the Delivery tab's `cv:` columns and creatives;
 *   - shared/source-tabs.js carries its own copy of `lookup`, `labelOf` and `creativeLabelOf`
 *     (it is injected into n8n and cannot require), pinned to this one by
 *     tests/value-labels-test.mjs.
 *
 * ES5 on purpose (var + function), like the other shared UMDs.
 * Browser/Vite: globalThis.ValueLabels; Node: module.exports.
 */
(function (root) {
"use strict";

/** The two kinds of value a pacing can name. */
var FIELDS = ['conversion_action', 'creative'];

/** Names the dashboard already gives its own rows. A value named like one of them would fold
 *  into that row (and render grey as a leftover), so they are refused. */
var RESERVED_LABELS = ['Unclassified', 'Others', 'Other values', 'No value', 'Not covered'];

var MAX_ENTRIES_PER_FIELD = 2000;
var MAX_RAW_LEN = 500;
var MAX_LABEL_LEN = 120;
// Bounds the whole stored value. config_json rides every refresh into the pacing-builder
// job (1 MiB body cap), so the names must stay a small part of it.
var MAX_BYTES = 256 * 1024;

var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

/** The matching key of a raw value: trimmed; '' for null, undefined or blank. */
function keyOf(v) {
  return v == null ? '' : String(v).trim();
}

function isReserved(label) {
  for (var i = 0; i < RESERVED_LABELS.length; i++) if (RESERVED_LABELS[i] === label) return true;
  return false;
}

function byRaw(a, b) { return a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0; }

function utf8Bytes(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Quoted for a sentence a person reads, shortened so a 500-character value stays readable. */
function q(s) {
  return '"' + (s.length > 60 ? s.slice(0, 57) + '…' : s) + '"';
}

var FIELD_WORDS = { conversion_action: 'conversion action', creative: 'creative' };

/** Empty stored shape: both fields present, no names. */
function empty() { return { conversion_action: [], creative: [] }; }

/**
 * The save validator. Returns { ok: true, value } with the canon form, or
 * { ok: false, detail } with a sentence naming the value that was refused.
 *
 * Canon form: both fields present; each entry { raw, label } with both trimmed; an entry
 * with an empty label, or a label equal to its own raw value, is dropped (it names nothing);
 * entries sorted by raw value. `null` clears (the empty shape). Keys other than the two
 * fields are dropped.
 *
 * Refused: a non-object value, a field that is not an array, an entry that is not an object
 * or has a non-string raw/label, a blank raw value, a raw value or label over its length cap,
 * a raw value named twice in one field, a reserved label, more entries than the cap, a
 * stored value over the byte cap.
 */
function validate(value) {
  if (value === null) return { ok: true, value: empty() };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, detail: 'Display names must be an object' };
  }
  var out = empty();
  for (var f = 0; f < FIELDS.length; f++) {
    var field = FIELDS[f];
    var list = hasOwn(value, field) ? value[field] : [];
    if (list == null) list = [];
    if (!Array.isArray(list)) return { ok: false, detail: 'Display names for ' + FIELD_WORDS[field] + 's must be a list' };
    var seen = Object.create(null);
    var kept = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== 'object' || Array.isArray(e)
        || typeof e.raw !== 'string' || (e.label != null && typeof e.label !== 'string')) {
        return { ok: false, detail: 'A ' + FIELD_WORDS[field] + ' display name is malformed' };
      }
      var raw = e.raw.trim();
      var label = e.label == null ? '' : e.label.trim();
      if (!raw) return { ok: false, detail: 'A ' + FIELD_WORDS[field] + ' display name has no value to rename' };
      if (raw.length > MAX_RAW_LEN) {
        return { ok: false, detail: 'The ' + FIELD_WORDS[field] + ' ' + q(raw) + ' is longer than ' + MAX_RAW_LEN + ' characters' };
      }
      if (seen[raw] === true) {
        return { ok: false, detail: 'The ' + FIELD_WORDS[field] + ' ' + q(raw) + ' has two display names' };
      }
      seen[raw] = true;
      if (!label || label === raw) continue;
      if (label.length > MAX_LABEL_LEN) {
        return { ok: false, detail: 'The name for ' + q(raw) + ' is longer than ' + MAX_LABEL_LEN + ' characters' };
      }
      if (isReserved(label)) {
        return { ok: false, detail: q(label) + ' is a name the dashboard uses for its own rows. Choose another name for ' + q(raw) };
      }
      kept.push({ raw: raw, label: label });
    }
    if (kept.length > MAX_ENTRIES_PER_FIELD) {
      return { ok: false, detail: 'At most ' + MAX_ENTRIES_PER_FIELD + ' ' + FIELD_WORDS[field] + ' display names' };
    }
    kept.sort(byRaw);
    out[field] = kept;
  }
  if (utf8Bytes(JSON.stringify(out)) > MAX_BYTES) {
    return { ok: false, detail: 'Display names are too large to store (over 256 KB)' };
  }
  return { ok: true, value: out };
}

/**
 * The reader: raw key → label for one field, or null when the pacing names nothing there.
 * Lenient on purpose — it reads stored config and must never throw: a malformed entry is
 * skipped, the first entry for a raw value wins. The map has no prototype, so a raw value
 * such as "constructor" is an ordinary key.
 */
function lookup(valueLabels, field) {
  var list = valueLabels && typeof valueLabels === 'object' && !Array.isArray(valueLabels)
    && hasOwn(valueLabels, field) ? valueLabels[field] : null;
  if (!Array.isArray(list) || list.length === 0) return null;
  var map = Object.create(null);
  var any = false;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e || typeof e !== 'object') continue;
    var raw = keyOf(e.raw);
    var label = keyOf(e.label);
    // A value named as itself names nothing: validate drops it, and so does the reader, so a
    // count never says "named" about a value nothing renames.
    if (!raw || !label || label === raw || hasOwn(map, raw)) continue;
    map[raw] = label;
    any = true;
  }
  return any ? map : null;
}

/** What a value is shown as: its label when the map names its key, else the value unchanged.
 *  One lookup, no chaining — "1 → 2, 2 → 1" swaps the two names. */
function labelOf(map, value) {
  if (!map) return value;
  var k = keyOf(value);
  return k && hasOwn(map, k) ? map[k] : value;
}

/** A creative's shown name, from its name and its id: the key is the trimmed name, else the
 *  trimmed id — the dashboard's own rule (widget-data.js auxRaw), so a creative known only by
 *  its id can be named. Unnamed: the name unchanged (an id-only creative keeps its blank name). */
function creativeLabelOf(map, name, id) {
  if (!map) return name;
  var k = keyOf(name) || keyOf(id);
  return k && hasOwn(map, k) ? map[k] : name;
}

/** Both fields' maps at once, for a reader that needs both. */
function lookups(valueLabels) {
  return {
    conversion_action: lookup(valueLabels, 'conversion_action'),
    creative: lookup(valueLabels, 'creative')
  };
}

/** How many values are named, per field and in total, for a summary line. */
function counts(valueLabels) {
  var out = { conversion_action: 0, creative: 0, total: 0 };
  for (var f = 0; f < FIELDS.length; f++) {
    var m = lookup(valueLabels, FIELDS[f]);
    var n = 0;
    if (m) for (var k in m) if (hasOwn(m, k)) n++;
    out[FIELDS[f]] = n;
    out.total += n;
  }
  return out;
}

var ValueLabels = {
  FIELDS: FIELDS,
  RESERVED_LABELS: RESERVED_LABELS,
  MAX_ENTRIES_PER_FIELD: MAX_ENTRIES_PER_FIELD,
  MAX_RAW_LEN: MAX_RAW_LEN,
  MAX_LABEL_LEN: MAX_LABEL_LEN,
  MAX_BYTES: MAX_BYTES,
  keyOf: keyOf,
  isReserved: isReserved,
  empty: empty,
  validate: validate,
  lookup: lookup,
  lookups: lookups,
  labelOf: labelOf,
  creativeLabelOf: creativeLabelOf,
  counts: counts
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ValueLabels;
} else {
  root.ValueLabels = ValueLabels;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
