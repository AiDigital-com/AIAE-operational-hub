/**
 * The Pacing Settings plan editor (§9 of the migration plan, US-125/126/127): per line item, edit
 * budget, target impressions, target margin, target CTR/VCR, rate type, flight and date-based
 * containers; add a line item from the campaign or by id; remove a line item with a confirmation
 * naming what is lost. One Save button, one request - the same single write path Pacing's own
 * settings-save endpoint has always used - now fired by the settings drawer's single Save, beside the
 * data and widget sections, the way the retired SPA's one drawer footer saved all of its tabs.
 *
 * The hard rule this file exists to respect: no pacing figure is computed here. Every number either
 * comes verbatim from `PacingLineItemPlanV1` or is what the user just typed; the only arithmetic in
 * this feature (`containers.ts`'s duplicate-scale multiply, this file's own container-sum hint) is
 * plain bookkeeping over user-entered targets, not delivery data - see containers.ts's own doc for the
 * line between the two. The one real validation this screen dispatches to (coefficient-cost margin
 * ranges, and - not yet enforced by Pacing today - the container-sum-vs-plan rule) is Pacing's;
 * this only renders whatever it says back. The coefficient warning shown BEFORE Save is no exception:
 * `coef-precheck.ts` hands the line item to the engine's own `validateCoefLi` - the same function
 * dash-gate runs on save - rather than restating the rule here, so the two cannot drift apart.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatError } from "../../shared/format/error";
import { Modal } from "../../shared/ui/modal/modal";
import type { SettingsSectionHandle, SettingsSectionProps } from "../pacing-dashboard/settings-section";
import { NumericField } from "../pacing-create/numeric-field";
import { fmtInt, parseEditableNumber } from "../pacing-create/format";
import { fmtUnits, MoneyInput } from "./plan-number-inputs";
import { AddLineItemPanel } from "./add-line-item-panel";
import { actionsByLi, unmatched, type CvAction } from "./cv-actions";
import { coefConfigBlocksSave, coefErrorMessage, collectCoefErrors, planWarningSentence } from "./coef-precheck";
import { getCurrency } from "../pacing-dashboard/engine/engine-loader";
import { ContainerCard, type RawSplits, type SplitFacts } from "./container-editor";
import { initRateState, RateControl, rateDirty, rateWire, type RateState } from "./rate-control";
import { buildDefaultContainer, containersExceedLi, fitProposal, type FitProposal, type PacingContainer } from "./containers";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import { detectContainerOverlaps } from "../pacing-dashboard/spa/containers.js";
import { chipKey, GroupEditor, ValueGroupsBlock } from "./value-groups";
import { useSavePacingPlan } from "./hooks";
import {
  netPctToRatio,
  netRatioToPct,
  seedFromCandidate,
  seedFromPlan,
  toPlanUpdateLineItem,
  type DimGroup,
  type EditableLineItem,
} from "./line-item-fields";
import type { PacingDraftLineItemV1, PacingLineItemPlanV1 } from "./types";
import "./pacing-plan.css";

const RATE_TYPES = ["CPM", "CPC", "CPV", "CPI", "Flat"];

/** One frozen empty list, so a line item with no conversion rows does not get a fresh array - and a
 *  fresh prop identity - on every render of the sheet. */
const EMPTY_ACTIONS: CvAction[] = [];

function seedAll(planByLineItem: Record<string, PacingLineItemPlanV1>): Record<string, EditableLineItem> {
  const out: Record<string, EditableLineItem> = {};
  for (const [id, plan] of Object.entries(planByLineItem)) out[id] = seedFromPlan(plan);
  return out;
}

interface LineItemCardProps {
  li: EditableLineItem;
  currency: string;
  /** The campaign rate (native → USD), 1 on a USD campaign - container budgets are converted with it. */
  rate: number;
  /** Net cost mode's pacing switch (`data.net_enabled`): the Net % field renders only while it is
   *  on, matching the retired SPA's Settings · Pacing tab. */
  netFeatureOn: boolean;
  /** Whether the coefficient controls are on screen at all: the pacing switch, or any line item
   *  already carrying the flag (the section computes it - see its `coefFeatureOn`). A pure
   *  visibility gate; a line item whose flag is set goes on computing client cost from it either
   *  way, which is why the Margin relabel below reads the line item's own flag, not this. */
  coefFeatureOn: boolean;
  /** Whether to draw the conversion chooser at all - see the section's `primaryCvFeatureOn`. */
  primaryCvFeatureOn: boolean;
  /** The actions this line item actually has in the delivered conversion rows, biggest first. */
  cvActions: CvAction[];
  /** The values the pacing has delivered, per dimension per line item - the dim split menu. */
  rawSplits: RawSplits | null | undefined;
  /** The per-day delivery the "not covered by the splits" warning reads. */
  splitFacts: SplitFacts | null | undefined;
  /** The pacing's widgets: a group over a value a widget is pinned to says so. */
  widgets: unknown[] | undefined;
  isLast: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: EditableLineItem) => void;
  onRemove: () => void;
}

