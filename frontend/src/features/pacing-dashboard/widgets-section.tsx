import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { savePacingDisplay } from "./api";
import { PacingDashboardLibrary } from "./pacing-dashboard-library";
import type { SettingsSectionHandle, SettingsSectionProps } from "./settings-section";
import type { PacingDisplayShape, PacingWidgetGroup, PacingWidgetInstance } from "./types";
import { newWidgetId } from "./vendor/layout-materialize.mjs";
// Moved JS from Pacing's SPA (see ./spa/SOURCE.md): the Line Items settings catalogue's door.
import * as LineItemColumnsUntyped from "./spa/line-item-columns.js";

const { isDefault: lineItemsIsDefault, normLineItems } = LineItemColumnsUntyped as unknown as {
  isDefault: (value: unknown) => boolean;
  normLineItems: (value: unknown) => { ok: boolean; value?: unknown };
};

/**
 * `display.lineItems` as the dirty check sees it - Pacing's `display-norm.js` `normLineItemsKey`:
 * absent, null and the default object are ONE setting (today's render), so none of them can dirty
 * the drawer against another; any other readable value compares in canonical key order.
 */
function lineItemsKey(value: unknown): unknown {
  if (lineItemsIsDefault(value)) return null;
  const r = normLineItems(value);
  return r.ok ? r.value : value;
}

/** Pacing's own ceiling on stored widgets (`widgets-validate` LIMITS.widgets). Named here rather
 *  than guessed: a 65th widget is refused by the save, and refusing it at the click is the
 *  difference between a sentence and a failed Save three tabs away. */
const WIDGET_CAP = 64;

/**
 * The widget library as a section of the settings drawer.
 *
 * It exists to hold a DRAFT. The library panel persisted every action the moment it happened -
 * add a widget, one request; drop it into a group, another - which is a different promise from the
 * one the drawer now makes, where a single Save commits every section and Reset abandons them.
 * Two save models on one screen would have been the worse outcome: a user who pressed Cancel after
 * adding three widgets would find all three still there.
 *
 * Nothing inside the library changes. It already renders from a `display` and reports the next one
 * through `onSave`, so pointing that at local state instead of the network is the whole conversion -
 * which is also why its own logic (linked vs copied instances, group bookkeeping) is untouched here.
 */

interface DisplayDraft {
  widgets: PacingWidgetInstance[];
  groups: PacingWidgetGroup[];
  /** The tile on/off map. It rides in this draft - and therefore in the drawer's one Save, inside
   *  the full display patch - rather than saving the instant a switch is flipped, which is what the
   *  retired SPA did.
   *
   *  That difference is safe here and is not safe there, for a reason worth keeping: the SPA's
   *  switch sits on the dashboard TILE, outside the drawer, so a drawer draft holding an `enabled`
   *  map frozen at open time would silently rewind a switch flipped behind it - which is why its
   *  `display-blocks.js` re-reads the live map on every draft push and its widget-set saves omit the
   *  key entirely. The Hub has no tile menu: the switch IS in the drawer, the draft is seeded from
   *  the same payload the save's `displayRev` is taken from, and dash-gate's CAS refuses the save
   *  outright if anything changed meanwhile. There is no window in which this map can go stale
   *  without the save failing loudly. */
  enabled: Record<string, boolean>;
  /** The Line Items block's settings (Pacing `85d353c`): columns, sort, default view, rows. An
   *  object, `null` for a pending «Reset to default» (the save sends it and dash-gate deletes the
   *  stored key), or undefined - never touched and never stored, and then the save omits it. */
  lineItems: unknown;
}

export interface PacingWidgetsSectionProps extends SettingsSectionProps {
  slug: string;
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
}

/** The dimension a widget is cut by, from either of the two slots that can carry one. */
function axisOf(widget: Record<string, unknown> | null | undefined): string | null {
  const slot = (value: unknown) =>
    (value && typeof value === "object" ? (value as { dim?: unknown }).dim : null);
  const dim = slot(widget?.rows) ?? slot(widget?.xAxis);
  return typeof dim === "string" && dim ? dim : null;
}

const seedOf = (display: PacingDisplayShape): DisplayDraft => ({
  widgets: display.widgets ?? [],
  groups: display.groups ?? [],
  enabled: display.enabled ?? {},
  lineItems: display.lineItems,
});

