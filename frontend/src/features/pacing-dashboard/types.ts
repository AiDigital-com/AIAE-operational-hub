import type { components } from "../../shared/api/generated/schema";

export type PacingDashboardV1 = components["schemas"]["PacingDashboardV1"];
export type PacingDashboardCampaignV1 = components["schemas"]["PacingDashboardCampaignV1"];
export type PacingLineItemPlanV1 = components["schemas"]["PacingLineItemPlanV1"];
export type PacingPauseIntervalV1 = components["schemas"]["PacingPauseIntervalV1"];
export type PacingJournalEntryV1 = components["schemas"]["PacingJournalEntryV1"];
export type PacingRefreshStatusV1 = components["schemas"]["PacingRefreshStatusV1"];
export type PacingDisplayConflictV1 = components["schemas"]["PacingDisplayConflictV1"];
export type PacingLibraryEntryV1 = components["schemas"]["PacingLibraryEntryV1"];
export type PacingLibraryKindV1 = components["schemas"]["PacingLibraryKindV1"];
export type PacingLibraryConflictV1 = components["schemas"]["PacingLibraryConflictV1"];
export type PacingLikeResultV1 = components["schemas"]["PacingLikeResultV1"];

/** A single library-linked or inline widget instance inside `display.widgets[]` (opaque on the wire -
 *  see PacingDashboardV1.display's own description). Only the handful of fields the Hub's widget
 *  management UI reads/writes are typed here; everything else in a widget's own `spec` passes through
 *  untouched via the index signature. */
export interface PacingWidgetInstance {
  id: string;
  kind?: string;
  title?: string;
  profile?: string;
  schemaVersion?: number;
  datasetType?: string;
  lib?: { src: string; key: string };
  [key: string]: unknown;
}

/** One group of widget instances (`display.groups[]`) - a bordered/tinted frame around its member
 *  tiles (US-117), never a left-edge stripe. Shape confirmed against dash-gate's `shared/dash-blocks.js`
 *  `normGroups`: `id` matches `/^g_[a-z0-9]{4,16}$/`, `tileIds` reference widget instance ids. */
export interface PacingWidgetGroup {
  id: string;
  tileIds: string[];
  bg: string;
  title?: string;
  hideTitle?: boolean;
}

/** The subset of the opaque `display` object the Hub's widget management UI reads and writes. Every
 *  other key dash-gate's `display` may carry (`layout`, `widgetRanges`, `projectionModes`, `enabled`,
 *  `autoAdded`) is preserved as-is on save by spreading the original object - the Hub never originates
 *  or reshapes them (§6: "service logic: None"). */
export interface PacingDisplayShape {
  rev?: number;
  widgets?: PacingWidgetInstance[];
  groups?: PacingWidgetGroup[];
  [key: string]: unknown;
}

/** Discriminated outcome of a fire-and-forget refresh trigger (US-119): a 429 inside the cooldown is a
 *  normal, expected outcome to render as a countdown, never an error to throw. */
export type PacingRefreshOutcome =
  | { status: "started" }
  | { status: "cooldown"; retryAfterSeconds: number };

/** Discriminated outcome of a display save (US-116/117/118): a concurrent edit is reported, never
 *  silently overwritten. */
export type PacingDisplaySaveOutcome =
  | { status: "saved"; display: Record<string, unknown> }
  | { status: "conflict"; conflict: PacingDisplayConflictV1 };

/** Discriminated outcome of a library create/update/delete (US-118). */
export type PacingLibrarySaveOutcome<T> =
  | { status: "saved"; result: T }
  | { status: "conflict"; conflict: PacingLibraryConflictV1 };
