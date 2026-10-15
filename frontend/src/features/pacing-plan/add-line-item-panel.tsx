/**
 * "Add line item" panel (§9 of the migration plan, US-126). Two ways in: the campaign's own
 * not-yet-added line items (GET addable-line-items), or add-by-id (POST line-items/validate), which
 * also reaches a line item from a DIFFERENT campaign - accepted and clearly marked as such. A currency
 * mismatch against this pacing's own currency is refused, with an explanation, before the row can even
 * be selected - see `containers.ts`'s `currencyMatches` doc for why that check lives here rather than
 * waiting on Pacing (it does not itself reject this case on a plan save today).
 *
 * Behaves as the reference's AddLiDialog: every way the list can be empty says which way it is, a
 * line item already on the draft is shown but cannot be added twice, the list can be read again,
 * and the two refusals a person can hit (no permission, too many lookups) are said in words.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { currencyMatches } from "./containers";
import { useAddableLineItems } from "./hooks";
import { validatePacingLineItemsById } from "./api";
import type { PacingDraftLineItemV1 } from "./types";

/** What a line item is bought on, as the reference's Add LI card names it. */
const UNIT: Record<string, string> = { CPM: "impr", CPC: "clicks", CPV: "views", CPI: "installs" };
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LOAD_FALLBACK = "Could not load this campaign's line items. Add by ID instead.";