export const PacingWidgetsSection = forwardRef<SettingsSectionHandle, PacingWidgetsSectionProps>(
  function PacingWidgetsSection(
    {
      slug,
      display,
      capabilities,
      isAdmin,
      libraryEntries,
      seedKey,
      initialWidgetId,
      onWidgetEditorOpened,
      customizeLineItemsRequest,
      onCustomizeLineItemsOpened,
      onDirtyChange,
    },
    ref
  ) {
    const [draft, setDraft] = useState<DisplayDraft>(() => seedOf(display));
    const [base, setBase] = useState<DisplayDraft>(() => seedOf(display));

    useEffect(() => {
      const seeded = seedOf(display);
      setDraft(seeded);
      setBase(seeded);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    // Tiles that land in the stored display behind an open draft - the page's auto-add
    // (widgets/auto-add.ts) minting «Delivery vs CM360» right after this drawer saved a CM360
    // source. The save below sends `widgets` whole under the LIVE revision, so a draft that never
    // learned of them would delete them with no 409 to stop it. They join the draft AND its
    // baseline, so a draft that was clean stays clean. Only ids the baseline never held: a tile the
    // user deleted in this draft was in the baseline, so it stays deleted.
    const baseRef = useRef(base);
    baseRef.current = base;
    useEffect(() => {
      const known = new Set(baseRef.current.widgets.map((w) => w.id));
      const arrived = (display.widgets ?? []).filter((w) => !known.has(w.id));
      if (!arrived.length) return;
      const join = (list: PacingWidgetInstance[]) => {
        const have = new Set(list.map((w) => w.id));
        return [...list, ...arrived.filter((w) => !have.has(w.id))];
      };
      setBase((b) => ({ ...b, widgets: join(b.widgets) }));
      setDraft((d) => ({ ...d, widgets: join(d.widgets) }));
    }, [display.widgets]);

    // By value, not by identity: the library rebuilds both arrays on every action, so an identity
    // check would call an untouched layout dirty as soon as anything re-rendered.
    const dirty = useMemo(() => {
      const comparable = (d: DisplayDraft) => JSON.stringify({ ...d, lineItems: lineItemsKey(d.lineItems) });
      return comparable(draft) !== comparable(base);
    }, [draft, base]);
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    const stateRef = useRef({ draft, dirty });
    stateRef.current = { draft, dirty };

    useImperativeHandle(ref, () => ({
      addWidget(widget: Record<string, unknown>) {
        const current = stateRef.current.draft;
        // A tile already reading this axis is the one the caller wants, not a reason for a second
        // copy of it. The mapping screen's "Create a table of the top 20" is a button a person
        // presses again when they come back to the column, and without this each press minted
        // another identical table until the cap.
        const axis = axisOf(widget);
        const existing = axis
          ? current.widgets.find((w) => axisOf(w as unknown as Record<string, unknown>) === axis)
          : undefined;
        if (existing?.id) return String(existing.id);
        if (current.widgets.length >= WIDGET_CAP) return null;
        const id = newWidgetId(current.widgets.map((w) => w?.id).filter(Boolean));
        setDraft({ ...current, widgets: [...current.widgets, { ...widget, id } as PacingWidgetInstance] });
        return id;
      },
      async save() {
        const { draft: current, dirty: isDirty } = stateRef.current;
        if (!isDirty) return { ok: true as const };
        // The revision comes off the payload this draft was seeded from, so a layout edited
        // elsewhere since then is what earns the 409 below rather than being overwritten.
        const next: Record<string, unknown> = {
          ...display,
          widgets: current.widgets,
          groups: current.groups,
          enabled: current.enabled,
        };
        // Sent when the draft holds the key (null = the reset, which deletes the stored key);
        // omitted when it never held one - Pacing's SettingsDrawer.jsx buildConfig rule.
        if (current.lineItems !== undefined) next.lineItems = current.lineItems;
        else delete next.lineItems;
        try {
          const outcome = await savePacingDisplay(slug, next, display.rev ?? 0, capabilities);
          if (outcome.status === "conflict") {
            // Not "save failed": one of these says someone else edited this pacing, the other says
            // this browser is running a build Pacing no longer accepts. Both are fixed by reloading
            // and neither is fixed by pressing Save again, which a generic message would invite.
            return {
              ok: false as const,
              message:
                outcome.conflict.reason === "stale_settings"
                  ? "This pacing's layout changed elsewhere. Reload to see the latest before editing again."
                  : "The editor needs to reload before saving again.",
            };
          }
          setBase(current);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
        }
      },
      reset() {
        setDraft(base);
      },
    }));

    // The library reads its widgets and groups off `display`, so it has to see the DRAFT - otherwise
    // an added widget would vanish from the list on the next render, saved or not.
    const draftDisplay = useMemo(
      () => ({ ...display, widgets: draft.widgets, groups: draft.groups, enabled: draft.enabled }),
      [display, draft]
    );

    return (
      <PacingDashboardLibrary
        display={draftDisplay}
        // The drawer's footer owns both now: one "Unsaved changes" line and one error, for every
        // section, is the point of having one Save.
        saving={false}
        saveError={null}
        onSave={(patch) =>
          setDraft((d) => ({ ...d, widgets: patch.widgets, groups: patch.groups, enabled: patch.enabled }))
        }
        isAdmin={isAdmin}
        libraryEntries={libraryEntries}
        initialWidgetId={initialWidgetId}
        onWidgetEditorOpened={onWidgetEditorOpened}
        lineItems={draft.lineItems}
        onLineItemsChange={(next) => setDraft((d) => ({ ...d, lineItems: next }))}
        customizeLineItemsRequest={customizeLineItemsRequest}
        onCustomizeLineItemsOpened={onCustomizeLineItemsOpened}
      />
    );
  }
);
