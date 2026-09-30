/**
 * Reassigning a pacing (§11 of the migration plan, US-131).
 *
 * One component, used from both places the story asks for — the Overview row and a campaign's
 * Pacing tab — so the two cannot drift into offering different choices or wording the same refusal
 * two ways.
 *
 * The list itself is {@link PersonPicker}: search, keyboard, placement and the empty-roster note all
 * live there, because the delegation form (§12) needs exactly the same control and a second copy is
 * how two screens start disagreeing about what an empty roster means. What stays here is what is
 * only true of a reassignment — the trigger's wording, and the transfer that follows a pick.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { formatError } from "../../shared/format/error";
import { PersonPicker } from "./person-picker";
import { useTransferPacingOwner } from "./hooks";

export function OwnerPicker({
  pacingId,
  currentOwnerName,
  onDone,
  trigger = "Reassign",
  triggerClassName,
}: {
  pacingId: string;
  currentOwnerName: string | null;
  /** Called after a successful transfer, for a caller that wants to close a menu or refocus. */
  onDone?: () => void;
  /** What the closed control shows — "Reassign" inline in a table cell (the default), or a menu
   *  item's own wording ("Transfer owner") when this sits inside a row's kebab menu. */
  trigger?: ReactNode;
  /** Class for the trigger, forwarded to {@link PersonPicker} — lets a menu style it as one of its
   *  own items instead of the inline link the owner cell uses. */
  triggerClassName?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const transfer = useTransferPacingOwner();

  async function assign(newOwnerId: string) {
    setError(null);
    try {
      await transfer.mutateAsync({ pacingId, newOwnerId });
      onDone?.();
      return true;
    } catch (cause) {
      // Keep the picker open with the reason. Closing would leave the old owner on screen and read
      // as success.
      setError(formatError(cause));
      return false;
    }
  }

  return (
    <PersonPicker
      trigger={trigger}
      triggerClassName={triggerClassName}
      searchLabel={`Reassign this pacing${currentOwnerName ? `, currently owned by ${currentOwnerName}` : ""}`}
      emptyNote="Nobody to assign to — the Hub has no one in your scope synced with Pacing yet."
      busy={transfer.isPending}
      busyNote="Reassigning…"
      error={error}
      onOpen={() => setError(null)}
      onPick={assign}
    />
  );
}
