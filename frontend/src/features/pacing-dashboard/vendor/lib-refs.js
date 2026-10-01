/**
 * lib-refs.js — the ONE vocabulary for library links (widget-library spec 2026-08-14
 * §3.2/§3.3/§3.4), plus widget-builder v2's §9 discriminator carry (relinkInstance).
 *
 * A tile that came from the Library is an ordinary display.widgets[] entry with a
 * normal `w_` id. What makes it a library tile is one of two small objects:
 *   lib:  { src, key }  — LINKED: no inline definition; the entry IS the definition
 *   from: { src, key }  — DETACHED: a private inline copy that remembers where it
 *                          came from, so it can be pushed back or reset
 * Both sides must agree on those shapes or a save stores something the dashboard
 * cannot render, so the rules live here beside dash-blocks.js and pacing-core.js:
 *   - dash-gate/lib/widgets-validate.mjs decides what may be STORED,
 *   - dash-gate/lib/merge.mjs decides which entries are DELIVERED,
 *   - the workspace decides what is RENDERED.
 * Browser/Vite: globalThis.LibRefs; Node: module.exports.
 *
 * Library identity is deliberately user-only. Standard Widgets are templates:
 * choosing one materializes an inline canonical definition, so no `std:*` key may
 * appear in `lib` or `from`.
 */
(function (root) {
"use strict";

// A Library entry is a PG row and its key is the UUID. Standard template keys are
// owned by shared/std-entries.js and intentionally do not participate in this
// vocabulary.
var USER_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

// JSON.parse gives '__proto__' as an ORDINARY own data property, but assigning it
// into a fresh object goes through Object.prototype's setter and re-parents the
// copy — so a hand-rolled payload could smuggle a whole `scope` (or any field)
// into a shared entry through a copy loop that only checks own keys. Every copy
// loop below skips it; a definition never has a legitimate '__proto__' field.
function copyable(obj, k) { return k !== '__proto__' && has(obj, k); }

function isUserKey(key) { return typeof key === 'string' && USER_KEY_RE.test(key); }

/**
 * SHAPE only — never existence. A ref to an entry that was soft-deleted, or that
 * this server has never heard of, is still a well-formed ref: §3.3 keeps those
 * resolving, and the tile explains itself when they don't.
 * Returns a FRESH {src,key} (unknown keys dropped) or null.
 */
function normRef(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.src === 'user' && isUserKey(v.key)) return { src: 'user', key: v.key };
  return null;
}

/** Every entry key this pacing references, deduped — the client-side twin of the
 *  usage scan's SQL (§3.4) and the input to merge.mjs's libraryEntries fetch. */
function usageRefs(display) {
  var out = [];
  var seen = {};
  var list = (display && Array.isArray(display.widgets)) ? display.widgets : [];
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    var ref = normRef(w && w.lib) || normRef(w && w.from);
    if (!ref || has(seen, ref.key)) continue;
    seen[ref.key] = true;
    out.push(ref.key);
  }
  return out;
}

/**
 * The definition a share stores (§3.2). Two things must go:
 *   - instance identity (`id`, `lib`, `from`) — a definition is not a tile;
 *   - the pacing-bound pins `scope.lis` and `scope.dims`. Line-item ids and
 *     literal dimension values are mined from THIS pacing; on another one they
 *     match nothing and the tile draws a confident zero. `scope.channels` and
 *     `scope.time` stay: a channel is a shared vocabulary, and the time scope is
 *     a property of the widget. `ds:` axes stay too — they are already
 *     shape-validated for shareability and the tile names a missing source.
 * Pure: the caller is holding the live instance, so nothing is mutated.
 */
function stripForShare(widget) {
  var out = {};
  for (var k in widget) {
    if (!copyable(widget, k)) continue;
    if (k === 'id' || k === 'lib' || k === 'from') continue;
    out[k] = widget[k];
  }
  if (has(out, 'scope') && out.scope && typeof out.scope === 'object' && !Array.isArray(out.scope)) {
    var s = {};
    for (var sk in out.scope) if (copyable(out.scope, sk)) s[sk] = out.scope[sk];
    s.lis = null;
    s.dims = null;
    out.scope = s;
  }
  return out;
}

/**
 * Would stripForShare take anything away from THIS widget? Share reads it to
 * decide whether the entry it creates is the same thing the author's own tile
 * shows (§6.1): with pins present the two differ, so re-linking the source
 * instance would silently change it. Empty arrays are not pins — sharing them
 * loses nothing.
 */
function hasPacingPins(widget) {
  var s = widget && widget.scope;
  if (!s || typeof s !== 'object') return false;
  return (Array.isArray(s.lis) && s.lis.length > 0) || (Array.isArray(s.dims) && s.dims.length > 0);
}

function lookup(entries, key) {
  if (!entries || typeof entries !== 'object') return null;
  if (!has(entries, key)) return null;
  var e = entries[key];
  return (e && typeof e === 'object') ? e : null;
}