/** "N impr · $X": what the line item is meant to deliver, in its own unit, and for how much. */
function planOf(li: PacingDraftLineItemV1): string {
  const units = Number(li.plannedUnits) || 0;
  const budget = Number(li.budgetTotal) || 0;
  const parts: string[] = [];
  if (units > 0) {
    parts.push(`${Math.round(units).toLocaleString("en-US")} ${UNIT[(li.rateType || "CPM").toUpperCase()] || "units"}`);
  }
  if (budget > 0) {
    parts.push(`$${budget.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }
  return parts.join(" · ");
}

/** "YYYY-MM-DD" -> "Oct 20", by plain split - no Date parsing, no timezone shift. */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  const month = MONTHS_SHORT[+m - 1];
  return month === undefined ? iso : `${month} ${+d}`;
}

/** "Oct 20 – Oct 26", or nothing when either end is missing. */
function flightOf(li: PacingDraftLineItemV1): string {
  return li.flightStart && li.flightEnd ? `${monthDay(li.flightStart)} – ${monthDay(li.flightEnd)}` : "";
}

/**
 * What this panel may do with one candidate against the plan's DRAFT. The server diffs its addable
 * list against the SAVED pacing only, so a line item added and not yet saved comes back as addable -
 * adding it again would overwrite the draft's edits, so it is shown and not selectable.
 */
type CandidateState = "ok" | "added" | "currency";
function candidateState(li: PacingDraftLineItemV1, existingIds: Set<string>, currency: string): CandidateState {
  if (existingIds.has(li.lineItemId)) return "added";
  if (!currencyMatches(li.currency, currency)) return "currency";
  return "ok";
}

/** The two refusals a person can run into here, said in words (the reference's addLiErrorText). */
function addLiErrorText(error: unknown, fallback: string): string {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status === 403) {
    return "You don't have permission to add line items by ID. Add from the campaign list, or ask a manager.";
  }
  if (status === 429) return "Too many NetSuite lookups in the last minute. Wait a moment and try again.";
  return formatError(error) || fallback;
}

interface AddLineItemPanelProps {
  slug: string;
  currency: string;
  existingIds: Set<string>;
  onAdd: (candidates: PacingDraftLineItemV1[]) => void;
  onClose: () => void;
  /** Inside a dialog that already carries the title and the close button. */
  bare?: boolean;
}

export function AddLineItemPanel({ slug, currency, existingIds, onAdd, onClose, bare = false }: AddLineItemPanelProps) {
  const addable = useAddableLineItems(slug, true);
  const [mode, setMode] = useState<"campaign" | "byId">("campaign");
  const [ids, setIds] = useState("");
  const [byIdCandidates, setByIdCandidates] = useState<PacingDraftLineItemV1[]>([]);
  const [byIdError, setByIdError] = useState<string | null>(null);
  const [byIdNotes, setByIdNotes] = useState("");
  const [byIdBusy, setByIdBusy] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // A refused re-read keeps the list already on screen: emptying it would say every line item is
  // already added, which is not true.
  const lastGood = useRef<{ io: string | null; candidates: PacingDraftLineItemV1[] } | null>(null);
  if (addable.data && addable.data.ok !== false) {
    lastGood.current = { io: addable.data.io || null, candidates: addable.data.addable ?? [] };
  }
  const io = lastGood.current?.io ?? (addable.data?.io || null);
  const campaignCandidates = lastGood.current?.candidates ?? [];
  const loading = addable.isFetching;
  const loaded = !addable.isPending;
  const loadError = addable.isError
    ? addLiErrorText(addable.error, LOAD_FALLBACK)
    : addable.data?.ok === false
      ? addable.data.error || LOAD_FALLBACK
      : null;

  // No order number means no campaign list at all: the panel opens straight on "By ID", as the
  // reference's does, and so does a first load that failed with nothing to show.
  useEffect(() => {
    if (!loaded) return;
    if (!io || (loadError && campaignCandidates.length === 0)) setMode("byId");
  }, [loaded, io, loadError, campaignCandidates.length]);

  const list = mode === "campaign" ? campaignCandidates : byIdCandidates;
  const selectable = list.filter((li) => candidateState(li, existingIds, currency) === "ok");
  const selectedCount = selectable.filter((li) => checked.has(li.lineItemId)).length;
  const blockedCount = list.length - selectable.length;
  // On "By ID" the lookup's own error wins; a failed campaign read still says so there when it left
  // nothing to pick from (that failure is why the panel opened on "By ID").
  const error = mode === "campaign"
    ? loadError
    : byIdError ?? (campaignCandidates.length === 0 ? loadError : null);

  function changeMode(next: "campaign" | "byId") {
    setMode(next);
    setByIdError(null);
    setByIdNotes("");
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const all = selectable.map((li) => li.lineItemId);
    setChecked(selectedCount === all.length ? new Set() : new Set(all));
  }

  async function runLookup() {
    setByIdBusy(true);
    setByIdError(null);
    setByIdNotes("");
    try {
      const requested = ids
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const duplicates = requested.filter((id) => existingIds.has(id));
      const fresh = requested.filter((id) => !existingIds.has(id));
      if (fresh.length === 0) {
        setByIdError("All entered ids are already in this pacing.");
        setByIdCandidates([]);
        return;
      }
      const result = await validatePacingLineItemsById(fresh);
      if (result.ok === false) {
        setByIdError(result.error || "Validation failed.");
        setByIdCandidates([]);
        return;
      }
      const found = (result.lineItems ?? []).filter((li) => !existingIds.has(li.lineItemId));
      setByIdCandidates(found);
      setChecked(new Set(found.filter((li) => candidateState(li, existingIds, currency) === "ok").map((li) => li.lineItemId)));
      const notes: string[] = [];
      if (duplicates.length) notes.push(`Skipped (already added): ${duplicates.join(", ")}`);
      const mismatched = found.filter((li) => candidateState(li, existingIds, currency) === "currency").map((li) => li.lineItemId);
      if (mismatched.length) notes.push(`Different currency than this pacing (${currency}) — cannot add: ${mismatched.join(", ")}`);
      setByIdNotes(notes.join(" · "));
    } catch (lookupError) {
      setByIdError(addLiErrorText(lookupError, "Validate failed"));
      setByIdCandidates([]);
    } finally {
      setByIdBusy(false);
    }
  }

  function confirm() {
    const selected = selectable.filter((li) => checked.has(li.lineItemId));
    if (selected.length === 0) return;
    onAdd(selected);
  }

  function reasonOf(state: CandidateState): string {
    if (state === "added") return "in this pacing";
    if (state === "currency") return `Different currency (≠ ${currency}) — cannot add`;
    return "";
  }

  return (
    <div className={`pplan__add-li${bare ? " pplan__add-li--bare" : ""}`}>
      {!bare && (
        <div className="pplan__add-li-head">
          <span className="pplan__subsection-head">Add line item</span>
          <button type="button" className="pplan__icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      )}

      {/* The tabs only when there is a campaign list to pick from - without an order number there
          is one way in, and a tab row offering a second, empty one says nothing true. */}
      {io && (
        <div className="pplan__add-li-tabrow">
          <div className="pplan__tabs">
            <button
              type="button"
              className={`pplan__tab${mode === "campaign" ? " pplan__tab--active" : ""}`}
              onClick={() => changeMode("campaign")}
            >
              From this campaign ({campaignCandidates.length})
            </button>
            <button type="button" className={`pplan__tab${mode === "byId" ? " pplan__tab--active" : ""}`} onClick={() => changeMode("byId")}>
              By ID
            </button>
          </div>
          {mode === "campaign" && (
            // Never `disabled`: a button that disables itself under the pointer throws keyboard
            // focus out of the panel. It says so and ignores the second press.
            <button
              type="button"
              className="pplan__link-btn"
              aria-busy={loading || undefined}
              title="Read the campaign's line items from NetSuite again"
              onClick={() => { if (!loading) void addable.refetch(); }}
            >
              {loading ? "Loading…" : "Refresh list"}
            </button>
          )}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {mode === "byId" && byIdNotes && <p className="pplan__hint">{byIdNotes}</p>}

      {/* Every way this list can be empty says WHICH way it is. */}
      {mode === "campaign" && !loaded && <p className="pplan__hint">Reading this campaign's line items from NetSuite…</p>}
      {mode === "campaign" && loaded && !loading && campaignCandidates.length === 0 && !loadError && (
        <p className="pplan__hint">
          Every line item on order {io} is already in this pacing.{" "}
          <button type="button" className="pplan__link-btn" onClick={() => changeMode("byId")}>
            Add one by ID
          </button>
        </p>
      )}
      {mode === "byId" && loaded && !io && !loadError && (
        <p className="pplan__hint">
          This pacing has no order number, so there is no campaign list to pick from. Paste the line item IDs instead.
        </p>
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
        </div>
      )}

      {list.length > 0 && (
        <div className="pplan__add-li-listhd">
          <span>
            {selectable.length > 0 ? `${selectable.length} can be added` : "Nothing here can be added"}
            {blockedCount > 0 ? ` · ${blockedCount} cannot` : ""}
          </span>
          {selectable.length > 1 && (
            <button type="button" className="pplan__link-btn" onClick={toggleAll}>
              {selectedCount === selectable.length ? "Clear" : "Select all"}
            </button>
          )}
        </div>
      )}

      {list.length > 0 && (
        <ul className="pplan__add-li-list">
          {list.map((li) => {
            const state = candidateState(li, existingIds, currency);
            const blocked = state !== "ok";
            const plan = planOf(li);
            const flight = flightOf(li);
            // The reference's card: what the line item is, what it is meant to deliver and for how
            // much, and over which flight - the flight is what someone prolonging a pacing picks by.
            // The description is the one free-text field, so it comes last and is clamped.
            return (
              <li key={li.lineItemId} className="pplan__add-li-row">
                <label className={`pplan__add-li-check${blocked ? " pplan__add-li-check--disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={!blocked && checked.has(li.lineItemId)}
                    disabled={blocked}
                    onChange={() => toggle(li.lineItemId)}
                  />
                  <span className="pplan__add-li-body">
                    <span className="pplan__add-li-top">
                      <span className="pplan__li-id">LI {li.lineItemId}</span>
                      <span className="pplan__badge">{li.channel || "Unknown"}</span>
                      <span className="pplan__add-li-rate">{li.rateType || "CPM"}</span>
                      {mode === "byId" && li.campaignName && <span className="pplan__hint">from {li.campaignName}</span>}
                      {blocked && <span className="pplan__hint pplan__hint--warn">{reasonOf(state)}</span>}
                      {plan && <span className="pplan__add-li-plan">{plan}</span>}
                    </span>
                    {(flight || li.description) && (
                      <span className="pplan__add-li-sub">
                        {flight && <span className="pplan__add-li-flight">{flight}</span>}
                        {li.description && <span className="pplan__add-li-desc">{li.description}</span>}
                      </span>
                    )}
                  </span>
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
          <button type="button" className="button button--primary button--sm" disabled={selectedCount === 0} onClick={confirm}>
            {selectedCount > 0 ? `Add selected (${selectedCount})` : "Add selected"}
          </button>
        </div>
      )}
    </div>
  );
}
