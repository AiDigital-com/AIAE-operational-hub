// workspace/src/pages/Dashboard/components/Settings/Widgets/WidgetGallery.jsx
//
// Display-tab widget management (spec §6; mock view 2): the custom-widget GALLERY
// (2-col cards with LIVE mini-previews — the real renderers, non-interactive) and
// "+ Add widget" (kind picker → editor sub-view). All edits ride the parent's
// localDisplay via onChange; the drawer's unified Save/Reset/dirty machinery applies.
//
// Standard templates are added from the Library's Standard shelf as inline canonical
// Widgets. There is no second template-minting path in this gallery.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ConfirmModal from '../ConfirmModal.jsx';
// Switch lives in its own module: importing it from BlockLibrary would close a
// BlockLibrary → WidgetGallery cycle. useEnabledSwitch is the ONE display.enabled
// write path, shared with the functional-block cards and the dashboard tile menu.
import Switch from './Switch.jsx';
import { useEnabledSwitch } from './useEnabledSwitch.js';
import { useLibraryEntries, useResolvedWidgets } from '../store.js';
import { hasSwitch } from '../display-blocks.js';
import { linkBadge, splitByLibraryState, tileTitle } from '../library-refs.js';
import { copyWidget, withWidgetRemoved, newWidgetId, WIDGET_CAP } from '../widget-ops.js';
// The library LINK LAYER — the card's ⋯, its dialogs and the edit gate. Its own
// module since phase 3: none of it is about cards, presets or the editor.
import { useLibraryLink } from './WidgetLinkMenu.jsx';
import WidgetBuilder from '../builder/ReportBuilder.jsx';
import { mintWidgetDraft } from '../builder/widget-drafts.js';
import GroupsSection from './GroupsSection.jsx';
import ReportWidget from '../report/ReportWidget.jsx';
import { isFutureWidget, FUTURE_VERSION } from '../report-v2.js';
import { validateReportDraft } from '../report-draft.js';
import { DeferredMount } from '../tile-registry.jsx';

// Scratch choices are authoring input, never persisted discriminators. Every one mints the
// same canonical v2 envelope and opens the same Builder.
const STARTS = {
  blank: (ids) => mintWidgetDraft({ id: newWidgetId(ids), start: 'blank' }),
  chart: (ids) => mintWidgetDraft({ id: newWidgetId(ids), start: 'chart' }),
  table: (ids) => mintWidgetDraft({ id: newWidgetId(ids), start: 'table' }),
  kpi: (ids) => mintWidgetDraft({ id: newWidgetId(ids), start: 'kpi' }),
  pie: (ids) => mintWidgetDraft({ id: newWidgetId(ids), start: 'pie' }),
  compare: (ids) => mintWidgetDraft({ id: newWidgetId(ids), start: 'compare' }),
};

/**
 * A composite thumbnail is a transform-SCALED miniature of the real render
 * (post-release UX round, 2026-08-16). The clamp-only approach (`compact` +
 * `maxHeightPx`) could not hold REAL content: a three-column hero with
 * production numbers (366,359-wide figures, long labels) crushed its columns
 * inside a ~300px card until chips sat half outside their frames. Here the tile
 * lays out at its natural profile width and shrinks as a PICTURE — layout
 * happens at full size, so no length of number or label can collide, whatever
 * the card or member-cell width. The box measures itself (ResizeObserver: the
 * drawer resizes), the inner render is clamped to the box's scaled height, and
 * the container clips; pointer events are already dead on the whole thumbnail
 * (.wgal-prev).
 */
