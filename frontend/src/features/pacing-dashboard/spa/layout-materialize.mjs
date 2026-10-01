// Copy a saved Layout into independent widget/group instances in either runtime.
import StdEntries from './std-entries.js';
import DashBlocks from './dash-blocks.js';
import { normalizeTiles, compactVertical } from './layout-geometry.mjs';

const { stdEntry, SEED_ID_BY_KEY } = StdEntries;
const CM360_KEY = 'std:v2:third-party';

export function newWidgetId(usedIds) {
  const used = new Set(usedIds || []);
  let id;
  do { id = `w_${Math.random().toString(36).slice(2, 10)}`; } while (used.has(id));
  return id;
}

export function newGroupId(groups) {
  const used = new Set((groups || []).map((g) => g.id));
  let id;
  do { id = `g_${Math.random().toString(36).slice(2, 10)}`; } while (used.has(id) || !DashBlocks.GROUP_ID_RE.test(id));
  return id;
}

/**
 * materializeLayout(entry, display) — the FULL display-cas patch Apply saves
 * (§3.1 full replace; §1a.3 copy-on-add). No curTiles parameter on purpose: a
 * layout REPLACES the arrangement, so the current placement is exactly what
 * does not matter. `display` is read for id-collision avoidance — fresh ids must
 * not collide with the instances being removed in the same save (the save is one
 * patch; old and new ids briefly co-exist in the diff) — and for the auto-add
 * receipts, which the patch carries back with ONE removed; see below.
 *
 * THE CM360 RECEIPT (sections cutover 2026-09-07). An Apply is not a deletion:
 * a chart the rate-type rules once added and this layout does not carry stays
 * gone, because its receipt rides through and applyAutoAdd adds nothing it has
 * a receipt for. «Delivery vs CM360» is the one tile that rule reads wrong. It
 * is not a preference — it exists because the pacing HAS a 3rd-party source —
 * and a layout built from an unconfigured pacing does not carry it (the migration
 * never appends it to a layout entry). Carrying its receipt through a full replace
 * would therefore remove the tile from every configured pacing for good. So the
 * patch hands the receipt back MINUS that key whenever the applied arrangement
 * holds no CM360 widget, and the next load re-adds the tile by the auto-add rule —
 * which follows the pacing's own config, not the layout's. A layout built from a
 * CONFIGURED pacing does carry a CM360 copy — under a fresh id, since the server
 * strips every member's id — so "holds" is judged by the widget's BODY (the views'
 * kind/id sequence of the Standard entry), never by the fixed id alone; with the
 * copy on the page the receipt stays and no second tile is minted. Only that key:
 * every other receipt keeps the standing rule.
 */
const viewSignature = (def) => JSON.stringify(((def && def.spec && Array.isArray(def.spec.views)) ? def.spec.views : [])
  .map((v) => (v && typeof v === 'object' ? [v.kind ?? null, v.id ?? null] : [null, null])));
const CM360_SIGNATURE = viewSignature(stdEntry(CM360_KEY)?.definition);
export function materializeLayout(entry, display) {
  const def = entry.definition;
  const used = new Set((display.widgets || []).map((w) => w.id));
  const widgets = [];
  const tiles = {};
  const idAt = []; // entry widget index → fresh instance id (groups thread through this)
  for (const [id, t] of Object.entries(def.flow || {})) tiles[id] = { ...t };
  def.widgets.forEach((m, i) => {
    // Layout members are inline canonical snapshots: no nested Library or template link.
    const w = { id: newWidgetId(used), ...structuredClone(m.definition) };
    used.add(w.id);
    widgets.push(w);
    idAt[i] = w.id;
    tiles[w.id] = { ...m.tile };
  });
  const groups = [];
  for (const g of def.groups || []) {
    const grp = { id: newGroupId(groups), tileIds: g.members.map((ix) => idAt[ix]), bg: g.bg };
    if (g.title) grp.title = g.title;
    if (g.hideTitle === true) grp.hideTitle = true; // owner 2026-08-16, = materializeBlock
    groups.push(grp);
  }
  // The receipt set, minus the CM360 key when this arrangement does not hold that tile.
  const keepsCm360 = widgets.some((w) => w.id === SEED_ID_BY_KEY[CM360_KEY]
    || (CM360_SIGNATURE && viewSignature(w) === CM360_SIGNATURE));
  const autoAdded = (display.autoAdded || []).filter((k) => keepsCm360 || k !== CM360_KEY);
  return {
    widgets,
    groups,
    // Defensive normalize (the resolveLayout rule for SAVED geometry): a valid
    // entry is already conflict-free, and then both passes are identity.
    layout: { version: 1, tiles: compactVertical(normalizeTiles(tiles)) },
    layoutFrom: entry.id,
    widgetRanges: {}, // every prior instance is gone; dead chip prefs go with it
    autoAdded,
  };
}
