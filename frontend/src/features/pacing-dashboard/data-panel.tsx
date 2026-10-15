import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType } from "react";
import { formatError } from "../../shared/format/error";
import { fmtDate } from "../pacing/mock/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getPacingThirdPartyCampaigns, getPacingThirdPartyStatus, refetchPacingThirdParty,
  savePacingThirdParty,
} from "./api";
// The reference's own fingerprint and label, moved in rather than re-derived: the fingerprint is
// deliberately blind to campaign ORDER, and a save here TRIGGERS a pull - so a list that differed
// only in the order boxes were ticked would re-fetch CM360 for nothing.
import { normThirdParty, reportLabel } from "./spa/third-party-norm.js";
// The reference's own ceiling rule and dialog, moved in, so the switch and the sentence under it
// say what Pacing's build will actually do.
import { deliveryGate as deliveryGateUntyped } from "./spa/delivery-gate.js";
import ConfirmModalUntyped from "./spa/ConfirmModal.jsx";
import { useSavePacingDataSettings } from "./hooks";
import type { SettingsSectionHandle, SettingsSectionProps } from "./settings-section";
import { SheetSources, type AddLineItemRequest, type LoadedDimSource } from "./sheet-source-panel";
import type {
  PacingDataSettingsUpdateV1,
  PacingDataShape,
  PacingDeliveryStatsV1,
  PacingDimSource,
  PacingSheetDimSource,
} from "./types";

/** The gate reads `cells` and `measuredAt` defensively (a non-number or empty value is "not
 *  measured"), so the nulls the contract allows are within what it handles. */
const deliveryGate = deliveryGateUntyped as unknown as (
  stats: PacingDeliveryStatsV1 | null,
) => { disabled: boolean; reason: string | null };
const ConfirmModal = ConfirmModalUntyped as unknown as ComponentType<{
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}>;
import "./data-panel.css";

/**
 * Where a pacing's delivery is read from, and which optional extras are fetched with it - the Data tab
 * the retired SPA carried (`DataTab.jsx`), rebuilt on the Hub's own primitives.
 *
 * It exists because this setting is not cosmetic. `source` names the BigQuery table the delivery query
 * reads: `platform_mart` is the raw platform feed, `platform_mart_adjustments_view` is the same feed
 * with the team's manual delivery corrections applied. On a campaign that has ever been corrected the
 * two disagree - and with no screen to see or change it, a pacing created through the API silently
 * kept Pacing's `platform_mart` default while the numbers everyone quotes came from the other table.
 *
 * SAVES ONLY WHAT CHANGED. Pacing merges this namespace key by key, so sending an untouched setting is
 * indistinguishable from editing it to the value it already had - harmless for a boolean, not harmless
 * for a list. The diff below is what keeps `dim_sources` out of a save that only moved the radio, and
 * it is also this section's dirty flag: an empty patch is a section with nothing to save.
 *
 * The namespace carries more than this panel shows (a sheet binding). Those keys
 * are safe precisely because they are never sent: a key absent from the request is a key Pacing
 * leaves alone.
 */

/** The catalogue dimension source this panel offers as a checkbox. Mirrors Pacing's own
 *  `DIM_SOURCE_CATALOG` key, which is what a stored entry's `origin.catalog` names. */
const DEVICES_SOURCE_ID = "devices";

const SOURCE_OPTIONS: Array<{ value: string; name: string; table: string; note: string }> = [
  {
    value: "platform_mart",
    name: "Raw delivery",
    table: "platform_mart",
    note: "Delivery exactly as the platforms reported it.",
  },
  {
    value: "platform_mart_adjustments_view",
    name: "With manual adjustments",
    table: "platform_mart_adjustments_view",
    note: "The same feed with the team's manual delivery corrections applied on top.",
  },
];

/** Is the built-in Devices source in this pacing's stored list? Matched on `loader` as well as `id`,
 *  the way Pacing's own reader does: a sheet-backed source that happens to be named `devices` is not
 *  the catalogue one, and ticking this box must not claim it. */
function devicesOn(dimSources: PacingDimSource[]): boolean {
  return dimSources.some((entry) => entry?.id === DEVICES_SOURCE_ID && entry?.loader === "bq_mart");
}

/**
 * The whole `dim_sources` list to store for a given state of the Devices checkbox.
 *
 * Every entry this panel does not own is carried through, in its original order. That is the whole
 * point: the field is a whole-array replace, so a list rebuilt from this one checkbox alone would
 * delete the pacing's sheet-backed sources on a click that has nothing to do with them.
 */