/**
 * What this tile is, and what to render for it.
 *   'linked'  — follows a library entry; widget = the entry's definition wearing
 *               the instance's id and title
 *   'edited'  — a private copy WITH provenance (detached); widget = the instance
 *   'plain'   — a hand-made custom / preset with no library history at all
 *   'missing' — a lib ref nothing answers; widget is null and the caller renders
 *               the tile's error state (§3.3: never a crash)
 */
function resolveInstance(instance, entries) {
  var id = instance && instance.id;
  var ref = normRef(instance && instance.lib);
  if (!ref) {
    var prov = normRef(instance && instance.from);
    return {
      id: id, state: prov ? 'edited' : 'plain', widget: instance,
      entry: prov ? lookup(entries, prov.key) : null, ref: prov,
    };
  }
  var entry = lookup(entries, ref.key);
  var def = entry && entry.definition;
  if (!def || typeof def !== 'object') {
    return { id: id, state: 'missing', widget: null, entry: null, ref: ref };
  }
  var w = {};
  for (var k in def) if (copyable(def, k)) w[k] = def[k];
  // The INSTANCE owns identity and title. `id` because display.widgetRanges,
  // display.layout.tiles and display.enabled are all keyed by it; `kind` because
  // the grid sizes tiles before anything is resolved (layout-grid KIND_CONSTRAINTS).
  w.id = id;
  w.kind = instance.kind || def.kind;
  var t = (typeof instance.title === 'string' && instance.title.trim()) ? instance.title : null;
  w.title = t || def.title || entry.name || '';
  return { id: id, state: 'linked', widget: w, entry: entry, ref: ref };
}

/** Same order in, resolution out. A malformed widgets key answers []. */
function resolveWidgets(widgets, entries) {
  var list = Array.isArray(widgets) ? widgets : [];
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(resolveInstance(list[i], entries));
  return out;
}

/**
 * Materialize a linked instance into a private copy that remembers where it came
 * from (§1 "Detach from library", and the same move an edit performs implicitly).
 * Returns null when the ref does not resolve — detaching into an EMPTY definition
 * would silently destroy the tile, and the caller must say so instead.
 */
function detachInstance(instance, entries) {
  var r = resolveInstance(instance, entries);
  if (r.state !== 'linked') return null;
  var out = {};
  for (var k in r.widget) if (copyable(r.widget, k)) out[k] = r.widget[k];
  // The title is an instance OVERRIDE (§1a.2), not part of the copied definition:
  // materialize it only when the user actually typed one. Baking the entry's own
  // title in would hand a permanent override back on relink — the tile would then
  // ignore the author's next rename, an override the user never chose.
  // CALLER CONTRACT: a detached copy with no override therefore has NO title key.
  // Its heading comes from the resolution's `entry`, which state 'edited' still
  // carries (`entry.definition.title || entry.name`) — a renderer that reads only
  // `widget.title` will show "Untitled widget".
  var own = (typeof instance.title === 'string' && instance.title.trim()) ? instance.title : null;
  if (own) out.title = own; else delete out.title;
  out.from = { src: r.ref.src, key: r.ref.key };
  return out;
}

/**
 * Put a detached instance back on its entry (§1 "Reset to library version"):
 * the inline definition goes entirely, `from` becomes `lib`. Works on a
 * soft-deleted entry too — rows are retained precisely so this can. Returns null
 * when there is no provenance: a hand-made custom has nothing to go back to.
 * Only a GENUINE title override rides back (detachInstance never bakes one in),
 * so a tile that was never renamed follows the entry's name again.
 */
function relinkInstance(instance) {
  var prov = normRef(instance && instance.from);
  if (!prov) return null;
  // Reset only exists for canonical Widgets. Refusing an incomplete or unknown
  // shape is safer than manufacturing the old absent-profile-as-card fallback and
  // sending a link the canonical validator cannot store.
  if (instance.kind !== 'composite' || instance.schemaVersion !== 2) return null;
  if (['card', 'chart', 'table', 'section'].indexOf(instance.profile) === -1) return null;
  if (instance.datasetType !== 'delivery' && instance.datasetType !== 'deliveryCm360') return null;
  // Key order matches widgets-validate.mjs's canonical linked-instance output.
  var out = {
    id: instance.id, kind: 'composite', lib: prov, profile: instance.profile,
    schemaVersion: 2, datasetType: instance.datasetType
  };
  if (typeof instance.title === 'string' && instance.title.trim()) out.title = instance.title;
  return out;
}

var LibRefs = {
  USER_KEY_RE: USER_KEY_RE,
  isUserKey: isUserKey,
  normRef: normRef,
  usageRefs: usageRefs,
  stripForShare: stripForShare,
  hasPacingPins: hasPacingPins,
  resolveInstance: resolveInstance,
  resolveWidgets: resolveWidgets,
  detachInstance: detachInstance,
  relinkInstance: relinkInstance
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LibRefs;
} else {
  root.LibRefs = LibRefs;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
