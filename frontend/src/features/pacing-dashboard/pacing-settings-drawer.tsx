import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../shared/style/cn";
import { CloseIcon } from "../../shared/ui/icons/icons";
import { Modal } from "../../shared/ui/modal/modal";
import { Sheet } from "../../shared/ui/sheet/sheet";
import { PacingPlanSection } from "../pacing-plan/pacing-plan-sheet";
import { PacingAlertsSection } from "./alerts-panel";
import { PacingDataSection, type PacingModeSwitches } from "./data-panel";
import { PacingDocumentsSection } from "./documents/documents-panel";
import { PacingWidgetsSection } from "./widgets-section";
import { SETTINGS_TABS, type SettingsSectionHandle, type SettingsTabId } from "./settings-section";
import type { PacingCampaignLinkV1, PacingDataShape, PacingDisplayShape, PacingNotifySettingsV1 } from "./types";
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
  planByLineItem: Record<string, PacingLineItemPlanV1>;
  data: PacingDataShape | undefined;
  display: PacingDisplayShape;
  capabilities: Record<string, unknown> | undefined;
  isAdmin: boolean;
  /** Handed to the widget section so its cards preview through the dashboard's own engine. */
  libraryEntries: Record<string, unknown> | undefined;
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
  /** Called once that request has been consumed, so a later open lands on the list instead. */
  onWidgetEditorOpened?: () => void;
  /** Re-read the dashboard after a save that landed. */
  onSaved: () => void;
}

type DirtyMap = Record<SettingsTabId, boolean>;
const NOTHING_DIRTY: DirtyMap = {
  plan: false,
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
  planByLineItem,
  data,
  display,
  capabilities,
  isAdmin,
  libraryEntries,
  notify,
  hasVideo,
  links,
  orderNumber,
  initialTab = null,
  initialWidgetId = null,
  onWidgetEditorOpened,
  onSaved,
}: PacingSettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTabId>("plan");
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
  };
  // Read by the open effect below without being a dependency of it - see its comment.
  const initialTabRef = useRef(initialTab);
  initialTabRef.current = initialTab;

  const plan = useRef<SettingsSectionHandle>(null);
  const dataSection = useRef<SettingsSectionHandle>(null);
  const widgets = useRef<SettingsSectionHandle>(null);
  const alerts = useRef<SettingsSectionHandle>(null);
  const documents = useRef<SettingsSectionHandle>(null);
  const handles = useMemo(
    () => ({ plan, data: dataSection, widgets, alerts, documents }) as Record<SettingsTabId, typeof plan>,
    []
  );

  // Net cost mode: how many line items carry a STORED ratio right now. Steers only the hint under
  // the Data tab's switch ("re-validate to pull ratios") - storedNetRatio is the ungated value, so
  // the count is right even while the switch itself is still off.
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
  // Same shape and the same reason: stable identity, and a no-op when nothing moved, so the Data
  // section's report cannot loop against its own effect.
  const markSwitches = useCallback(
    (v: PacingModeSwitches) =>
      setSwitches((s) => (s && s.coefEnabled === v.coefEnabled && s.netEnabled === v.netEnabled ? s : v)),
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

  async function handleSave() {
    setSaving(true);
    setErrors([]);
    const failures: Array<{ tab: SettingsTabId; message: string }> = [];
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
            netFeatureOn={liveSwitches.netEnabled}
            coefEnabled={liveSwitches.coefEnabled}
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
            initialWidgetId={initialWidgetId}
            onWidgetEditorOpened={onWidgetEditorOpened}
            onDirtyChange={markWidgets}
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
