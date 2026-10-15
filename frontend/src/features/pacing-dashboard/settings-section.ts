/**
 * What the settings drawer needs from each of its sections.
 *
 * The drawer owns one Save for all of them, the way the retired SPA's drawer did, and that
 * only works if it can ask each section two things: are you dirty, and save yourself. Neither
 * belongs in the drawer: a section knows its own draft, its own endpoint and its own failures
 * (display carries a revision and can come back 409, the plan carries none, data is a partial
 * patch). So the drawer orchestrates and the sections still own their arithmetic.
 *
 * `dirty` is LIFTED, `save`/`reset` are handed over by ref, and the split is deliberate. Dirty
 * is a boolean that changes rarely and the footer has to re-render on it. The two callbacks
 * change on every keystroke and nothing renders on them - lifting those would re-render the
 * whole drawer on every character typed into a line item's budget.
 */
import type { PacingDraftLineItemV1 } from "../pacing-plan/types";

/** What one section's save came to. A failure carries the sentence to show, because only the
 *  section knows what its own 409 means ("the editor needs to reload" is not "save failed"). */
export type SectionSaveResult = { ok: true } | { ok: false; message: string };

export interface SettingsSectionHandle {
  /** Persist this section's draft. Never throws - a rejection is a result, so one section's
   *  failure cannot abandon the others mid-save. */
  save: () => Promise<SectionSaveResult>;
  /** Drop the draft back to what the server last said. */
  reset: () => void;
  /** A check that must pass before ANY section is written - the reference saves every tab in one
   *  request and aborts it whole on a coefficient error (`SettingsDrawer.jsx` `runSave`), so here a
   *  section that would refuse its own save says so first and nothing is sent. Optional; only the
   *  plan implements it. */
  precheck?: () => SectionSaveResult;
  /** Add a widget to this section's DRAFT, for a screen that is not this one.
   *
   *  Only the widget section implements it. A breakdown with thousands of values has no donut worth
   *  drawing, so the mapping screen offers a table instead - and the draft it must land in lives
   *  here, behind one Save with everything else. Returns the new widget's id, or null when the cap
   *  is reached, so the caller can say which happened. */
  addWidget?: (widget: Record<string, unknown>) => string | null;
  /** Add line items to this section's DRAFT, for a screen that is not this one - the mapping
   *  pickers' «＋ Add line item…». Only the plan section implements it. */
  addLineItems?: (candidates: PacingDraftLineItemV1[]) => void;
  /** Set a line item's custom display name in this section's DRAFT, for a screen that is not this
   *  one - the plan section's «Display name» field. Only the widget section implements it: the name
   *  lives in `display.liNames` and is saved with the widgets under the display revision, where the
   *  reference's `buildConfig` puts it, so the draft that saves it is the one that must hold it. */
  setLineItemName?: (lineItemId: string, value: string) => void;
}

export interface SettingsSectionProps {
  /** Called whenever this section's dirty state flips. */
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * The sections the drawer shows, in tab order - Pacing's SettingsDrawer.jsx, names and order both
 * (owner decision 2026-10-14). The ids are this app's own and stay as they were; only what a person
 * reads changed. The moved code's own empty states point at «Settings → Data» and «Settings →
 * Mapping» by name, which these labels keep true.
 */
export const SETTINGS_TABS = [
  { id: "widgets", label: "Display" },
  { id: "plan", label: "Pacing" },
  { id: "documents", label: "Assets" },
  { id: "data", label: "Data" },
  { id: "mapping", label: "Mapping" },
  { id: "alerts", label: "Notifications" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];
