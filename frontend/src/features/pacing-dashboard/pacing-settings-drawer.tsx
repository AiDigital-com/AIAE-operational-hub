import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../shared/style/cn";
import { CloseIcon } from "../../shared/ui/icons/icons";
import { Modal } from "../../shared/ui/modal/modal";
import { Sheet } from "../../shared/ui/sheet/sheet";
import { PacingPlanSection } from "../pacing-plan/pacing-plan-sheet";
import type { SplitFacts } from "../pacing-plan/container-editor";
import { PacingAlertsSection } from "./alerts-panel";
import { topNCompositeFor } from "./widgets/top-n-widget.js";
import { probeErrorText } from "./spa/sheet-source-norm.js";
import { probePacingSheet } from "./api";
import { PacingMappingSection } from "./mapping-panel";
import { PacingDataSection, type PacingModeSwitches } from "./data-panel";
import { PacingDocumentsSection } from "./documents/documents-panel";
import { PacingWidgetsSection } from "./widgets-section";
import { SETTINGS_TABS, type SettingsSectionHandle, type SettingsTabId } from "./settings-section";
import type {
  PacingCampaignLinkV1,
  PacingDataShape,
  PacingDisplayShape,
  PacingNotifySettingsV1,
  PacingSheetDimColumn,
  PacingSheetDimSource,
} from "./types";
import type { PacingLineItemPlanV1 } from "../pacing-plan/types";
import "./pacing-settings-drawer.css";

/**
 * Everything a pacing is configured with, behind one gear.
 *
 * The retired SPA had exactly this: a gear in the filter bar, a right-hand drawer, a row of tabs,
 * and ONE footer - "Unsaved changes", Reset, Save - covering all of them. The Hub had grown three
 * separate buttons opening three separate panels with three separate Save buttons instead, which
 * is three places to learn and three chances to leave an edit behind.
 *
 * One Save over three endpoints is the part that needs care, because they do not fail alike: the
 * plan has no revision, the data namespace is a per-key patch, and the display carries a revision
 * and can come back 409 meaning "someone else edited this; reload". So sections are saved and
 * REPORTED individually. A run where the plan lands and the display 409s is not "save failed" -
 * two thirds of it is done, and telling the user otherwise invites them to redo work that is
 * already saved.
 *
 * Unsaved work is never dropped silently. Switching tabs is safe (the drafts live in the sections
 * and survive it), but closing is not, so a dirty close asks first - `handleClose`'s rule in the
 * original drawer.
 */

