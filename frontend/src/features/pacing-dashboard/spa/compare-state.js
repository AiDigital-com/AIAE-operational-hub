// workspace/src/lib/mapping/compare-state.js
//
// Seam 3 of the Delivery x CM360 adapter (spec 2026-08-18 §8.5): which of the
// fourteen states the widget is in, and what the person looking at it can do
// about it. Pure — no fetching, no clock, no React.
//
// The panel's early-return ladder (ThirdPartyPanel.jsx:437-485) is the reference.
// This is a FINER split of it, on purpose: the panel folds "no CM360 rows yet"
// into its transport-failure return, and picks its no-bridge copy off the entity
// count, so a caller cannot ask it which of the two happened. Here every branch
// has a name, and `messageKey` names the copy so the component owns the words.
//
// It is also more than the panel, because a v2 widget can PIN a mapping. §7.7:
// a fixed mapping id that resolves to nothing renders a named disconnected state
// with a repair path, and NEVER quietly substitutes another mapping — a widget
// silently comparing against a different mapping is a wrong answer with no
// symptom.

import { usableMapping } from './compare-dataset.js';

/**
 * The closed state set of §8.5, in the order resolveState below actually asks —
 * the first match wins. Keep the two in step: an entry that reads as a fallback
 * here while the code checks it first is a lie about which state answers.
 */
export const CM360_COMPARISON_STATES = Object.freeze([
  'notConfigured',            // no 3rd-party source on the pacing (sections cutover 2026-09-07)
  'loading',                  // the fetch, or the status probe behind it
  'pendingPull',              // a server-side pull is running
  'emptyCm360',               // the file landed carrying nothing
  'transportFail',            // …and everything else that left us without data
  'fixedMappingMissing',      // a pinned mapping is gone (§7.7)
  'noMapping',                // runtime binding, nothing to bind to
  'missingCreatives',         // creative level without the creatives aux
  'noBridge',                 // a mapping that classifies nothing across
  'invalidDate',              // pivotCompare's assertIsoDate
  'modelError',               // any other projection throw
  'runtimeSelectionFallback', // ↓ the three that still draw numbers
  'stale',
  'ready',
]);

/** The three states that still draw numbers. */
const MODEL_READY = new Set(['runtimeSelectionFallback', 'stale', 'ready']);

/** Copy id per state; null where the state has no sentence (a skeleton, or the widget itself). */
const MESSAGE_KEY = {
  notConfigured: 'noSourceConfigured',
  loading: null,
  pendingPull: 'pullingCm360',
  transportFail: 'pullFailed',
  emptyCm360: 'noCm360Rows',
  fixedMappingMissing: 'fixedMappingMissing',
  noMapping: 'noMappingYet',
  missingCreatives: 'creativesNotFetched',
  noBridge: 'nothingClassified',
  invalidDate: 'unexpectedDateFormat',
  modelError: 'comparisonFailed',
  runtimeSelectionFallback: 'mappingSubstituted',
  stale: 'sourceStale',
  ready: null,
};

/** Where each state sends the person who wants it fixed; null when nothing is theirs to do. */
function repairActionFor(state, choice) {
  switch (state) {
    case 'notConfigured':
      return { kind: 'configureSource', target: 'settings:data' };
    case 'transportFail':
    case 'emptyCm360':
    case 'stale':
      return { kind: 'retryFetch', target: 'settings:data' };
    case 'fixedMappingMissing':
      // The reference is named either way (§7.7). What differs is where it sends
      // you: a picker is a repair only when there is something in it — with no
      // mapping on the pacing at all, "choose another" opens an empty list.
      return choice.available === 0
        ? { kind: 'createMapping', target: 'settings:mapping', missingId: choice.requestedId }
        : { kind: 'chooseMapping', target: 'settings:mapping', missingId: choice.requestedId };
    case 'noMapping':
      return { kind: 'createMapping', target: 'settings:mapping' };
    case 'missingCreatives':
      return { kind: 'enableCreatives', target: 'settings:data' };
    case 'noBridge':
      return { kind: 'buildLibrary', target: 'settings:mapping' };
    default:
      return null;
  }
}

/**
 * Which mapping entity drives the comparison.
 *   {mode:'runtime'} → the viewer's pick while it exists, else the first
 *       dimensions-kind entity; substituting one raises `fallback`.
 *   {mode:'fixed', id} → that id and nothing else (§7.7).
 *
 * → { mode, requestedId, entity, mapping, fallback, available, entities }
 *   `entity` is the chosen dimensions-kind entity; `mapping` is that entity only
 *   when it actually carries a dimensions array — the panel's own split
 *   (ThirdPartyPanel.jsx:205-206), which keeps a malformed entity selectable in
 *   the header while classifying nothing.
 *   `entities` is what the choice was made FROM, in pacing order — the list a
 *   viewer's picker offers, so the rule "only dimensions-kind entities drive the
 *   comparison" is applied once here rather than re-typed beside every control.
 */
