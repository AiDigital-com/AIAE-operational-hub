/**
 * Delete confirmations for the pacing administration screen. Deletion is permanent on the Pacing
 * side - it removes the pacing's row, its delivery journal, and its dashboard data file + slug
 * directory from disk, with no soft delete and no undo - so both modals say plainly what is lost and
 * require the caller to type something exact before the danger action becomes clickable. Neither
 * modal computes anything about the pacing; they only name it and forward the delete.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatError } from "../../shared/format/error";
import { Modal } from "../../shared/ui/modal/modal";
import { deletePacing } from "./api";
import { useDeletePacing } from "./hooks";
import type { PacingRowV1 } from "./types";
import "./pacing-admin.css";

/** Deletes one pacing. Requires typing its exact name before "Delete permanently" is clickable -
 *  the same friction the retired Pacing front end's own Admin screen used for this exact action. */
export function DeletePacingModal({ row, onClose }: { row: PacingRowV1; onClose: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const mutation = useDeletePacing();
  const nameMatches = confirmText.trim() === row.name.trim();

  async function handleConfirm() {
    if (!nameMatches || mutation.isPending) return;
    try {
      await mutation.mutateAsync(row.id);
      onClose();
    } catch {
      // Left open - the error renders below from mutation.error, so the caller can retry or cancel.
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete "${row.name}"?`}
      subtitle="This permanently deletes its dashboard data and delivery journal from Pacing. There is no undo."
    >
      <div className="pacing-admin__confirm-target">
        <span className="pacing-admin__confirm-name">{row.name}</span>
        {row.dashSlug && <span className="pacing-admin__confirm-slug">{row.dashSlug}</span>}
      </div>
      <label className="pacing-admin__confirm-label" htmlFor="pacing-admin-delete-confirm">
        Type <strong>{row.name}</strong> to confirm
      </label>
      <input
        id="pacing-admin-delete-confirm"
        type="text"
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
        placeholder={row.name}
        autoComplete="off"
        autoFocus
      />
      {mutation.isError && <p className="form-error">{formatError(mutation.error)}</p>}
      <div className="pacing-admin__dialog-actions">
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--danger button--sm"
          onClick={handleConfirm}
          disabled={!nameMatches || mutation.isPending}
        >
          {mutation.isPending ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </Modal>
  );
}

interface DeleteFailure {
  row: PacingRowV1;
  message: string;
}

/**
 * Deletes several pacings at once. Unlike the retired front end's own bulk-delete modal (which
 * showed only a count), this one names every pacing that is about to go - a bulk action behind a
 * bare count is how one accidental click becomes eight accidents. Requires typing the literal word
 * DELETE, since typing N different names is not practical for a bulk action.
 */
export function BulkDeletePacingModal({
  rows,
  onClose,
  onDeleted,
}: {
  rows: PacingRowV1[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  // What is left to delete - starts as every selected pacing; a partial failure shrinks it to just
  // the ones that did not go, so retrying never re-sends a delete for one already gone (harmless
  // against Pacing's own 404, but a stale "still needs deleting" list would be a lie on screen).
  const [remaining, setRemaining] = useState(rows);
  const [failures, setFailures] = useState<DeleteFailure[]>([]);
  const queryClient = useQueryClient();
  const originalCount = rows.length;
  const confirmMatches = confirmText.trim().toUpperCase() === "DELETE";

  async function handleConfirm() {
    if (!confirmMatches || busy || remaining.length === 0) return;
    setBusy(true);
    setFailures([]);
    const toDelete = remaining;
    const results = await Promise.allSettled(toDelete.map((row) => deletePacing(row.id)));
    // One invalidation for the whole batch - each individual delete already succeeded or failed on
    // the Pacing side by the time this runs, so there is nothing to refetch per-row.
    void queryClient.invalidateQueries({ queryKey: ["pacing"] });
    const failed: DeleteFailure[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failed.push({ row: toDelete[index], message: formatError(result.reason) });
      }
    });
    setBusy(false);
    if (failed.length === 0) {
      onDeleted();
      return;
    }
    // Some deleted, some didn't: stay open, name exactly which ones failed, and only offer to retry
    // those - the rest are already gone and re-sending their delete would just 404.
    setFailures(failed);
    setRemaining(failed.map((f) => f.row));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${originalCount} pacing${originalCount === 1 ? "" : "s"}?`}
      subtitle="This permanently deletes each one's dashboard data and delivery journal from Pacing. There is no undo."
    >
      <ul className="pacing-admin__confirm-list">
        {rows.map((row) => (
          <li key={row.id} className="pacing-admin__confirm-list-item">
            <span className="pacing-admin__confirm-name">{row.name}</span>
            {row.dashSlug && <span className="pacing-admin__confirm-slug">{row.dashSlug}</span>}
          </li>
        ))}
      </ul>
      <label className="pacing-admin__confirm-label" htmlFor="pacing-admin-bulk-delete-confirm">
        Type <strong>DELETE</strong> to confirm
      </label>
      <input
        id="pacing-admin-bulk-delete-confirm"
        type="text"
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
        placeholder="DELETE"
        autoComplete="off"
        autoFocus
      />
      {failures.length > 0 && (
        <div className="pacing-admin__confirm-failures">
          <p className="form-error">
            {failures.length} of {originalCount} could not be deleted - the rest are gone:
          </p>
          <ul>
            {failures.map(({ row, message }) => (
              <li key={row.id}>
                {row.name}: {message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="pacing-admin__dialog-actions">
        <button type="button" className="button button--ghost button--sm" onClick={onClose} disabled={busy}>
          {failures.length > 0 ? "Close" : "Cancel"}
        </button>
        <button
          type="button"
          className="button button--danger button--sm"
          onClick={handleConfirm}
          disabled={!confirmMatches || busy}
        >
          {busy
            ? "Deleting…"
            : failures.length > 0
              ? `Retry ${remaining.length} failed`
              : `Delete ${originalCount} pacing${originalCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}
