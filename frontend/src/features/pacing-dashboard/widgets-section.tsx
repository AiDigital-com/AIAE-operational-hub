import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { savePacingDisplay } from "./api";
import { PacingDashboardLibrary } from "./pacing-dashboard-library";
import type { SettingsSectionHandle, SettingsSectionProps } from "./settings-section";
import type { PacingDisplayShape, PacingWidgetGroup, PacingWidgetInstance } from "./types";

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
}

const seedOf = (display: PacingDisplayShape): DisplayDraft => ({
  widgets: display.widgets ?? [],
  groups: display.groups ?? [],
  enabled: display.enabled ?? {},
});

export const PacingWidgetsSection = forwardRef<SettingsSectionHandle, PacingWidgetsSectionProps>(
  function PacingWidgetsSection({ slug, display, capabilities, isAdmin, libraryEntries, seedKey, initialWidgetId, onWidgetEditorOpened, onDirtyChange }, ref) {
    const [draft, setDraft] = useState<DisplayDraft>(() => seedOf(display));
    const [base, setBase] = useState<DisplayDraft>(() => seedOf(display));

    useEffect(() => {
      const seeded = seedOf(display);
      setDraft(seeded);
      setBase(seeded);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    // By value, not by identity: the library rebuilds both arrays on every action, so an identity
    // check would call an untouched layout dirty as soon as anything re-rendered.
    const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    const stateRef = useRef({ draft, dirty });
    stateRef.current = { draft, dirty };

    useImperativeHandle(ref, () => ({
      async save() {
        const { draft: current, dirty: isDirty } = stateRef.current;
        if (!isDirty) return { ok: true as const };
        // The revision comes off the payload this draft was seeded from, so a layout edited
        // elsewhere since then is what earns the 409 below rather than being overwritten.
        const next = {
          ...display,
          widgets: current.widgets,
          groups: current.groups,
          enabled: current.enabled,
        };
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
        onSave={(patch) => setDraft({ widgets: patch.widgets, groups: patch.groups, enabled: patch.enabled })}
        isAdmin={isAdmin}
        libraryEntries={libraryEntries}
        initialWidgetId={initialWidgetId}
        onWidgetEditorOpened={onWidgetEditorOpened}
      />
    );
  }
);
