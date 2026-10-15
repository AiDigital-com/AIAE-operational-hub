// workspace/src/pages/Dashboard/components/Settings/Widgets/LibraryScreen.jsx
//
// The Library — the SECOND SCREEN of the settings drawer (widget-library spec
// §6.2, owner 2026-08-15). Deliberately not full-screen: the drawer's side-panel
// placement keeps the dashboard visible, so every Add materializes on the pacing
// live behind it, and an overlay would hide exactly that feedback.
//
// THREE SHELVES: Standard, Shared, Mine. The Standard route decorates the exact
// `std:v2:*` catalog with likes and usage; Shared and Mine are user Library rows.
// Standard never becomes link identity: Add resolves its exact bundled catalog key
// and deep-clones that definition into an ordinary inline Widget. Shared carries
// team entries only; Mine carries both visibilities, and a private one wears the
// Only me chip (spec 2026-09-04). The ROUTE owns that predicate, like every other.
//
// A WIDGET Add rides the drawer's DRAFT, like the preset chips it replaced: the
// instance list belongs to the drawer's Save, and an immediate widget-set write from
// inside an open drawer would persist whatever else is unsaved beside it. A BLOCK Add
// and a LAYOUT Apply are the opposite on purpose (T10): both are arrangement
// decisions — widgets, groups and layout land in ONE display-cas save — so they are
// gated on a CLEAN drawer draft (casEnabled) instead of riding a dirty one.
//
// Search results and their likes/usage live in THIS screen's state. The store's
// `libraryEntries` map is only the UUID resolution map for this pacing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../store.js';
import { toast } from '../ui/Toast.jsx';
import ConfirmModal from '../ConfirmModal.jsx';
import TileMenu from '../ui/TileMenu.jsx';
import { useApi } from '../useApi.js';
// Two translators, and the difference is the SUBJECT: the library's own actions
// (load, remove, like, the visibility flip) answer for a library entry and read the
// code's words, while the two display-cas saves below can be refused over a widget
// the server can name, so they read the shared cas translator (which prefers that
// sentence).
import { saveErrorText, casFailureText } from '../save-error.js';
import { withWriter, libraryAddBlocked } from '../report-v2.js';
import { WIDGET_CAP, libraryInstance } from '../widget-ops.js';
import { SEED_ID_BY_KEY } from '../std-catalog.js';
import { materializeBlock } from '../group-ops.js';
import { layoutPreviewModel } from '../layout-preview.js';
import { materializeLayout } from '../layout-ops.js';
import {
  reconcileLibraryList, reconcileLibraryVisibility,
} from '../library-reconcile.js';
import { useDashboardStore } from '../store.js';
import { useStoreActions } from '../store.js';
// THE `display.enabled` write path (one copy for every surface that flips a tile) — the Add
// below reaches it for the one case a fixed id can inherit: a switch left behind by the tile
// that used to hold that id.
import { useEnabledSwitch } from './useEnabledSwitch.js';
import { currentTiles } from './current-tiles.js';
import { MiniPreview } from './WidgetGallery.jsx';

// [key, label, hint] — the hint is the empty state, so a shelf can never be blank
// with no explanation.
const SHELVES = [
  ['standard', 'Standard', 'Nothing matches: clear the search to see the standard widgets.'],
  ['shared', 'Shared', 'Nothing shared yet: be the first to share a widget with the team.'],
  ['mine', 'Mine', 'Nothing shared yet: share a widget from its card in the gallery.'],
];

const SORTS = [['usage', 'Usage'], ['likes', 'Likes']];

// The kind filter row (owner Q5, 2026-08-16): the SAME three shelves, one more
// axis. The ROUTE owns the predicate (GET /library ?kind=…), so the shelf and
// the filter can never disagree — 'all' simply sends no param.
const KINDS = [
  ['all', 'All'],
  ['widget', 'Widgets'],
  ['block', 'Blocks'],
  ['layout', 'Layouts'],
];

// How long the search box waits before it asks the server. DECISION (Task 11): the
// GET is deliberately not rate-bucketed, so a request per keystroke would work —
// it would just be a dozen scans of the pacings table to answer one word. 250 ms
// is short enough that the list feels typed-into and long enough that a word costs
// one request. Enter skips the wait entirely (see the field below).
const SEARCH_DEBOUNCE_MS = 250;

/** FNV-1a → base36, 6 chars. Not cryptographic: it only has to make 28 templates and a
 *  few hundred user entries distinct inside one rendered list. */
function hash36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(6, '0').slice(-6);
}

// The two cas actions' grid vocabulary (T10) — currentTiles: the CURRENT
// placement as a tiles map, shared with the Groups section since the
// post-release UX round (current-tiles.js). materializeBlock computes the
// band's row from THIS, never from display.layout.tiles.

/**
 * The Apply confirm's copy — honest about what is destroyed, counts BOTH sides,
 * and never implies an undo (§3.1: Apply replaces the arrangement after an
 * explicit confirm; the removal is unrecoverable unless the previous
 * arrangement was shared as a layout first).
 */
function applyConfirmMessage(entry) {
  const arriving = (entry.definition?.widgets || []).length;
  const removed = (useDashboardStore.getState().display?.widgets || []).length;
  // "WIDGET switch settings": functional-block switches SURVIVE an Apply — the
  // server's dead-widget sweep drops only w_ ids, and the patch never carries
  // enabled{} — so the copy must not claim more than the sweep destroys.
  return `This replaces your current arrangement: ${arriving} ${arriving === 1 ? 'tile arrives' : 'tiles arrive'}, `
    + `${removed} ${removed === 1 ? 'tile is' : 'tiles are'} removed. Widget switch settings and period chips reset.`;
}