export interface PacingSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  currency: string;
  /** The campaign rate (native → USD), 1 on a USD campaign - the plan editor converts budgets with it. */
  rate: number;
  /** The rate was set by hand (NetSuite refreshes leave it alone). */
  rateLocked?: boolean;
  /** The NetSuite rate the plan's Reset to NS restores. */
  nsRate?: number | null;
  /** The delivered values per dimension per line item, as fetched - the dim split menu and the
   *  value group editor list them. */
  availableSplits?: Record<string, Record<string, string[]>> | null;
  /** `facts.liDaily` / `facts.liSplitDaily` from the page's state - a container's "not covered by
   *  the splits" warning reads them. */
  splitFacts?: SplitFacts | null;
  planByLineItem: Record<string, PacingLineItemPlanV1>;
  /** The pacing's conversion-mart rows, straight off the dashboard payload. The plan editor needs
   *  them to offer a line item the actions it actually has - there is no other list of them. */
  conversions: Array<Record<string, unknown>> | undefined;
  data: PacingDataShape | undefined;
  display: PacingDisplayShape;
  capabilities: Record<string, unknown> | undefined;
  isAdmin: boolean;
  /** Handed to the widget section so its cards preview through the dashboard's own engine. */
  libraryEntries: Record<string, unknown> | undefined;
  /** What each configured dimension source last read, keyed by source id, straight off the
   *  dashboard payload. Read-only: the Data tab shows row counts and coverage beside the source
   *  that produced them, and there is nowhere else those come from. */
  dimSourcesLoaded: Record<string, Record<string, unknown>> | undefined;
  /** The stored `third_party` list, straight off the dashboard payload. Edited on the Data tab. */
  thirdParty: Record<string, unknown>[] | undefined;
  /** The stored mapping entities (§11), straight off the dashboard payload. NULL means this
   *  pacing predates the v3 mapping model; [] means it was migrated and nothing is mapped. */
  mappingsV3: Record<string, unknown>[] | null | undefined;
  /** The published CM360 file, if a pull has landed. The mapping editor reads its placements so an
   *  alias can be matched against what is actually there rather than guessed. */
  thirdPartyFile: { rows?: Record<string, unknown>[] | null } | null | undefined;
  /** The delivery side as the comparison engine wants it. The mapping editor builds the engine's
   *  own rows from these, so the numbers it shows are the ones the widget will produce. */
  factsDaily: Record<string, unknown>[] | null | undefined;
  /** Delivery per line item per day, built by the page with the engine the dashboard itself uses.
   *  The denominator of "this source covers N% of pacing impressions". */
  liDaily: Record<string, unknown> | null | undefined;
  types: Record<string, unknown>[] | null | undefined;
  liPlan: Record<string, unknown> | null | undefined;
  creatives: Record<string, unknown>[] | null | undefined;
  /** This pacing's stored alert configuration (§14), straight off the dashboard payload. */
  notify: PacingNotifySettingsV1 | undefined;
  /** Whether this pacing has a video line item - gates the Alerts tab's two VCR-only rows. */
  hasVideo: boolean;
  /** The stored campaign links (§16), straight off the dashboard payload's `campaign.links`. */
  links: PacingCampaignLinkV1[] | undefined;
  /** The IO number, shown read-only on the Documents tab. */
  orderNumber: string | undefined;
  /** Which tab to land on when the drawer opens; null keeps whatever tab was last shown. Set by
   *  the header's "+ Add documents" pill, which promises the Documents tab specifically. */
  initialTab?: SettingsTabId | null;
  /** A widget a tile's "Edit…" asked the drawer to open its builder on. */
  initialWidgetId?: string | null;
  /** "Open the Breakdown" from a sheet column: the dashboard owns the filters and the scroll. */
  onOpenBreakdown?: (source: PacingSheetDimSource, dim: PacingSheetDimColumn) => void;
  /** Called once that request has been consumed, so a later open lands on the list instead. */
  onWidgetEditorOpened?: () => void;
  /** The Line Items tile's ⋯ → Customize… (Pacing `85d353c`): open that block's settings card on the
   *  widgets tab. A new value per request. */
  customizeLineItemsRequest?: number | null;
  /** Called once that request has been consumed. */
  onCustomizeLineItemsOpened?: () => void;
  /** A Layout-mode session is open on the page behind the drawer (Display's display-cas gate). */
  layoutSessionOpen?: boolean;
  /** Layout mode's "+ Add": open Display's Library screen. A new number per request. */
  openLibraryRequest?: number | null;
  /** Called once that request has been honoured. */
  onLibraryOpened?: () => void;
  /** Display's unsaved draft to preview on the page behind the drawer, or null. */
  onPreviewChange?: (display: PacingDisplayShape | null) => void;
  /** Re-read the dashboard after a save that landed. */
  onSaved: () => void;
}

type DirtyMap = Record<SettingsTabId, boolean>;
const NOTHING_DIRTY: DirtyMap = {
  plan: false,
  mapping: false,
  data: false,
  widgets: false,
  alerts: false,
  documents: false,
};

