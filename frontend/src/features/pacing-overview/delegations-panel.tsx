import { useState } from "react";
import { cn } from "../../shared/style/cn";
import { ChevronDownIcon } from "../../shared/ui/icons/icons";
import { Sheet } from "../../shared/ui/sheet/sheet";
import { PersonPicker } from "./person-picker";
import { useAssignableOwners, useCreateDelegation, useDelegations, useRevokeDelegation } from "./hooks";
import type { PacingDelegationV1 } from "./delegations-api";
import "./delegations-panel.css";

/**
 * Delegations (§12 of the migration plan, US-133/134/135).
 *
 * Grant your access to a colleague for a period, see what you have granted and what you have
 * received, and take a grant back.
 *
 * NOTHING HERE DECIDES ACCESS. Every rule - at most 30 days, no delegating to yourself, no start in
 * the past, no duplicate live grants - is a database constraint in Pacing, and the migration plan
 * says so in as many words: "Reproducing that faithfully elsewhere is its own piece of work." So
 * this screen forwards and reports. The one liberty it takes is bounding the date field at 30 days,
 * which is not a check but a courtesy: it makes the common case impossible to get wrong, and the
 * refusal rare rather than routine.
 *
 * Received grants are shown but not revocable here. Pacing lets whoever owns the delegator's scope
 * revoke, but "cancel the access somebody gave me" is a different act from "take back what I gave",
 * and putting both behind one button on one row is how a person revokes the wrong one.
 */

/** Pacing's refusal codes, in words. Ported from the retired Overview screen so the same rule reads
 *  the same way it always has. */
const REFUSALS: Record<string, string> = {
  delegate_id_required: "Please select a user to delegate to",
  expires_at_required: "End date is required",
  cannot_delegate_to_self: "Cannot delegate to yourself",
  delegate_not_found: "Selected user not found",
  starts_at_in_past: "Start date cannot be in the past",
  expires_before_start: "End date must be after start date",
  max_30_days: "Maximum delegation period is 30 days",
  would_shorten_active: "Active delegation exists with a later end date — revoke it first",
  not_your_pacing: "You can only delegate pacings you own",
  too_many_pacings: "Too many pacings in one delegation",
};

/** Pacing answers with a code, a sentence, or both. Prefer our own wording for a code we know, and
 *  fall back to whatever it said rather than to "something went wrong". */
function refusalText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  for (const [code, text] of Object.entries(REFUSALS)) {
    if (raw.includes(code)) return text;
  }
  return raw || "Could not save the delegation";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** The window Pacing allows: the start day counts, so the last legal end is start + 29. */
const maxEndFor = (start: string) => ymd(new Date(new Date(`${start}T00:00:00Z`).getTime() + 29 * DAY_MS));

function fmtDay(value: string | undefined | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value).slice(0, 10)
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** What a grant covers, in words. A portfolio-wide grant says how much that is - "everything I own"
 *  means nothing without the number. */
function scopeText(d: PacingDelegationV1): string {
  if (d.pacingId) return d.pacingName || d.dashSlug || "One pacing";
  const n = d.pacingCount ?? 0;
  return n > 0 ? `Everything they own (${n})` : "Everything they own";
}

