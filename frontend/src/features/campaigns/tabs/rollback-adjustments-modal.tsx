import { formatError } from "../../../shared/format/error";
import { LoadingSpinner } from "../../../shared/ui/loading-spinner/loading-spinner";
import { Modal } from "../../../shared/ui/modal/modal";
import { useAdjustmentRollbackPreview, useRollbackAdjustments } from "../hooks";
import type { DateWindow } from "../hooks";
import type { ReportRowAdjustmentRollbackResultV1 } from "../types";
import "./rollback-adjustments-modal.css";

interface RollbackAdjustmentsModalProps {
  open: boolean;
  campaignId: number;
  /** The level-1 campaigns currently filtered on the report (the `line_item_name` filter's values). */
  campaignConstructedNames: string[];
  dateWindow: DateWindow;
  onClose: () => void;
  onRolledBack: (result: ReportRowAdjustmentRollbackResultV1) => void;
}

/** Renders an inclusive date window as one readable range, or "" while either bound is unset. */
function dateWindowLabel(dateWindow: DateWindow): string {
  return dateWindow.from === "" || dateWindow.to === "" ? "" : `${dateWindow.from} – ${dateWindow.to}`;
}

/**
 * Confirms and runs a "Roll back adjustments" request (PDI_124): deletes the Hub's own manual
 * adjustment overlay rows for the level-1 campaigns the report is currently filtered to, within the
 * report's current date window - never all-time. Nothing is restored, because nothing was destroyed:
 * the adjustments view already falls back to the untouched platform_mart/conversions_mart figures the
 * moment the overlay row is gone, and a manually-added row (one with no underlying platform row)
 * disappears from the report entirely.
 *
 * Requires both a level-1 filter and a complete date window before it will preview or confirm
 * anything - together they are the operation's explicit, bounded scope, stated back to the user before
 * a single destructive press.
 */
export function RollbackAdjustmentsModal({
  open,
  campaignId,
  campaignConstructedNames,
  dateWindow,
  onClose,
  onRolledBack,
}: RollbackAdjustmentsModalProps) {
  const scoped = campaignConstructedNames.length > 0 && dateWindow.from !== "" && dateWindow.to !== "";
  const preview = useAdjustmentRollbackPreview(campaignId, campaignConstructedNames, dateWindow, open && scoped);
  const rollback = useRollbackAdjustments(campaignId);
  const nothingToRemove =
    preview.data != null && preview.data.deliveryRowsRemoved === 0 && preview.data.conversionRowsRemoved === 0;

  function confirmRollback() {
    rollback.mutate(
      { campaignConstructedNames, dateWindow },
      { onSuccess: (result) => onRolledBack(result) }
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Roll back adjustments?"
      subtitle="Removes the Operational Hub's manual adjustments for the scope below, so those rows fall back to the raw platform data. This cannot be undone from the Hub."
      className="rollback-adjustments-modal"
    >
      {!scoped ? (
        <p className="rollback-adjustments-modal__hint">
          Filter the report by Line item name and set both a start and end date before rolling back
          adjustments.
        </p>
      ) : (
        <>
          <dl className="rollback-adjustments-modal__scope">
            <div className="rollback-adjustments-modal__scope-row">
              <dt>Campaigns</dt>
              <dd>{campaignConstructedNames.join(", ")}</dd>
            </div>
            <div className="rollback-adjustments-modal__scope-row">
              <dt>Date window</dt>
              <dd>{dateWindowLabel(dateWindow)}</dd>
            </div>
          </dl>

          <p className="rollback-adjustments-modal__scope-note">
            This covers every platform and every other dimension for these campaigns in the date window
            above - not just what the report's other filters are currently showing.
          </p>

          {preview.isPending && (
            <div className="rollback-adjustments-modal__state">
              <LoadingSpinner label="Calculating what would be removed" size="sm" />
            </div>
          )}
          {preview.isError && (
            <p className="form-error rollback-adjustments-modal__state" role="alert">
              {formatError(preview.error)}
            </p>
          )}
          {preview.data && !nothingToRemove && (
            <p className="rollback-adjustments-modal__counts">
              This will remove <strong>{preview.data.deliveryRowsRemoved}</strong> delivery adjustment
              row{preview.data.deliveryRowsRemoved === 1 ? "" : "s"} and{" "}
              <strong>{preview.data.conversionRowsRemoved}</strong> conversions adjustment
              row{preview.data.conversionRowsRemoved === 1 ? "" : "s"}, including any manually added rows
              among them.
            </p>
          )}
          {nothingToRemove && (
            <p className="rollback-adjustments-modal__state">
              No Hub adjustments exist for this scope - nothing would change.
            </p>
          )}
          {rollback.isError && (
            <p className="form-error rollback-adjustments-modal__state" role="alert">
              {formatError(rollback.error)}
            </p>
          )}
        </>
      )}

      <div className="rollback-adjustments-modal__actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={onClose}
          disabled={rollback.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--danger"
          onClick={confirmRollback}
          disabled={!scoped || preview.isPending || preview.isError || nothingToRemove || rollback.isPending}
        >
          {rollback.isPending ? "Rolling back…" : "Roll back adjustments"}
        </button>
      </div>
    </Modal>
  );
}
