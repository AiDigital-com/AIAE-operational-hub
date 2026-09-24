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

/** What one section's save came to. A failure carries the sentence to show, because only the
 *  section knows what its own 409 means ("the editor needs to reload" is not "save failed"). */
export type SectionSaveResult = { ok: true } | { ok: false; message: string };

export interface SettingsSectionHandle {
  /** Persist this section's draft. Never throws - a rejection is a result, so one section's
   *  failure cannot abandon the others mid-save. */
  save: () => Promise<SectionSaveResult>;
  /** Drop the draft back to what the server last said. */
  reset: () => void;
}

export interface SettingsSectionProps {
  /** Called whenever this section's dirty state flips. */
  onDirtyChange: (dirty: boolean) => void;
}

/** The sections the drawer shows, in tab order. */
export const SETTINGS_TABS = [
  { id: "plan", label: "Plan" },
  { id: "data", label: "Data" },
  { id: "widgets", label: "Widgets" },
  { id: "alerts", label: "Alerts" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];
