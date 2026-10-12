import type { components } from "../../shared/api/generated/schema";

export type PacingDashboardV1 = components["schemas"]["PacingDashboardV1"];
export type PacingDashboardCampaignV1 = components["schemas"]["PacingDashboardCampaignV1"];
export type PacingCampaignLinkV1 = components["schemas"]["PacingCampaignLinkV1"];
export type PacingLineItemPlanV1 = components["schemas"]["PacingLineItemPlanV1"];
export type PacingPauseIntervalV1 = components["schemas"]["PacingPauseIntervalV1"];
export type PacingJournalEntryV1 = components["schemas"]["PacingJournalEntryV1"];
export type PacingJournalEntryWriteV1 = components["schemas"]["PacingJournalEntryWriteV1"];
export type PacingRefreshStatusV1 = components["schemas"]["PacingRefreshStatusV1"];
export type PacingThirdPartyCampaignsV1 = components["schemas"]["PacingThirdPartyCampaignsV1"];
export type PacingThirdPartyCampaignV1 = components["schemas"]["PacingThirdPartyCampaignV1"];
export type PacingThirdPartyDataV1 = components["schemas"]["PacingThirdPartyDataV1"];
export type PacingThirdPartyStatusV1 = components["schemas"]["PacingThirdPartyStatusV1"];
export type PacingDisplayConflictV1 = components["schemas"]["PacingDisplayConflictV1"];
export type PacingLibraryEntryV1 = components["schemas"]["PacingLibraryEntryV1"];
export type PacingLibraryKindV1 = components["schemas"]["PacingLibraryKindV1"];
export type PacingLibraryConflictV1 = components["schemas"]["PacingLibraryConflictV1"];
export type PacingLikeResultV1 = components["schemas"]["PacingLikeResultV1"];
export type PacingDataSourceV1 = components["schemas"]["PacingDataSourceV1"];
export type PacingDataSettingsUpdateV1 = components["schemas"]["PacingDataSettingsUpdateV1"];
export type PacingNotifySettingsV1 = components["schemas"]["PacingNotifySettingsV1"];
export type PacingAlertsConfigV1 = components["schemas"]["PacingAlertsConfigV1"];
export type PacingSummaryProjectionV1 = components["schemas"]["PacingSummaryProjectionV1"];

/** One entry of `data.dim_sources` - a dimension this pacing loads beside its delivery. Opaque on the
 *  wire and owned by Pacing, which validates the shape and refuses a malformed one. The Data panel
 *  reads `id`/`loader` to answer "is the Devices catalogue source on?" and carries every other entry
 *  through untouched on save: the list is a whole-array replace, so an entry this panel drops is an
 *  entry the pacing loses. */
export interface PacingDimSource {
  id?: string;
  loader?: string;
  [key: string]: unknown;
}

/** What a probed spreadsheet holds. `readable: false` is an ANSWER, not an error - almost always
 *  "nobody has shared this file with us yet", which `shareWith` then tells the person how to fix. */
export type PacingSheetProbeV1 = components["schemas"]["PacingSheetProbeV1"];
/** One tab of a probed spreadsheet: its header row, and a few data rows to recognise a column by. */
export type PacingSheetTabV1 = components["schemas"]["PacingSheetTabV1"];
/** The distinct values of up to three columns of a sheet tab, each with how many rows carry it. */
export type PacingDimSourceValuesV1 = components["schemas"]["PacingDimSourceValuesV1"];
/** One distinct value and its row count. */
export type PacingDimSourceValueV1 = components["schemas"]["PacingDimSourceValueV1"];
/** What a re-read of a configured sheet source produced. */
export type PacingDimSourceReadV1 = components["schemas"]["PacingDimSourceReadV1"];
/** The Google Sheet whose tabs replace BigQuery delivery, as `config.data.sheet` stores it. Opaque
 *  on the wire and owned by Pacing, like a dimension source. */
