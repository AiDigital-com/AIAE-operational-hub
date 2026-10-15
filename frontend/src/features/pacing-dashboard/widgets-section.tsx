import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType } from "react";
import { savePacingDisplay } from "./api";
import type { SettingsSectionHandle, SettingsSectionProps } from "./settings-section";
import type { PacingDisplayShape, PacingWidgetInstance } from "./types";
import { newWidgetId } from "./vendor/layout-materialize.mjs";
// Moved JS from Pacing's SPA (see ./spa/SOURCE.md): the Display tab itself, and the two helpers its
// drawer used to judge a draft - the same ones, so "unsaved" means here what it means there.
import BlockLibraryUntyped from "./spa/display/BlockLibrary.jsx";
import { cloneDisplay as cloneDisplayUntyped, normDisplay as normDisplayUntyped } from "./spa/display-norm.js";
import { preserveEnabled as preserveEnabledUntyped } from "./spa/display-blocks.js";
import { WIDGET_CAP as SPA_WIDGET_CAP } from "./spa/widget-ops.js";

/** Re-typed at the boundary: `allowJs` infers each prop from its default. The real contract is the
 *  reference drawer's (`SettingsDrawer.jsx` → `DisplayTab.jsx` → `BlockLibrary.jsx`). */
const BlockLibrary = BlockLibraryUntyped as unknown as ComponentType<Record<string, unknown>>;
const cloneDisplay = cloneDisplayUntyped as unknown as (d: PacingDisplayShape) => PacingDisplayShape;
const normDisplay = normDisplayUntyped as unknown as (d: PacingDisplayShape) => string;
const preserveEnabled = preserveEnabledUntyped as unknown as (
  draft: PacingDisplayShape,
  live: PacingDisplayShape
) => PacingDisplayShape;
/** Pacing's own widget cap (`widget-ops.js`, the same 100 `widgets-validate.mjs` enforces). */
const WIDGET_CAP = SPA_WIDGET_CAP as number;

/**
 * Settings → Display, as a section of this app's drawer: Pacing's own Display tab (`BlockLibrary`,
 * moved), hosted the way Pacing's settings drawer hosts it.
 *
 * Everything the tab does is the moved code's. What lives here is the half of Pacing's drawer the
 * tab leans on - written again because this app's drawer is its own, but to the same contract:
 *
 *   - THE DRAFT. The tab edits a copy of the display (`onChange`, a value or an updater) and the
 *     drawer's one Save commits it. Dirty is Pacing's `normDisplay` comparison, so switching a tile,
 *     which the tab saves at once on its own, never marks the drawer dirty.
 *   - THE SAVE carries what Pacing's `buildConfig` carries and nothing more: `liNames`,
 *     `showDescription`, `lineItems`, `widgets`, `widgetRanges`, under the live revision and the
 *     writer marker. `enabled`, `groups`, `layout`, `layoutFrom` and `autoAdded` are deliberately
 *     absent, as there: switches save themselves, and the arrangement is Layout mode's and the
 *     Library's to write, so a draft taken at open time can never roll them back.
 *   - THE SIGNALS the tab expects: the save epoch and the submitted snapshot (so a just-saved new
 *     widget stops being a disposable newborn), the reset epoch, the deep-opens (a tile's Edit…, a
 *     block's Customize…, Layout mode's "+ Add"), and the display-cas gate with its re-base: the
 *     Library's block Add and layout Apply save the LIVE arrangement at once, so they are allowed
 *     only while the whole drawer is clean and no Layout-mode session is open, and afterwards the
 *     draft starts again from what they saved.
 *   - THE PREVIEW: Pacing's drawer pushes the draft into the store 200 ms after an edit, so the
 *     dashboard behind the drawer shows it before Save; here the draft goes to the page the same way
 *     (`onPreviewChange`), with the live on/off map in it.
 *
 * Not taken: the arrangement History. Its door in the tab is gone (see `spa/SOURCE.md`).
 */

