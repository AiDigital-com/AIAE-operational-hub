/**
 * Confirmation for re-pulling a pacing's configuration from the NetSuite master. Unlike the delete
 * modals next door this asks for a plain confirm, not a typed name: the action is reversible in the
 * sense that matters - it re-seeds config FROM NetSuite, it does not destroy anything, and delivery
 * data is untouched. What it does need is to say plainly which parts of the pacing can move, since
 * "revalidate" says nothing on its own.
 */
import { formatError } from "../../shared/format/error";
import { Modal } from "../../shared/ui/modal/modal";
import { useToast } from "../../shared/ui/toast/toast";
import { useRevalidatePacing } from "./hooks";
import type { PacingRowV1 } from "./types";
import "./pacing-admin.css";

export function RevalidatePacingModal({ row, onClose }: { row: PacingRowV1; onClose: () => void }) {
  const mutation = useRevalidatePacing();
  const toast = useToast();

  async function handleConfirm() {
    if (mutation.isPending) return;
    try {
      const result = await mutation.mutateAsync(row.id);
      // "Nothing changed" is an outcome worth reporting, not silence: without it a re-validate that
      // found the pacing already in step looks identical to one that did nothing because it broke.
      toast.showSuccess(
        result.changed
          ? `"${row.name}" re-validated — ${result.changes.length} field${result.changes.length === 1 ? "" : "s"} updated.`
          : `"${row.name}" already matches NetSuite — nothing to update.`
      );
      result.warnings.forEach((warning) => toast.showError(warning));
      onClose();
    } catch {
      // Left open - the error renders below from mutation.error, so the caller can retry or cancel.
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Re-validate "${row.name}"?`}
      subtitle="Re-pulls this pacing's configuration from the NetSuite master and applies what changed."
    >
      <div className="pacing-admin__confirm-target">
        <span className="pacing-admin__confirm-name">{row.name}</span>
        {row.dashSlug && <span className="pacing-admin__confirm-slug">{row.dashSlug}</span>}
      </div>
      <p className="pacing-admin__confirm-body">
        Margins, targets, flight dates and channel are re-seeded from NetSuite, and client, agency,
        campaigns and currency are filled in where this pacing has none. Delivery data is not touched.
      </p>
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
        <button type="button" className="button button--sm" onClick={handleConfirm} disabled={mutation.isPending}>
          {mutation.isPending ? "Re-validating…" : "Re-validate"}
        </button>
      </div>
    </Modal>
  );
}