function dimSourcesFor(
  devices: boolean,
  sheets: PacingSheetDimSource[] | undefined,
  existing: PacingDimSource[],
): PacingDimSource[] {
  // No sheet list handed in means "this caller does not edit them", NOT "there are none". The two
  // read the same from here and only one of them is safe: rebuilding the array without the stored
  // sheet sources deletes them on a click about the Devices checkbox. A caller that DOES edit them
  // passes its draft, empty list included.
  const sheetHalf = sheets ?? (existing.filter((e) => e?.loader === "sheet") as PacingSheetDimSource[]);
  // Everything that is neither the Devices entry nor a sheet source is carried through untouched, in
  // its original order. The field is a whole-array replace, so an entry rebuilt from this screen's
  // own controls alone would delete whatever Pacing adds to the list next.
  const others = existing.filter(
    (entry) => entry?.id !== DEVICES_SOURCE_ID && entry?.loader !== "sheet",
  );
  const builtIn: PacingDimSource[] = devices
    ? [{ id: DEVICES_SOURCE_ID, loader: "bq_mart", origin: { catalog: DEVICES_SOURCE_ID } }]
    : [];
  return [...builtIn, ...sheetHalf, ...others];
}

/** Order-insensitive on nothing: a sheet source list IS ordered (it is the order the cards show in),
 *  so this compares the bytes. Used only to decide whether the list moved at all. */
function sheetsKey(sheets: PacingSheetDimSource[] | undefined): string {
  return JSON.stringify(sheets);
}

interface DataDraft {
  source: string;
  fetchCreatives: boolean;
  fetchConversions: boolean;
  coefEnabled: boolean;
  netEnabled: boolean;
  primaryCvEnabled: boolean;
  deliveryTab: boolean;
  devices: boolean;
}

/**
 * Reads the stored namespace into the panel's state.
 *
 * An absent namespace is a pacing that has never had these settings written, and it reads as Pacing's
 * own defaults - raw `platform_mart`, every extra off - because that is what its refresh actually
 * does. An unrecognised stored source falls back the same way Pacing's `safeDataSource` does, so the
 * radio shows the table the query will really read rather than no selection at all.
 */
function seed(data: PacingDataShape | undefined): DataDraft {
  const stored = data?.source;
  const known = SOURCE_OPTIONS.some((option) => option.value === stored);
  const dimSources = Array.isArray(data?.dim_sources) ? data.dim_sources : [];
  return {
    source: known ? (stored as string) : "platform_mart",
    fetchCreatives: data?.fetch_creatives === true,
    fetchConversions: data?.fetch_conversions === true,
    coefEnabled: data?.coef_enabled === true,
    netEnabled: data?.net_enabled === true,
    primaryCvEnabled: data?.primary_cv_enabled === true,
    deliveryTab: data?.delivery_tab === true,
    devices: devicesOn(dimSources),
  };
}

/** The request body for a draft against what was loaded: every changed field, and nothing else. */
function diff(
  draft: DataDraft,
  base: DataDraft,
  existing: PacingDimSource[],
  sheets: PacingSheetDimSource[] | undefined,
  storedSheets: PacingSheetDimSource[] | undefined,
  labels: Record<string, unknown> | null,
  storedLabels: Record<string, unknown> | null,
  perf: Record<string, unknown> | null,
  storedPerf: Record<string, unknown> | null,
  perfTouched: boolean,
): PacingDataSettingsUpdateV1 {
  const body: PacingDataSettingsUpdateV1 = {};
  if (draft.source !== base.source) {
    body.source = draft.source as PacingDataSettingsUpdateV1["source"];
  }
  if (draft.fetchCreatives !== base.fetchCreatives) body.fetchCreatives = draft.fetchCreatives;
  if (draft.fetchConversions !== base.fetchConversions) body.fetchConversions = draft.fetchConversions;
  if (draft.coefEnabled !== base.coefEnabled) body.coefEnabled = draft.coefEnabled;
  if (draft.netEnabled !== base.netEnabled) body.netEnabled = draft.netEnabled;
  if (draft.primaryCvEnabled !== base.primaryCvEnabled) body.primaryCvEnabled = draft.primaryCvEnabled;
  if (draft.deliveryTab !== base.deliveryTab) body.deliveryTab = draft.deliveryTab;
  const sheetsMoved = !!sheets && sheetsKey(sheets) !== sheetsKey(storedSheets ?? []);
  if (draft.devices !== base.devices || sheetsMoved) {
    // Wrapped, and the wrapper is the signal: sending the field at all means "replace the list", so it
    // is built only when this checkbox actually moved. An unwrapped array could not say that - see the
    // contract's own note on why `PacingDimSourcesV1` exists.
    body.dimSources = {
      entries: dimSourcesFor(draft.devices, sheets, existing) as Array<Record<string, unknown>>,
    };
  }
  // Display names: sent only when this session changed them, so a drawer opened before a
  // teammate's edit cannot wipe it - the same rule the key has on Pacing's side.
  if (JSON.stringify(labels ?? null) !== JSON.stringify(storedLabels ?? null)) {
    body.valueLabels = (labels ?? {}) as Record<string, unknown>;
  }
  // Three states, and the wrapper is how the third one is said at all: no wrapper leaves the stored
  // source alone, `entry: null` disconnects it. Sent only when this session touched it AND the value
  // actually moved, so a drawer opened and closed changes nothing.
  if (perfTouched && JSON.stringify(perf ?? null) !== JSON.stringify(storedPerf ?? null)) {
    body.sheet = { entry: perf as Record<string, never> | null };
  }
  return body;
}