export function resolveMappingChoice({
  mappingEntities = null, mappingBinding = null, selectedMappingId = null,
} = {}) {
  const entities = (Array.isArray(mappingEntities) ? mappingEntities : [])
    .filter((e) => e && e.kind === 'dimensions');
  const mode = mappingBinding && mappingBinding.mode === 'fixed' ? 'fixed' : 'runtime';

  if (mode === 'fixed') {
    const id = mappingBinding && mappingBinding.id != null ? String(mappingBinding.id) : '';
    const entity = entities.find((e) => e.id === id) || null;
    return {
      mode, requestedId: id || null, entity, mapping: usableMapping(entity),
      fallback: false, available: entities.length, entities,
    };
  }

  const requestedId = selectedMappingId == null ? null : String(selectedMappingId);
  const picked = requestedId == null ? null : (entities.find((e) => e.id === requestedId) || null);
  const entity = picked || entities[0] || null;
  return {
    mode,
    requestedId,
    entity,
    mapping: usableMapping(entity),
    fallback: requestedId != null && picked == null && entity != null,
    available: entities.length,
    entities,
  };
}

/**
 * resolveCm360ComparisonState({...}) → { state, messageKey, repairAction,
 *                                        mappingChoice, freshness, modelReady }
 *
 * Inputs, and where a caller gets them:
 *   configured                        whether the pacing carries a 3rd-party source at
 *       all (config `third_party[]`); false answers before anything else is looked at
 *   data / loading / error            the third-party data fetch
 *   statusData / statusLoading        the third-party status probe
 *   mappingEntities / mappingBinding / selectedMappingId   → resolveMappingChoice
 *   level / anyBridge                 seam 1's dataset
 *   cm360GroupCount                   seam 1's `cm360Rows.length` — optional; the
 *       raw row count of `data.rows` stands in when it is not given, which differs
 *       only for a file whose rows carry no placement at all
 *   creatives                         the delivery creatives aux (null = not fetched)
 *   freshness                         {fetchedAt, stale} — the CALLER compares the
 *       stamp to a clock, because a clock read is not a pure function; and per §8.3
 *       freshness describes the SOURCE, never the selected window
 *   projectionError                   seam 2's typed throw, or null
 */
export function resolveCm360ComparisonState({
  configured = true,
  data = null, loading = false, error = null,
  statusData = null, statusLoading = false,
  mappingEntities = null, mappingBinding = null, selectedMappingId = null,
  level = 'placement', creatives = null, anyBridge = false,
  cm360GroupCount = null, freshness = null, projectionError = null,
} = {}) {
  const choice = resolveMappingChoice({ mappingEntities, mappingBinding, selectedMappingId });
  const fresh = {
    fetchedAt: (freshness && freshness.fetchedAt != null)
      ? freshness.fetchedAt
      : (data && data.fetched_at != null ? data.fetched_at : null),
    stale: !!(freshness && freshness.stale === true),
  };
  const groups = cm360GroupCount != null
    ? cm360GroupCount
    : (data && Array.isArray(data.rows) ? data.rows.length : 0);

  const state = resolveState({
    configured, data, loading, error, statusData, statusLoading,
    groups, choice, level, creatives, anyBridge, fresh, projectionError,
  });

  return {
    state,
    messageKey: MESSAGE_KEY[state],
    repairAction: repairActionFor(state, choice),
    mappingChoice: choice,
    freshness: fresh,
    modelReady: MODEL_READY.has(state),
  };
}

function resolveState({
  configured, data, loading, error, statusData, statusLoading,
  groups, choice, level, creatives, anyBridge, fresh, projectionError,
}) {
  // ── Nothing to compare AGAINST. The legacy section hid itself here; a widget cannot, so
  //    it says so — and the tile asks this before it fetches, so a pacing with no source
  //    never sees the 404 that used to read as a failed pull.
  if (configured === false) return 'notConfigured';

  // ── Source prerequisites (panel :437-448). Nothing below can be judged until
  //    the CM360 side has actually landed.
  if (loading) return 'loading';
  if (error || !data || groups === 0) {
    if (statusLoading && !data) return 'loading';
    if (statusData && statusData.state === 'pending') return 'pendingPull';
    // Data arrived, no error, and still nothing to compare: the file is empty,
    // which is a different sentence from a pull that failed.
    if (!error && data && groups === 0) return 'emptyCm360';
    return 'transportFail';
  }

  // ── Mapping prerequisites. A pinned mapping that is gone is named, never swapped.
  if (choice.mode === 'fixed' && choice.entity == null) return 'fixedMappingMissing';
  if (choice.entity == null) return 'noMapping';

  // ── Classification prerequisites (panel :453-477).
  if (level === 'creative' && creatives == null) return 'missingCreatives';
  if (!anyBridge) return 'noBridge';

  // ── The projection itself (panel :479-485).
  if (projectionError) {
    return projectionError.kind === 'invalidDate' ? 'invalidDate' : 'modelError';
  }

  // ── Ready, with the two notes that still draw numbers. A substituted mapping
  //    outranks a stale source: it changes WHAT is being compared, not just when.
  if (choice.fallback) return 'runtimeSelectionFallback';
  if (fresh.stale) return 'stale';
  return 'ready';
}
