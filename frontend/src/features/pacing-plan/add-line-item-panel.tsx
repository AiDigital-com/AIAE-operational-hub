/**
 * "Add line item" panel (§9 of the migration plan, US-126). Two ways in: the campaign's own
 * not-yet-added line items (GET addable-line-items), or add-by-id (POST line-items/validate), which
 * also reaches a line item from a DIFFERENT campaign - accepted and clearly marked as such. A currency
 * mismatch against this pacing's own currency is refused, with an explanation, before the row can even
 * be selected - see `containers.ts`'s `currencyMatches` doc for why that check lives here rather than
 * waiting on Pacing (it does not itself reject this case on a plan save today).
 */
import { useState } from "react";
import { formatError } from "../../shared/format/error";
import { currencyMatches } from "./containers";
import { useAddableLineItems } from "./hooks";
import { validatePacingLineItemsById } from "./api";
import type { PacingDraftLineItemV1 } from "./types";

interface AddLineItemPanelProps {
  slug: string;
  currency: string;
  existingIds: Set<string>;
  onAdd: (candidates: PacingDraftLineItemV1[]) => void;
  onClose: () => void;
}

export function AddLineItemPanel({ slug, currency, existingIds, onAdd, onClose }: AddLineItemPanelProps) {
  const addable = useAddableLineItems(slug, true);
  const [mode, setMode] = useState<"campaign" | "byId">("campaign");
  const [ids, setIds] = useState("");
  const [byIdCandidates, setByIdCandidates] = useState<PacingDraftLineItemV1[]>([]);
  const [byIdError, setByIdError] = useState<string | null>(null);
  const [byIdBusy, setByIdBusy] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const campaignCandidates = (addable.data?.ok !== false ? addable.data?.addable : []) ?? [];
  const list = mode === "campaign" ? campaignCandidates : byIdCandidates;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runLookup() {
    setByIdBusy(true);
    setByIdError(null);
    try {
      const requested = ids
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const fresh = requested.filter((id) => !existingIds.has(id));
      if (fresh.length === 0) {
        setByIdError("All entered ids are already on this pacing.");
        setByIdCandidates([]);
        return;
      }
      const result = await validatePacingLineItemsById(fresh);
      if (result.ok === false) {
        setByIdError(result.error || "Lookup failed.");
        setByIdCandidates([]);
        return;
      }
      const found = (result.lineItems ?? []).filter((li) => !existingIds.has(li.lineItemId));
      setByIdCandidates(found);
      setChecked(new Set(found.filter((li) => currencyMatches(li.currency, currency)).map((li) => li.lineItemId)));
    } catch (error) {
      setByIdError(formatError(error));
      setByIdCandidates([]);
    } finally {
      setByIdBusy(false);
    }
  }

  function confirm() {
    const selected = list.filter((li) => checked.has(li.lineItemId) && currencyMatches(li.currency, currency));
    if (selected.length === 0) return;
    onAdd(selected);
  }

  return (
    <div className="pplan__add-li">
      <div className="pplan__add-li-head">
        <span className="pplan__subsection-head">Add line item</span>
        <button type="button" className="pplan__icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="pplan__tabs">
        <button
          type="button"
          className={`pplan__tab${mode === "campaign" ? " pplan__tab--active" : ""}`}
          onClick={() => setMode("campaign")}
        >
          From this campaign ({campaignCandidates.length})
        </button>
        <button type="button" className={`pplan__tab${mode === "byId" ? " pplan__tab--active" : ""}`} onClick={() => setMode("byId")}>
          By ID
        </button>
      </div>

      {mode === "campaign" && addable.isPending && <p className="pplan__hint">Loading campaign line items…</p>}
      {mode === "campaign" && addable.isError && <p className="form-error">{formatError(addable.error)}</p>}
      {mode === "campaign" && addable.data?.ok === false && <p className="form-error">{addable.data.error}</p>}
      {mode === "campaign" && addable.isSuccess && addable.data.ok !== false && campaignCandidates.length === 0 && (
        <p className="pplan__hint">All of this campaign's line items are already on this pacing. Use "By ID" to add one from another campaign.</p>
      )}

      {mode === "byId" && (
        <div className="pplan__field">
          <textarea
            className="pplan__input"
            rows={2}
            value={ids}
            placeholder="Line item IDs — one per line, or comma separated"
            onChange={(e) => setIds(e.target.value)}
          />
          <div className="pplan__dialog-actions">
            <button type="button" className="button button--ghost button--sm" disabled={byIdBusy || !ids.trim()} onClick={runLookup}>
              {byIdBusy ? "Looking up…" : "Look up"}
            </button>
          </div>
          {byIdError && <p className="form-error">{byIdError}</p>}
        </div>
      )}

      {list.length > 0 && (
        <ul className="pplan__add-li-list">
          {list.map((li) => {
            const mismatch = !currencyMatches(li.currency, currency);
            return (
              <li key={li.lineItemId} className="pplan__add-li-row">
                <label className={`pplan__add-li-check${mismatch ? " pplan__add-li-check--disabled" : ""}`}>
                  <input type="checkbox" checked={checked.has(li.lineItemId)} disabled={mismatch} onChange={() => toggle(li.lineItemId)} />
                  <span className="pplan__li-id">LI {li.lineItemId}</span>
                  <span className="pplan__badge">{li.channel || "Unknown"}</span>
                  {mode === "byId" && li.campaignName && <span className="pplan__hint">from {li.campaignName}</span>}
                  {mismatch ? (
                    <span className="pplan__hint pplan__hint--warn pplan__add-li-note">
                      Different currency ({li.currency || "USD"} ≠ {currency}) — cannot add
                    </span>
                  ) : (
                    li.description && <span className="pplan__hint pplan__add-li-note">{li.description}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {list.length > 0 && (
        <div className="pplan__dialog-actions">
          <button type="button" className="button button--ghost button--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary button--sm" disabled={checked.size === 0} onClick={confirm}>
            Add selected
          </button>
        </div>
      )}
    </div>
  );
}