export interface PacingDataSectionProps extends SettingsSectionProps {
  slug: string;
  /** This pacing's stored `data` namespace, straight off the dashboard payload. */
  data: PacingDataShape | undefined;
  /** What the last build measured of the Delivery tab, straight off the dashboard payload. Null when
   *  it was never measured. Read-only: it greys the switch when the tab would pass Pacing's cap. */
  deliveryStats?: PacingDeliveryStatsV1 | null;
  /** How many line items currently carry a stored net ratio (from `planByLineItem`'s
   *  `storedNetRatio`). Read-only - it only steers the hint under the Net cost mode switch,
   *  and is never sent. */
  netRatioCount: number;
  /** Re-seeded whenever this changes - the drawer bumps it on open, so a reopened panel never
   *  shows an edit abandoned in a previous session. */
  seedKey: number;
  /** This pacing's stored `third_party` list. Edited on THIS tab because that is where the compare
   *  widget's own empty state sends you ("Add one in Settings → Data"), even though it is a
   *  different config key with a different endpoint - see this section's save(). */
  thirdParty: Record<string, unknown>[] | undefined;
  /** The sheet sources as the Mapping tab currently has them, and as they are stored.
   *
   *  This tab WRITES them and does not edit them: they live on `config.data`, which is this tab's
   *  patch, while the screen that edits them is Mapping - where the reference puts it. Passing both
   *  is what lets the save send them only when they actually moved. */
  sheetSources?: PacingSheetDimSource[];
  storedSheetSources?: PacingSheetDimSource[];
  /** Display names, same arrangement and for the same reason. */
  valueLabels?: Record<string, unknown> | null;
  storedValueLabels?: Record<string, unknown> | null;
  /** What each source last read, for the block beside it. */
  dimSourcesLoaded?: Record<string, Record<string, unknown>>;
  /** This pacing's widgets, so removing a source can say what uses it. */
  widgets?: unknown;
  /** Called after a re-read, so the host can refetch the figures that just changed. */
  onReadSource?: () => void;
  /** Hands the edited list up: the DRAWER owns this draft, because the Mapping tab edits the same
   *  list and one Save over two tabs cannot have two owners. */
  onSheetSourcesChange?: (next: PacingSheetDimSource[]) => void;
  /** «＋ Add line item…» in the sheet editors' line-item pickers - the same pickers Mapping shows. */
  onAddLineItem?: AddLineItemRequest | null;
  /** The sheet that replaces delivery: what is on screen, what is stored, and whether this session
   *  said anything about it at all - the three states the save has to tell apart. */
  /** Delivery per line item per day - the denominator of the coverage line under each source. */
  liDaily?: Record<string, unknown> | null;
  /** This pacing's line items, with their flights. Coverage counts the imported rows over the days
   *  each line item was RUNNING, so without this list the numerator is zero and the line reads 0%. */
  lineItems?: ReadonlyArray<{ id: string; label: string; fs?: string | null; fe?: string | null }>;
  perfSheet?: Record<string, unknown> | null;
  storedPerfSheet?: Record<string, unknown> | null;
  perfTouched?: boolean;
  onPerfSheetChange?: (next: Record<string, unknown> | null) => void;
  /** What the SPREADSHEET holds - its tabs and their headers. A different question from what the
   *  pacing has bound, and the editor needs both: the drawer owns it so Mapping sees the same one. */
  perfProbe?: Record<string, unknown> | null;
  perfProbing?: boolean;
  perfProbeMessage?: string | null;
  /** Binds a spreadsheet to this pacing by URL; resolves `{ok:false, message}` on a bad link or an
   *  unreadable file, which the connect form prints as it stands. */
  onPerfConnect?: (url: string) => Promise<{ ok: boolean; message?: string }>;
  onPerfDisconnect?: () => void;
  onPerfRetryProbe?: () => void;
  /** Whether this tab is on screen. The campaign picker's list is a BigQuery read on the Pacing
   *  side, so it is asked for only when someone is looking at it. */
  visible: boolean;
  /** Reports the two mode switches as this panel's DRAFT currently has them, not as they are
   *  stored. The Plan section gates its Net % field and its coefficient checkbox on them, and the
   *  drawer commits every section in one Save - so reading the stored value there would mean
   *  turning a mode on, saving, watching the drawer close, and reopening it before the controls
   *  the switch exists to reveal could be touched. The retired SPA held both halves in one
   *  component and read the draft directly; this is the same answer across the Hub's section seam. */
  onSwitchesChange: (switches: PacingModeSwitches) => void;
}

/** The pacing-level mode switches the Plan section's controls hang off. */
export interface PacingModeSwitches {
  coefEnabled: boolean;
  netEnabled: boolean;
  primaryCvEnabled: boolean;
  /** Not a mode switch: whether conversions are fetched, which decides whether a newly added line
   *  item has conversion data to seed its primary conversions from (the reference reads its draft). */
  fetchConversions: boolean;
}

/** One CM360 source: a report, and the campaigns picked inside it. */
interface Cm360Source {
  /** Row identity for React only - the stored id, when there is one, rides in `rest`. */
  key: string;
  report: string;
  campaigns: string[];
  /** The stored entry's own fields (id, audit stamps) carried forward, so saving a campaign change
   *  does not look like a brand new source to Pacing's own diff. */
  rest: Record<string, unknown>;
}

