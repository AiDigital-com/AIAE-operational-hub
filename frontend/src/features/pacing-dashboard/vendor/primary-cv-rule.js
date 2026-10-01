/**
 * primary-cv-rule.js — the ONE rule behind primary conversions
 * (spec docs/2026-09-13-primary-conversions.md §1, §8):
 *   - does a line item's own source fetch per-action conversion rows,
 *   - is the pacing switch on, and is it operative,
 *   - which source a line item belongs to (seeding compares line items on one source),
 *   - the canon form of a stored list of conversion action names.
 *
 * Two runtimes must agree or the drawer offers a choice the dashboard ignores:
 *   - dash-gate/lib/merge.mjs publishes data.primary_cv_operative and each line
 *     item's conversionData from this file,
 *   - the Settings drawer runs the same rule on its unsaved draft
 *     (workspace/src/lib/settings/primary-cv-state.js).
 *
 * What the rule describes is the refresh itself: the n8n node "Code: Build BQ Query"
 * keeps a sheet-bound line item out of the BigQuery id list and reads
 * conversions_mart only while data.fetch_conversions is true, and
 * shared/sheet-convert.js emits per-action rows only for a tab's mapped
 * conversion_actions. tests/primary-cv-rule-test.mjs pins both.
 *
 * bindingLineItemIds repeats workspace/src/lib/settings/sheet-source-norm.js
 * (a shared file cannot import workspace code); the same test keeps the two in step.
 *
 * ES5 on purpose (var + function), like the other shared UMDs.
 * Browser/Vite: globalThis.PrimaryCvRule; Node: module.exports.
 */
(function (root) {
"use strict";

/** Line items a sheet binding feeds: one (single shape) or many (split shape),
 *  as strings, first-seen order, no blanks, no repeats. */
function bindingLineItemIds(binding) {
  if (binding && binding.split) {
    var out = [];
    var rules = Array.isArray(binding.split.rules) ? binding.split.rules : [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      var id = String(r && r.line_item_id != null ? r.line_item_id : '');
      if (id && out.indexOf(id) === -1) out.push(id);
    }
    return out;
  }
  return binding && binding.line_item_id ? [String(binding.line_item_id)] : [];
}

/** The data.sheet.tabs[] entry that feeds this line item, or null. */
function sheetBindingFor(liId, data) {
  var id = liId == null ? '' : String(liId);
  if (!id) return null;
  var sheet = data && typeof data === 'object' ? data.sheet : null;
  var tabs = sheet && typeof sheet === 'object' && Array.isArray(sheet.tabs) ? sheet.tabs : [];
  for (var i = 0; i < tabs.length; i++) {
    if (bindingLineItemIds(tabs[i]).indexOf(id) !== -1) return tabs[i];
  }
  return null;
}

/** True when the line item's own source brings per-action conversion rows:
 *  a sheet-bound line item when its tab maps at least one conversion action
 *  (whatever Fetch conversions says), any other line item when
 *  data.fetch_conversions is strictly true. */
function liHasConversionData(liId, data) {
  if (!data || typeof data !== 'object') return false;
  var binding = sheetBindingFor(liId, data);
  if (binding) {
    return Array.isArray(binding.conversion_actions) && binding.conversion_actions.length > 0;
  }
  return data.fetch_conversions === true;
}

/** 'sheet:<sheet_id>' for a sheet-bound line item, 'bq' for every other one. */
function sourceKeyOf(liId, data) {
  var binding = sheetBindingFor(liId, data);
  return binding ? 'sheet:' + String(binding.sheet_id) : 'bq';
}

/** The pacing switch, strict true. Absent, null data or any other value is off. */
function isEnabled(data) {
  return !!(data && typeof data === 'object' && data.primary_cv_enabled === true);
}

/** The switch is on AND at least one of the pacing's line items has conversion data. */
function isOperative(config) {
  var data = config && typeof config === 'object' ? config.data : null;
  if (!isEnabled(data)) return false;
  var lis = Array.isArray(config.line_items) ? config.line_items : [];
  for (var i = 0; i < lis.length; i++) {
    var li = lis[i];
    if (!li || li.line_item_id == null) continue;
    if (liHasConversionData(String(li.line_item_id), data)) return true;
  }
  return false;
}

/** Canon form of a list of conversion action names: trimmed, blank dropped,
 *  repeats dropped (exact match after trim), first-seen order. Non-string
 *  entries are skipped: refusing them is the save validator's job on the raw
 *  payload. A non-array gives []. Always a new array; the input is not touched. */
function canonNames(list) {
  var out = [];
  if (!Array.isArray(list)) return out;
  var seen = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    if (typeof v !== 'string') continue;
    var name = v.trim();
    if (!name || seen[name] === true) continue;
    seen[name] = true;
    out.push(name);
  }
  return out;
}

/** Do this pacing's conversion rows carry their OWN dimension tags (spec §9)? True when
 *  Primary conversions or "Apply dashboard filters to creatives and conversions" is on,
 *  each strict true. BigQuery rows are tagged only when data.fetch_conversions is true as
 *  well (the branch is empty otherwise); sheet rows follow this answer alone. The query node
 *  "Code: Build BQ Query" restates it by hand (it has no injection path) and
 *  tests/primary-cv-rule-test.mjs pins that line; pacing-build.js and the pacing-builder
 *  worker require it. */
function conversionTagsOn(data) {
  return !!(data && typeof data === 'object'
    && (data.primary_cv_enabled === true || data.lens_context === true));
}

var PrimaryCvRule = {
  bindingLineItemIds: bindingLineItemIds,
  sheetBindingFor: sheetBindingFor,
  liHasConversionData: liHasConversionData,
  sourceKeyOf: sourceKeyOf,
  isEnabled: isEnabled,
  isOperative: isOperative,
  canonNames: canonNames,
  conversionTagsOn: conversionTagsOn
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PrimaryCvRule;
} else {
  root.PrimaryCvRule = PrimaryCvRule;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
