/**
 * The Create Pacing modal - the Overview's "Create pacing" button opens it in place (no route, no
 * URL change), so a pacing can be created without first navigating into a campaign. Two steps, like
 * the retired SPA's create form: step 1 looks line items up by insertion-order number or by a paste
 * of line item ids (`POST /api/v1/pacing/line-items/validate` - the same Pacing validate endpoint
 * the campaign path uses, different selector); step 2 is the SAME review/configure panel the
 * campaign tab uses (`CreatePacingPanel`), fed the already-fetched draft instead of a campaign id.
 * The step is the draft: no draft means step 1, a loaded draft means step 2 - one source of truth,
 * no way for the two to disagree.
 *
 * Step 1 owns the outcomes the reference handled explicitly (CreatePacing.jsx's applyValidateResult):
 * `ok: false` stays here with the reason on screen (a mixed-currency lookup must never walk into an
 * empty step 2); an empty result names what was looked up; a 429 reads as "wait a minute", not as a
 * crash. `notFoundIds` rows travel INTO step 2 un-ticked and marked - they may legitimately be
 * re-ticked to pace early, so they are never hidden.
 *
 * Closing with work on screen: once a draft is loaded, Esc, an overlay click, the header's X and the
 * panel's own "Back to input" all route through one in-card confirm ("Discard this draft?") instead
 * of throwing ticked rows and edited plan values away silently. Handled HERE, in the caller - the
 * Modal primitive's unconditional-close contract is untouched, every other modal relies on it.
 *
 * Access: the "Create pacing" button that opens this is gated on the resolved `can_create`; with no
 * route of its own there is nothing else to reach.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { cn } from "../../shared/style/cn";
import { Modal } from "../../shared/ui/modal/modal";
import type { OpenPacingState } from "../pacing-overview/navigation";
import { validatePacingLookup } from "./api";
import { CreatePacingPanel } from "./create-pacing-panel";
import type { PacingDraftV1 } from "./types";
import "./create-pacing-modal.css";

type LookupMode = "io" | "ids";

/** What the in-card discard confirm is guarding: closing the modal, or going back to step 1. */
type DiscardIntent = "close" | "back";