/**
 * The remove confirm's copy — honest about BOTH halves of the server's soft
 * delete (§3.3). The catalog half: listLibrary filters `deleted_at IS NULL`,
 * so the entry leaves every shelf for everyone. The pacing half: the ROW is
 * retained — getLibraryEntriesByIds delivers soft-deleted rows into every
 * dashboard body, and resolveInstance never reads `deleted_at` — so a linked
 * tile keeps rendering the last shared version, and block/layout adds minted
 * inline copies that never referenced the row again. Nothing says "missing".
 */
const REMOVE_MESSAGE = 'Removes it from the library for everyone. Pacings that already added it keep their tiles.';

/**
 * The confirm an ADMIN meets before taking a colleague's entry off the team's
 * shelf (2026-09-04). Spec §4 grants the flip one click and no confirm, and that
 * is right on your OWN card, where the way back is the same item in the same
 * menu. On a colleague's card there is no way back at all: a private entry is on
 * no shelf an admin can reach (§2), so the one click is a one-way trip and gets
 * the question the Remove beside it has always asked for less.
 */
const makePrivateMessage = (entry) =>
  `Only ${entry.owner_name} will find it in the library. It leaves your shelves too, so you cannot put it back. Pacings that already added it keep their tiles.`;

/**
 * The widget a block member's thumbnail draws. Block members are self-contained
 * snapshots; no template or user Library resolver participates in their preview.
 */
function memberPreviewWidget(entry, m, i) {
  const def = m.definition;
  if (!def) return null;
  return {
    ...def,
    id: `w_pv${hash36(`${entry.id}:m${i}`)}`,
    title: def.title || entry.definition?.title || entry.name,
  };
}

/**
 * The block card's preview: the group's own MAT — the grp-* tint tokens, defined
 * for both themes — framing up to three member thumbnails, with an honest +N
 * chip for the rest. Card-with-preview everywhere (§6): never a plain list.
 * Members render through the ONE preview machinery (MiniPreview, which already
 * sits behind DeferredMount — the perf rule).
 */
function BlockPreview({ entry }) {
  const all = entry.definition?.members || [];
  const members = useMemo(
    () => all.slice(0, 3).map((m, i) => memberPreviewWidget(entry, m, i)),
    // Keyed on the version stamp, like the widget card's memo: search keystrokes
    // answer with freshly parsed rows, and a new widget object per letter would
    // remount every member chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry.id, entry.updated_at],
  );
  const hidden = all.length - members.length;
  return (
    <div className={`lib-prevblock grp-${entry.definition?.bg || 'slate'}`} aria-hidden="true">
      {members.map((w, i) => (
        <div key={i} className="lib-prevb-m">
          {w
            ? <MiniPreview widget={w} />
            : <div className="wgal-prev wgal-prev--gone">Not in this build</div>}
        </div>
      ))}
      {hidden > 0 && <span className="lib-prevmore">+{hidden}</span>}
    </div>
  );
}

/**
 * The layout card's preview: a STATIC schematic (the functional-block thumbnail
 * precedent) — absolutely-positioned divs scaled from the entry's saved
 * geometry. Flow rows as slim bars, sized tiles as blocks, group areas tinted
 * with their own grp-* tokens. Pure CSS, no live mounts, drawn from
 * entry.definition in one memo.
 */
/** The silhouette inside a widget box: stat blocks, a sparkline, table rows, a ring,
 *  two bars — told apart by shape and one accent, never by text (spec 2026-09-03
 *  layout-preview). Pure spans and one inline SVG; no renderer. */
function layoutGlyph(kind) {
  if (kind === 'layout' || kind === 'kpi') {
    const n = kind === 'layout' ? 5 : 4;
    return <span className="lp-stats">{Array.from({ length: n }, (_, i) => <i key={i} className="lp-stat" />)}</span>;
  }
  if (kind === 'chart') {
    return (
      <>
        <i className="lp-ttl" />
        <svg viewBox="0 0 100 24" preserveAspectRatio="none">
          <path d="M0 20 L14 15 L28 17 L42 9 L56 12 L70 6 L84 8 L100 3 L100 24 L0 24 Z" fill="var(--accent)" fillOpacity=".12" />
          <path d="M0 20 L14 15 L28 17 L42 9 L56 12 L70 6 L84 8 L100 3" fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
      </>
    );
  }
  if (kind === 'table') return <><i className="lp-hdr" /><i className="lp-rows" /></>;
  if (kind === 'pie') return <><i className="lp-pie" /><i className="lp-pie-rows" /></>;
  if (kind === 'compare') return <span className="lp-bars"><i /><i /></span>;
  return null;
}

/** The layout card's preview: the pure model (layout-preview.js) drawn as absolutely
 *  positioned spans — section bands, widget boxes with a silhouette by kind, group
 *  frames behind them, and a fade when the layout runs past the box. Static, no
 *  live mounts; memoized on the version stamp like the other card previews. */