const PREVIEW_DESIGN_W = {
  section: 1160,
  card: 560,
  chart: 1160,
  table: 1160,
};
function ScaledPreview({ widget }) {
  const boxRef = useRef(null);
  const inRef = useRef(null);
  const [box, setBox] = useState(null);       // {w,h} of the thumbnail CELL (.wgal-prev)
  const [innerH, setInnerH] = useState(null); // content height, NATURAL px
  useLayoutEffect(() => {
    // The CELL is measured, not this div: DeferredMount wraps its children in an
    // unstyled auto-height div, so nothing between the fixed-height .wgal-prev
    // and here has a height of its own to inherit.
    const cell = boxRef.current?.closest('.wgal-prev');
    if (!cell) return undefined;
    const measure = () => {
      const r = cell.getBoundingClientRect();
      setBox((cur) => (cur && cur.w === r.width && cur.h === r.height ? cur : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cell);
    return () => ro.disconnect();
  }, []);
  // The content's own height (offsetHeight ignores the transform — natural px):
  // a SHORT composite shrinks the wrapper to its scaled height, so the cell's
  // centring works instead of pinning a small miniature to the top of a void.
  useLayoutEffect(() => {
    const el = inRef.current;
    if (!el) return undefined;
    const measure = () => setInnerH((cur) => (cur === el.offsetHeight ? cur : el.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);   // the inner exists only once the cell is measured
  const designW = PREVIEW_DESIGN_W[widget.profile] || PREVIEW_DESIGN_W.section;
  const scale = box && box.w > 0 ? box.w / designW : null;
  const height = scale == null ? undefined
    : Math.min(box.h, innerH != null ? Math.ceil(innerH * scale) : box.h);
  return (
    <div ref={boxRef} className="wgal-scaled" style={{ height }}>
      {scale != null && (
        <div ref={inRef} className="wgal-scaled-in" style={{ width: designW, transform: `scale(${scale})` }}>
          {/* THE dispatch, the miniature's copy (P2 decision 1): a v2 report draws as
              ITSELF inside the same transform-scale wrapper — same design width by
              profile, same clamp — because a card must show what the tile shows.
              Rendering one through the legacy composite path drew an empty frame. */}
          <ReportWidget widget={widget} preview maxHeightPx={Math.ceil(box.h / scale)} />
        </div>
      )}
    </div>
  );
}

// Exported for the Library screen's catalog cards (Task 11): ONE preview
// machinery for both card grids, so a thumbnail can never render one way here and
// another there — and both stay behind DeferredMount.
export function MiniPreview({ widget }) {
  const minHeight = widget.profile === 'card' ? 60 : 128;
  return (
    <div className="wgal-prev" aria-hidden="true">
      <DeferredMount minHeight={minHeight} rootMargin="300px 0px">
        {isFutureWidget(widget)
          ? <div className="wgal-prev--gone">{FUTURE_VERSION}</div>
          : <ScaledPreview widget={widget} />}
      </DeferredMount>
    </div>
  );
}

/**
 * ONE gallery card: the thumbnail of what the tile DRAWS, its name, its kind, its
 * link badge, its switch and its actions. Its own component because the gallery
 * around it holds three sub-views and the link layer's dialogs, and the card is
 * the part that gets read and changed most.
 *
 * It renders and reports; it never edits. `w` is the raw INSTANCE and `r` its
 * library resolution — both read-only here — and every action is a callback the
 * gallery owns, because they all ride the drawer's DRAFT. `menu` is the link
 * control, built by the gallery for the same reason.
 */
export function WidgetCard({ w, r, on, busy, atCap, onToggle, onEdit, onDuplicate, onDelete, menu }) {
  // What this card DRAWS. Null only for a library ref nothing answers — the card
  // still lists the tile so it can be deleted or reset.
  const drawn = r?.widget;
  // What it is CALLED: a detached copy usually carries no title of its own (§1a.2),
  // so the name lives on its library entry — and this is the same name the
  // dashboard tile prints (tileTitle).
  const title = tileTitle(r, w);
  // Linked / Edited (§6.1). A pill in the meta row, never a rail, and null for a
  // hand-made widget or a broken ref — the first has no library story and the
  // second explains itself in the preview box. The ENTRY rides along (T8): a
  // copy whose `from` names a BLOCK entry is fresh, not "Edited", and the badge
  // answers by kind.
  const badge = linkBadge(r?.state, r?.entry);
  // A ref nothing answers: there is no definition to edit and none to copy.
  // Editing would write fields the resolver ignores (the `lib` still wins) and
  // copying would put a SECOND unavailable tile on the dashboard, so both say why
  // instead of failing quietly.
  const gone = r?.state === 'missing';
  // A future-version row has no editor in this bundle. Every supported widget opens the
  // same builder; a broken linked instance is still handled by `gone` above.
  const subject = drawn || w;
  const noEdit = isFutureWidget(subject) ? FUTURE_VERSION : null;
  const noCopy = isFutureWidget(subject) ? FUTURE_VERSION : null;
  return (
    // Off looks the same here as on a functional-block card — quiet tint, dimmed
    // preview. One visual language for one state (spec §6).
    <div className={`wgal-card wgal-widget-card${on ? '' : ' wgal-card--off'}`} data-widget-id={w.id}>
      <div className="wgal-meta">
        <div className="wgal-identity">
          <span className="wgal-title" title={title}>{title}</span>
          {/* MiniPreview is a non-interactive picture, hidden from assistive
              technology. Its future-version refusal must also remain readable. */}
          {noEdit && <span className="sr-only">{noEdit}</span>}
          {(badge || !on) && (
            <span className="wgal-status">
              {badge && <span className="wgal-badge" title={badge.title}>{badge.label}</span>}
              {!on && <span className="wgal-badge" title="Not shown on the dashboard">Off</span>}
            </span>
          )}
        </div>
        <div className="wgal-card-controls">
          {/* Same gate as the block cards: an id enabled{} may not carry gets no
              control, instead of exposing a write the closed grammar would refuse. */}
          {hasSwitch(w.id) && (
            <Switch on={on} label={title} disabled={busy} onChange={onToggle} />
          )}
          <div className="wgal-acts">
            <button type="button" className="wgal-edit" disabled={gone || !!noEdit}
              title={gone ? 'Nothing to edit: this tile’s library entry is unavailable'
                : noEdit || 'Edit'}
              onClick={onEdit}>Edit</button>
            {menu([
              // Copy the resolved definition with its displayed name. Deletion still
              // targets the original instance through the gallery's existing callback.
              { key: 'duplicate', label: 'Duplicate', disabled: gone || atCap || !!noCopy,
                title: gone ? 'Nothing to copy: this tile’s library entry is unavailable'
                  : noCopy || (atCap ? `Widget cap reached (${WIDGET_CAP})` : undefined),
                onSelect: () => onDuplicate({ ...(drawn || w), title }) },
              { key: 'delete', label: 'Delete', danger: true, onSelect: onDelete },
            ])}
          </div>
        </div>
      </div>
      <div className="wgal-preview-frame">
        {drawn
          ? <MiniPreview widget={drawn} />
          : <div className="wgal-prev wgal-prev--gone">Library entry unavailable</div>}
      </div>
    </div>
  );
}

export default function WidgetGallery({
  display, onChange, onEditingChange, onDraftInvalidChange, onWidgetDraftInvalidChange,
  openWidgetId, savedEpoch, savedDisplay, submittedDisplayRef, onOpened, draftCm360Configured,
  resetEpoch = 0,
  // A request to leave an open editor ({ close: true, nonce }): a block's own settings
  // were asked for from a tile (spec 2026-10-01). It goes through backFromEditor, so a
  // dirty or invalid draft still gets its confirm, and a cancelled confirm keeps the editor.
  editorRequest = null,
  // The display-cas gate and its re-base callback, for the Groups section's Rename and
  // Ungroup (spec 2026-09-03 group-card): computed by the drawer, threaded through here
  // exactly as BlockLibrary threads them to the Library screen.
  casEnabled = false, casReason = null, onCasSaved,
}) {
  const [view, setViewRaw] = useState({ mode: 'list' });   // {mode:'list'|'pick'|'edit', id?}
  // The Builder owns the current form. An incomplete canonical draft is deliberately NOT a
  // member of display.widgets: that array feeds the dashboard, debounce lane and outer Save.
  // Once strict validation succeeds, the compiled value is mirrored there while the richer
  // editor-local draft remains the object Preview receives.
  const [builderDraft, setBuilderDraft] = useState(null);
  const builderDraftRef = useRef(null);
  const editorEntryRef = useRef(null); // {id, widget|null, index, initialDraft}
  // Every confirm on this tab holds { widget, title }: the raw INSTANCE it acts on
  // and the name that instance wears on screen. Never one object with the title
  // merged in — the link layer's writers read `widget.title` as the user's own
  // override (§1a.2), so handing them a widget wearing its library entry's name
  // would store an override nobody typed. Delete keeps the shape for one message.
  const [confirmDelete, setConfirmDelete] = useState(null);      // {widget,title} | null
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The editor takes over the WHOLE tab (spec §6 / mock view 3) — the parent hides
  // its sibling sections while a widget is being edited.
  const setView = (v) => {
    setViewRaw(v);
    onEditingChange?.(v.mode === 'edit');
    // Leaving the editor always clears the invalid-draft Save block — drafts die
    // with their fields (the editor confirms discarding them on Back).
    if (v.mode !== 'edit') {
      onDraftInvalidChange?.(false);
      onWidgetDraftInvalidChange?.(null);
    }
  };

  // Structural draft validation and an uncommitted FormulaField error are different
  // states. The former belongs to the Builder (for example, Blank has no views yet); the
  // latter belongs to the drawer-wide formula guard. Mixing both into one boolean made a
  // pristine Blank widget claim that a formula was broken.
  const structuralProblem = (validation) => (
    validation && !validation.ok
      ? (validation.errors?.[0]?.error || 'the current Widget draft is not savable yet')
      : null
  );
  useEffect(() => () => onWidgetDraftInvalidChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const holdDraft = (draft) => {
    builderDraftRef.current = draft;
    setBuilderDraft(draft);
  };

  const clearDraft = () => {
    builderDraftRef.current = null;
    editorEntryRef.current = null;
    setBuilderDraft(null);
    setConfirmDiscard(false);
  };

  // A widget's on/off switch is view state (spec §4): immediate, alone, through the
  // merge lane — NOT part of the drawer's draft, which is why the hook reads the
  // live store and not the `display` prop. Same lane, same guard, same wording as
  // the functional-block cards above it in BlockLibrary.
  const { isOn, setOn, isBusy } = useEnabledSwitch(onChange);

  // Library entries this pacing references — the same map the tiles resolve
  // through, so the menu's gating and the card's rendering read one source.
  const libEntries = useLibraryEntries();

  const widgets = display.widgets || [];
  // Preset tiles are LISTED too (round 11: "renamable" had no UI path — the cards
  // are where rename/delete live). Their definition stays read-only in the editor.
  const galleryWidgets = widgets;
  // Cards preview what the tile ACTUALLY renders — for a linked instance that is
  // the library entry's definition, so an author's push is visible here too.
  // The DRAFT's widget list, not the store's: this list is `display`, the drawer's
  // unsaved draft, and the store only learns it 200 ms later (and never after a
  // drawer Reset). Resolving the store's list would show a just-duplicated card as
  // "Library entry unavailable" until the debounce fired. The ENTRIES still come
  // from the store — they are server truth, and no draft owns them.
  const resolved = useResolvedWidgets(widgets);
  // Byte budget readout appears once the config is heavy enough to matter (>200 KB
  // of the 400 KB server cap — see widgets-validate LIMITS.displayBytes).
  const displayKb = (() => {
    try { return Math.round(new TextEncoder().encode(JSON.stringify(display)).length / 1000); }
    catch { return 0; }
  })();
  // Functional all the way down (round 11): same-tick patches from sibling formula
  // fields compose instead of clobbering each other via stale snapshots.
  const patchWidgets = (next) => onChange((cur) => ({
    ...cur,
    widgets: typeof next === 'function' ? next(cur.widgets || []) : next,
  }));

  // The library link layer (spec §1, §6.1) — its own module since it is 45% of what
  // this tab does and none of it is about cards, presets or the editor. It owns the
  // ⋯ menu, the five dialogs behind it, and the edit gate.
  const { linkMenuFor, readyToEdit, dialogs } = useLibraryLink({
    resolved, libEntries, patchWidgets, onEditReady: (id) => setView({ mode: 'edit', id }),
  });

  /* custom widget ops */
  // Newborn snapshots (UX round): "Add → Back" with ZERO edits must leave nothing
  // behind — the untouched skeleton is removed silently on Back instead of shipping
  // a "New chart" to every viewer on the next Save.
  const newbornRef = useRef(new Map());
  const savedEpochRef = useRef(savedEpoch);
  useEffect(() => {
    if (savedEpochRef.current === savedEpoch) return;
    savedEpochRef.current = savedEpoch;
    // Only the successful request's snapshot is committed. The live display and
    // Builder may already contain newer edits, or a different newborn created
    // while that request was in flight. Neither becomes saved with its response.
    const persisted = savedDisplay?.widgets || [];
    for (const widget of persisted) newbornRef.current.delete(widget.id);
    const entry = editorEntryRef.current;
    const index = entry ? persisted.findIndex((widget) => widget.id === entry.id) : -1;
    if (index !== -1) {
      const widget = structuredClone(persisted[index]);
      editorEntryRef.current = { id: widget.id, widget, index, initialDraft: JSON.stringify(widget) };
    }
    // Do not replace builderDraft: its newer edits and Undo history stay local.
  }, [savedEpoch, savedDisplay]);
  // Drawer Reset (`resetEpoch` bumps, `display` is already the restored draft). The
  // builderDraft above outranks `display`, so without this the editor kept the discarded
  // edits and wrote them back on the next patch. The editor stays open on the restored
  // widget with a fresh Undo history (the Builder is keyed on the epoch below); it closes
  // only when there is nothing editable left: a widget Reset removed, or one that is
  // linked again (the detach that made it editable was part of what Reset undid).
  const resetEpochRef = useRef(resetEpoch);
  useEffect(() => {
    if (resetEpochRef.current === resetEpoch) return;
    resetEpochRef.current = resetEpoch;
    const id = builderDraftRef.current?.id;
    if (view.mode !== 'edit' || !id) return;
    const index = widgets.findIndex((w) => w.id === id);
    const state = resolved.get(id)?.state;
    if (index === -1 || state === 'linked' || state === 'missing') {
      newbornRef.current.delete(id);
      clearDraft();
      setView({ mode: 'list' });
      return;
    }
    const widget = widgets[index];
    editorEntryRef.current = { id, widget, index, initialDraft: JSON.stringify(widget) };
    holdDraft(widget);
    setConfirmDiscard(false);
    onWidgetDraftInvalidChange?.(structuralProblem(validateReportDraft(widget)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetEpoch]);
  const addWidget = (kind) => {
    // The pick screen can be reached at 39 and a preset added meanwhile (round 10):
    // re-check the cap at the moment of creation, not only on the entry buttons.
    if (widgets.length >= WIDGET_CAP) { setView({ mode: 'list' }); return; }
    const w = STARTS[kind](widgets.map((x) => x.id));
    const validation = validateReportDraft(w);
    newbornRef.current.set(w.id, JSON.stringify(w));
    editorEntryRef.current = {
      id: w.id, widget: null, index: widgets.length, initialDraft: JSON.stringify(w),
    };
    holdDraft(w);
    // A SAFETY NET, not a live branch: since the four section templates moved to the
    // Library's Standard shelf (sections cutover 2026-09-07) every start on this screen is
    // a skeleton that validateReportDraft refuses at creation — a blank draws no view, a
    // chart no series, a table no column — so a new widget reserves only its id/capacity
    // slot here and enters the pending display later, from patchBuilderDraft, the moment
    // the Builder has made it valid. A start that IS complete would still be right to add.
    if (validation.ok) patchWidgets((ws) => [...ws, { ...w, spec: validation.normalized }]);
    onWidgetDraftInvalidChange?.(structuralProblem(validation));
    setView({ mode: 'edit', id: w.id });
  };

  const restoreEditorEntry = () => {
    const entry = editorEntryRef.current;
    if (!entry) return;
    if (entry.widget == null) {
      patchWidgets((ws) => ws.filter((w) => w.id !== entry.id));
    } else {
      patchWidgets((ws) => {
        const without = ws.filter((w) => w.id !== entry.id);
        const at = Math.max(0, Math.min(entry.index, without.length));
        return [...without.slice(0, at), entry.widget, ...without.slice(at)];
      });
    }
  };

  const leaveEditor = (id, { discard = false } = {}) => {
    if (discard) restoreEditorEntry();
    newbornRef.current.delete(id);
    clearDraft();
    setView({ mode: 'list' });
  };

  const backFromEditor = (id) => {
    const draft = builderDraftRef.current;
    const entry = editorEntryRef.current;
    const untouched = !!(draft && entry && JSON.stringify(draft) === entry.initialDraft);
    const validation = draft ? validateReportDraft(draft) : { ok: true };
    const submitted = submittedDisplayRef?.current?.widgets?.some((w) => w.id === id);
    if (entry && entry.widget == null && untouched && !submitted) {
      leaveEditor(id, { discard: true });
      return;
    }
    if (!validation.ok) {
      setConfirmDiscard(true);
      return;
    }
    leaveEditor(id);
  };
  // A copy is a new, independent, INLINE tile. WHAT is copied is the card's call —
  // it is the thing that knows what the tile draws and what it is called (see
  // WidgetCard's Duplicate button); this only appends it, on the draft.
  const duplicateWidget = (w) => patchWidgets((ws) => [...ws, copyWidget(w, ws.map((x) => x.id))]);
  // BOTH producers of the delete confirm — a card and the editor's Delete — come
  // through here, so the two can never name one tile two ways (§1a.2 heading).
  const askDelete = (w) => setConfirmDelete({ widget: w, title: tileTitle(resolved.get(w.id), w) });
  const deleteWidget = (id) => {
    onChange((cur) => ({ ...cur, ...withWidgetRemoved(cur, id) }));
    setConfirmDelete(null);
    if (builderDraftRef.current?.id === id) clearDraft();
  };
  const patchBuilderDraft = (id, updater) => {
    const current = builderDraftRef.current;
    if (!current || current.id !== id) return;
    let next = typeof updater === 'function' ? updater(current) : updater;
    const validation = validateReportDraft(next);
    if (validation.ok) {
      next = { ...next, spec: validation.normalized };
      patchWidgets((ws) => {
        const i = ws.findIndex((w) => w.id === id);
        if (i === -1) return [...ws, next];
        const out = ws.slice();
        out[i] = next;
        return out;
      });
    }
    holdDraft(next);
    onWidgetDraftInvalidChange?.(structuralProblem(validation));
  };

  /**
   * THE door into the editor — the card's ✎, and the external deep-open request below
   * (the dashboard tile's "Edit…" and Mapping's "Create widget"). One door, because two
   * of them are the same act on the same tile and only one of them used to ask.
   */
  const startEdit = (w, r) => {
    if (!readyToEdit(w, r)) return;   // missing → refused; linked → the confirm owns it
    const index = widgets.findIndex((x) => x.id === w.id);
    editorEntryRef.current = {
      id: w.id, widget: w, index, initialDraft: JSON.stringify(w),
    };
    holdDraft(w);
    onWidgetDraftInvalidChange?.(structuralProblem(validateReportDraft(w)));
    setView({ mode: 'edit', id: w.id });
  };

  /* editor sub-view */
  // Someone arrived here from Mapping's "Create widget" (spec 2026-08-11 §5.5) or
  // from a dashboard tile's ⋯ → Edit…: the tile is already in the drawer's DRAFT,
  // and the editor opens ON it so the person sees what they are getting before
  // anything is saved. It deliberately does NOT enter newbornRef: unlike a blank
  // Add-widget skeleton, this is work the person explicitly requested and
  // Back/tab-switch must keep it pending for the drawer's normal
  // Save/Reset/Discard boundary.
  //
  // Through startEdit, NOT straight to setView: a linked instance is
  // {id, kind, lib} and nothing else, so opening it directly gave a BLANK editor
  // whose fields the resolver ignores — and the drawer's Save then dropped every
  // one of them (widgets-validate builds a linked widget from the ref alone).
  // The tile's ⋯ → Edit… is the same act as the card's ✎ and must ask the same
  // question.
  //
  // `onOpened` clears the request, so this fires once: without it, pressing Back
  // would be answered by the effect re-opening the same editor for ever.
  useEffect(() => {
    if (!openWidgetId) return;
    const target = widgets.find((w) => w.id === openWidgetId);
    if (target) {
      startEdit(target, resolved.get(openWidgetId));
    }
    onOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWidgetId]);

  useEffect(() => {
    if (!editorRequest?.close || !editorRequest.nonce) return;
    if (view.mode === 'edit' && view.id) backFromEditor(view.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorRequest]);

  const storedEditing = view.mode === 'edit' ? widgets.find((w) => w.id === view.id) : null;
  const editing = view.mode === 'edit' && builderDraft?.id === view.id ? builderDraft : storedEditing;

  // A linked instance is detached by the link layer immediately before it asks this screen
  // to edit by id. That callback cannot hand the just-created definition through, so the
  // first render which can see it captures the same entry snapshot as every other door.
  useEffect(() => {
    if (view.mode !== 'edit' || builderDraftRef.current || !storedEditing) return;
    const index = widgets.findIndex((w) => w.id === storedEditing.id);
    editorEntryRef.current = {
      id: storedEditing.id, widget: storedEditing, index, initialDraft: JSON.stringify(storedEditing),
    };
    holdDraft(storedEditing);
    onWidgetDraftInvalidChange?.(structuralProblem(validateReportDraft(storedEditing)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.mode, storedEditing]);

  // Heal after an external state change (round 11: drawer Reset while the editor
  // was open left the tab stuck in "editing" with no widget — sections hidden).
  useEffect(() => {
    if (view.mode === 'edit' && !editing) setView({ mode: 'list' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.mode, editing]);

  // Unmount with an UNTOUCHED newborn open (tab switch away) removes it — a
  // pristine "New chart" must never ride a later Save from another tab (round 11).
  const unmountGuard = useRef({});
  unmountGuard.current = { view, widgets, onChange, submittedDisplayRef };
  useEffect(() => () => {
    const { view: v, widgets: ws, onChange: oc, submittedDisplayRef: submission } = unmountGuard.current;
    if (v.mode !== 'edit') return;
    const snap = newbornRef.current.get(v.id);
    const cur = ws.find((w) => w.id === v.id);
    // Clicking Save owns this addition even before the response lands. A tab
    // unmount must not manufacture a deletion behind that request; if it fails,
    // keep the submitted widget pending for Retry. Later newborns are unrelated.
    const submitted = submission?.current?.widgets?.some((w) => w.id === v.id);
    if (snap && cur && !submitted && JSON.stringify(cur) === snap) {
      oc((c) => ({ ...c, widgets: (c.widgets || []).filter((w) => w.id !== v.id) }));
    }
  }, []);

  if (editing) {
    return (
      <>
        <WidgetBuilder
          key={resetEpoch}
          widget={editing}
          titlePlaceholder={tileTitle(resolved.get(editing.id), editing)}
          isNewborn={newbornRef.current.has(editing.id)}
          // The drawer's unsaved CM360 draft: this tab and the Data tab sit behind one Save,
          // so the store's `sourceFacts` cannot know about a source added a minute ago. The
          // builder folds it into its env — see `withDraftCm360`.
          draftCm360Configured={draftCm360Configured}
          onPatch={(updater) => patchBuilderDraft(editing.id, updater)}
          onBack={() => backFromEditor(editing.id)}
          onDelete={() => askDelete(editing)}
          onDraftInvalidChange={onDraftInvalidChange}
        />
        {confirmDelete && (
          <ConfirmModal
            title="Delete widget?"
            message={`“${confirmDelete.title}” will be removed from this pacing's dashboard for everyone. This can't be undone after Save.`}
            confirmLabel="Delete"
            onConfirm={() => { deleteWidget(confirmDelete.widget.id); setView({ mode: 'list' }); }}
            onCancel={() => setConfirmDelete(null)}
          />
        )}
        {confirmDiscard && (
          <ConfirmModal
            title="Discard incomplete changes?"
            message="This Widget cannot be saved yet. Discard restores its last saved state, or its state when the Builder opened if it has not been saved here. Keep editing leaves the current draft in place."
            confirmLabel="Discard changes"
            cancelLabel="Keep editing"
            onConfirm={() => leaveEditor(editing.id, { discard: true })}
            onCancel={() => setConfirmDiscard(false)}
          />
        )}
        {/* Mounted in BOTH branches, for the same reason confirmDelete is: the
            deep-open effect can fire while the editor is open, and a dialog that
            exists in only one branch is invisible exactly when it is asked for. */}
        {dialogs}
      </>
    );
  }

  // The two widget sections (post-release UX round, 2026-08-16): untouched
  // library links on top, everything else under the divider. Derived from the
  // resolution, so an edit that detaches — or a "Reset to library" that
  // re-links — moves the card on the very next render, no reload.
  const { linked, custom } = splitByLibraryState(galleryWidgets, resolved);

  return (
    <>
      <section className="sp-sect">
        <div className="sp-sect-t">
          Widgets
          <span style={{ color: 'var(--text-faint)', letterSpacing: 0, textTransform: 'none', fontWeight: 400, marginLeft: 6 }}>
            {widgets.length} of {WIDGET_CAP}
            {displayKb > 200 && ` · ${displayKb} KB of 400 KB`}
          </span>
        </div>
        {/* It used to sit under the chip rows. They retired into the Library's
            Standard shelf, and this is now the only place on the screen that adds a
            tile — so the one answer to "where did it go" moves with them.
            `.lib-note` is the same modifier the Library screen puts on a hint that
            sits ABOVE a card grid: .blib-hint alone has no bottom margin, and the
            .wgal grid has no top one, so the text would touch the first card. */}
        <div className="blib-hint lib-note">Added tiles appear in the first free spot — arrange in Layout mode.</div>

        {view.mode === 'pick' && (
          <div className="wgal-pick">
            <div className="blib-group-t" style={{ gridColumn: '1 / -1' }}>Start from scratch</div>
            {[
              ['blank', 'Blank widget', 'Build with containers, charts, tables and readings'],
              ['chart', 'Chart', 'One empty Chart View; add its first series in the Builder'],
              ['table', 'Table', 'One empty Table View; add its first column in the Builder'],
              ['kpi', 'KPI', 'One KPI View waiting for its value'],
              ['pie', 'Pie', 'One Pie View waiting for its value and slice'],
              ['compare', 'Compare', 'Delivery and CM360 setup waiting for the metrics to compare'],
            ].map(([kind, label, hint]) => (
              <button key={kind} type="button" className="wgal-pick-card" onClick={() => addWidget(kind)}>
                <span className="wgal-pick-t">{label}</span>
                <span className="wgal-pick-h">{hint}</span>
              </button>
            ))}
            <div className="wgf-help" style={{ gridColumn: '1 / -1' }}>
              Widgets are shared — everyone with access to this dashboard will see what you add.
            </div>
            <button type="button" className="wgf-add" style={{ gridColumn: '1 / -1' }} onClick={() => setView({ mode: 'list' })}>
              Cancel
            </button>
          </div>
        )}

        {view.mode === 'list' && (() => {
          const card = (w) => {
            const r = resolved.get(w.id);
            return (
              <WidgetCard
                key={w.id}
                w={w}
                r={r}
                on={isOn(w.id)}
                busy={isBusy(w.id)}
                atCap={widgets.length >= WIDGET_CAP}
                onToggle={(v) => setOn(w.id, v)}
                onEdit={() => startEdit(w, r)}
                onDuplicate={duplicateWidget}
                onDelete={() => askDelete(w)}
                menu={(items) => linkMenuFor(w, r, items)}
              />
            );
          };
          return (
            <>
              {/* "From library" and "Custom" show only when they hold cards — no
                  empty scaffolding. The + Add card always renders: a new widget
                  is custom by construction, so it lives in the bottom grid. */}
              {linked.length > 0 && (
                <>
                  <div className="blib-group-t">From library</div>
                  <div className="wgal">{linked.map(card)}</div>
                </>
              )}
              {linked.length > 0 && custom.length > 0 && <hr className="wgal-div" />}
              {custom.length > 0 && <div className="blib-group-t">Custom</div>}
              <div className="wgal">
                {custom.map(card)}
                <button
                  type="button"
                  className="wgal-card wgal-add"
                  disabled={widgets.length >= WIDGET_CAP}
                  onClick={() => setView({ mode: 'pick' })}
                >
                  + Add widget
                </button>
              </div>
              <GroupsSection casEnabled={casEnabled} casReason={casReason} onCasSaved={onCasSaved} />
            </>
          );
        })()}
      </section>

      {confirmDelete && (
        <ConfirmModal
          title="Delete widget?"
          message={`“${confirmDelete.title}” will be removed from this pacing's dashboard for everyone. This can't be undone after Save.`}
          confirmLabel="Delete"
          onConfirm={() => deleteWidget(confirmDelete.widget.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {dialogs}
    </>
  );
}