/**
 * "Fit LI to containers" - the reference's `FitLiToContainersDialog`: only the fields that need to
 * grow, before → after. Fields that could shrink are left as they are.
 */
function FitLiDialog({
  planImpr,
  budgetUsd,
  fs,
  fe,
  proposal,
  onConfirm,
  onCancel,
}: {
  planImpr: number;
  budgetUsd: number;
  fs: string;
  fe: string;
  proposal: FitProposal;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rows: Array<{ label: string; from: number | string; to: number | string }> = [];
  if (proposal.needsImpr) rows.push({ label: "Planned units", from: planImpr, to: proposal.sumTi });
  if (proposal.needsBudget) rows.push({ label: "Planned budget", from: budgetUsd, to: Math.round(proposal.sumTs * 100) / 100 });
  if (proposal.needsFs) rows.push({ label: "Flight start", from: fs, to: proposal.earliestFs });
  if (proposal.needsFe) rows.push({ label: "Flight end", from: fe, to: proposal.latestFe });
  const show = (v: number | string) => (typeof v === "number" ? fmtUnits(v) || "—" : v || "—");
  return (
    <Modal open onClose={onCancel} title="Fit LI to containers" subtitle="Adjust LI fields so every container fits. Reducible fields are left as-is.">
      <table className="pplan__fit-table">
        <thead>
          <tr>
            <th>Field</th>
            <th className="pplan__fit-num">Before</th>
            <th className="pplan__fit-num">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="pplan__fit-num">{show(r.from)}</td>
              <td className="pplan__fit-num pplan__fit-to">{show(r.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pplan__dialog-actions">
        <button type="button" className="button button--ghost button--sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button--primary button--sm" onClick={onConfirm}>
          Apply
        </button>
      </div>
    </Modal>
  );
}

function LineItemCard({
  li,
  currency,
  rate,
  netFeatureOn,
  coefFeatureOn,
  primaryCvFeatureOn,
  cvActions,
  rawSplits,
  splitFacts,
  widgets,
  isLast,
  open,
  onToggleOpen,
  onChange,
  onRemove,
}: LineItemCardProps) {
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [lastAddedContainerId, setLastAddedContainerId] = useState<string | null>(null);
  const [fitOpen, setFitOpen] = useState(false);
  // Value groups: which group the editor is open on (-1 = a new one), and the element it hangs
  // from (a chip, "+ Add group", or a container's "+ Add dim split"). `opened` keys the editor, so
  // every open starts from the group as it is now.
  const [groupEdit, setGroupEdit] = useState<{ index: number; opened: number } | null>(null);
  const [chipFocus, setChipFocus] = useState<string | null>(null);
  const groupAnchorRef = useRef<HTMLElement | null>(null);

  function field<K extends keyof EditableLineItem>(key: K, value: EditableLineItem[K]) {
    onChange({ ...li, [key]: value });
  }
  function setContainerAt(idx: number, next: PacingContainer) {
    onChange({ ...li, containers: li.containers.map((c, i) => (i === idx ? next : c)) });
  }
  function removeContainerAt(idx: number) {
    onChange({ ...li, containers: li.containers.filter((_, i) => i !== idx) });
  }
  // The line item's budget in USD - the reference's `plan.budget`, which its budget field keeps at
  // `currencyToUsd(native, rate)` on every edit. Containers turn their own budgets into units against it.
  const liNative = parseEditableNumber(li.nativeBudget) ?? null;
  const liBudgetUsd = liNative == null ? null : getCurrency().currencyToUsd(liNative, rate);
  const liBase = { planImpr: parseEditableNumber(li.targetImpressions) || 0, budgetUsd: liBudgetUsd || 0 };

  function addContainer() {
    // The reference's naming: the first container is "Default" (or its month), later ones "Container N".
    const built = buildDefaultContainer({
      fs: li.flightStart,
      fe: li.flightEnd,
      targetImpressions: parseEditableNumber(li.targetImpressions) ?? null,
      nativeBudget: liNative,
      budgetUsd: liBudgetUsd,
    });
    const container = li.containers.length > 0 ? { ...built, name: `Container ${li.containers.length + 1}` } : built;
    setLastAddedContainerId(container.id);
    onChange({ ...li, containers: [...li.containers, container] });
  }
  function addDuplicatedContainer(dup: PacingContainer) {
    setLastAddedContainerId(dup.id);
    onChange({ ...li, containers: [...li.containers, dup] });
  }

  const groups = li.dimGroups;
  function openGroupEditor(index: number, anchor: HTMLElement | null) {
    groupAnchorRef.current = anchor;
    setGroupEdit((cur) => ({ index, opened: (cur?.opened || 0) + 1 }));
  }
  function closeGroupEditor() {
    setGroupEdit(null);
    groupAnchorRef.current?.focus?.({ preventScroll: true });
  }
  // "Done": the line's dictionary, and its containers when a rename moved a split with it.
  function applyGroupEdit(next: { groups: DimGroup[]; containers: PacingContainer[] }) {
    const edited = groupEdit && groupEdit.index >= 0 ? next.groups[groupEdit.index] : null;
    onChange({ ...li, dimGroups: next.groups, containers: next.containers });
    closeGroupEditor();
    // A rename gives the chip a new key: the focus follows it once it is drawn.
    if (edited) setChipFocus(chipKey(edited));
  }
  function removeGroup(i: number) {
    // The open editor names its group by place; a removal moves the places, so it closes first.
    if (groupEdit) {
      setGroupEdit(null);
      groupAnchorRef.current = null;
    }
    const nextChip = groups[i + 1] || groups[i - 1];
    onChange({ ...li, dimGroups: groups.filter((_, j) => j !== i) });
    setChipFocus(nextChip ? chipKey(nextChip) : null);
  }

  const liFit = { planImpr: liBase.planImpr, budgetUsd: liBase.budgetUsd, fs: li.flightStart, fe: li.flightEnd };
  const fit = fitProposal(liFit, li.containers);
  const overPlan = containersExceedLi(liFit, li.containers);
  const containerOverlaps = detectContainerOverlaps({ containers: li.containers }) as Array<{
    a: { idx: number; name?: string | null };
    b: { idx: number; name?: string | null };
    start: string;
    end: string;
  }>;
  // "Fit LI to containers" - the reference's `fitLiPatch`. The USD budget is the target; the line
  // item is edited in its contract currency, so the amount is converted back at the campaign rate
  // (rate 1 on a USD pacing: the same number). dash-gate re-derives the USD figure from it on save.
  function applyFit(proposal: FitProposal) {
    const next = { ...li };
    if (proposal.needsImpr) next.targetImpressions = String(proposal.sumTi);
    if (proposal.needsBudget) {
      const usd = Math.round(Number(proposal.sumTs) * 100) / 100;
      next.nativeBudget = String(Math.round(getCurrency().usdToNative(usd, rate) * 100) / 100);
    }
    if (proposal.needsFs) next.flightStart = proposal.earliestFs;
    if (proposal.needsFe) next.flightEnd = proposal.latestFe;
    onChange(next);
  }
  // Coefficient margin mode, pre-save. Pacing refuses the WHOLE settings save with `bad_coef_config`
  // on a bad coefficient config, so without this the only way to find out is to press Save. The rule
  // is not restated here - `coefConfigBlocksSave` calls the engine's own `validateCoefLi`, the same
  // function dash-gate runs on save, so the warning and the refusal cannot disagree.
  const coefBlocked = useMemo(
    () => coefConfigBlocksSave({ costCoef: li.costCoef, marginTargetPct: li.marginTargetPct, containers: li.containers }),
    [li.costCoef, li.marginTargetPct, li.containers]
  );
  const planWarning = planWarningSentence(overPlan, coefBlocked);
  // On a coefficient line item the Margin % cell is no longer a target to be judged against - it IS
  // the client-cost formula's divisor, and a value outside [0,100) makes that formula meaningless.
  // Blank reads as 0 here exactly as it does in the reference, and 0 is a valid margin.
  const marginInvalid =
    li.costCoef && !(Number.isFinite(Number(li.marginTargetPct)) && Number(li.marginTargetPct) >= 0 && Number(li.marginTargetPct) < 100);
  // Net cost mode: there is something to reset to only when NetSuite reports a ratio, and only
  // once the cell has moved off it (or was locked by hand). Compared on the RATIOS, not on the
  // displayed percents - two different ratios can round to the same 2-decimal cell.
  const canResetNet = li.nsNetRatio != null && (li.netLocked || li.netRatio !== li.nsNetRatio);

  return (
    <div className="pplan__li-card" data-li-id={li.lineItemId}>
      <button type="button" className="pplan__li-head" onClick={onToggleOpen} aria-expanded={open}>
        <span className={`pplan__chevron${open ? " pplan__chevron--open" : ""}`}>▸</span>
        <span className="pplan__li-id">LI {li.lineItemId}</span>
        <span className="pplan__badge">{li.channel || "Unknown"}</span>
        <span className="pplan__badge">{li.rateType}</span>
        {li.isNew && <span className="pplan__badge pplan__badge--new">New</span>}
        {/* A collapsed card must still say that it is the one holding the save back. A top-row badge,
            never an edge accent; its title carries the same sentence the body spells out. */}
        {planWarning && (
          <span className="pplan__badge pplan__badge--warn" role="img" title={planWarning} aria-label={`Warning: ${planWarning}`}>
            ⚠
          </span>
        )}
      </button>
      <button
        type="button"
        className="pplan__icon-btn pplan__li-remove"
        onClick={() => setShowRemoveConfirm(true)}
        aria-label={`Remove line item ${li.lineItemId}`}
        title="Remove line item"
      >
        ×
      </button>

      {open && (
        <div className="pplan__li-body">
          <div className="pplan__field-row">
            <label className="pplan__field">
              <span className="pplan__field-label">Flight start</span>
              <input type="date" className="pplan__input" value={li.flightStart} onChange={(e) => field("flightStart", e.target.value)} />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Flight end</span>
              <input type="date" className="pplan__input" value={li.flightEnd} onChange={(e) => field("flightEnd", e.target.value)} />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Rate type</span>
              <span className="select pplan__input">
                <select value={li.rateType} onChange={(e) => field("rateType", e.target.value)}>
                  {RATE_TYPES.map((rt) => (
                    <option key={rt} value={rt}>
                      {rt}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
          <div className="pplan__field-row">
            <label className="pplan__field">
              <span className="pplan__field-label">Units</span>
              <NumericField
                value={li.targetImpressions}
                onChange={(v) => field("targetImpressions", v)}
                ariaLabel={`Units for line item ${li.lineItemId}`}
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Budget</span>
              {/* The reference's MoneyField: the contract-currency amount, with "= $X USD" under it on a
                  converted campaign. dash-gate re-derives the USD figure from it on save. */}
              <MoneyInput
                value={li.nativeBudget}
                rate={rate}
                currency={currency}
                onChange={(raw) => field("nativeBudget", raw.replace(/,/g, ""))}
                placeholder="0"
                ariaLabel={`Budget for line item ${li.lineItemId}`}
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              {/* The label is the statement of what this cell DOES, and on a coefficient line item
                  that changes: it stops being a target and becomes the client-cost divisor. */}
              <span
                className="pplan__field-label"
                title={li.costCoef ? "Margin % - sets client cost" : undefined}
              >
                {li.costCoef ? "Margin % (client cost)" : "Target margin %"}
              </span>
              <input
                type="number"
                step="0.01"
                className={`pplan__input pplan__input--num${marginInvalid ? " pplan__input--invalid" : ""}`}
                aria-invalid={marginInvalid || undefined}
                value={li.marginTargetPct}
                onChange={(e) => field("marginTargetPct", e.target.value)}
              />
            </label>
          </div>
          <div className="pplan__field-row">
            <label className="pplan__field">
              <span className="pplan__field-label">Target CTR %</span>
              <input
                type="number"
                step="0.001"
                className="pplan__input pplan__input--num"
                value={li.targetCtr}
                placeholder="opt."
                onChange={(e) => field("targetCtr", e.target.value)}
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Target VCR %</span>
              <input
                type="number"
                step="0.001"
                className="pplan__input pplan__input--num"
                value={li.targetVcr}
                placeholder="opt."
                onChange={(e) => field("targetVcr", e.target.value)}
              />
            </label>
            {netFeatureOn && (
              <div className="pplan__field">
                <span className="pplan__field-label">Net %</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className="pplan__input pplan__input--num"
                  value={li.netPct}
                  placeholder="100 (gross)"
                  aria-label={`Net percent for line item ${li.lineItemId}`}
                  // A manual edit ALWAYS locks - including a typed 100 or a cleared cell, which say
                  // "this line item is invoiced at gross" and must survive a revalidate. The typed
                  // string drives BOTH the display and the ratio: only a keystroke may move the
                  // ratio off what Pacing stored (see EditableLineItem.netRatio).
                  onChange={(e) =>
                    onChange({
                      ...li,
                      netPct: e.target.value,
                      netRatio: netPctToRatio(e.target.value),
                      netLocked: true,
                    })
                  }
                />
                {/* Both actions stay mounted and hide with `visibility` - an action that unmounts
                    would re-flow the fields beside it the moment a cell is typed in or reset. */}
                <div className="pplan__net-actions">
                  <button
                    type="button"
                    className="pplan__reset-net"
                    style={{ visibility: canResetNet ? "visible" : "hidden" }}
                    tabIndex={canResetNet ? 0 : -1}
                    aria-hidden={!canResetNet}
                    onClick={() =>
                      onChange({
                        ...li,
                        netPct: netRatioToPct(li.nsNetRatio),
                        netRatio: li.nsNetRatio,
                        netLocked: false,
                      })
                    }
                    title={
                      canResetNet ? "Restore NetSuite's own net/gross ratio and let revalidate keep it fresh" : undefined
                    }
                  >
                    {li.nsNetRatio != null ? `Reset to NS (${netRatioToPct(li.nsNetRatio)}%)` : "Reset to NS"}
                  </button>
                  <span
                    className="pplan__net-lock"
                    style={{ visibility: li.netLocked ? "visible" : "hidden" }}
                    aria-hidden={!li.netLocked}
                    title={li.netLocked ? "Set manually — re-validate won't overwrite it until you reset" : undefined}
                  >
                    Locked
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Its own full-width row, never sharing one with the stacked-label fields above: a bare
              checkbox dropped beside them would sit on a different baseline from every neighbour,
              because theirs starts below a label and it has none. The Margin relabel above is the
              other half of this control - the two are read together. */}
          {coefFeatureOn && (
            <div className="pplan__field-row">
              <label className="pplan__switch">
                <input
                  type="checkbox"
                  checked={li.costCoef}
                  aria-label={`Coefficient cost for line item ${li.lineItemId}`}
                  onChange={(e) => field("costCoef", e.target.checked)}
                />
                <span className="pplan__switch-label">
                  Coefficient cost &mdash; client cost = spend / (1 &minus; margin)
                </span>
              </label>
            </div>
          )}

          {/* Primary conversions (Pacing spec 2026-09-13 §2). A checkbox per action rather than a
              multi-select: the list is short, the counts matter for choosing, and a multi-select hides
              both. Its own full-width block for the same reason the coefficient switch above has one -
              these are not label-stacked fields and must not share a row with them. */}
          {primaryCvFeatureOn && (
            <div className="pplan__cv">
              <div className="pplan__cv-head">
                Primary conversions
                <span className="pplan__cv-count">
                  {li.primaryCv.length === 0
                    ? "counting every action"
                    : `${li.primaryCv.length} of ${cvActions.length} chosen`}
                </span>
              </div>
              {cvActions.length === 0 ? (
                <p className="pplan__hint">
                  No conversion rows for this line item yet. Turn on Fetch conversions in Data and
                  refresh; a choice made here before then would match nothing.
                </p>
              ) : (
                <>
                  <div className="pplan__cv-list">
                    {cvActions.map((action) => {
                      const chosen = li.primaryCv.includes(action.name);
                      return (
                        <label key={action.name} className="pplan__cv-item">
                          <input
                            type="checkbox"
                            checked={chosen}
                            aria-label={`Count ${action.name} for line item ${li.lineItemId}`}
                            onChange={() =>
                              field(
                                "primaryCv",
                                chosen
                                  ? li.primaryCv.filter((name) => name !== action.name)
                                  : [...li.primaryCv, action.name]
                              )
                            }
                          />
                          <span className="pplan__cv-name">{action.name}</span>
                          <span className="pplan__cv-sum">{fmtInt(Math.round(action.conversions))}</span>
                        </label>
                      );
                    })}
                  </div>
                  {/* A stored name the delivered rows no longer have counts nothing, so the line reads
                      zero and looks broken. Says which name, because the fix is to re-pick it. */}
                  {unmatched(li.primaryCv, cvActions).length > 0 && (
                    <p className="pplan__hint pplan__hint--warn">
                      ⚠ Not in the delivered data: {unmatched(li.primaryCv, cvActions).join(", ")} - these
                      count nothing until the action reappears or you choose another.
                    </p>
                  )}
                  <p className="pplan__hint">
                    {li.primaryCv.length === 0
                      ? "No choice: this line counts every conversion action above."
                      : "Conversions, CPA and CVR count only the ticked actions."}
                  </p>
                </>
              )}
            </div>
          )}

          {groups.length > 0 && (
            <ValueGroupsBlock
              groups={groups}
              containers={li.containers}
              editingIndex={groupEdit ? groupEdit.index : null}
              onOpen={openGroupEditor}
              onRemove={removeGroup}
              focusKey={chipFocus}
              onFocused={() => setChipFocus(null)}
            />
          )}
          {groupEdit && (
            <GroupEditor
              key={groupEdit.opened}
              anchorRef={groupAnchorRef}
              liId={li.lineItemId}
              rawSplits={rawSplits}
              groups={groups}
              containers={li.containers}
              widgets={widgets}
              editingIndex={groupEdit.index}
              onDone={applyGroupEdit}
              onClose={closeGroupEditor}
            />
          )}

          <div className="pplan__subsection">
            <div className="pplan__subsection-head">Containers ({li.containers.length})</div>
            {fit.anyFit && (
              <div className="pplan__hint pplan__hint--warn pplan__fit-banner">
                <span className="pplan__fit-text">
                  {fit.needsImpr && <>⚠ Containers units sum ({fmtUnits(fit.sumTi)}) exceeds LI total ({fmtUnits(liBase.planImpr)}). </>}
                  {fit.needsBudget && <>⚠ Containers spend exceeds LI budget ({fmtUnits(liBase.budgetUsd)}). </>}
                  {(fit.needsFs || fit.needsFe) && <>⚠ Container period extends past LI flight ({li.flightStart} – {li.flightEnd}). </>}
                </span>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => setFitOpen(true)}
                  title="Adjust LI fields to cover all containers"
                >
                  Fit LI to containers
                </button>
              </div>
            )}
            {containerOverlaps.map((ov, i) => {
              const a = ov.a.name || `Container ${ov.a.idx + 1}`;
              const b = ov.b.name || `Container ${ov.b.idx + 1}`;
              // Overlapping containers are legal (information only). Under coefficient cost two
              // overlapping containers that BOTH carry a margin make the client cost ambiguous on the
              // overlap days - that is what validateCoefLi refuses, so the pair that blocks the save
              // is named here, in a red tint.
              const hasMargin = (c: PacingContainer | undefined) => !!c && c.margin_percent != null;
              const blocking = li.costCoef && hasMargin(li.containers[ov.a.idx]) && hasMargin(li.containers[ov.b.idx]);
              return (
                <p key={`cov-${i}`} className={`pplan__hint ${blocking ? "pplan__hint--bad" : "pplan__hint--info"}`}>
                  {blocking
                    ? `⚠ Coefficient margins overlap — blocks save: ${a} & ${b}: ${ov.start} – ${ov.end} (remove one margin or split the dates)`
                    : `ⓘ Containers overlap: ${a} & ${b}: ${ov.start} – ${ov.end}`}
                </p>
              );
            })}
            {li.containers.length === 0 ? (
              /* The empty state IS the add button - one dashed box, not an explainer stacked on a
                 second dashed control. */
              <button type="button" className="pplan__add-btn pplan__add-btn--empty" onClick={addContainer}>
                + Add container
                <span className="pplan__add-hint">Track date sub-periods and dimensional carve-outs.</span>
              </button>
            ) : (
              <>
                {li.containers.map((container, idx) => (
                  <ContainerCard
                    key={container.id || idx}
                    liId={li.lineItemId}
                    container={container}
                    li={liBase}
                    currency={currency}
                    rate={rate}
                    liCoef={li.costCoef}
                    rawSplits={rawSplits}
                    groups={groups}
                    splitFacts={splitFacts}
                    onGroupValues={(anchor) => openGroupEditor(-1, anchor)}
                    defaultOpen={container.id === lastAddedContainerId}
                    onChange={(next) => setContainerAt(idx, next)}
                    onRemove={() => removeContainerAt(idx)}
                    onDuplicate={addDuplicatedContainer}
                  />
                ))}
                <button type="button" className="pplan__add-btn" onClick={addContainer}>
                  + Add container
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {fitOpen && (
        <FitLiDialog
          planImpr={liBase.planImpr}
          budgetUsd={liBase.budgetUsd}
          fs={li.flightStart}
          fe={li.flightEnd}
          proposal={fit}
          onConfirm={() => {
            applyFit(fit);
            setFitOpen(false);
          }}
          onCancel={() => setFitOpen(false)}
        />
      )}

      {showRemoveConfirm && (
        <Modal
          open
          onClose={() => setShowRemoveConfirm(false)}
          title={isLast ? "This is the last line item" : `Remove line item ${li.lineItemId}?`}
          subtitle={
            isLast
              ? "A pacing needs at least one line item. To retire the whole pacing instead, change its status to Archive from the footer."
              : `This removes line item ${li.lineItemId}'s entire plan — its budget, targets and ${li.containers.length} container${li.containers.length === 1 ? "" : "s"} — from this pacing. The remaining line items and their delivery history are unaffected. This can't be undone.`
          }
        >
          <div className="pplan__dialog-actions">
            <button type="button" className="button button--ghost button--sm" onClick={() => setShowRemoveConfirm(false)}>
              Cancel
            </button>
            {!isLast && (
              <button
                type="button"
                className="button button--danger button--sm"
                onClick={() => {
                  setShowRemoveConfirm(false);
                  onRemove();
                }}
              >
                Remove
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

export interface PacingPlanSectionProps extends SettingsSectionProps {
  slug: string;
  currency: string;
  /** The campaign rate (native → USD) off the dashboard payload; 1 on a USD campaign. The section
   *  edits its own copy (the Exchange Rate control) and converts budgets with that one. */
  rate: number;
  /** The rate was set by hand: NetSuite refreshes leave it alone until Reset to NS. */
  rateLocked?: boolean;
  /** The NetSuite rate Reset to NS restores; null when NetSuite reports none. */
  nsRate?: number | null;
  /** Net cost mode's pacing switch (`data.net_enabled`) as the Data section currently has it -
   *  the LIVE draft, not what is stored, so flipping it there reveals the Net % field here in the
   *  same unsaved sitting. Gates the field AND the wire: while off, a plan save carries no net keys
   *  at all, leaving stored ratios inert. */
  netFeatureOn: boolean;
  /** Coefficient margin mode's pacing switch (`data.coef_enabled`), live from the Data section the
   *  same way. It is only HALF the question this screen asks - see `coefFeatureOn` below. */
  coefEnabled: boolean;
  /** Primary conversions' pacing switch (`data.primary_cv_enabled`), live from the Data section the
   *  same way `coefEnabled` is. A pure visibility gate here: a stored choice keeps counting while it
   *  is off, exactly as a stored coefficient flag does. */
  primaryCvEnabled: boolean;
  /** The pacing's conversion-mart rows - the only place the choosable actions exist. */
  conversions: Array<Record<string, unknown>> | undefined;
  /** The delivered values per dimension per line item, as fetched (before value groups fold them). */
  rawSplits?: RawSplits | null;
  /** The per-day delivery the containers' "not covered" warning reads. */
  splitFacts?: SplitFacts | null;
  /** The pacing's widgets - the group editor names the ones pinned to a value it folds. */
  widgets?: unknown[];
  planByLineItem: Record<string, PacingLineItemPlanV1>;
  /** Bumped by the drawer on open, so a reopened section never shows an abandoned edit. */
  seedKey: number;
}

export const PacingPlanSection = forwardRef<SettingsSectionHandle, PacingPlanSectionProps>(
  function PacingPlanSection({ slug, currency, rate, rateLocked, nsRate, netFeatureOn, coefEnabled, primaryCvEnabled, conversions, rawSplits, splitFacts, widgets, planByLineItem, seedKey, onDirtyChange }, ref) {
    const [lineItems, setLineItems] = useState<Record<string, EditableLineItem>>({});
    const [base, setBase] = useState<Record<string, EditableLineItem>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [addingLi, setAddingLi] = useState(false);
    // The campaign rate as this section edits it, and as last seeded/saved. Line item and container
    // budgets convert with the EDITED rate, as the reference's cards do (`rate={localRate}`).
    const [rateState, setRateState] = useState<RateState>(() => initRateState(rate, rateLocked));
    const [rateBase, setRateBase] = useState<RateState>(() => initRateState(rate, rateLocked));
    const savePlan = useSavePacingPlan(slug);

    // Re-hydrate from the latest server data every time the drawer opens - never carry a stale edit
    // across a close/reopen, and never show an edit still in flight from a previous session.
    useEffect(() => {
      const seeded = seedAll(planByLineItem);
      setLineItems(seeded);
      setBase(seeded);
      setRateState(initRateState(rate, rateLocked));
      setRateBase(initRateState(rate, rateLocked));
      const ids = Object.keys(seeded).sort();
      setExpanded(new Set(ids.slice(0, 1)));
      setAddingLi(false);
      // Re-seed only when the drawer re-opens, not on every planByLineItem identity change (which
      // would clobber in-progress edits on every unrelated background refetch).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    const ids = useMemo(() => Object.keys(lineItems).sort(), [lineItems]);
    const existingIds = useMemo(() => new Set(ids), [ids]);

    // Whether the coefficient controls are on screen - the pacing switch OR a line item that already
    // carries the flag, which is the retired SPA's rule (`SettingsDrawer.jsx`: `localCoefEnabled ||
    // Object.values(localPlans).some((p) => p?.coef === true)`).
    //
    // The OR is the whole point, not a nicety. A line item may carry `cost_coef` while the pacing
    // switch is off - Pacing supports that state and says so in the Data tab's own hint ("Existing
    // coefficient line items keep working when this is off"), and a pacing created with the mode on
    // reaches it the moment someone unticks the switch. Without this clause that line item goes on
    // computing client cost from a coefficient with no control anywhere to turn it off, while its
    // Margin field still reads "Margin % (client cost)" - a setting the user can see the effects of
    // and cannot reach.
    // Same OR as the coefficient gate beside it, and for the same reason: a line item that already
    // carries a choice must stay editable after someone turns the pacing switch off, or the only way
    // to clear it would be to turn the switch back on first.
    const cvActions = useMemo(() => actionsByLi(conversions), [conversions]);
    const primaryCvFeatureOn = useMemo(
      () => primaryCvEnabled || ids.some((id) => (lineItems[id]?.primaryCv?.length ?? 0) > 0),
      [primaryCvEnabled, ids, lineItems]
    );
    const coefFeatureOn = useMemo(
      () => coefEnabled || ids.some((id) => lineItems[id]?.costCoef === true),
      [coefEnabled, ids, lineItems]
    );

    // Compared as the payload that would be SENT, not as the editor's own state: seeding builds
    // fresh objects, so an identity check would call an untouched plan dirty the moment it loads.
    const rateChanged = rateDirty(rateState, rateBase);
    const dirty = useMemo(
      () => rateChanged
        || JSON.stringify(ids.map((id) => toPlanUpdateLineItem(lineItems[id], netFeatureOn)))
        !== JSON.stringify(Object.keys(base).sort().map((id) => toPlanUpdateLineItem(base[id], netFeatureOn))),
      [rateChanged, ids, lineItems, base, netFeatureOn]
    );
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    const stateRef = useRef({ ids, lineItems, dirty, netFeatureOn, rateState, rateChanged });
    stateRef.current = { ids, lineItems, dirty, netFeatureOn, rateState, rateChanged };

    useImperativeHandle(ref, () => ({
      async save() {
        const { ids: currentIds, lineItems: current, dirty: isDirty, netFeatureOn: netOn, rateState: rateNow, rateChanged: rateMoved } =
          stateRef.current;
        if (!isDirty) return { ok: true as const };
        // The coefficient contract, checked before anything is sent (the reference's `runSave`):
        // the reason is named here rather than read back from dash-gate's refusal.
        const coefErrors = collectCoefErrors(currentIds.map((id) => current[id]));
        if (coefErrors.length > 0) return { ok: false as const, message: coefErrorMessage(coefErrors) };
        try {
          // The rate rides the SAME request as the line items: dash-gate applies it before it re-derives
          // every USD figure from its contract amount, which a separate request would not do.
          await savePlan.mutateAsync({
            lineItems: currentIds.map((id) => toPlanUpdateLineItem(current[id], netOn)),
            ...(rateMoved ? rateWire(rateNow) : {}),
          });
          setBase(current);
          setRateBase(rateNow);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: formatError(error) };
        }
      },
      reset() {
        setLineItems(base);
        setRateState(rateBase);
        setAddingLi(false);
      },
    }));

    function toggleExpanded(id: string) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

    function updateLineItem(id: string, next: EditableLineItem) {
      setLineItems((prev) => ({ ...prev, [id]: next }));
    }

    function removeLineItem(id: string) {
      setLineItems((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    /** Seed every line item's Net % from its own NetSuite ratio and clear the lock. A line item
     *  NetSuite reports no ratio for is SKIPPED, not rewritten - it keeps whatever it holds. */
    function seedNetFromNsOnAll() {
      setLineItems((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) {
          const li = next[id];
          if (li.nsNetRatio == null) continue;
          next[id] = { ...li, netRatio: li.nsNetRatio, netPct: netRatioToPct(li.nsNetRatio), netLocked: false };
        }
        return next;
      });
    }

    /** Turn coefficient cost ON for every line item in this pacing. One direction only, like the Net
     *  seed beside it: the bulk gesture people actually make is "this whole pacing is coefficient",
     *  and a bulk OFF would be an undo for a flag each card can already clear on its own. */
    function setCoefOnAll() {
      setLineItems((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) next[id] = { ...next[id], costCoef: true };
        return next;
      });
    }

    function addCandidates(candidates: PacingDraftLineItemV1[]) {
      setLineItems((prev) => {
        const next = { ...prev };
        for (const candidate of candidates) next[candidate.lineItemId] = seedFromCandidate(candidate);
        return next;
      });
      setExpanded((prev) => new Set([...prev, ...candidates.map((c) => c.lineItemId)]));
      setAddingLi(false);
    }

    return (
      <>
        <RateControl currency={currency} nsRate={nsRate} value={rateState} onChange={setRateState} />
        <div className="pplan__section-actions">
          {coefFeatureOn && ids.length > 1 && (
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={setCoefOnAll}
              title="Turn on coefficient cost for every line item in this pacing"
            >
              Coef → all LIs
            </button>
          )}
          {netFeatureOn && ids.length > 1 && (
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={seedNetFromNsOnAll}
              title="Copy the NetSuite net/gross ratio onto every line item and clear the locks"
            >
              Net % from NS → all LIs
            </button>
          )}
          <button type="button" className="button button--ghost button--sm" onClick={() => setAddingLi((v) => !v)}>
            + Add line item
          </button>
        </div>

        {addingLi && (
          <AddLineItemPanel slug={slug} currency={currency} existingIds={existingIds} onAdd={addCandidates} onClose={() => setAddingLi(false)} />
        )}

        {ids.length === 0 && !addingLi && <p className="pplan__hint">No line items on this pacing.</p>}

        {ids.map((id) => (
          <LineItemCard
            key={id}
            li={lineItems[id]}
            currency={currency}
            rate={rateState.rate}
            rawSplits={rawSplits}
            splitFacts={splitFacts}
            widgets={widgets}
            netFeatureOn={netFeatureOn}
            coefFeatureOn={coefFeatureOn}
            primaryCvFeatureOn={primaryCvFeatureOn}
            cvActions={cvActions.get(id) ?? EMPTY_ACTIONS}
            isLast={ids.length === 1}
            open={expanded.has(id)}
            onToggleOpen={() => toggleExpanded(id)}
            onChange={(next) => updateLineItem(id, next)}
            onRemove={() => removeLineItem(id)}
          />
        ))}
      </>
    );
  }
);