export interface PacingPerfSheet {
  spreadsheet_id?: string;
  tabs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** A proposal for part of a sheet source's mapping. `available: false` is an answer, not an error. */
export type PacingDimSourceSuggestionsV1 = components["schemas"]["PacingDimSourceSuggestionsV1"];
/** One proposed route from a sheet name to a line item. */
export type PacingDimSourceBindingV1 = components["schemas"]["PacingDimSourceBindingV1"];
/** One proposed grouping of a column's values. */
export type PacingDimSourceGroupV1 = components["schemas"]["PacingDimSourceGroupV1"];

/** The roles a sheet column can be given, as a stored source spells them.
 *
 *  `date` and at least one of `dims` and one metric are what make a source READABLE - Pacing refuses
 *  to serve rows for anything less. `line_item` may be absent, but only on a source bound to a single
 *  line item: with no column naming a line item and no single binding, there is nothing to attribute
 *  a row to. */
/** One column given the BREAKDOWN role: the dimension it becomes, and the sheet column it reads.
 *
 *  Named because the moved editor hands this whole entry to its callbacks - `onCreateWidget(source,
 *  dim)` and `onOpenBreakdown(source, dim)` both pass it, not its key. */
export interface PacingSheetDimColumn {
  key: string;
  label: string;
  column: string;
  brk_dim?: string | null;
}

export interface PacingSheetColumns {
  date?: string;
  line_item?: string | null;
  dims?: PacingSheetDimColumn[];
  metrics?: Record<string, string>;
  cnb_name?: string | null;
  [key: string]: unknown;
}

/** A sheet-backed entry of `data.dim_sources`, narrowed from the opaque {@link PacingDimSource}.
 *
 *  Narrowed rather than replaced: the list also carries catalogue entries (`loader: "bq_mart"`, the
 *  Devices toggle), and both kinds have to survive a save that was about the other. */
export interface PacingSheetDimSource extends PacingDimSource {
  loader?: "sheet" | string;
  title?: string;
  origin?: {
    spreadsheet_id?: string;
    sheet_id?: number;
    title?: string;
    header_row?: number;
    columns?: PacingSheetColumns | null;
  };
  binding?: {
    mode?: "id_in_name" | "manual" | "single";
    line_item_id?: string;
    map?: Record<string, string>;
    exclude?: string[];
  };
}

/** The part of the opaque `data` namespace the Data panel reads and writes. Every other key it may
 *  carry (`delivery_tab`, `sheet`, and whatever Pacing adds next) is preserved by not being sent: the
 *  save is a per-key merge on Pacing's side, so a key this type does not name is a key this screen
 *  cannot disturb. */
export interface PacingDataShape {
  source?: string;
  fetch_creatives?: boolean;
  fetch_conversions?: boolean;
  /** Coefficient margin mode's pacing-level switch - a pure VISIBILITY gate, unlike `net_enabled`
   *  beside it: it reveals the per-line-item coefficient controls on the plan screen and changes no
   *  figure. A line item already carrying `costCoef` keeps computing client cost as
   *  spend / (1 - margin) while this is off. */
  coef_enabled?: boolean;
  net_enabled?: boolean;
  /** Primary conversions' pacing-level switch (Pacing spec 2026-09-13 §1). Stores a flag only - which
   *  conversion rows a line counts is driven by that line's own stored choice. */
  primary_cv_enabled?: boolean;
  /** Pacing's own answer to "is the switch actually doing anything": the switch is on AND at least
   *  one line item has conversion data. COMPUTED on every read by `merge.mjs`'s `publicDataConfig`
   *  and never stored, so it is read-only here. */
  primary_cv_operative?: boolean;
  dim_sources?: PacingDimSource[];
  /** The sheet that replaces delivery, when one is bound. */
  sheet?: PacingPerfSheet | null;
  [key: string]: unknown;
}

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
  /** Where a private copy came FROM - a library entry it was materialized out of. Dropped whenever
   *  the copy stops being a copy (duplicate, edit), so it never claims provenance it no longer has. */
  from?: { src: string; key: string };
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
 *  other key dash-gate's `display` may carry (`layout`, `widgetRanges`, `projectionModes`,
 *  `autoAdded`) is preserved as-is on save by spreading the original object - the Hub never originates
 *  or reshapes them (§6: "service logic: None"). */
export interface PacingDisplayShape {
  rev?: number;
  widgets?: PacingWidgetInstance[];
  groups?: PacingWidgetGroup[];
  /** The tile on/off map. Absent ≡ every tile on; only an explicit `false` hides one, which is why
   *  the stored map is the size of what someone actually turned off rather than of the dashboard.
   *  Keys are functional block ids and `w_` widget instances and nothing else - dash-gate refuses an
   *  unknown one rather than storing it. The rule itself is not restated here: it lives in
   *  `vendor/dash-blocks.js`, reached through `widgets/widget-tiles.ts`. */
  enabled?: Record<string, boolean>;
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
