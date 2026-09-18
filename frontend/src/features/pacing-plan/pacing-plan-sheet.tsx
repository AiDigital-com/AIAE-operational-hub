/**
 * The Pacing Settings plan editor (§9 of the migration plan, US-125/126/127): per line item, edit
 * budget, target impressions, target margin, target CTR/VCR, rate type, flight and date-based
 * containers; add a line item from the campaign or by id; remove a line item with a confirmation
 * naming what is lost. One Save button, one request - the same single write path Pacing's own
 * settings-save endpoint has always used. Placed in a slide-over `Sheet`, the same primitive §6's
 * Widgets panel uses, for the same reason the retired SPA put its whole Settings screen in a drawer:
 * editing a plan is something a person does occasionally, not the reason they opened the dashboard.
 *
 * The hard rule this file exists to respect: no pacing figure is computed here. Every number either
 * comes verbatim from `PacingLineItemPlanV1` or is what the user just typed; the only arithmetic in
 * this feature (`containers.ts`'s duplicate-scale multiply, this file's own container-sum hint) is
 * plain bookkeeping over user-entered targets, not delivery data - see containers.ts's own doc for the
 * line between the two. The one real validation this screen dispatches to (coefficient-cost margin
 * ranges, and - not yet enforced by Pacing today - the container-sum-vs-plan rule) is Pacing's;
 * this only renders whatever it says back.
 */
import { useEffect, useMemo, useState } from "react";
import { formatError } from "../../shared/format/error";
import { Modal } from "../../shared/ui/modal/modal";
import { Sheet } from "../../shared/ui/sheet/sheet";
import { NumericField } from "../pacing-create/numeric-field";
import { parseEditableNumber } from "../pacing-create/format";
import { AddLineItemPanel } from "./add-line-item-panel";
import { ContainerCard } from "./container-editor";
import { buildDefaultContainer, containerSumExceedsPlan, type PacingContainer } from "./containers";
import { useSavePacingPlan } from "./hooks";
import { seedFromCandidate, seedFromPlan, toPlanUpdateLineItem, type EditableLineItem } from "./line-item-fields";
import type { PacingDraftLineItemV1, PacingLineItemPlanV1 } from "./types";
import "./pacing-plan.css";

const RATE_TYPES = ["CPM", "CPC", "CPV", "Flat"];

function seedAll(planByLineItem: Record<string, PacingLineItemPlanV1>): Record<string, EditableLineItem> {
  const out: Record<string, EditableLineItem> = {};
  for (const [id, plan] of Object.entries(planByLineItem)) out[id] = seedFromPlan(plan);
  return out;
}

interface LineItemCardProps {
  li: EditableLineItem;
  currency: string;
  isLast: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (next: EditableLineItem) => void;
  onRemove: () => void;
}