export interface PacingWidgetsSectionProps extends SettingsSectionProps {
  slug: string;
  /** The LIVE display from the dashboard payload. */
  display: PacingDisplayShape;
  /** Echoed back on save; Pacing refuses a v2 widget change without it. */
  capabilities: Record<string, unknown> | undefined;
  isAdmin: boolean;
  /** Definitions for this pacing's linked instances, keyed by library entry id. */
  libraryEntries: Record<string, unknown> | undefined;
  /** Bumped by the drawer on open, so a reopened section never shows an abandoned edit. */
  seedKey: number;
  /** A widget a tile's "Edit…" asked to open the builder on, rather than the list. */
  initialWidgetId?: string | null;
  /** Called once that request is consumed, so a later open lands on the list. */
  onWidgetEditorOpened?: () => void;
  /** A tile's ⋯ → Customize… on the Line Items block: open that card's editor. */
  customizeLineItemsRequest?: number | null;
  /** Called once that request is consumed. */
  onCustomizeLineItemsOpened?: () => void;
  /** Another section of the drawer holds unsaved work - the display-cas actions wait for it. */
  drawerDirty?: boolean;
  /** A Layout-mode session is open behind the drawer - the display-cas actions wait for it too. */
  layoutSessionOpen?: boolean;
  /** Layout mode's "+ Add": open the Library screen. A new number per request. */
  openLibraryRequest?: number | null;
  /** Called once that request is consumed. */
  onLibraryOpened?: () => void;
  /** A layout Apply replaced the arrangement: the drawer closes, as Pacing's does. */
  onCloseRequest?: () => void;
  /** The draft to preview behind the drawer, or null for "show what is saved". */
  onPreviewChange?: (display: PacingDisplayShape | null) => void;
  /** Whether a CM360 source is configured, for the builder's CM pill. */
  draftCm360Configured?: boolean;
}

/** The dimension a widget is cut by, from either of the two slots that can carry one. */
function axisOf(widget: Record<string, unknown> | null | undefined): string | null {
  const slot = (value: unknown) =>
    (value && typeof value === "object" ? (value as { dim?: unknown }).dim : null);
  const dim = slot(widget?.rows) ?? slot(widget?.xAxis);
  return typeof dim === "string" && dim ? dim : null;
}

const CAS_LAYOUT_SESSION = "Finish the layout session first — Save or Cancel it, then come back";
const CAS_DIRTY = "Save or discard the drawer’s unsaved changes first";
const PREVIEW_DEBOUNCE_MS = 200;