/** Splits a paste of line item ids on commas and newlines, dropping the empties. */
function parseIds(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function CreatePacingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();

  const [mode, setMode] = useState<LookupMode>("io");
  const [ioInput, setIoInput] = useState("");
  const [idsInput, setIdsInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PacingDraftV1 | null>(null);
  // Bumped on every successful lookup and used as the panel's key: the review form seeds all its
  // local state (selection, edits) from the draft in lazy initializers, so a SECOND validate after
  // "Back to input" must remount it - otherwise the previous draft's edits survive into the new one.
  const [draftVersion, setDraftVersion] = useState(0);
  // Non-null while the in-card discard confirm is showing, carrying what confirming abandons the
  // draft FOR. Both destructive exits (close the modal / back to step 1) go through it.
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent | null>(null);

  const step: 1 | 2 = draft ? 2 : 1;

  /**
   * Every close path of the Modal (Esc, overlay click, header X) lands here: with no draft there is
   * nothing to lose and the modal just closes; with one, the in-card confirm takes over.
   */
  function requestClose() {
    if (draft) {
      setDiscardIntent("close");
      return;
    }
    onClose();
  }

  /** The confirm's destructive choice: abandon the draft, then close or return to step 1. */
  function confirmDiscard() {
    const intent = discardIntent;
    setDiscardIntent(null);
    // The draft clears either way: step 1 is "no draft", and a later Validate builds a fresh one.
    setDraft(null);
    if (intent === "close") onClose();
  }

  function switchMode(next: LookupMode) {
    setMode(next);
    setValidateError(null);
  }

  async function handleValidate() {
    const trimmedIo = ioInput.trim();
    const ids = parseIds(idsInput);
    if (mode === "io" && !trimmedIo) {
      setValidateError("Enter an insertion order number.");
      return;
    }
    if (mode === "ids" && ids.length === 0) {
      setValidateError("Enter at least one line item id.");
      return;
    }
    setValidating(true);
    setValidateError(null);
    try {
      const result = await validatePacingLookup(
        mode === "io" ? { insertionOrderId: trimmedIo } : { lineItemIds: ids }
      );
      // A rejected validate (e.g. mixed currencies) is a normal 200 with ok:false and the reason in
      // `error`. Unchecked, it walks into an empty step 2 and the user never sees why - the exact
      // bug the reference fixed.
      if (result.ok === false) {
        setValidateError(result.error || "Validation failed.");
        return;
      }
      // Nothing found is not a silent empty table: name what was looked up.
      if ((result.lineItems ?? []).length === 0) {
        setValidateError(
          mode === "io"
            ? `No line items found for insertion order "${result.orderNumber || trimmedIo}". Check the number in NetSuite.`
            : "No line items found for these ids. Check them in NetSuite."
        );
        return;
      }
      setDraft(result);
      setDraftVersion((version) => version + 1);
    } catch (error) {
      // Pacing allows 5 validates per user per minute - an honest "slow down", never a crash.
      if (error instanceof ApiError && error.status === 429) {
        setValidateError("Pacing allows a few lookups per minute — wait a minute and try again.");
      } else {
        setValidateError(formatError(error));
      }
    } finally {
      setValidating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title="Create Pacing"
      // Two deliberate card sizes: a normal dialog for the one-field lookup, the wide canvas for
      // the review table. The growth on Validate reads as progress into the review, not as jitter -
      // one fixed size for both steps left step 1 floating tiny controls in a huge empty card.
      className={cn("pcreate-modal", draft ? "pcreate-modal--review" : "pcreate-modal--input")}
    >
      {/* The discard confirm, in the card rather than a second modal: it never fights the Modal's
          own Esc handler or focus trap, and a stray Esc/overlay click can only ever summon it, not
          lose work. Background tint, no stripe. */}
      {discardIntent !== null && (
        <div className="pcreate-modal__discard" role="alert">
          <span className="pcreate-modal__discard-text">
            {discardIntent === "close"
              ? "Discard this draft? Ticked rows and edited plan values will be lost."
              : "Go back to input? Ticked rows and edited plan values will be lost."}
          </span>
          <span className="pcreate-modal__discard-actions">
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setDiscardIntent(null)}
            >
              Keep editing
            </button>
            <button type="button" className="button button--danger button--sm" onClick={confirmDiscard}>
              Discard
            </button>
          </span>
        </div>
      )}

      <ol className="pcreate-modal__steps" aria-label="Create pacing steps">
        <li
          className={cn("pcreate-modal__step", step === 1 && "pcreate-modal__step--active")}
          aria-current={step === 1 ? "step" : undefined}
        >
          <span className="pcreate-modal__step-num">1</span> Input
        </li>
        <li
          className={cn("pcreate-modal__step", step === 2 && "pcreate-modal__step--active")}
          aria-current={step === 2 ? "step" : undefined}
        >
          <span className="pcreate-modal__step-num">2</span> Review &amp; Configure
        </li>
      </ol>

      <div className="pcreate-modal__scroll">
        {step === 1 && (
          <div className="pcreate-modal__step1">
            <div className="pcreate-modal__modes" role="group" aria-label="Lookup mode">
              <button
                type="button"
                className={cn("pcreate-modal__mode-btn", mode === "io" && "pcreate-modal__mode-btn--active")}
                onClick={() => switchMode("io")}
              >
                Insertion order
              </button>
              <button
                type="button"
                className={cn("pcreate-modal__mode-btn", mode === "ids" && "pcreate-modal__mode-btn--active")}
                onClick={() => switchMode("ids")}
              >
                Line item IDs
              </button>
            </div>

            {mode === "io" ? (
              <label className="pcreate-modal__field">
                <span className="pcreate-modal__field-label">Insertion order number</span>
                <input
                  type="text"
                  className="pcreate-modal__io-input"
                  value={ioInput}
                  placeholder="e.g. TM-271064"
                  onChange={(e) => setIoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleValidate();
                  }}
                />
              </label>
            ) : (
              <label className="pcreate-modal__field">
                <span className="pcreate-modal__field-label">Line item ids, separated by commas or new lines</span>
                <textarea
                  className="pcreate-modal__ids-input"
                  rows={5}
                  value={idsInput}
                  placeholder={"599852\n599853, 599854"}
                  onChange={(e) => setIdsInput(e.target.value)}
                />
              </label>
            )}

            {validateError && <p className="form-error pcreate-modal__error">{validateError}</p>}

            <div className="pcreate-modal__actions">
              <button type="button" className="button" disabled={validating} onClick={() => void handleValidate()}>
                {validating ? "Validating…" : "Validate"}
              </button>
            </div>
          </div>
        )}

        {step === 2 && draft && (
          <CreatePacingPanel
            key={draftVersion}
            draft={draft}
            backLabel="← Back to input"
            onClose={() => setDiscardIntent("back")}
            onCreated={(pacingId, primaryCampaignId) => {
              // Close first (the Overview owns the open flag), then open the new pacing the way the
              // Overview opens one: through its primary campaign, with the just-created flag so the
              // dashboard shows its "pulling first data" state while the fire-and-forget first
              // refresh lands. The empty-set case cannot normally reach here (Create is blocked on
              // it), so the fallback is just "stay home".
              onClose();
              const campaignId = Number(primaryCampaignId);
              if (primaryCampaignId != null && Number.isFinite(campaignId)) {
                const state: OpenPacingState = { openPacingId: pacingId, justCreated: true };
                navigate(`/campaigns/${campaignId}/pacing`, { state });
              }
            }}
          />
        )}
      </div>
    </Modal>
  );
}