/**
 * Read the stored `third_party` list into the editor's sources.
 *
 * ALL of them, in stored order. The save is a whole-array replace, so an editor that showed only
 * the first would delete the rest the moment anything else on this tab was saved - the kind of
 * loss nobody sees happen.
 *
 * @param list the stored third_party array
 * @returns one editable source per stored CM360 entry
 */
function seedCm360(list: Record<string, unknown>[] | undefined): Cm360Source[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && e.type === "cm360")
    .map((e, i) => {
      const { report_name: reportName, campaigns, ...rest } = e as Record<string, unknown>;
      return {
        key: typeof rest.id === "string" && rest.id ? rest.id : `tp_${i}`,
        report: typeof reportName === "string" ? reportName : "",
        campaigns: Array.isArray(campaigns) ? campaigns.map(String) : [],
        rest,
      };
    });
}

/**
 * The wire shape. A source with no campaigns is dropped: Pacing refuses an empty list on an entry,
 * and an entry nobody finished authoring is not a source.
 *
 * Every entry MUST carry an id. Pacing's `safeThirdPartyEntry` drops an id-less entry outright -
 * silently, because an array that validates down to empty is a legal save - so a new source sent
 * without one is accepted with a 204 and then simply does not exist. A stored source already has
 * its id in `rest`; a new one gets it here, the way the reference's `newThirdPartyBlock` mints it.
 */
function cm360ToWire(sources: Cm360Source[]): Record<string, unknown>[] {
  return sources
    .filter((s) => s.campaigns.length > 0)
    .map((s) => ({
      // The audit stamps default to blank: the server owns them, and the client has no clock worth
      // trusting. Pacing stamps them on first save and keeps them on every later one.
      added_at: "",
      added_by: "",
      ...s.rest,
      id: typeof s.rest.id === "string" && s.rest.id ? s.rest.id : newThirdPartyId(),
      type: "cm360",
      report_name: s.report || null,
      campaigns: s.campaigns,
    }));
}

/** A fresh source id, in Pacing's own shape so a round-trip keeps it. */
function newThirdPartyId(): string {
  return `tp_${Math.random().toString(36).slice(2, 10)}`;
}