export const PacingWidgetsSection = forwardRef<SettingsSectionHandle, PacingWidgetsSectionProps>(
  function PacingWidgetsSection(
    {
      slug,
      display,
      capabilities,
      seedKey,
      initialWidgetId,
      onWidgetEditorOpened,
      customizeLineItemsRequest,
      onCustomizeLineItemsOpened,
      drawerDirty = false,
      layoutSessionOpen = false,
      openLibraryRequest = null,
      onLibraryOpened,
      onCloseRequest,
      onPreviewChange,
      draftCm360Configured = false,
      onDirtyChange,
    },
    ref
  ) {
    const [draft, setDraft] = useState<PacingDisplayShape>(() => cloneDisplay(display));
    // What Reset restores and what dirty compares against: the display as it stood when the drawer
    // opened, or as the last save / re-base left it.
    const origRef = useRef<PacingDisplayShape>(cloneDisplay(display));
    const [baseNorm, setBaseNorm] = useState(() => normDisplay(display));

    const reseed = useCallback((d: PacingDisplayShape) => {
      const seeded = cloneDisplay(d);
      origRef.current = cloneDisplay(d);
      setDraft(seeded);
      setBaseNorm(normDisplay(seeded));
    }, []);

    const displayRef = useRef(display);
    displayRef.current = display;
    useEffect(() => {
      reseed(displayRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    // Tiles that land in the stored display behind an open draft - the page's auto-add minting
    // «Delivery vs CM360» right after this drawer saved a CM360 source. The save sends `widgets`
    // whole, so a draft that never learned of them would delete them. They join the draft AND its
    // baseline, so a clean draft stays clean (Pacing's drawer does the same for the auto-add).
    useEffect(() => {
      const known = new Set((origRef.current.widgets ?? []).map((w) => w.id));
      const arrived = (display.widgets ?? []).filter((w) => !known.has(w.id));
      if (!arrived.length) return;
      const join = (list: PacingWidgetInstance[] | undefined) => {
        const have = new Set((list ?? []).map((w) => w.id));
        return [...(list ?? []), ...arrived.filter((w) => !have.has(w.id)).map((w) => structuredClone(w))];
      };
      origRef.current = { ...origRef.current, widgets: join(origRef.current.widgets) };
      setBaseNorm(normDisplay(origRef.current));
      setDraft((d) => ({ ...d, widgets: join(d.widgets) }));
    }, [display.widgets]);

    // The display-cas re-base (Pacing's `rebaseFromStore`): after a block Add or a layout Apply the
    // draft starts again from what that save stored. The save adopts its answer into the payload,
    // so the re-base waits for the display prop that carries it.
    const rebasePending = useRef<null | "add" | "apply">(null);
    useEffect(() => {
      const action = rebasePending.current;
      if (!action) return;
      rebasePending.current = null;
      reseed(display);
      if (action === "apply") onCloseRequest?.();
    }, [display, reseed, onCloseRequest]);

    const dirty = useMemo(() => normDisplay(draft) !== baseNorm, [draft, baseNorm]);
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    // The live preview, debounced as Pacing's drawer debounces its store push: each push re-renders
    // the whole board behind the drawer. A clean draft previews nothing - the board shows the saved
    // display, and a save made elsewhere is never masked by a stale copy.
    useEffect(() => {
      if (!onPreviewChange) return undefined;
      if (!dirty) {
        onPreviewChange(null);
        return undefined;
      }
      const timer = window.setTimeout(
        () => onPreviewChange(preserveEnabled(draft, displayRef.current)),
        PREVIEW_DEBOUNCE_MS
      );
      return () => window.clearTimeout(timer);
    }, [draft, dirty, onPreviewChange]);
    useEffect(() => () => onPreviewChange?.(null), [onPreviewChange]);

    // Accepts a value OR an updater (Pacing's handleDisplayChange): two same-tick commits compose.
    const handleChange = useCallback(
      (next: PacingDisplayShape | ((cur: PacingDisplayShape) => PacingDisplayShape)) =>
        setDraft((cur) => (typeof next === "function" ? next(cur) : next)),
      []
    );

    // An uncommitted invalid formula, and a widget draft the builder cannot store yet: both block
    // Save, as in Pacing's drawer.
    const [draftInvalid, setDraftInvalid] = useState(false);
    const [widgetDraftInvalid, setWidgetDraftInvalid] = useState<string | null>(null);

    // The signals the tab reads after a save and a reset.
    const [savedEpoch, setSavedEpoch] = useState(0);
    const savedDisplayRef = useRef<PacingDisplayShape | null>(null);
    const submittedDisplayRef = useRef<PacingDisplayShape | null>(null);
    const [resetEpoch, setResetEpoch] = useState(0);

    // The deep-opens. A tile's ⋯ → Customize… asks an open widget editor to close first (through its
    // own dirty/invalid guard) and then opens the Line Items card - Pacing's openBlockRequest and
    // editorRequest pair.
    const [openBlock, setOpenBlock] = useState<{ id: string; nonce: number } | null>(null);
    const [editorRequest, setEditorRequest] = useState<{ close: true; nonce: number } | null>(null);
    useEffect(() => {
      if (customizeLineItemsRequest == null) return;
      setOpenBlock({ id: "lineItems", nonce: customizeLineItemsRequest });
      setEditorRequest({ close: true, nonce: customizeLineItemsRequest });
    }, [customizeLineItemsRequest]);
    const openLibrary = useMemo(
      () => (openLibraryRequest == null ? null : { nonce: openLibraryRequest }),
      [openLibraryRequest]
    );

    const casEnabled = !dirty && !drawerDirty && !layoutSessionOpen;
    const casReason = layoutSessionOpen ? CAS_LAYOUT_SESSION : !casEnabled ? CAS_DIRTY : null;
    const handleCasSaved = useCallback((action: "add" | "apply") => {
      rebasePending.current = action;
    }, []);

    const stateRef = useRef({ draft, dirty, draftInvalid, widgetDraftInvalid });
    stateRef.current = { draft, dirty, draftInvalid, widgetDraftInvalid };

    const invalidMessage = () => {
      const s = stateRef.current;
      if (s.draftInvalid) return "A formula in the open widget is not valid yet. Fix it or discard it before saving.";
      if (s.widgetDraftInvalid) return `The open widget cannot be saved yet: ${s.widgetDraftInvalid}.`;
      return null;
    };

    useImperativeHandle(ref, () => ({
      addWidget(widget: Record<string, unknown>) {
        const current = stateRef.current.draft;
        const widgets = current.widgets ?? [];
        // A tile already reading this axis is the one the caller wants, not a reason for a second
        // copy of it (the mapping screen's "Create a table of the top 20" is pressed again whenever
        // someone comes back to the column).
        const axis = axisOf(widget);
        const existing = axis
          ? widgets.find((w) => axisOf(w as unknown as Record<string, unknown>) === axis)
          : undefined;
        if (existing?.id) return String(existing.id);
        if (widgets.length >= WIDGET_CAP) return null;
        const id = newWidgetId(widgets.map((w) => w?.id).filter(Boolean));
        setDraft({ ...current, widgets: [...widgets, { ...widget, id } as PacingWidgetInstance] });
        return id;
      },
      precheck() {
        if (!stateRef.current.dirty) return { ok: true as const };
        const message = invalidMessage();
        return message ? { ok: false as const, message } : { ok: true as const };
      },
      async save() {
        const { draft: current, dirty: isDirty } = stateRef.current;
        if (!isDirty) return { ok: true as const };
        const message = invalidMessage();
        if (message) return { ok: false as const, message };
        // Pacing's buildConfig, the display half - and only it (see the header).
        const patch: Record<string, unknown> = {
          liNames: current.liNames,
          showDescription: !!current.showDescription,
          ...(current.lineItems !== undefined ? { lineItems: current.lineItems } : null),
          widgets: current.widgets ?? [],
          widgetRanges: current.widgetRanges ?? {},
        };
        submittedDisplayRef.current = cloneDisplay(patch as PacingDisplayShape);
        try {
          // The LIVE revision, read at save time: our own saves from anywhere else (a switch, Layout
          // mode behind the drawer) must not make this one fight them.
          const outcome = await savePacingDisplay(slug, patch, Number(displayRef.current.rev ?? 0), capabilities);
          if (outcome.status === "conflict") {
            // Not "save failed": one of these says someone else edited this pacing, the other says
            // this browser is running a build Pacing no longer accepts. Both are fixed by reloading.
            return {
              ok: false as const,
              message:
                outcome.conflict.reason === "stale_settings"
                  ? "This pacing's layout changed elsewhere. Reload to see the latest before editing again."
                  : "The editor needs to reload before saving again.",
            };
          }
          origRef.current = cloneDisplay(current);
          setBaseNorm(normDisplay(current));
          savedDisplayRef.current = cloneDisplay((outcome.display as PacingDisplayShape) ?? current);
          setSavedEpoch((n) => n + 1);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
        }
      },
      reset() {
        setDraft(cloneDisplay(origRef.current));
        setResetEpoch((n) => n + 1);
      },
    }));

    const handleShowDescription = useCallback(
      () => setDraft((d) => ({ ...d, showDescription: !d.showDescription })),
      []
    );
    const handleLineItems = useCallback(
      (next: unknown) => setDraft((d) => ({ ...d, lineItems: next })),
      []
    );

    return (
      <div className="sp-display">
        <BlockLibrary
          display={draft}
          onChange={handleChange}
          onDraftInvalidChange={setDraftInvalid}
          onWidgetDraftInvalidChange={setWidgetDraftInvalid}
          showDescription={!!draft.showDescription}
          onShowDescriptionToggle={handleShowDescription}
          lineItems={draft.lineItems}
          onLineItemsChange={handleLineItems}
          openBlockId={openBlock}
          onBlockOpened={() => {
            setOpenBlock(null);
            onCustomizeLineItemsOpened?.();
          }}
          editorRequest={editorRequest}
          openWidgetId={initialWidgetId ?? null}
          onOpened={onWidgetEditorOpened}
          draftCm360Configured={draftCm360Configured}
          openLibrary={openLibrary}
          onLibraryOpened={onLibraryOpened}
          savedEpoch={savedEpoch}
          savedDisplay={savedDisplayRef.current}
          submittedDisplayRef={submittedDisplayRef}
          resetEpoch={resetEpoch}
          casEnabled={casEnabled}
          casReason={casReason}
          onCasSaved={handleCasSaved}
        />
      </div>
    );
  }
);
