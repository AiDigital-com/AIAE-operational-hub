import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "../../shared/style/cn";
import { CloseIcon } from "../../shared/ui/icons/icons";
import { Modal } from "../../shared/ui/modal/modal";
import { Sheet } from "../../shared/ui/sheet/sheet";
import { PacingPlanSection } from "../pacing-plan/pacing-plan-sheet";
import { PacingDataSection } from "./data-panel";
import { PacingWidgetsSection } from "./widgets-section";
import { SETTINGS_TABS, type SettingsSectionHandle, type SettingsTabId } from "./settings-section";
import type { PacingDataShape, PacingDisplayShape } from "./types";
import type { WidgetRenderContext } from "./widgets/widget-engine";
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
  renderCtx: WidgetRenderContext;
  libraryEntries: Record<string, unknown> | undefined;
  /** Re-read the dashboard after a save that landed. */
  onSaved: () => void;
}

type DirtyMap = Record<SettingsTabId, boolean>;
const NOTHING_DIRTY: DirtyMap = { plan: false, data: false, widgets: false };

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
  renderCtx,
  libraryEntries,
  onSaved,
}: PacingSettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTabId>("plan");
  const [dirty, setDirty] = useState<DirtyMap>(NOTHING_DIRTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Array<{ tab: SettingsTabId; message: string }>>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  // Bumped on every open: the sections re-seed on it, so a draft abandoned last time is gone.
  const [seedKey, setSeedKey] = useState(0);
  const openedRef = useRef(false);

  const plan = useRef<SettingsSectionHandle>(null);
  const dataSection = useRef<SettingsSectionHandle>(null);
  const widgets = useRef<SettingsSectionHandle>(null);
  const handles = useMemo(
    () => ({ plan, data: dataSection, widgets }) as Record<SettingsTabId, typeof plan>,
    []
  );

  if (open && !openedRef.current) {
    openedRef.current = true;
    // During render rather than in an effect: the sections read `seedKey` on their first render of
    // this opening, so bumping it afterwards would seed them twice and flash the previous draft.
    setSeedKey((n) => n + 1);
    setDirty(NOTHING_DIRTY);
    setErrors([]);
  } else if (!open && openedRef.current) {
    openedRef.current = false;
  }

  // One stable callback per section: an inline arrow would be a new function on every render, and
  // the sections report their dirty state from an effect keyed on it.
  const markPlan = useCallback((v: boolean) => setDirty((d) => (d.plan === v ? d : { ...d, plan: v })), []);
  const markData = useCallback((v: boolean) => setDirty((d) => (d.data === v ? d : { ...d, data: v })), []);
  const markWidgets = useCallback((v: boolean) => setDirty((d) => (d.widgets === v ? d : { ...d, widgets: v })), []);

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
            planByLineItem={planByLineItem}
            seedKey={seedKey}
            onDirtyChange={markPlan}
          />
        </div>
        <div className={cn("psettings__panel", tab !== "data" && "psettings__panel--hidden")}>
          <PacingDataSection ref={dataSection} slug={slug} data={data} seedKey={seedKey} onDirtyChange={markData} />
        </div>
        <div className={cn("psettings__panel", tab !== "widgets" && "psettings__panel--hidden")}>
          <PacingWidgetsSection
            ref={widgets}
            slug={slug}
            display={display}
            capabilities={capabilities}
            isAdmin={isAdmin}
            renderCtx={renderCtx}
            libraryEntries={libraryEntries}
            seedKey={seedKey}
            onDirtyChange={markWidgets}
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
