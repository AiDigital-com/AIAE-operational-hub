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
  /**
   * The optional level-2 constructed names to further narrow the rollback to (the
   * `insertion_order_name` filter's values), independent of {@link constructedNamesLvl3}. Empty means
   * "do not narrow by level 2".
   */
  constructedNamesLvl2: string[];
  /**
   * The optional level-3 constructed names to further narrow the rollback to (the
   * `campaign_constructed_name` filter's values), independent of {@link constructedNamesLvl2}. Empty
   * means "do not narrow by level 3".
   */
  constructedNamesLvl3: string[];
  /** The platform-resolved display term for level 2 (e.g. "Insertion order"), for the scope list and note. */
  level2Label: string;
  /** The platform-resolved display term for level 3 (e.g. "Creative"), for the scope list and note. */
  level3Label: string;
  dateWindow: DateWindow;
  onClose: () => void;
  onRolledBack: (result: ReportRowAdjustmentRollbackResultV1) => void;
}

/** Renders an inclusive date window as one readable range, or "" while either bound is unset. */
function dateWindowLabel(dateWindow: DateWindow): string {
  return dateWindow.from === "" || dateWindow.to === "" ? "" : `${dateWindow.from} – ${dateWindow.to}`;
}

/**
 * States, truthfully, what a rollback of this scope reaches beyond the level-1/level-2/level-3 selection
 * and date window shown above it: every platform always, and every dimension the caller did not narrow
 * by. Narrowing by a level removes it from that list, since a rollback narrowed to specific level-2/3
 * names no longer touches rows outside them.
 *
 * @param narrowedLabels the display labels of the levels currently narrowed (level 2 and/or level 3, in
 *                        that order), or empty when neither is narrowed
 * @return the scope note's full sentence
 */
function scopeNoteText(narrowedLabels: string[]): string {
  const reach = narrowedLabels.length === 0
    ? "every platform and every other dimension"
    : `every platform and every dimension other than ${narrowedLabels.join(" and ")}`;
  return `This covers ${reach} for these campaigns in the date window above - not just what the report's `
    + "other filters are currently showing.";
}

/**
 * Confirms and runs a "Roll back adjustments" request (PDI_124/PDI_125): deletes the Hub's own manual
 * adjustment overlay rows for the level-1 campaigns the report is currently filtered to, within the
 * report's current date window - never all-time - and optionally narrowed further to specific level-2
 * and/or level-3 constructed names, independently of one another. Nothing is restored, because nothing
 * was destroyed: the adjustments view already falls back to the untouched
 * platform_mart/conversions_mart figures the moment the overlay row is gone, and a manually-added row
 * (one with no underlying platform row) disappears from the report entirely.
 *
 * Requires both a level-1 filter and a complete date window before it will preview or confirm anything -
 * together they are the operation's explicit, bounded scope, stated back to the user before a single
 * destructive press. The level-2/level-3 narrowing stays optional throughout: an empty selection for
 * either never blocks the rollback, it just means that level is not narrowed.
 */
export function RollbackAdjustmentsModal({
  open,
  campaignId,
  campaignConstructedNames,
  constructedNamesLvl2,
  constructedNamesLvl3,
  level2Label,
  level3Label,
  dateWindow,
  onClose,
  onRolledBack,
}: RollbackAdjustmentsModalProps) {
  const scoped = campaignConstructedNames.length > 0 && dateWindow.from !== "" && dateWindow.to !== "";
  const preview = useAdjustmentRollbackPreview(
    campaignId, campaignConstructedNames, constructedNamesLvl2, constructedNamesLvl3, dateWindow, open && scoped
  );
  const rollback = useRollbackAdjustments(campaignId);
  const nothingToRemove =
    preview.data != null && preview.data.deliveryRowsRemoved === 0 && preview.data.conversionRowsRemoved === 0;
  const narrowedLabels = [
    ...(constructedNamesLvl2.length > 0 ? [level2Label] : []),
    ...(constructedNamesLvl3.length > 0 ? [level3Label] : []),
  ];

  function confirmRollback() {
    rollback.mutate(
      { campaignConstructedNames, constructedNamesLvl2, constructedNamesLvl3, dateWindow },
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
            {constructedNamesLvl2.length > 0 && (
              <div className="rollback-adjustments-modal__scope-row">
                <dt>{level2Label}</dt>
                <dd>{constructedNamesLvl2.join(", ")}</dd>
              </div>
            )}
            {constructedNamesLvl3.length > 0 && (
              <div className="rollback-adjustments-modal__scope-row">
                <dt>{level3Label}</dt>
                <dd>{constructedNamesLvl3.join(", ")}</dd>
              </div>
            )}
          </dl>

          <p className="rollback-adjustments-modal__scope-note">{scopeNoteText(narrowedLabels)}</p>

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