function LayoutPreview({ entry }) {
  const model = useMemo(
    () => layoutPreviewModel(entry.definition || {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry.id, entry.updated_at],
  );
  const box = (t) => ({
    left: `calc(${t.left}% + ${t.gutterLeft || 0}px)`,
    width: `calc(${t.width}% - ${(t.gutterLeft || 0) + (t.gutterRight || 0)}px)`,
    top: `${t.top}px`,
    height: `${t.height}px`,
  });
  return (
    <div className="lib-prevlayout" aria-hidden="true">
      <div className="lib-prevl-c">
        {/* Group frames first — they paint BEHIND the tiles, exactly as the real
            frames paint behind the real tiles. */}
        {model.groups.map((g, i) => (
          <span key={`g${i}`} className={`lib-prevl-g grp-${g.bg}`} style={box(g)} />
        ))}
        {model.tiles.map((t) => (
          <span key={t.id} className={t.flow ? 'lib-prevl-f' : `lib-prevl-w lp-k-${t.kind}`} style={box(t)}>
            {t.flow ? null : layoutGlyph(t.kind)}
          </span>
        ))}
      </div>
      {model.overflow && <div className="lib-prevl-fade" />}
    </div>
  );
}

/**
 * One catalog card — the ONE card language for all three kinds (§6: always a
 * card with a preview). A widget card previews the definition itself; a block
 * card the tinted mat with its members; a layout card the arrangement
 * schematic. Its own component so the preview widget is memoized per entry:
 * MiniPreview mounts a real renderer behind DeferredMount, and rebuilding the
 * widget object on every keystroke in the search box would remount every chart.
 */
function LibraryCard({
  entry, addedCount, canAdd, capReason, widgetCount,
  casEnabled, casReason, casBusy, onAdd, onAddBlock, onApplyLayout, onLike,
  canManage, onFlipVisibility, onRemove,
}) {
  const kind = entry.kind === 'block' || entry.kind === 'layout' ? entry.kind : 'widget';
  // The cap, honest for a band: a block Add lands ALL its members at once.
  const blockAtCap = kind === 'block'
    && widgetCount + (entry.definition?.members || []).length > WIDGET_CAP;
  // The protocol door blocks only definitions from a future canonical version. The
  // button stays visible with the reason instead of failing after the add request.
  const noAdd = libraryAddBlocked(entry);
  // A definition has no id (it is not a tile), and the renderers key their data by
  // one. A stable synthetic id derived from the entry keeps the preview's memo
  // stable across re-renders without colliding with a real instance.
  //
  // Keyed on `updated_at`, NOT on `entry.definition`: every search keystroke and
  // every sort flip answers with freshly parsed rows, so the definition is a new
  // object each time while being the same widget — and that would hand the chart
  // renderer a new `widget` prop, and a full recharts re-render, on every letter
  // typed. `updated_at` is the version stamp: it moves when, and only when, the
  // author pushes a change.
  const previewWidget = useMemo(
    () => ({
      ...entry.definition,
      // A digest of the ENTIRE id: every Standard chart shares a long prefix, while
      // user entries are UUIDs. The preview id must distinguish both sets.
      id: `w_pv${hash36(String(entry.id))}`,
      // The heading the preview should wear (`definition.title || entry.name`). It is
      // NOT cosmetic: a share deletes the definition's title on purpose, so the
      // entry name governs everywhere — and without this the thumbnail's own frame
      // fell back to the literal words "Untitled widget" on EVERY card, directly
      // above the card's correct name. The gallery's cards have never done that
      // (resolveInstance writes the name onto the resolved widget); this is the
      // same rule, applied where there is no instance to resolve.
      title: entry.definition?.title || entry.name,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry.id, entry.updated_at, entry.name],
  );
  return (
    <div className="lib-card">
      {kind === 'block' ? <BlockPreview entry={entry} />
        : kind === 'layout' ? <LayoutPreview entry={entry} />
        : <MiniPreview widget={previewWidget} />}
      <div className="lib-card-b">
        <div className="lib-card-row">
          <span className="lib-card-name" title={entry.name}>{entry.name}</span>
          {/* The kind chip (Q5): a badge on the top row — never a stripe. Widget
              cards stay bare; the mixed "All" list is where the chip earns it. */}
          {kind !== 'widget' && (
            <span className="lib-kind">{kind === 'block' ? 'Block' : 'Layout'}</span>
          )}
          {/* Only me (spec 2026-09-04): the same chip language beside the kind
              one, never a stripe. Drawn off the entry itself rather than off the
              shelf — a private entry is only ever your own, and only Mine lists
              it, so the fact travels with the row wherever it is shown. */}
          {entry.visibility === 'private' && (
            <span className="wgal-badge" title="Only you see this in the library">Only me</span>
          )}
          <button
            type="button"
            className={`lib-like${entry.liked ? ' lib-like--on' : ''}`}
            aria-pressed={!!entry.liked}
            aria-label={entry.liked ? `Unlike ${entry.name}` : `Like ${entry.name}`}
            title={entry.liked ? 'You like this' : 'Like this entry'}
            onClick={() => onLike(entry)}
          >
            <i className={entry.liked ? 'ri-heart-fill' : 'ri-heart-line'} aria-hidden="true" />
            <span className="lib-like-n">{entry.likes}</span>
          </button>
          {/* Standard templates are bundled and immutable. User rows expose the two
              owner actions only where the server's owner/admin predicate would
              allow them — the SAME rule for both (spec 2026-09-04 §4). */}
          {canManage && (
            <TileMenu
              label={`Entry actions: ${entry.name}`}
              items={[
                // One click, no confirm on your OWN card: the flip carries no content
                // and the way back is the same item in the same menu. The label names
                // the ACTION, so it reads off the state the card is in — and off WHOSE
                // card it is: an admin flipping a colleague's entry hands it to its
                // AUTHOR alone, not to themselves, so it must not say "only me". That
                // one is also a one-way trip — a private entry is on no shelf an admin
                // can reach — so it wears the ellipsis and asks first, exactly like the
                // Remove below it. The screen owns the question (see onFlipVisibility);
                // both read `entry.mine`, so the promise and the behaviour cannot drift.
                // The visibility flip is NOT offered here: this app has no "only me" entries,
                // every entry is visible to everyone (owner decision 2026-10-14).
                { key: 'remove', label: 'Remove from library…', danger: true,
                  onSelect: () => onRemove(entry) },
              ]}
            />
          )}
        </div>
        <div className="lib-card-meta">
          <span className="lib-card-by">{entry.owner_name}</span>
          {/* A Standard Add materializes an inline copy with no template identity, so the
              server has no usage to count and answers 0; «0 pacings» would read as unused. */}
          {!entry.standard && (
            <span className="lib-card-use">{entry.usage === 1 ? '1 pacing' : `${entry.usage} pacings`}</span>
          )}
        </div>
        {entry.description && <span className="lib-card-desc">{entry.description}</span>}
        <div className="lib-card-row">
          {/* Three actions, one slot. A widget Add rides the drawer DRAFT; a
              block Add and a layout Apply are display-cas SAVES (T10) — gated
              on a clean drawer and no live layout session, and a refused card
              says WHY in its title. */}
          {kind === 'layout' ? (
            /* Reason precedence, the same on all three buttons here and on the two
               Duplicate gates (DashGrid, WidgetGallery): the PERMANENT reason leads. A cap
               is freed by deleting a tile and a busy drawer by closing it, so either of
               them shown over "reports arrive later" invites a click that would fail
               anyway — and the v2 sentence is still true once the temporary one is gone. */
            <button
              type="button" className="sp-btn sp-btn-p lib-add"
              disabled={!casEnabled || casBusy || !!noAdd}
              title={noAdd || (!casEnabled ? casReason : 'Replaces this dashboard’s whole arrangement')}
              onClick={() => onApplyLayout(entry)}
            >
              Apply
            </button>
          ) : kind === 'block' ? (
            <button
              type="button" className="sp-btn sp-btn-p lib-add"
              disabled={!casEnabled || casBusy || blockAtCap || !!noAdd}
              title={noAdd || (!casEnabled ? casReason : blockAtCap ? capReason : undefined)}
              onClick={() => onAddBlock(entry)}
            >
              Add
            </button>
          ) : (
            <button
              type="button" className="sp-btn sp-btn-p lib-add"
              disabled={!canAdd || !!noAdd}
              title={noAdd || (canAdd ? undefined : capReason)}
              onClick={() => onAdd(entry)}
            >
              Add
            </button>
          )}
          {/* User entries retain identity, so their affirmation counts live instances.
              Standard templates deliberately have no identity to count after Add. */}
          {addedCount > 0 && <span className="lib-added">Added ×{addedCount}</span>}
        </div>
      </div>
    </div>
  );
}

/** A Standard entry with a fixed id is added under it while no live widget holds it: that is
 *  what lets the grid rank it by slot (tile-slots.js) and the migration recognise it. A second
 *  copy, or a user entry, takes a random id as ever. */
function fixedIdFor(entry, list) {
  const id = entry && entry.standard ? SEED_ID_BY_KEY[entry.key] : undefined;
  return id && !list.some((w) => w && w.id === id) ? id : undefined;
}

export default function LibraryScreen({
  onBack, display, onChange, casEnabled = false, casReason = null, onCasSaved,
}) {
  const { slug } = useParams();
  const { mergeLibraryEntries, saveSettings } = useStoreActions();
  // Standard is the shelf that is never empty, and it is where the preset chips went
  // (§6.1) — so it is what opens.
  const [shelf, setShelf] = useState('standard');
  // The kind filter (Q5): a second axis over the same shelves. 'all' at open —
  // the filter narrows, it never hides the catalog by default.
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('usage');
  const [q, setQ] = useState('');        // what is TYPED
  const [term, setTerm] = useState('');  // what is SEARCHED
  const [entries, setEntries] = useState(null);   // null = never loaded
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);        // a request is in flight
  // Every list GET gets a generation. A successful visibility write advances it
  // before patching the current shelf, so a GET that began against the old server
  // state cannot overwrite the write when it answers later. listRefresh starts a
  // new GET after the write; that genuinely later read remains authoritative.
  const listGenerationRef = useRef(0);
  const [listRefresh, setListRefresh] = useState(0);
  // A visibility request begins on one shelf and may answer on another. Read the
  // shelf at response time rather than retaining the shelf where the click began.
  const shelfRef = useRef(shelf);
  shelfRef.current = shelf;
  // ONE cas save at a time: two concurrent display-cas writes would race each
  // other's display_rev, and the loser's toast would blame "someone else".
  const [casBusy, setCasBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(null); // the layout entry | null
  const [confirmRemove, setConfirmRemove] = useState(null); // the entry to remove | null
  const [removeBusy, setRemoveBusy] = useState(false);
  // A COLLEAGUE's entry an admin is about to take off the team's shelf | null.
  // Your own flip never lands here — see onFlipVisibility.
  const [confirmPrivate, setConfirmPrivate] = useState(null);
  const [flipBusy, setFlipBusy] = useState(false);
  // The viewer, for the owner-or-admin gate on Remove — the same cached GET the
  // card menu's Push gate reads (WidgetLinkMenu), deduped for 30 s.
  const { data: me } = useApi(() => api.me(), [], { cacheKey: 'me' });

  // The debounce, and only the debounce, lives here: `term` is what the fetch below
  // depends on, so a keystroke does not rebuild the request at all until it settles.
  // Clearing the box is instant — waiting a quarter second to see everything again
  // reads as lag, not as care.
  useEffect(() => {
    if (q === term) return undefined;
    const t = setTimeout(() => setTerm(q), q ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [q, term]);

  // The route owns shelf search and sort, so there is one definition of
  // "matches" and one of "order" — not a server sort with a client filter on top,
  // which is how two orderings start disagreeing.
  // `alive` is the stale-answer guard: a slow request for "imp" must not overwrite
  // the fast one for "impr" that replaced it. The cleanup runs before the next
  // request starts, so the loser can only be the one that was already abandoned.
  useEffect(() => {
    let alive = true;
    const requestGeneration = ++listGenerationRef.current;
    const current = () => alive && requestGeneration === listGenerationRef.current;
    setBusy(true);
    (async () => {
      try {
        const res = await api.library.list({
          sort, shelf, ...(kind !== 'all' ? { kind } : {}), ...(term ? { q: term } : {}),
        });
        if (!current()) return;
        setEntries((cur) => reconcileLibraryList(
          cur, res.entries || [], requestGeneration, listGenerationRef.current,
        ));
        setError(null);
      } catch (err) {
        if (!current()) return;
        setError(saveErrorText(err, 'Could not load the library'));
      } finally {
        if (current()) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [term, sort, shelf, kind, listRefresh]);

  const widgets = Array.isArray(display?.widgets) ? display.widgets : [];
  const atCap = widgets.length >= WIDGET_CAP;
  // The switch lane, for the fixed-id Add below. `isOn` reads the LIVE store (this screen's
  // `display` is the drawer draft, whose `enabled` is frozen at open by design) and the
  // updater re-pushes that draft after the save, exactly as the gallery's own switches do.
  const { isOn, setOn } = useEnabledSwitch(onChange);
  // How many tiles on this pacing already reference a user entry. Derived from the DRAFT,
  // so it survives closing and reopening the screen, drops back on Discard, and
  // tells the truth about an entry that was added in an earlier session. A block
  // Add mints private copies carrying `from` provenance (§3.4), not a link — the
  // ×N counts both, the same pair the server's usage scan counts.
  const countAdded = useCallback(
    (entryId) => widgets.filter((w) => w.lib?.key === entryId || w.from?.key === entryId).length,
    [widgets],
  );

  /**
   * Add appends one independent Widget to the drawer draft. A user entry becomes a
   * UUID link; a Standard template becomes a deep-cloned inline definition. Geometry is not set here:
   * resolveLayout places an unplaced id through placeNew on the next render, which
   * is the same path a preset chip takes.
   *
   * The cap is re-checked INSIDE the updater as well as before it: this screen can
   * be open at 39 widgets while a preset is added on the gallery behind it — the
   * same race WidgetGallery's addWidget already handles.
   */
  const onAdd = useCallback((entry) => {
    if (atCap) { toast(`Widget cap reached (${WIDGET_CAP})`, 'error'); return; }
    // Only user rows enter the resolver store. A Standard definition is cloned inline
    // by libraryInstance and retains neither `lib` nor `from`.
    if (!entry.standard) mergeLibraryEntries({ [entry.id]: entry });
    // A fixed id can arrive with someone else's OFF switch on it. `withWidgetRemoved`
    // deliberately does not carry `enabled` (a client never sends that map in a widget-set
    // patch — the server sweeps the dead entry on the one save that proves the widget is
    // gone), and a tile deleted and re-added INSIDE one drawer session never crosses such a
    // save: the id would come back invisible, its gallery switch off. So the switch is
    // cleared here, on the same view-pref lane every other switch writes on, and only when
    // it is really off — an unnecessary write is a save nobody asked for.
    const fixed = fixedIdFor(entry, widgets);
    if (fixed && !isOn(fixed)) void setOn(fixed, true);
    onChange((cur) => {
      const list = Array.isArray(cur.widgets) ? cur.widgets : [];
      if (list.length >= WIDGET_CAP) return cur;
      return { ...cur, widgets: [...list, libraryInstance(entry, list.map((w) => w.id), fixedIdFor(entry, list))] };
    });
    // No local counter: countAdded above reads the draft, so the affirmation
    // updates from the same source the dashboard behind the drawer renders from.
  }, [atCap, onChange, mergeLibraryEntries, widgets, isOn, setOn]);

  /* Both cas saves below read `casFailureText`, imported above. It was a local function
     here until the History screen's Restore became the third display-cas save (spec
     2026-09-03); it moved to save-error.js word for word. */

  /**
   * Add (block) — a DISPLAY-CAS SAVE, never a draft edit (§6.2 + §1a.3): a band
   * is an arrangement decision — its widgets, its fresh group and their tiles
   * land in ONE save — and the drawer's Save never carries layout/groups. The
   * casEnabled gate (a clean drawer draft AND no live layout session, computed
   * by the drawer) is what makes the store's display the persisted truth this
   * save builds on.
   */
  const onAddBlock = useCallback(async (entry) => {
    if (!casEnabled || casBusy) return;
    const storeDisplay = useDashboardStore.getState().display || {};
    const curWidgets = Array.isArray(storeDisplay.widgets) ? storeDisplay.widgets : [];
    const members = (entry.definition?.members || []).length;
    // The at-the-cap race (WidgetGallery's addWidget rule): re-checked at click,
    // and against everything a block lands at once.
    if (curWidgets.length + members > WIDGET_CAP) {
      toast(`Widget cap reached (${WIDGET_CAP})`, 'error');
      return;
    }
    // The CURRENT placement FIRST (T9's contract) — resolveLayout over the live
    // display; materializeBlock computes the band's row from it.
    const curTiles = currentTiles(storeDisplay);
    const m = materializeBlock(entry, storeDisplay, curTiles);
    // The BLOCK entry must reach the store: the copies carry `from` pointing at
    // it, and provenance resolution (state 'edited' headings, the T8 kind gates)
    // needs the entry BEFORE the next full load. It is never merged as a widget
    // definition for tiles — the copies are inline; this feeds provenance only.
    mergeLibraryEntries({ [entry.id]: entry });
    setCasBusy(true);
    const t = toast('Adding block…', 'pending');
    try {
      // Adding a block IS an arrangement decision, so a seed-null layout becomes
      // explicit here: the band's row was computed against the placement on
      // screen (curTiles), and only an explicit layout keeps it there.
      // §7.5 writer marker: a block lands v2 widgets like any other, and an undeclared
      // client is refused (v2_writer_required) the moment one of them is a v2 copy.
      await saveSettings(slug, withWriter({
        display: {
          widgets: [...curWidgets, ...m.widgets],
          groups: [...(storeDisplay.groups || []), m.group],
          layout: { version: 1, tiles: { ...curTiles, ...m.tiles } },
        },
        display_rev: Number(useDashboardStore.getState().displayRev ?? 0),
      }, useDashboardStore.getState().capabilities));
      t.update(`“${entry.name}” added to the dashboard`, 'success');
      // The drawer re-bases its draft + baselines on the store's fresh display —
      // without this the stale draft would ride the next live-preview push and
      // silently wipe the band off the store.
      onCasSaved?.('add');
    } catch (err) {
      t.update(casFailureText(err, 'Could not add this block'), 'error');
    } finally {
      setCasBusy(false);
    }
  }, [casEnabled, casBusy, slug, saveSettings, mergeLibraryEntries, onCasSaved]);

  /**
   * Apply (layout) — the destructive one (§3.1 full replace), reached ONLY
   * through the ConfirmModal below: one cas save of materializeLayout's whole
   * patch. Apply merges nothing into the resolution map — the fresh copies are
   * inline and nothing references the layout entry at render time.
   */
  const doApplyLayout = useCallback(async (entry) => {
    if (!casEnabled || casBusy) return;
    const patch = materializeLayout(entry, useDashboardStore.getState().display || {});
    setCasBusy(true);
    const t = toast('Applying layout…', 'pending');
    try {
      // §7.5 writer marker: a full replace REMOVES every widget the arrangement drops,
      // and a removed v2 tile is a v2 change the server refuses from an old client.
      await saveSettings(slug, withWriter({
        display: patch,
        display_rev: Number(useDashboardStore.getState().displayRev ?? 0),
      }, useDashboardStore.getState().capabilities));
      t.update(`“${entry.name}” applied`, 'success');
      setConfirmApply(null);
      // The drawer re-bases and then CLOSES — the new arrangement is the point.
      onCasSaved?.('apply');
    } catch (err) {
      t.update(casFailureText(err, 'Could not apply this layout'), 'error');
      // The confirm closes on failure too: the toast carries the next step
      // (a stale rev means reload — retrying the same confirm cannot succeed).
      setConfirmApply(null);
    } finally {
      setCasBusy(false);
    }
  }, [casEnabled, casBusy, slug, saveSettings, onCasSaved]);

  /**
   * Remove (own entries, or any user entry as admin) — the server's soft delete
   * (DELETE /api/library/:id, §3.3), reached only through the ConfirmModal
   * below. The `updated_at` CAS stamp travels with it, so a delete over a
   * version this list has not seen answers `stale_entry` in words instead of
   * silently clobbering it.
   *
   * Success touches the CATALOG alone: `entries` is this screen's state and the
   * shelf's only source, so the filter IS the live update. The store's
   * resolution map is deliberately untouched — the row is retained on the
   * server precisely so every tile that already links the entry keeps
   * resolving, and evicting it client-side would break those tiles this
   * session while the next full load quietly fixed them.
   */
  const doRemove = useCallback(async (entry) => {
    setRemoveBusy(true);
    try {
      await api.library.remove(entry.id, entry.updated_at, useDashboardStore.getState().capabilities);
      setEntries((cur) => (cur || []).filter((e) => e.id !== entry.id));
      toast(`“${entry.name}” removed from the library`, 'success');
    } catch (err) {
      toast(saveErrorText(err, 'Could not remove this entry'), 'error');
    } finally {
      // Closed on failure too: a stale stamp means this list is outdated, and
      // retrying the same confirm cannot succeed — the toast carries the next step.
      setConfirmRemove(null);
      setRemoveBusy(false);
    }
  }, []);

  /**
   * Who sees the entry (spec 2026-09-04 §4) — one PUT, no confirm and no CAS
   * stamp: the flip is a two-state write that carries no content, so there is
   * nothing a concurrent push could clobber and nothing to be stale about.
   *
   * The list patch touches `visibility` and NOTHING else: usage, likes and the
   * `mine` flag on this row are still true, and re-seating the whole row from the
   * answer would blank the decorations only the catalog route computes. The one
   * exception is the Shared shelf, which lists live `team` rows only — an entry
   * just made private is no longer one of them, so it leaves the list the way a
   * removed one does, instead of sitting there until the next read drops it.
   *
   * The store's resolution map is left alone, like Remove leaves it: nothing that
   * renders a tile reads `visibility`, so a copy of it there cannot go stale in a
   * way anyone can see.
   */
  const doFlipVisibility = useCallback(async (entry) => {
    const asked = entry.visibility === 'private' ? 'team' : 'private';
    setFlipBusy(true);
    try {
      const res = await api.library.setVisibility(
        entry.id, asked, useDashboardStore.getState().capabilities,
      );
      const now = res?.entry?.visibility || asked;
      // Invalidate every GET started before this completed write, then reconcile
      // the shelf visible NOW. A fresh GET follows so server order/decorations win
      // once it answers; this local patch covers the interval without losing them.
      listGenerationRef.current += 1;
      setEntries((cur) => reconcileLibraryVisibility(cur, shelfRef.current, entry, now));
      setBusy(false);
      setListRefresh((n) => n + 1);
      // The toast tells the truth about WHOSE entry moved, for the same reason the
      // menu label does: on a colleague's card only its author keeps it.
      toast(now === 'private'
        ? (entry.mine ? 'Now only you see it' : 'Now only its author sees it')
        : 'Now visible to the team', 'success');
    } catch (err) {
      toast(saveErrorText(err, 'Could not change who sees this entry'), 'error');
    } finally {
      // Closed on failure too, like the remove confirm: the toast carries the next
      // step, and a second press of the same button cannot answer a 403 or a 404.
      setConfirmPrivate(null);
      setFlipBusy(false);
    }
  }, []);

  /**
   * What the ⋯ item actually presses. Your own card flips on the click, exactly as
   * spec §4 asks. A COLLEAGUE's entry going private asks first: that direction is
   * one-way for an admin (a private entry is on no shelf they can reach, §2), and
   * an irreversible action taken on someone else's work with one unconfirmed click
   * is what the Remove beside it has always refused to be. The other direction
   * needs no question: it puts the entry back on Shared, where it can be flipped
   * again.
   */
  const onFlipVisibility = useCallback((entry) => {
    if (!entry.mine && entry.visibility !== 'private') { setConfirmPrivate(entry); return; }
    doFlipVisibility(entry);
  }, [doFlipVisibility]);

  const onLike = useCallback(async (entry) => {
    // Optimistic: a like is one click and a round trip would make the heart lag.
    // The answer carries the true count, so the reconcile is exact rather than a
    // guess, and a failure puts the card back where it was.
    const before = { liked: entry.liked, likes: entry.likes };
    const next = { liked: !entry.liked, likes: entry.likes + (entry.liked ? -1 : 1) };
    setEntries((cur) => (cur || []).map((e) => (e.id === entry.id ? { ...e, ...next } : e)));
    try {
      const res = entry.liked ? await api.library.unlike(entry.id) : await api.library.like(entry.id);
      setEntries((cur) => (cur || []).map((e) => (e.id === entry.id ? { ...e, liked: res.liked, likes: res.likes } : e)));
    } catch (err) {
      setEntries((cur) => (cur || []).map((e) => (e.id === entry.id ? { ...e, ...before } : e)));
      toast(saveErrorText(err, 'Could not save that like'), 'error');
    }
  }, []);

  const shelfHint = (SHELVES.find(([k]) => k === shelf) || SHELVES[0])[2];
  // The empty state, kind-aware: Standard stays widgets-only in v1 (owner Q5),
  // and that shelf under the Blocks/Layouts filter must say so honestly instead
  // of borrowing the search hint. A filtered Shared/Mine shelf points at where
  // blocks and layouts come from.
  const emptyText = term ? 'No entries match that search.'
    : shelf === 'standard' && (kind === 'block' || kind === 'layout')
      ? 'Standard entries are widgets only; blocks and layouts live on Shared and Mine.'
    : kind === 'block' ? 'No blocks yet: group tiles in Layout mode and share the group.'
    : kind === 'layout' ? 'No layouts yet: share an arrangement from Layout mode.'
    : shelfHint;

  return (
    <section className="sp-sect">
      {/* The SAME head the Widget Builder uses — .wgf-back is the drawer's
          second-screen Back button, and two back affordances
          that look different on one tab would read as two different kinds of
          "back". Only the row is new. */}
      <div className="lib-head">
        <button type="button" className="wgf-back" title="Back to the gallery"
          aria-label="Back to the gallery" onClick={onBack}>‹</button>
        <span className="sp-sect-t lib-head-t">Library</span>
      </div>

      <div className="lib-controls">
        {/* Same pill primitive AND same ARIA as the hero variant picker in
            BlockLibrary: a radiogroup, not a tablist. A `tab` without a
            `tabpanel` to point at is an ARIA pattern with its other half missing,
            and this is a one-of-N filter — which is what a radiogroup is. */}
        <div className="blib-pills" role="radiogroup" aria-label="Library shelf">
          {SHELVES.map(([key, label]) => (
            <button
              key={key} type="button" role="radio" aria-checked={shelf === key}
              className={`blib-pill${shelf === key ? ' blib-pill--on' : ''}`}
              onClick={() => setShelf(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* The kind filter (Q5): the SAME pill primitive and the same ARIA as
            the shelf row beside it — two one-of-N filters on one baseline. */}
        <div className="blib-pills" role="radiogroup" aria-label="Entry kind">
          {KINDS.map(([key, label]) => (
            <button
              key={key} type="button" role="radio" aria-checked={kind === key}
              className={`blib-pill${kind === key ? ' blib-pill--on' : ''}`}
              onClick={() => setKind(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* .sp-inp is the drawer's field class; --sans because it is mono by
            default, and a search box of prose should not read as code. A <select>
            takes the same class — the house pattern. Enter searches at once, the
            same "Enter commits" reflex every one-field dialog on this tab has. */}
        <input
          className="sp-inp sp-inp--sans lib-search" type="search" value={q}
          placeholder="Search by name or author"
          aria-label="Search the library"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setTerm(q); } }}
        />
        <label className="lib-sort">
          <span className="lib-sort-l">Sort</span>
          <select className="sp-inp sp-inp--sans lib-sort-s" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>

      {/* ABOVE the cards, not at the bottom of the screen: it is the answer to
          "what just happened when I pressed Add". One short line (hint-noise
          pass, 2026-08-16) — the two write lanes, and nothing else. */}
      <div className="blib-hint lib-note">
        Widgets land with Save; blocks and layouts save immediately.
      </div>

      {error && <div className="lib-empty">{error}</div>}
      {!error && entries === null && <div className="lib-empty">Loading the library…</div>}
      {!error && entries && entries.length === 0 && (
        <div className="lib-empty">{emptyText}</div>
      )}

      {/* A refetch DIMS the list it is replacing rather than clearing it: the
          answer to "Usage or Likes" is a re-ordering of cards the reader is
          already looking at, and blanking the grid for 80 ms throws the page
          height around and loses their place. aria-busy says the same thing to a
          reader who cannot see the dimming. Only the FIRST load has nothing to
          show, and that one gets the Loading box above. */}
      {!error && entries && entries.length > 0 && (
        <div className={`lib-cards${busy ? ' lib-cards--busy' : ''}`} aria-busy={busy}>
          {entries.map((entry) => (
            <LibraryCard
              key={entry.id} entry={entry} addedCount={entry.standard ? 0 : countAdded(entry.id)}
              canAdd={!atCap} capReason={`Widget cap reached (${WIDGET_CAP})`}
              widgetCount={widgets.length}
              casEnabled={casEnabled} casReason={casReason} casBusy={casBusy}
              onAdd={onAdd} onAddBlock={onAddBlock}
              onApplyLayout={(e) => setConfirmApply(e)} onLike={onLike}
              // The client reading of the server's own predicate (library.mjs
              // `AND ($3 OR owner_id = $4)`): the wire row's `mine` flag, or the
              // admin role. Standard templates never reach these server-side
              // actions. Remove and the visibility flip share it — the delete's
              // rule is the flip's rule (spec 2026-09-04 §4).
              canManage={!entry.standard && (entry.mine || me?.role === 'admin')}
              onFlipVisibility={onFlipVisibility}
              onRemove={(e) => setConfirmRemove(e)}
            />
          ))}
        </div>
      )}

      {/* The destructive confirm (§3.1): Apply replaces the arrangement, and the
          copy says exactly what is destroyed — counted on BOTH sides, no undo
          implication. Red confirm: this is the one library action that removes. */}
      {confirmApply && (
        <ConfirmModal
          title={`Apply “${confirmApply.name}”?`}
          message={applyConfirmMessage(confirmApply)}
          confirmLabel="Apply"
          loading={casBusy}
          onConfirm={() => doApplyLayout(confirmApply)}
          onCancel={() => setConfirmApply(null)}
        />
      )}

      {/* The remove confirm — red like every removal, and honest about the soft
          delete's two halves (see REMOVE_MESSAGE). */}
      {confirmRemove && (
        <ConfirmModal
          title={`Remove “${confirmRemove.name}” from the library?`}
          message={REMOVE_MESSAGE}
          confirmLabel="Remove"
          loading={removeBusy}
          onConfirm={() => doRemove(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {/* The admin's one-way flip asks first (see makePrivateMessage). Accent, not
          red: it destroys nothing — the author keeps the entry and every pacing
          keeps its tiles — it is only unreachable from here afterwards. */}
      {confirmPrivate && (
        <ConfirmModal
          title={`Make “${confirmPrivate.name}” private?`}
          message={makePrivateMessage(confirmPrivate)}
          confirmLabel="Make it private"
          confirmColor="var(--accent)"
          loading={flipBusy}
          onConfirm={() => doFlipVisibility(confirmPrivate)}
          onCancel={() => setConfirmPrivate(null)}
        />
      )}
    </section>
  );
}
