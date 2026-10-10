// workspace/src/lib/settings/third-party-norm.js
//
// Pure dirty-detection fingerprint helpers for the Settings · 3rd Party and
// Mapping tabs (2026-07 CM360 mapping feature, docs/superpowers/specs/
// 2026-07-03-cm360-3rd-party-mapping-design.md). Mirrors the pattern in
// pages/Dashboard/components/Settings/settings-norm.js: a stable
// JSON.stringify of a normalized array, order-insensitive on the axes the
// drawer UI doesn't preserve (campaign order, pair order, override order,
// left.fields order). No React, no DOM, no imports — plain ESM so host
// tests can import it directly, and consumed by SettingsDrawer (Tasks
// 11-12) for baseRef dirty-detection identity.

/**
 * New 3rd-party data block (Settings · Data tab · "+ Add CM360 campaigns").
 * Relocated here from the deleted lib/mapping/mapping-model.js (v1 pairs model,
 * removed with the v1 Mapping tab in Mapping v3 Task 5); this factory is the
 * third_party helper that survived. added_at is a server/save-time stamp, left
 * '' client-side (not faked with a client clock).
 */
// (The block comment above belongs to newThirdPartyBlock, further down.)

/**
 * Display form of a raw CM360 report_name (report scoping, 2026-08-02).
 *
 * The _history prefix is tested FIRST because the plain prefix is its prefix
 * too, and it survives as a visible « (history)» suffix instead of being
 * dropped: without it «…_history Corvel» and «…Corvel» both render «Corvel» —
 * and holding one block on each is exactly the workflow report scoping makes
 * normal. Empty input is the All-reports pseudo-group.
 */
const REPORT_PREFIXES = ['BQ_CM360_Client_Export_history', 'BQ_CM360_Client_Export'];
export function reportLabel(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'All reports';
  for (const p of REPORT_PREFIXES) {
    if (s.startsWith(p)) {
      const rest = s.slice(p.length).trim();
      if (!rest) return s; // nothing left to show — keep the raw value
      return p.endsWith('_history') ? `${rest} (history)` : rest;
    }
  }
  return s;
}

const randId = (prefix) => prefix + Math.random().toString(36).slice(2, 10);
export function newThirdPartyBlock({ campaigns, report, userId } = {}) {
  return {
    id: randId('tp_'),
    type: 'cm360',
    // Report scoping (2026-08-02): the key exists only when a report was chosen.
    // «All reports» blocks must stay key-less so they serialize exactly like the
    // blocks stored before scoping existed (server mirrors this in
    // safeThirdPartyEntry).
    ...(report ? { report_name: report } : {}),
    campaigns: [...(campaigns || [])],
    added_at: '',
    added_by: userId || '',
  };
}

/** Fingerprint of the 3rd-party data-block list (Settings · 3rd Party tab).
 *  report_name folds in as `null` when absent so that scoping an existing block —
 *  the only field that changes — marks the drawer dirty. */
export function normThirdParty(blocks) {
  return JSON.stringify((blocks || []).map(
    (b) => [b.id, b.type, b.report_name ?? null, [...(b.campaigns || [])].sort()],
  ));
}

function cmp3(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * Confirmed-only pairs, fingerprinted as [dimension, left, right, origin,
 * confidence] and sorted by (dimension, left, right). Draft (or any
 * non-'confirmed') pairs are excluded — AI suggestions / in-progress edits
 * must not make the drawer dirty; only what the user confirms is ever saved.
 * origin + confidence ARE included in the tuple: they persist in the saved
 * config (spec §2 `pairs[]` shape), so a re-confirm that only bumps
 * confidence/origin must still be detected as a change.
 */
function normConfirmedPairs(pairs) {
  return (pairs || [])
    .filter((p) => p.status === 'confirmed')
    .map((p) => [p.dimension, p.left, p.right, p.origin, p.confidence])
    .sort(cmp3);
}

/** Row-level overrides, fingerprinted as [placement, line_item_id] and sorted by placement. */
function normOverrides(overrides) {
  return (overrides || [])
    .map((o) => [o.placement, o.line_item_id ?? null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function normMapping(m) {
  return [
    m.id,
    m.name || '',
    m.kind,
    [...((m.left && m.left.fields) || [])].sort(),
    (m.right && m.right.field) ?? null,
    normConfirmedPairs(m.pairs),
    normOverrides(m.overrides),
  ];
}