function LineItemCard({ li, currency, isLast, open, onToggleOpen, onChange, onRemove }: LineItemCardProps) {
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [lastAddedContainerId, setLastAddedContainerId] = useState<string | null>(null);

  function field<K extends keyof EditableLineItem>(key: K, value: EditableLineItem[K]) {
    onChange({ ...li, [key]: value });
  }
  function setContainerAt(idx: number, next: PacingContainer) {
    onChange({ ...li, containers: li.containers.map((c, i) => (i === idx ? next : c)) });
  }
  function removeContainerAt(idx: number) {
    onChange({ ...li, containers: li.containers.filter((_, i) => i !== idx) });
  }
  function addContainer() {
    const container = buildDefaultContainer(
      {
        fs: li.flightStart,
        fe: li.flightEnd,
        targetImpressions: parseEditableNumber(li.targetImpressions) ?? null,
        nativeBudget: parseEditableNumber(li.nativeBudget) ?? null,
      },
      li.containers.length > 0 ? `Container ${li.containers.length + 1}` : "Container"
    );
    setLastAddedContainerId(container.id);
    onChange({ ...li, containers: [...li.containers, container] });
  }
  function addDuplicatedContainer(dup: PacingContainer) {
    setLastAddedContainerId(dup.id);
    onChange({ ...li, containers: [...li.containers, dup] });
  }

  const planImpr = parseEditableNumber(li.targetImpressions) ?? null;
  const overPlan = containerSumExceedsPlan(planImpr, li.containers);

  return (
    <div className="pplan__li-card" data-li-id={li.lineItemId}>
      <button type="button" className="pplan__li-head" onClick={onToggleOpen} aria-expanded={open}>
        <span className={`pplan__chevron${open ? " pplan__chevron--open" : ""}`}>▸</span>
        <span className="pplan__li-id">LI {li.lineItemId}</span>
        <span className="pplan__badge">{li.channel || "Unknown"}</span>
        <span className="pplan__badge">{li.rateType}</span>
        {li.isNew && <span className="pplan__badge pplan__badge--new">New</span>}
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
              <span className="pplan__field-label">Target impressions</span>
              <NumericField
                value={li.targetImpressions}
                onChange={(v) => field("targetImpressions", v)}
                ariaLabel={`Target impressions for line item ${li.lineItemId}`}
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Budget ({currency})</span>
              <NumericField
                value={li.nativeBudget}
                onChange={(v) => field("nativeBudget", v)}
                ariaLabel={`Budget for line item ${li.lineItemId}`}
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Target margin %</span>
              <input
                type="number"
                step="0.01"
                className="pplan__input pplan__input--num"
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
          </div>

          <div className="pplan__subsection">
            <div className="pplan__subsection-head">Containers ({li.containers.length})</div>
            {overPlan && (
              <p className="pplan__hint pplan__hint--warn">
                ⚠ Containers' combined target exceeds this line item's own target impressions. Pacing may reject this on save.
              </p>
            )}
            {li.containers.map((container, idx) => (
              <ContainerCard
                key={container.id}
                container={container}
                currency={currency}
                defaultOpen={container.id === lastAddedContainerId}
                onChange={(next) => setContainerAt(idx, next)}
                onRemove={() => removeContainerAt(idx)}
                onDuplicate={addDuplicatedContainer}
              />
            ))}
            <button type="button" className="pplan__add-btn" onClick={addContainer}>
              + Add container
            </button>
          </div>
        </div>
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

export interface PacingPlanSheetProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  currency: string;
  planByLineItem: Record<string, PacingLineItemPlanV1>;
}

export function PacingPlanSheet({ open, onClose, slug, currency, planByLineItem }: PacingPlanSheetProps) {
  const [lineItems, setLineItems] = useState<Record<string, EditableLineItem>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingLi, setAddingLi] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savePlan = useSavePacingPlan(slug);

  // Re-hydrate from the latest server data every time the sheet opens - never carry a stale edit
  // across a close/reopen, and never show an edit still in flight from a previous session.
  useEffect(() => {
    if (!open) return;
    const seeded = seedAll(planByLineItem);
    setLineItems(seeded);
    const ids = Object.keys(seeded).sort();
    setExpanded(new Set(ids.slice(0, 1)));
    setAddingLi(false);
    setSaveError(null);
    // Re-seed only when the sheet transitions open, not on every planByLineItem identity change
    // (which would clobber in-progress edits on every unrelated background refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slug]);

  const ids = useMemo(() => Object.keys(lineItems).sort(), [lineItems]);
  const existingIds = useMemo(() => new Set(ids), [ids]);

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

  function addCandidates(candidates: PacingDraftLineItemV1[]) {
    setLineItems((prev) => {
      const next = { ...prev };
      for (const candidate of candidates) next[candidate.lineItemId] = seedFromCandidate(candidate);
      return next;
    });
    setExpanded((prev) => new Set([...prev, ...candidates.map((c) => c.lineItemId)]));
    setAddingLi(false);
  }

  async function handleSave() {
    setSaveError(null);
    try {
      await savePlan.mutateAsync(ids.map((id) => toPlanUpdateLineItem(lineItems[id])));
      onClose();
    } catch (error) {
      setSaveError(formatError(error));
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pacing plan"
      className="pplan__sheet"
      headerActions={
        <button type="button" className="button button--ghost button--sm" onClick={() => setAddingLi((v) => !v)}>
          + Add line item
        </button>
      }
      footer={
        <div className="pplan__footer">
          {saveError && <span className="form-error pplan__footer-error">{saveError}</span>}
          <div className="pplan__footer-actions">
            <button type="button" className="button button--ghost button--sm" onClick={onClose} disabled={savePlan.isPending}>
              Cancel
            </button>
            <button type="button" className="button button--primary button--sm" onClick={() => void handleSave()} disabled={savePlan.isPending}>
              {savePlan.isPending ? "Saving…" : "Save plan"}
            </button>
          </div>
        </div>
      }
    >
      {addingLi && (
        <AddLineItemPanel slug={slug} currency={currency} existingIds={existingIds} onAdd={addCandidates} onClose={() => setAddingLi(false)} />
      )}

      {ids.length === 0 && !addingLi && <p className="pplan__hint">No line items on this pacing.</p>}

      {ids.map((id) => (
        <LineItemCard
          key={id}
          li={lineItems[id]}
          currency={currency}
          isLast={ids.length === 1}
          open={expanded.has(id)}
          onToggleOpen={() => toggleExpanded(id)}
          onChange={(next) => updateLineItem(id, next)}
          onRemove={() => removeLineItem(id)}
        />
      ))}
    </Sheet>
  );
}