export function DelegationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = ymd(new Date());
  const [delegateId, setDelegateId] = useState("");
  const [startsAt, setStartsAt] = useState(today);
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const delegations = useDelegations(open);
  const owners = useAssignableOwners(open);
  const create = useCreateDelegation();
  const revoke = useRevokeDelegation();

  // Which side of a grant this person is on is the server's answer: a delegation is keyed on the
  // PACING user id, and nothing on this side knows the caller's own.
  const granted = (delegations.data ?? []).filter((d) => d.direction === "granted");
  const received = (delegations.data ?? []).filter((d) => d.direction !== "granted");

  const maxEnd = maxEndFor(startsAt || today);

  // The trigger has to name whoever was chosen, and a delegation carries only their id. Same query
  // the picker reads, so this is the cached roster rather than a second request.
  const delegateName = (owners.data?.owners ?? []).find((o) => o.pacingUserId === delegateId)?.name;

  async function handleGrant() {
    setError(null);
    if (!delegateId) {
      setError(REFUSALS.delegate_id_required);
      return;
    }
    if (!expiresAt) {
      setError(REFUSALS.expires_at_required);
      return;
    }
    try {
      await create.mutateAsync({
        delegateId,
        startsAt: startsAt || undefined,
        expiresAt,
        reason: reason.trim() || undefined,
        // No pacings named: everything the delegator owns (US-134). Scoping to chosen pacings is a
        // separate control and is not offered yet - see the panel's own note.
      });
      setDelegateId("");
      setReason("");
      setExpiresAt("");
    } catch (e) {
      setError(refusalText(e));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Delegations">
      <section className="deleg__section">
        <h3 className="deleg__heading">Delegate my access</h3>
        <p className="deleg__hint">
          The person sees everything you own, for the period you choose. Up to 30 days; revoking
          takes effect immediately.
        </p>

        <div className="deleg__form">
          {/* The same picker the reassignment flow uses, not a native select: it is the same roster
              of six hundred-odd people, and a list you can only scroll is not a list you can choose
              from. Not a <label>, because the control it would point at is a button - the name is on
              the button itself. */}
          <div className="deleg__field">
            <span className="deleg__label">To</span>
            <PersonPicker
              triggerClassName={cn("opick__field", !delegateId && "opick__field--empty")}
              trigger={
                <>
                  <span className="deleg__to-name">{delegateName ?? "Select a person…"}</span>
                  <ChevronDownIcon className="opick__field-chevron" />
                </>
              }
              triggerLabel={delegateName ? `Delegate to: ${delegateName}` : "Delegate to"}
              searchLabel="Delegate to"
              onPick={setDelegateId}
              onOpen={() => setError(null)}
            />
          </div>

          <label className="deleg__field">
            <span className="deleg__label">From</span>
            <input type="date" value={startsAt} min={today} onChange={(e) => setStartsAt(e.target.value)} aria-label="From" />
          </label>

          <label className="deleg__field">
            <span className="deleg__label">Until</span>
            {/* Bounded at 30 days so the rule is met by the control rather than by a refusal. */}
            <input
              type="date"
              value={expiresAt}
              min={startsAt || today}
              max={maxEnd}
              onChange={(e) => setExpiresAt(e.target.value)}
              aria-label="Until"
            />
          </label>

          <label className="deleg__field deleg__field--wide">
            <span className="deleg__label">Reason</span>
            <input
              type="text"
              value={reason}
              maxLength={200}
              placeholder="Annual leave"
              onChange={(e) => setReason(e.target.value)}
              aria-label="Reason"
            />
          </label>
        </div>

        <p className="deleg__hint">Latest end date allowed from {fmtDay(startsAt)}: {fmtDay(maxEnd)}.</p>
        {error && <p className="form-error">{error}</p>}

        <div className="deleg__actions">
          <button
            type="button"
            className="button button--primary button--sm"
            onClick={() => void handleGrant()}
            disabled={create.isPending}
          >
            {create.isPending ? "Granting…" : "Delegate"}
          </button>
        </div>
      </section>

      <DelegationList
        title="Granted by me"
        empty="You have not delegated your access to anyone."
        rows={granted}
        person={(d) => d.delegateName || d.delegateEmail || d.delegateId}
        onRevoke={(id) => void revoke.mutateAsync(id)}
        busy={revoke.isPending}
        loading={delegations.isPending}
      />

      <DelegationList
        title="Granted to me"
        empty="Nobody has delegated their access to you."
        rows={received}
        person={(d) => d.delegatorName || d.delegatorEmail || d.delegatorId}
        loading={delegations.isPending}
      />
    </Sheet>
  );
}

function DelegationList({
  title,
  empty,
  rows,
  person,
  onRevoke,
  busy,
  loading,
}: {
  title: string;
  empty: string;
  rows: PacingDelegationV1[];
  person: (d: PacingDelegationV1) => string;
  onRevoke?: (delegationId: string) => void;
  busy?: boolean;
  loading?: boolean;
}) {
  return (
    <section className="deleg__section">
      <h3 className="deleg__heading">{title}</h3>
      {loading ? (
        <p className="deleg__hint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="deleg__hint">{empty}</p>
      ) : (
        <ul className="deleg__list">
          {rows.map((d) => (
            <li key={d.delegationId} className={cn("deleg__row", !d.pacingId && "deleg__row--wide-scope")}>
              <div className="deleg__row-main">
                <span className="deleg__person">{person(d)}</span>
                <span className="deleg__scope">{scopeText(d)}</span>
              </div>
              <div className="deleg__row-meta">
                <span className="deleg__period">
                  {fmtDay(d.startsAt)} → {fmtDay(d.expiresAt)}
                </span>
                {d.reason && <span className="deleg__reason">{d.reason}</span>}
              </div>
              {onRevoke && (
                <button
                  type="button"
                  className="button button--danger button--sm"
                  onClick={() => onRevoke(d.delegationId)}
                  disabled={busy}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