export function PacingSettingsDrawer({
  open,
  onClose,
  slug,
  currency,
  rate,
  rateLocked,
  nsRate,
  availableSplits,
  splitFacts,
  planByLineItem,
  dimSourcesLoaded,
  conversions,
  data,
  display,
  capabilities,
  isAdmin,
  libraryEntries,
  thirdParty,
  mappingsV3,
  thirdPartyFile,
  factsDaily,
  liDaily,
  types,
  liPlan,
  creatives,
  notify,
  hasVideo,
  links,
  orderNumber,
  initialTab = null,
  initialWidgetId = null,
  onOpenBreakdown,
  onWidgetEditorOpened,
  customizeLineItemsRequest = null,
  onCustomizeLineItemsOpened,
  layoutSessionOpen = false,
  openLibraryRequest = null,
  onLibraryOpened,
  onPreviewChange,
  onSaved,
}: PacingSettingsDrawerProps) {
  // Display first, as in Pacing - the drawer's first tab.
  const [tab, setTab] = useState<SettingsTabId>("widgets");
  const [dirty, setDirty] = useState<DirtyMap>(NOTHING_DIRTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Array<{ tab: SettingsTabId; message: string }>>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  // Bumped on every open: the sections re-seed on it, so a draft abandoned last time is gone.
  const [seedKey, setSeedKey] = useState(0);
  // The two pacing-level mode switches, LIVE from the Data section's draft rather than from the
  // stored payload. They sit here because two sections need one answer: the Data tab owns them and
  // the Plan tab's controls hang off them, and a single Save commits both.
  //
  // `null` until that section speaks, NOT a copy of the payload seeded here. A second seed of its
  // own is how this went wrong once already: the drawer read `data` at ITS first render, which can
  // be a render before the payload has arrived, and nothing afterwards corrected it - the Data
  // section only reports when its own value CHANGES, and a value that was right from the start
  // never changes. The Plan tab then drew no coefficient control on a pacing whose switch was
  // plainly ticked one tab over. Falling back to the payload per render instead of latching it once
  // means the worst case is a render that agrees with storage, which is also the right answer.
  const [switches, setSwitches] = useState<PacingModeSwitches | null>(null);
  const liveSwitches: PacingModeSwitches = switches ?? {
    coefEnabled: data?.coef_enabled === true,
    netEnabled: data?.net_enabled === true,
    primaryCvEnabled: data?.primary_cv_enabled === true,
  };
  // Read by the open effect below without being a dependency of it - see its comment.
  const initialTabRef = useRef(initialTab);
  initialTabRef.current = initialTab;

  const plan = useRef<SettingsSectionHandle>(null);
  const dataSection = useRef<SettingsSectionHandle>(null);
  const mapping = useRef<SettingsSectionHandle>(null);
  const widgets = useRef<SettingsSectionHandle>(null);
  const alerts = useRef<SettingsSectionHandle>(null);
  const documents = useRef<SettingsSectionHandle>(null);
  const handles = useMemo(
    () => ({ plan, data: dataSection, widgets, mapping, alerts, documents }) as Record<SettingsTabId, typeof plan>,
    []
  );

  // Net cost mode: how many line items carry a STORED ratio right now. Steers only the hint under
  // the Data tab's switch ("re-validate to pull ratios") - storedNetRatio is the ungated value, so
  // the count is right even while the switch itself is still off.
  // The line items a sheet source can bind its names to. Labelled the way the dashboard labels them -
  // "LI <id>" plus the name when there is one - so a person routing 40 sheet names is choosing from
  // the same list they read everywhere else, not from bare ids.
  // The tile a mapping handoff just minted, so the Widgets tab opens its editor. Held here rather
  // than pushed through the host's own `initialWidgetId`, which belongs to whoever opened the
  // drawer and must not be overwritten by a handoff inside it.
  const [pendingWidgetId, setPendingWidgetId] = useState<string | null>(null);

  // The table a high-cardinality breakdown needs. 7,616 apps under a line item is not a donut, so
  // the mapping screen offers a top-20 table instead - and the draft it lands in belongs to the
  // widget section, behind the same single Save.
  //
  // `(source, dim)`, because that is the order the moved editor calls this in, and `dim` arrives as
  // the whole column entry rather than its key. It used to be declared `(dim, source)`: TypeScript
  // was happy, and the widget got a title that was a source OBJECT, which threw inside the tile.
  //
  // The SHAPE is `topNCompositeFor`, not the moved `topNWidgetFor` - see that file for why: the
  // moved one still mints the pre-v2 table shape the server has refused since the canonical cutover.
  const createDimWidget = useCallback((source: Record<string, unknown>, dim: PacingSheetDimColumn) => {
    const added = widgets.current?.addWidget?.(topNCompositeFor(source, dim, 20));
    // Null means the cap is reached. The Display tab is where something gets removed, so that is
    // where this lands either way - with the new widget, or with the reason there is none.
    setTab("widgets");
    // And open its editor, as the reference does: landing on a list of twenty tiles with the new one
    // somewhere in it is not an answer to "create a table of this column". `addWidget` answers with
    // the EXISTING tile's id when one already reads this axis, so a second press opens that one
    // instead of minting a duplicate.
    if (added) setPendingWidgetId(added);
    return added;
  }, []);

  // Sheet sources and display names are edited on MAPPING, where the reference puts them, and saved
  // by DATA, which owns the `config.data` patch. Two tabs over one key is how a save of one silently
  // drops the other, so the draft is held HERE and handed to both - the editor on one side, the
  // writer on the other.
  const [sheetDraft, setSheetDraft] = useState<PacingSheetDimSource[]>([]);
  const [labelsDraft, setLabelsDraft] = useState<Record<string, unknown> | null>(null);
  // The sheet that replaces delivery. `undefined` is load-bearing and is NOT the same as null: it
  // means this session gave no instruction, while null means "disconnect the stored one".
  const [perfDraft, setPerfDraft] = useState<Record<string, unknown> | null | undefined>(undefined);

  // The performance sheet, as the editor reads it: what tabs the SPREADSHEET has, which is a
  // different question from what the pacing has bound. Held here, beside the draft, because both
  // Data (connect, disconnect) and Mapping (the card, the editor) ask it.
  const [perfProbe, setPerfProbe] = useState<Record<string, unknown> | null>(null);
  const [perfProbing, setPerfProbing] = useState(false);
  const [perfProbeErr, setPerfProbeErr] = useState<{ error?: string; shareWith?: string } | null>(null);
  // The id already ATTEMPTED, not the one that succeeded: the lazy effect below re-runs whenever
  // `perfProbing` flips back, so keying off success would re-probe for ever on a failure - and burn
  // the rate budget doing it. Retry clears this explicitly. (The reference's own note.)
  const probedIdRef = useRef<string | null>(null);

  const runPerfProbe = useCallback(async (id: string) => {
    probedIdRef.current = id;
    setPerfProbing(true);
    setPerfProbeErr(null);
    try {
      const r = await probePacingSheet(slug, `https://docs.google.com/spreadsheets/d/${id}/edit`);
      if (!r.readable) {
        const e = { error: r.error ?? undefined, shareWith: r.shareWith ?? undefined };
        setPerfProbeErr(e);
        return { ok: false as const, ...e };
      }
      setPerfProbe({
        title: r.title ?? "",
        tabs: (r.tabs ?? []).map((tab) => ({
          sheet_id: tab.sheetId,
          title: tab.title,
          row_count: tab.rowCount,
          col_count: tab.colCount,
          header_row: tab.headerRow,
          headers: tab.headers ?? [],
          sample: tab.sample ?? [],
          grid: tab.grid ?? [],
        })),
      });
      return { ok: true as const };
    } catch {
      const e = { error: "probe_failed", shareWith: undefined };
      setPerfProbeErr(e);
      return { ok: false as const, ...e };
    } finally {
      setPerfProbing(false);
    }
  }, [slug]);

  const storedSheets = useMemo(
    () => (Array.isArray(data?.dim_sources) ? data.dim_sources : [])
      .filter((entry) => (entry as PacingSheetDimSource)?.loader === "sheet") as PacingSheetDimSource[],
    [data],
  );
  const storedLabels = useMemo(
    () => (data?.value_labels ?? null) as Record<string, unknown> | null,
    [data],
  );
  // Back to what the server holds. Used by BOTH the re-seed on opening and Reset - they are the same
  // act, and writing it twice is how Reset came to miss these three: a section's own draft is reset
  // through its handle, but these live HERE because Mapping and Data share them.
  const seedDrafts = useCallback(() => {
    setSheetDraft(storedSheets);
    setLabelsDraft(storedLabels);
    setPerfDraft(undefined);
  }, [storedSheets, storedLabels]);

  // Re-seeded on every opening, like every other section: a drawer reopened must never show an edit
  // abandoned in a previous session.
  useEffect(() => {
    seedDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, slug]);

  // The spreadsheet the editor is working against, draft first.
  const perfSheet = (perfDraft === undefined ? (data?.sheet ?? null) : perfDraft) as
    { spreadsheet_id?: string } | null;
  const perfSheetId = perfSheet?.spreadsheet_id ?? "";

  // Probe lazily, and only while the drawer is open on a tab that shows it - the reference's own
  // gate. Re-connecting the SAME spreadsheet keeps the bindings; a different one starts clean
  // rather than silently pairing tab ids across two files.
  useEffect(() => {
    if (!open || (tab !== "data" && tab !== "mapping")) return;
    if (!perfSheetId || perfProbing || probedIdRef.current === perfSheetId) return;
    void runPerfProbe(perfSheetId);
  }, [open, tab, perfSheetId, perfProbing, runPerfProbe]);

  // A closed drawer forgets the probe, so reopening re-reads rather than showing a stale tab list.
  useEffect(() => {
    if (open) return;
    setPerfProbe(null);
    setPerfProbeErr(null);
    probedIdRef.current = null;
  }, [open]);

  const connectPerfSheet = useCallback(async (url: string) => {
    const m = String(url).match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,120})(?:[/?#]|$)/);
    if (!m) return { ok: false as const, message: probeErrorText("bad_url") };
    const id = m[1];
    const r = await runPerfProbe(id);
    if (!r.ok) return { ok: false as const, message: probeErrorText(r.error, r.shareWith) };
    setPerfDraft((cur) => {
      const current = (cur === undefined ? (data?.sheet ?? null) : cur) as { spreadsheet_id?: string } | null;
      return current && current.spreadsheet_id === id ? current : { spreadsheet_id: id, tabs: [] };
    });
    return { ok: true as const };
  }, [runPerfProbe, data]);

  const disconnectPerfSheet = useCallback(() => {
    // null, not undefined: this is an instruction to drop the stored one, not the absence of one.
    setPerfDraft(null);
    setPerfProbe(null);
    setPerfProbeErr(null);
    probedIdRef.current = null;
  }, []);

  const perfProbeMessage = perfProbeErr
    ? probeErrorText(perfProbeErr.error, perfProbeErr.shareWith)
    : null;

  const sheetLineItems = useMemo(
    () =>
      Object.keys(planByLineItem).map((id) => {
        const plan = planByLineItem[id] as unknown as { name?: unknown; rateType?: unknown };
        const name = typeof plan?.name === "string" && plan.name.trim() ? plan.name.trim() : "";
        // The rate type is part of the label, not decoration: on a sheet whose names differ only by
        // their tail, "LI 695345 · CPV" is what tells a person which of two line items they are
        // routing to. The reference labels them the same way.
        const rate = typeof plan?.rateType === "string" && plan.rateType ? plan.rateType : "CPM";
        // The flight travels with the id: coverage is measured over the days a line item was
        // actually running, so a source that stops early is not flattered by the days after it.
        const flight = plan as unknown as { flightStart?: unknown; flightEnd?: unknown };
        return {
          id,
          label: `LI ${id}${name ? ` · ${name}` : ""} · ${rate}`,
          fs: typeof flight?.flightStart === "string" ? flight.flightStart : null,
          fe: typeof flight?.flightEnd === "string" ? flight.flightEnd : null,
        };
      }),
    [planByLineItem]
  );

  const netRatioCount = useMemo(
    () =>
      Object.values(planByLineItem).filter(
        (p) => typeof p?.storedNetRatio === "number" && p.storedNetRatio > 0 && p.storedNetRatio < 1
      ).length,
    [planByLineItem]
  );

  // Everything that has to happen once per opening: re-seed the sections, and forget what the last
  // session left behind.
  //
  // In an EFFECT, not during render. It used to run in the render body, guarded by a ref the same
  // render mutated - and under React's development double-invoke that guard defeated itself: the
  // first invocation set `openedRef.current = true` and queued the two resets, the second saw the
  // ref already true and skipped the whole block, so neither reset survived. The symptom was not
  // subtle. `seedKey` never left 0, so no section ever re-seeded on open; and `dirty` kept whatever
  // the previous session put there, so a pacing whose setting had just been saved re-opened with the
  // tab still flagged and Save still lit, over a panel that agreed it had nothing to save.
  //
  // A ref written during render is the bug, not the double-invoke that exposed it: render must stay
  // free of side effects for exactly this reason. `open` as the only dependency is what makes this
  // once-per-opening; `initialTab` is read, never depended on, so a changing prop cannot yank the
  // user off the tab they are on mid-session.
  useEffect(() => {
    if (!open) return;
    setSeedKey((n) => n + 1);
    setDirty(NOTHING_DIRTY);
    setErrors([]);
    // Only when the opener promised a tab: the gear keeps the last-shown tab, the way it always
    // has, while "+ Add documents" must land on Documents rather than wherever the user left off.
    if (initialTabRef.current) setTab(initialTabRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // One stable callback per section: an inline arrow would be a new function on every render, and
  // the sections report their dirty state from an effect keyed on it.
  const markPlan = useCallback((v: boolean) => setDirty((d) => (d.plan === v ? d : { ...d, plan: v })), []);
  const markData = useCallback((v: boolean) => setDirty((d) => (d.data === v ? d : { ...d, data: v })), []);
  const markMapping = useCallback((v: boolean) => setDirty((d) => (d.mapping === v ? d : { ...d, mapping: v })), []);
  // Same shape and the same reason: stable identity, and a no-op when nothing moved, so the Data
  // section's report cannot loop against its own effect.
  const markSwitches = useCallback(
    (v: PacingModeSwitches) =>
      setSwitches((s) => (s
        && s.coefEnabled === v.coefEnabled
        && s.netEnabled === v.netEnabled
        && s.primaryCvEnabled === v.primaryCvEnabled ? s : v)),
    []
  );
  const markWidgets = useCallback((v: boolean) => setDirty((d) => (d.widgets === v ? d : { ...d, widgets: v })), []);
  const markAlerts = useCallback((v: boolean) => setDirty((d) => (d.alerts === v ? d : { ...d, alerts: v })), []);
  const markDocuments = useCallback(
    (v: boolean) => setDirty((d) => (d.documents === v ? d : { ...d, documents: v })),
    []
  );

  const dirtyTabs = SETTINGS_TABS.filter((t) => dirty[t.id]).map((t) => t.id);
  const anyDirty = dirtyTabs.length > 0;
  // Display's display-cas actions (the Library's block Add and layout Apply) wait for the WHOLE
  // drawer to be clean, as Pacing's do; Display knows its own draft, this is everyone else's.
  const othersDirty = dirtyTabs.some((id) => id !== "widgets");
  // Layout mode's "+ Add" lands on Display, whichever tab was showing.
  useEffect(() => {
    if (openLibraryRequest != null) setTab("widgets");
  }, [openLibraryRequest]);

  async function handleSave() {
    setSaving(true);
    setErrors([]);
    const failures: Array<{ tab: SettingsTabId; message: string }> = [];
    // All or nothing on a precheck, as the reference's single-request save is: a coefficient error
    // in the plan used to stop the plan alone while Data and the rest went through.
    for (const id of dirtyTabs) {
      const check = handles[id].current?.precheck?.();
      if (check && !check.ok) failures.push({ tab: id, message: check.message });
    }
    if (failures.length > 0) {
      setSaving(false);
      setErrors(failures);
      return;
    }
    // Sequential, not parallel: three writes to one pacing, and the order they land in is the order
    // a reader would expect. Concurrency here would buy milliseconds and cost a comprehensible
    // failure story.
    for (const id of dirtyTabs) {
      const result = await handles[id].current?.save();
      if (result && !result.ok) failures.push({ tab: id, message: result.message });
    }
    setSaving(false);
    setErrors(failures);
    // Anything that landed changed the pacing, so re-read even on a partial failure - otherwise the
    // sections that saved would keep showing the draft they just committed as if it were pending.
    if (failures.length < dirtyTabs.length) onSaved();
    if (failures.length === 0) onClose();
  }

  function handleReset() {
    for (const t of SETTINGS_TABS) handles[t.id].current?.reset();
    // The sheet sources, the display names and the performance sheet are NOT a section's own draft -
    // they are edited on Mapping and written by Data, so the drawer holds them and the loop above
    // cannot reach them. Without this, Reset left a removed source removed.
    seedDrafts();
    setErrors([]);
  }

  function requestClose() {
    if (anyDirty && !saving) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  const tabLabel = (id: SettingsTabId) => SETTINGS_TABS.find((t) => t.id === id)?.label ?? id;

  return (
    <>
      <Sheet
        open={open}
        onClose={requestClose}
        title="Pacing settings"
        headerActions={
          <button type="button" title="Close (Esc)" aria-label="Close" onClick={requestClose}>
            <CloseIcon />
          </button>
        }
        tabs={
          <>
            {SETTINGS_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={cn("psettings__tab", tab === t.id && "psettings__tab--active")}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id}
                // The state is named on the BUTTON, and the dot is decorative. Labelling the dot
                // instead appends its words straight onto the tab's own with no separator - the
                // accessible name came out "Dataunsaved changes".
                aria-label={dirty[t.id] ? `${t.label}, unsaved changes` : undefined}
              >
                {t.label}
                {/* A dot, not a count: which tab has unsaved work is the question a single Save
                    raises, and it has to be answerable without visiting all three. */}
                {dirty[t.id] && <span className="psettings__tab-dot" aria-hidden="true" />}
              </button>
            ))}
          </>
        }
        footer={
          <div className="psettings__footer">
            <div className="psettings__footer-state" role="status">
              {errors.length > 0 ? (
                errors.map((e) => (
                  <span key={e.tab} className="form-error psettings__footer-error">
                    {tabLabel(e.tab)}: {e.message}
                  </span>
                ))
              ) : anyDirty ? (
                <span className="psettings__dirty">Unsaved changes</span>
              ) : null}
            </div>
            <div className="psettings__footer-actions">
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={handleReset}
                disabled={!anyDirty || saving}
              >
                Reset
              </button>
              <button
                type="button"
                className="button button--primary button--sm"
                onClick={() => void handleSave()}
                disabled={!anyDirty || saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        }
      >
        {/* All three stay mounted. They hold the drafts a single Save commits, so unmounting the two
            a user is not looking at would quietly discard two thirds of their work on a tab click. */}
        <div className={cn("psettings__panel", tab !== "plan" && "psettings__panel--hidden")}>
          <PacingPlanSection
            ref={plan}
            slug={slug}
            currency={currency}
            rate={rate}
            rateLocked={rateLocked}
            nsRate={nsRate}
            rawSplits={availableSplits}
            splitFacts={splitFacts}
            widgets={display?.widgets as unknown[] | undefined}
            netFeatureOn={liveSwitches.netEnabled}
            coefEnabled={liveSwitches.coefEnabled}
            primaryCvEnabled={liveSwitches.primaryCvEnabled}
            conversions={conversions}
            planByLineItem={planByLineItem}
            seedKey={seedKey}
            onDirtyChange={markPlan}
          />
        </div>
        <div className={cn("psettings__panel", tab !== "data" && "psettings__panel--hidden")}>
          <PacingDataSection
            ref={dataSection}
            slug={slug}
            data={data}
            netRatioCount={netRatioCount}
            seedKey={seedKey}
            thirdParty={thirdParty}
            sheetSources={sheetDraft}
            storedSheetSources={storedSheets}
            valueLabels={labelsDraft}
            storedValueLabels={storedLabels}
            dimSourcesLoaded={dimSourcesLoaded}
            widgets={display?.widgets}
            onReadSource={onSaved}
            onSheetSourcesChange={setSheetDraft}
            liDaily={liDaily}
            lineItems={sheetLineItems}
            perfSheet={perfDraft === undefined ? (data?.sheet ?? null) : perfDraft}
            storedPerfSheet={(data?.sheet ?? null) as Record<string, unknown> | null}
            perfTouched={perfDraft !== undefined}
            onPerfSheetChange={setPerfDraft}
            perfProbe={perfProbe}
            perfProbing={perfProbing}
            perfProbeMessage={perfProbeMessage}
            onPerfConnect={connectPerfSheet}
            onPerfDisconnect={disconnectPerfSheet}
            onPerfRetryProbe={() => { probedIdRef.current = null; if (perfSheetId) void runPerfProbe(perfSheetId); }}
            visible={tab === "data"}
            onDirtyChange={markData}
            onSwitchesChange={markSwitches}
          />
        </div>
        <div className={cn("psettings__panel", tab !== "widgets" && "psettings__panel--hidden")}>
          <PacingWidgetsSection
            ref={widgets}
            slug={slug}
            display={display}
            capabilities={capabilities}
            isAdmin={isAdmin}
            libraryEntries={libraryEntries}
            seedKey={seedKey}
            initialWidgetId={pendingWidgetId ?? initialWidgetId}
            onWidgetEditorOpened={() => { setPendingWidgetId(null); onWidgetEditorOpened?.(); }}
            customizeLineItemsRequest={customizeLineItemsRequest}
            onCustomizeLineItemsOpened={onCustomizeLineItemsOpened}
            drawerDirty={othersDirty}
            layoutSessionOpen={layoutSessionOpen}
            openLibraryRequest={openLibraryRequest}
            onLibraryOpened={onLibraryOpened}
            // A layout Apply replaced the arrangement: Pacing's drawer closes on it, discarding the
            // (clean - the gate required it) draft rather than asking about it.
            onCloseRequest={onClose}
            onPreviewChange={onPreviewChange}
            draftCm360Configured={(thirdParty?.length ?? 0) > 0}
            onDirtyChange={markWidgets}
          />
        </div>
        <div className={cn("psettings__panel", tab !== "mapping" && "psettings__panel--hidden")}>
          <PacingMappingSection
            ref={mapping}
            slug={slug}
            mappings={mappingsV3}
            cm360={thirdPartyFile}
            factsDaily={factsDaily}
            types={types}
            liPlan={liPlan}
            creatives={creatives}
            conversions={conversions}
            seedKey={seedKey}
            sheetSources={sheetDraft}
            storedSheetSources={storedSheets}
            dimSourcesLoaded={dimSourcesLoaded}
            lineItems={sheetLineItems}
            widgets={display?.widgets}
            valueLabels={labelsDraft}
            onSheetSourcesChange={setSheetDraft}
            onValueLabelsChange={setLabelsDraft}
            onCreateDimWidget={createDimWidget}
            onOpenDimBreakdown={onOpenBreakdown}
            perfSheet={perfSheet as Record<string, unknown> | null}
            perfProbe={perfProbe}
            perfProbing={perfProbing}
            perfProbeMessage={perfProbeMessage}
            onPerfSheetChange={setPerfDraft}
            onPerfRetryProbe={() => { probedIdRef.current = null; if (perfSheetId) void runPerfProbe(perfSheetId); }}
            onReadSource={onSaved}
            onDirtyChange={markMapping}
          />
        </div>
        <div className={cn("psettings__panel", tab !== "alerts" && "psettings__panel--hidden")}>
          <PacingAlertsSection
            ref={alerts}
            slug={slug}
            notify={notify}
            hasVideo={hasVideo}
            seedKey={seedKey}
            onDirtyChange={markAlerts}
          />
        </div>
        <div className={cn("psettings__panel", tab !== "documents" && "psettings__panel--hidden")}>
          <PacingDocumentsSection
            ref={documents}
            slug={slug}
            links={links}
            orderNumber={orderNumber}
            seedKey={seedKey}
            onDirtyChange={markDocuments}
          />
        </div>
      </Sheet>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title="Discard unsaved changes?">
        <p>
          {dirtyTabs.map(tabLabel).join(" and ")} {dirtyTabs.length > 1 ? "have" : "has"} edits that have
          not been saved. Closing now loses them.
        </p>
        <div className="psettings__confirm-actions">
          <button type="button" className="button button--ghost button--sm" onClick={() => setConfirmClose(false)}>
            Keep editing
          </button>
          <button
            type="button"
            className="button button--danger button--sm"
            onClick={() => {
              setConfirmClose(false);
              onClose();
            }}
          >
            Discard
          </button>
        </div>
      </Modal>
    </>
  );
}