export const PacingDataSection = forwardRef<SettingsSectionHandle, PacingDataSectionProps>(
  function PacingDataSection(
    {
      slug, data, deliveryStats, netRatioCount, seedKey, thirdParty, sheetSources, storedSheetSources,
      valueLabels = null, storedValueLabels = null, dimSourcesLoaded, widgets, onReadSource,
      onSheetSourcesChange, liDaily, lineItems = [], perfSheet = null, storedPerfSheet = null, perfTouched = false,
      onPerfSheetChange, perfProbe = null, perfProbing = false, perfProbeMessage = null,
      onPerfConnect, onPerfDisconnect, onPerfRetryProbe, onAddLineItem = null, visible,
      onDirtyChange, onSwitchesChange,
    },
    ref,
  ) {
    const [draft, setDraft] = useState<DataDraft>(() => seed(data));
    const [base, setBase] = useState<DataDraft>(() => seed(data));
    const [extrasOpen, setExtrasOpen] = useState(false);
    // Closed on every visit, like its neighbour: most pacings connect nothing here.
    const [tpOpen, setTpOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    // Delivery tab: the question asked before it goes on, and whether the last build's measurement
    // leaves room for it at all.
    const [confirmDelivery, setConfirmDelivery] = useState(false);
    const deliveryGateState = deliveryGate(deliveryStats ?? null);
    const save = useSavePacingDataSettings(slug);

    // ── CM360 source ──────────────────────────────────────────────────────────────────────────
    // A different config key with its own endpoint, edited here because that is where the compare
    // widget sends people. Its draft is kept apart from the `data` draft so one cannot be sent
    // under the other's shape.
    const [tpBase, setTpBase] = useState<Cm360Source[]>(() => seedCm360(thirdParty));
    const [tpDraft, setTpDraft] = useState<Cm360Source[]>(tpBase);
    useEffect(() => {
      const seeded = seedCm360(thirdParty);
      setTpBase(seeded);
      setTpDraft(seeded);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey]);

    // Asked for only while this tab is on screen: Pacing answers it from BigQuery behind a
    // ten-minute cache, and nothing else on the drawer needs it.
    const campaignsQuery = useQuery({
      queryKey: ["pacing", "third-party-campaigns", slug],
      queryFn: () => getPacingThirdPartyCampaigns(slug),
      enabled: !!slug && visible,
      retry: false,
      staleTime: 5 * 60_000,
    });
    const allCampaigns = campaignsQuery.data?.campaigns ?? [];
    const reports = useMemo(() => {
      const names = new Set<string>();
      for (const c of allCampaigns) if (c.report) names.add(c.report);
      return [...names].sort();
    }, [allCampaigns]);
    /** The campaigns one source may pick from. Per source, not per tab: two sources can be scoped
     *  to two different reports, which is exactly what report scoping is for. */
    const campaignsFor = useMemo(
      () => (report: string) => allCampaigns.filter((c) => !report || c.report === report),
      [allCampaigns],
    );

    // Where the pull stands. Polled only while this tab is on screen and only while something is
    // actually pending: a ready file does not change by itself, and a poll that never stops is a
    // request every few seconds for the life of the drawer.
    const tpStatusQuery = useQuery({
      queryKey: ["pacing", "third-party-status", slug],
      queryFn: () => (slug ? getPacingThirdPartyStatus(slug) : Promise.resolve(null)),
      enabled: !!slug && visible,
      refetchInterval: (query) => (query.state.data?.state === "pending" ? 4000 : false),
    });
    const tpStatus = tpStatusQuery.data ?? null;

    // "Pull again now". Saving a source starts a pull as a side effect, but a pull is also the
    // thing you want when nothing about the source changed and the ad server has moved on.
    const refetch = useMutation({
      mutationFn: () => {
        if (!slug) throw new Error("This pacing has no dashboard yet.");
        return refetchPacingThirdParty(slug);
      },
      onSuccess: (outcome) => { if (outcome.started) tpStatusQuery.refetch(); },
    });
    const refetchNote = refetch.isError ? formatError(refetch.error)
      : refetch.data?.notConfigured ? "There is no CM360 source to pull yet."
        : refetch.data?.rateLimited ? "Too many pulls just now - try again in a minute."
          : null;
    const tpStatusText = useMemo(() => {
      if (!tpStatus) return "";
      if (tpStatus.state === "pending") return "Pulling ad-server rows\u2026";
      if (tpStatus.state === "ready") {
        const rows = (tpStatus.rowCount ?? 0).toLocaleString();
        // `fetchedAt` is a full ISO stamp; the app's own date format is what a reader expects
        // beside a count, not a machine timestamp with milliseconds in it.
        const when = tpStatus.fetchedAt ? fmtDate(tpStatus.fetchedAt) : "";
        return `Ad-server rows ready: ${rows}${when ? ` \u00b7 ${when}` : ""}`;
      }
      if (tpStatus.state === "error") return "The last ad-server pull failed.";
      return "Nothing pulled yet. Saving a source starts the pull.";
    }, [tpStatus]);

    const existingDimSources = useMemo(
      () => (Array.isArray(data?.dim_sources) ? data.dim_sources : []),
      [data]
    );

    // Re-hydrate from the latest server data on every open, never carrying a stale edit across a
    // close/reopen. Keyed on `seedKey`/`slug` rather than on `data`, so a background refetch
    // cannot clobber an edit in progress.
    useEffect(() => {
      const seeded = seed(data);
      setDraft(seeded);
      setBase(seeded);
      // Collapsed on every visit, as the retired tab was: the source is what this section is for,
      // and the extras are three settings nobody opens it to change.
      setExtrasOpen(false);
      setConfirmDelivery(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    const body = useMemo(
      () => diff(
        draft, base, existingDimSources, sheetSources, storedSheetSources, valueLabels,
        storedValueLabels, perfSheet, storedPerfSheet, perfTouched,
      ),
      [
        draft, base, existingDimSources, sheetSources, storedSheetSources, valueLabels,
        storedValueLabels, perfSheet, storedPerfSheet, perfTouched,
      ],
    );
    // The CM360 source is dirty on its own terms - it is a different key behind a different
    // endpoint, and the tab's dot has to light up for either.
    const tpDirty = useMemo(
      () => normThirdParty(cm360ToWire(tpDraft)) !== normThirdParty(cm360ToWire(tpBase)),
      [tpDraft, tpBase],
    );
    const tpDirtyRef = useRef(tpDirty);
    tpDirtyRef.current = tpDirty;
    const tpDraftRef = useRef(tpDraft);
    tpDraftRef.current = tpDraft;

    const dirty = Object.keys(body).length > 0 || tpDirty;

    // …and follow the server whenever a NEW namespace arrives and there is nothing to lose.
    //
    // The re-seed above is not enough on its own, and the gap is what made a saved setting read as
    // unsaved. `base` is what "unchanged" is measured against, and it was only ever re-read when the
    // drawer re-opened. A save answers before its own refetch lands, so the sequence is: patch
    // accepted -> `base` set to the draft -> payload refetches a moment later. If anything re-seeded
    // the section between those two points it read the OLD namespace, and `base` went back to the
    // value the user had just changed away from - the save was on the server, and the screen called
    // it a pending edit for as long as the page stayed loaded.
    //
    // Gated three ways, because this is the effect that must never eat an edit:
    //   - only when the namespace's own bytes changed (`dataKey`), never on an unrelated re-render;
    //   - only while the section is clean, so a draft in progress survives a background refetch -
    //     the same promise the comment above makes;
    //   - and `lastDataKey` is NOT advanced while dirty, so the arrival is picked up later, as soon
    //     as the edit is saved or reset, rather than being skipped.
    const dataKey = useMemo(() => JSON.stringify(data ?? null), [data]);
    const lastDataKey = useRef(dataKey);
    useEffect(() => {
      if (lastDataKey.current === dataKey || dirty) return;
      lastDataKey.current = dataKey;
      const seeded = seed(data);
      setDraft(seeded);
      setBase(seeded);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataKey, dirty]);

    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    // Reported from the draft, so a flip reaches the Plan section without a Save. Keyed on the two
    // booleans rather than on `draft`, so moving the source radio does not re-render the drawer.
    useEffect(
      () => {
        onSwitchesChange({
          coefEnabled: draft.coefEnabled,
          netEnabled: draft.netEnabled,
          primaryCvEnabled: draft.primaryCvEnabled,
          fetchConversions: draft.fetchConversions,
        });
      },
      [draft.coefEnabled, draft.netEnabled, draft.primaryCvEnabled, draft.fetchConversions, onSwitchesChange]
    );

    // The freshest patch, without re-rendering the drawer on every click: the handle below closes
    // over this ref rather than over a render's `body`.
    const bodyRef = useRef(body);
    bodyRef.current = body;
    const draftRef = useRef(draft);
    draftRef.current = draft;

    useImperativeHandle(ref, () => ({
      async save() {
        const patch = bodyRef.current;
        try {
          if (Object.keys(patch).length) {
            await save.mutateAsync(patch);
            setBase(draftRef.current);
          }
          // The CM360 source is a different config key behind a different endpoint, so it is a
          // second call - sent only when it actually moved, because saving it TRIGGERS a pull and
          // an unchanged list would re-pull on every unrelated Data save.
          if (tpDirtyRef.current && slug) {
            await savePacingThirdParty(slug, cm360ToWire(tpDraftRef.current));
            setTpBase(tpDraftRef.current);
          }
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: formatError(error) };
        }
      },
      reset() {
        setDraft(base);
        setTpDraft(tpBase);
      },
    }));

    function set(patch: Partial<DataDraft>) {
      setDraft((prev) => ({ ...prev, ...patch }));
    }

    return (
      <>
        <section className="pdata__section">
          <h3 className="pdata__heading">BigQuery source</h3>
          <div className="pdata__options">
            {SOURCE_OPTIONS.map((option) => (
              <label key={option.value} className="pdata__option">
                <input
                  type="radio"
                  name="pacing-data-source"
                  value={option.value}
                  checked={draft.source === option.value}
                  onChange={() => set({ source: option.value })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">{option.name}</span>
                  <span className="pdata__option-table">{option.table}</span>
                  <span className="pdata__hint">{option.note}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="pdata__hint pdata__hint--block">
            Applies on the next refresh. The figures on screen were built from the table this pacing
            read last time, and they stay that way until the delivery query runs again.
          </p>
        </section>

        <section className="pdata__section">
          {/* Collapsible with a count, as the reference has it: on most pacings there is nothing here,
              and a section that is always open spends a screen saying so. The count is what tells
              you whether to open it. */}
          <button
            type="button"
            className="pdata__collapse"
            aria-expanded={tpOpen}
            onClick={() => setTpOpen((value) => !value)}
          >
            <svg className="pdata__chevron" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
            <span className="pdata__heading">3rd Party Data</span>
            {tpDraft.length + (sheetSources?.length ?? 0) > 0 && (
              <span className="pdata__count">{tpDraft.length + (sheetSources?.length ?? 0)}</span>
            )}
          </button>
          {tpOpen && (
            <>
          <p className="pdata__hint pdata__hint--block">
            Which ad-server campaigns this pacing is compared against. Saving starts a pull; the
            rows land in the background and the compare widget says where it got to.
          </p>

          {/* Where the pull got to, beside the one control that starts another. Pacing holds ONE
              file per pacing covering every source, so this is the section's state, not a row's. */}
          <div className="pdata__tpstatus">
            <span className="pdata__hint">{tpStatus ? tpStatusText : ""}</span>
            <button
              type="button"
              className="pdata__remove"
              disabled={refetch.isPending || !slug || tpDraft.length === 0}
              title={tpDraft.length === 0 ? "Add a source first" : undefined}
              onClick={() => refetch.mutate()}
            >
              {refetch.isPending ? "Pulling\u2026" : "Pull again"}
            </button>
          </div>
          {refetchNote && <p className="pdata__hint pdata__hint--block">{refetchNote}</p>}

          {tpDraft.length === 0 && (
            <p className="pdata__hint pdata__hint--block">
              No ad-server source yet. Add one to compare this pacing against CM360.
            </p>
          )}

          {tpDraft.map((src, index) => (
            <div key={src.key} className="pdata__cm360">
              <div className="pdata__cm360-head">
                <span className="pdata__field-label">{reportLabel(src.report)}</span>
                <span className="pdata__hint">
                  {src.campaigns.length} {src.campaigns.length === 1 ? "campaign" : "campaigns"}
                </span>
                <button
                  type="button"
                  className="pdata__remove"
                  onClick={() => setTpDraft((prev) => prev.filter((_, i) => i !== index))}
                >
                  Remove source
                </button>
              </div>

              <label className="pdata__field">
                <span className="pdata__field-label">Report</span>
                <select
                  value={src.report}
                  disabled={campaignsQuery.isLoading || !reports.length}
                  onChange={(event) =>
                    // Campaigns are scoped to their report, so switching report drops a selection
                    // that no longer exists rather than silently keeping names from another export.
                    setTpDraft((prev) => prev.map((x, i) => (
                      i === index ? { ...x, report: event.target.value, campaigns: [] } : x
                    )))
                  }
                >
                  <option value="">
                    {campaignsQuery.isLoading ? "Loading…" : "Select a report"}
                  </option>
                  {reports.map((r) => (
                    <option key={r} value={r}>{reportLabel(r)}</option>
                  ))}
                </select>
              </label>

              {src.report && (
                <fieldset className="pdata__campaigns">
                  <legend className="pdata__field-label">
                    Campaigns ({src.campaigns.length} of {campaignsFor(src.report).length})
                  </legend>
                  <div className="pdata__campaign-list">
                    {campaignsFor(src.report).map((c) => {
                      const name = c.name ?? "";
                      const checked = src.campaigns.includes(name);
                      return (
                        <label key={name} className="pdata__check">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setTpDraft((prev) => prev.map((x, i) => (i === index ? {
                                ...x,
                                campaigns: checked
                                  ? x.campaigns.filter((y) => y !== name)
                                  : [...x.campaigns, name],
                              } : x)))
                            }
                          />
                          <span className="pdata__option-text">
                            <span className="pdata__option-name">{name}</span>
                            {/* Impressions are what tells a live campaign from one that never ran -
                                the only thing on screen that does, since both carry a name. */}
                            <span className="pdata__hint">
                              {(c.imp ?? 0).toLocaleString()} impressions
                              {c.lastSeen ? ` \u00b7 last seen ${c.lastSeen}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                    {campaignsFor(src.report).length === 0 && (
                      <p className="pdata__hint">This report carries no campaigns.</p>
                    )}
                  </div>
                </fieldset>
              )}
            </div>
          ))}

          {campaignsQuery.isError && (
            <p className="form-error pdata__hint--block">
              Could not load the campaign list: {formatError(campaignsQuery.error)}
            </p>
          )}
          {campaignsQuery.data?.stale && (
            <p className="pdata__hint pdata__hint--block">
              Showing the last known list - the ad-server read did not answer just now.
            </p>
          )}

          {/* No button of its own any more: "what am I connecting?" is ONE question with three
              answers, and it is asked once, below. Two buttons in two blocks is what made the third
              answer - a tab that replaces delivery - look like something the product cannot do. */}

          {/* ONE list, not two sections. CM360 rows and sheet tabs are both "data from somewhere
              else, hung on this pacing" - the reference lists them together with a kind chip, and
              splitting them was what made "+ Add" look like two unrelated buttons. */}
          <SheetSources
            onAddCm360={() => setTpDraft((prev) => [
              ...prev,
              { key: `new_${prev.length}_${Date.now()}`, report: "", campaigns: [], rest: {} },
            ])}
            slug={slug}
            sources={sheetSources ?? []}
            stored={storedSheetSources ?? []}
            loaded={(dimSourcesLoaded ?? {}) as Record<string, LoadedDimSource>}
            widgets={widgets}
            onRead={() => onReadSource?.()}
            liDaily={liDaily}
            lineItems={lineItems}
            perfSheet={perfSheet}
            onPerfSheetChange={(next) => onPerfSheetChange?.(next)}
            perfProbe={perfProbe}
            perfProbing={perfProbing}
            perfProbeMessage={perfProbeMessage}
            onPerfConnect={onPerfConnect}
            onPerfDisconnect={onPerfDisconnect}
            onPerfRetryProbe={onPerfRetryProbe}
            onAddLineItem={onAddLineItem}
            onChange={(next) => onSheetSourcesChange?.(next)}
          />
            </>
          )}
        </section>

        <section className="pdata__section">
          {/* Collapsible for its neighbours' reason: four switches most pacings never touch, each
              needing a paragraph to explain itself. Closed, the tab reads as what it is about.
              Named and ordered as the reference's "Advanced settings", Delivery tab first. */}
          <button
            type="button"
            className="pdata__collapse"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <svg className="pdata__chevron" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
            <span className="pdata__heading">Advanced settings</span>
          </button>
          {advancedOpen && (
          <div className="pdata__options">
            {/* The ceiling blocks turning it ON. A tab that is somehow still on above the ceiling
                stays switchable OFF, or the only way out would be a database edit. Turning it off
                is never questioned; turning it on asks first, because it is the one setting here
                that can cost the whole system a night. */}
            <label className="pdata__check">
              <input
                type="checkbox"
                checked={draft.deliveryTab}
                disabled={deliveryGateState.disabled && !draft.deliveryTab}
                onChange={(event) => {
                  if (!event.target.checked) { set({ deliveryTab: false }); return; }
                  setConfirmDelivery(true);
                }}
              />
              <span className="pdata__option-text">
                <span className="pdata__option-name">Delivery tab in source sheet</span>
                <span className="pdata__hint">
                  {deliveryGateState.reason
                    ?? "Adds a pivot-ready Delivery tab with naming dimensions, creatives and conversions to the source sheet after refresh."}
                </span>
              </span>
            </label>
            <label className="pdata__check">
              <input
                type="checkbox"
                checked={draft.coefEnabled}
                onChange={(event) => set({ coefEnabled: event.target.checked })}
              />
              <span className="pdata__option-text">
                <span className="pdata__option-name">Coefficient margin mode</span>
                {/* Deliberately does NOT name the switch below it. An option's hint joins its
                    checkbox's accessible name, so borrowing the neighbour's label here gave two
                    checkboxes on this panel the same name to anyone reading it aloud. */}
                <span className="pdata__hint">
                  Adds the coefficient controls on the plan screen: client cost = spend / (1 &minus;
                  margin). It reveals controls and moves no figure on its own - line items already on
                  coefficient cost keep working while it is off.
                </span>
              </span>
            </label>
            <label className="pdata__check">
              <input
                type="checkbox"
                checked={draft.netEnabled}
                onChange={(event) => set({ netEnabled: event.target.checked })}
              />
              <span className="pdata__option-text">
                <span className="pdata__option-name">Net cost mode</span>
                <span className="pdata__hint">
                  Client cost is invoiced at net. Margin, budget pacing and alerts use net = gross ×
                  each line item&apos;s ratio. The dashboard shows gross and net. Turning this off
                  restores gross and keeps the ratios.
                </span>
              </span>
            </label>
            {draft.netEnabled && netRatioCount === 0 && (
              <p className="pdata__hint pdata__hint--block">
                No line item carries a net ratio yet. Re-validate to pull net ratios from NetSuite,
                or enter them per line item on the plan screen - until then every figure stays gross.
              </p>
            )}
            {/* Primary conversions (Pacing spec 2026-09-13 §1). Disabled with no conversion data to
                count, because Pacing would refuse to call it operative anyway and the switch would
                read as broken. Once ON it stays switchable OFF whatever the fetches say - the same
                rule the retired SPA's Delivery gate used, so turning conversions off never traps the
                pacing with a switch it cannot clear. The reference also accepts a sheet tab that maps
                conversion actions; that lane still runs through an n8n that is not deployed here, so
                `Fetch conversions` is the only source this gate can see. */}
            <label className="pdata__check">
              <input
                type="checkbox"
                checked={draft.primaryCvEnabled}
                disabled={!draft.primaryCvEnabled && !draft.fetchConversions}
                onChange={(event) => set({ primaryCvEnabled: event.target.checked })}
              />
              <span className="pdata__option-text">
                <span className="pdata__option-name">Primary conversions</span>
                <span className="pdata__hint">
                  {!draft.primaryCvEnabled && !draft.fetchConversions
                    ? "Needs conversion data: turn on Fetch conversions first."
                    : draft.primaryCvEnabled && !draft.fetchConversions
                      ? "Off until conversion data is fetched. Choices are kept."
                      : "Choose conversions per line item on the plan screen. Conversions, CPA and CVR then count only the chosen ones; a line item with no choice keeps counting every conversion the platform reported."}
                </span>
              </span>
            </label>
          </div>
          )}
        </section>

        <section className="pdata__section">
          <button
            type="button"
            className="pdata__collapse"
            aria-expanded={extrasOpen}
            onClick={() => setExtrasOpen((value) => !value)}
          >
            <svg className="pdata__chevron" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
            <span className="pdata__heading">Additional data</span>
          </button>
          {extrasOpen && (
            <div className="pdata__options">
              <label className="pdata__check">
                <input
                  type="checkbox"
                  checked={draft.fetchCreatives}
                  onChange={(event) => set({ fetchCreatives: event.target.checked })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">Fetch DSP creative assets</span>
                  <span className="pdata__hint">
                    Adds Creative (asset) to breakdowns. Turning this off removes it after a refresh.
                  </span>
                </span>
              </label>
              <label className="pdata__check">
                <input
                  type="checkbox"
                  checked={draft.fetchConversions}
                  onChange={(event) => set({ fetchConversions: event.target.checked })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">Fetch conversions</span>
                  <span className="pdata__hint">
                    Adds Conversion Action to breakdowns, read from the conversions table paired with
                    the source above.
                  </span>
                </span>
              </label>
              <label className="pdata__check">
                <input
                  type="checkbox"
                  checked={draft.devices}
                  onChange={(event) => set({ devices: event.target.checked })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">Devices dimension</span>
                  <span className="pdata__hint">Adds Device (from DSP) as a breakdown axis.</span>
                </span>
              </label>
            </div>
          )}
        </section>

        {confirmDelivery && (
          <ConfirmModal
            title="Enable the Delivery tab?"
            message={"This tab mirrors every date × line item × dimension × creative row into the source "
              + "spreadsheet, which is heavy for the system. Turn it on only if you really need it. "
              + "Limit: 3,000,000 cells — about 90,000 rows. Above that the tab stops updating and the "
              + "setting turns itself off."}
            confirmLabel="Enable"
            onConfirm={() => { setConfirmDelivery(false); set({ deliveryTab: true }); }}
            onCancel={() => setConfirmDelivery(false)}
          />
        )}
      </>
    );
  }
);
