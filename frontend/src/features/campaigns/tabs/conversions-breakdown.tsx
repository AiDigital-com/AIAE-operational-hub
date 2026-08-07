import { useEffect, useMemo, useState } from "react";
import { useApplyConversionAdjustments, useConversionBreakdown } from "../hooks";
import type { ConversionAdjustmentRowV1, ConversionBreakdownRowV1 } from "../types";
import { formatError } from "../../../shared/format/error";
import { cn } from "../../../shared/style/cn";
import { LoadingSpinner } from "../../../shared/ui/loading-spinner/loading-spinner";
import { Modal } from "../../../shared/ui/modal/modal";
import "./conversions-breakdown.css";

/** The report row whose Conversions cell was opened. */
export interface ConversionBreakdownTarget {
  date: string;
  levelOneName: string;
  levelThreeName?: string;
  channel?: string;
  /** Dimensions the current report is not grouped by, but the breakdown needs to match the cell. */
  missingDimensions?: string[];
  /** The figure the report shows, for the panel to reconcile its own rows against. */
  reported: number | null;
}

interface ConversionsBreakdownProps {
  campaignId: number;
  target: ConversionBreakdownTarget;
  onClose: () => void;
  onSaved: (applied: number) => void;
}

// The ASCII Unit Separator (0x1F): keeps a row's identity fields unambiguous without storing a NUL byte
// in the source file.
const CONVERSION_KEY_SEPARATOR = String.fromCharCode(31);

/** What a row is keyed by on the way back - identity as read, never re-typed by the user. */
function toKey(row: ConversionBreakdownRowV1): string {
  return [
    row.date,
    row.lineItemId,
    row.insertionOrderId,
    row.creativeId,
    row.conversionAction,
    row.conversionCategory,
  ].join(CONVERSION_KEY_SEPARATOR);
}

/** A value is editable if it reads as a number that is not negative; blank is not a number. */
function parseValue(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * How far the rows may sum from the cell before they are not its rows.
 *
 * Conversions are floats on both sides, summed in a different order here than in BigQuery, so exact
 * equality would reject sound breakdowns over the last bit of a double. Half a hundredth is well under
 * the smallest difference anyone edits and well over the drift of summing a few dozen values.
 */
const RECONCILE_TOLERANCE = 0.005;
const CAMPAIGN_LEVEL_CONVERSION_CHANNELS = new Set(["Google SEM", "Google Search", "YouTube"]);

/** Whether level 3 is ignored by the report's own conversion join for this channel. */
function isCampaignLevelChannel(channel?: string): boolean {
  return channel ? CAMPAIGN_LEVEL_CONVERSION_CHANNELS.has(channel) : false;
}

/**
 * The per-action breakdown behind one Conversions cell, with its figures editable in place.
 *
 * Rendered as a modal rather than as a popover on the cell, because the report's table is a scroll
 * container, which clips on both axes, so anything anchored inside a cell loses whatever hangs outside
 * the visible rows.
 *
 * The running total is the point of the panel. Conversions live one grain below the report - per day,
 * line item and conversion action - so the cell is a sum, and a user editing one action needs to see
 * what the sum becomes before saving rather than after.
 */
export function ConversionsBreakdown({ campaignId, target, onClose, onSaved }: ConversionsBreakdownProps) {
  const query = useMemo(
    () => ({
      date: target.date,
      levelOneName: target.levelOneName,
      levelThreeName: target.levelThreeName,
      channel: target.channel,
    }),
    [target.date, target.levelOneName, target.levelThreeName, target.channel]
  );
  const breakdown = useConversionBreakdown(campaignId, query);
  const apply = useApplyConversionAdjustments(campaignId);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const rows = useMemo(() => breakdown.data?.rows ?? [], [breakdown.data]);
  const loaded = !breakdown.isPending && !breakdown.isError;
  const saving = apply.isPending;

  // A reopened cell starts from what is stored, not from what was typed into it last time.
  useEffect(() => {
    setEdited({});
    setFailure(null);
    setConfirmDiscard(false);
  }, [query]);

  function valueOf(row: ConversionBreakdownRowV1): string {
    const key = toKey(row);
    return key in edited ? edited[key] : String(row.conversions ?? 0);
  }

  const changed = rows.filter((row) => {
    const parsed = parseValue(valueOf(row));
    return parsed !== null && parsed !== (row.conversions ?? 0);
  });
  const invalid = rows.some((row) => parseValue(valueOf(row)) === null);
  const hasUnsavedEdits = changed.length > 0 || invalid;
  const total = rows.reduce((sum, row) => sum + (parseValue(valueOf(row)) ?? 0), 0);
  const storedTotal = rows.reduce((sum, row) => sum + (row.conversions ?? 0), 0);

  // Whether these rows really are the rows behind the cell, asked of the data rather than assumed.
  //
  // The report attaches conversions by date and the two constructed names, except on Google SEM,
  // Google Search and YouTube, where it attaches them to the campaign and ignores level 3 - and the
  // channel deciding that is a column a grouped report need not be showing. Rather than demanding the
  // column, the panel checks the one thing that settles it either way: rows that are this cell's rows
  // add up to this cell. They also fail to add up when the report is grouped coarser than conversions
  // are stored, which is the same problem and deserves the same answer.
  const reconciled =
    !loaded || target.reported == null || Math.abs(storedTotal - target.reported) < RECONCILE_TOLERANCE;
  const missingMatchFields = useMemo(() => {
    const fields: string[] = [];
    if (!target.levelOneName) fields.push("Constructed name L1");
    if (!target.channel) fields.push("Channel");
    if (!target.levelThreeName && (!target.channel || !isCampaignLevelChannel(target.channel))) {
      fields.push("Constructed name L3");
    }
    for (const dimension of target.missingDimensions ?? []) {
      if (!fields.includes(dimension)) fields.push(dimension);
    }
    return fields;
  }, [target.channel, target.levelOneName, target.levelThreeName, target.missingDimensions]);
  const rowLabel = target.levelThreeName || target.levelOneName || target.channel || "selected row";
  const canEdit = reconciled && missingMatchFields.length === 0;
  const saveHint = invalid
    ? "A conversions figure has to be a number, and cannot be negative."
    : changed.length === 0
      ? "Change at least one value to save."
      : `${changed.length} row${changed.length === 1 ? "" : "s"} changed`;

  async function save() {
    if (saving) return;
    setFailure(null);
    const payload: ConversionAdjustmentRowV1[] = changed.map((row) => ({
      date: row.date,
      lineItemId: row.lineItemId,
      insertionOrderId: row.insertionOrderId,
      creativeId: row.creativeId,
      conversionAction: row.conversionAction,
      conversionCategory: row.conversionCategory,
      conversions: parseValue(valueOf(row)) as number,
    }));
    try {
      const result = await apply.mutateAsync(payload);
      onSaved(result.applied ?? 0);
      onClose();
    } catch (error) {
      setFailure(formatError(error));
    }
  }

  function requestClose() {
    if (saving) {
      return;
    }
    if (hasUnsavedEdits) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  if (confirmDiscard) {
    return (
      <Modal
        open
        onClose={() => setConfirmDiscard(false)}
        title="Discard unsaved conversion edits?"
        subtitle="The values you changed in this conversion breakdown have not been saved."
        className="conv-breakdown-modal conv-breakdown-modal--confirm"
      >
        <div className="conv-breakdown__confirm-actions">
          <button type="button" className="button button--secondary" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </button>
          <button type="button" className="button button--primary" onClick={onClose}>
            Discard
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={requestClose}
      title="Conversions by action"
      subtitle={`${target.date} · ${rowLabel}`}
      className="conv-breakdown-modal"
    >
      <section className="conv-breakdown">
        {loaded && (
          <div className="conv-breakdown__totals">
            <span className="conv-breakdown__total-label">Row total</span>
            <span className={cn("conv-breakdown__total", total !== storedTotal && "conv-breakdown__total--changed")}>
              {total.toLocaleString()}
            </span>
          </div>
        )}

        {breakdown.isPending && (
          <div className="conv-breakdown__state">
            <LoadingSpinner label="Loading conversions" size="sm" />
          </div>
        )}
        {breakdown.isError && (
          <p className="form-error conv-breakdown__state">{formatError(breakdown.error)}</p>
        )}
        {loaded && rows.length === 0 && reconciled && (
          <p className="conv-breakdown__state">
            No conversions are attached to this row, so there is nothing to adjust here. A figure can only
            be edited where the mart already reports one.
          </p>
        )}

        {loaded && reconciled && rows.length > 0 && missingMatchFields.length > 0 && (
          <p className="conv-breakdown__grain-note">
            Editing is disabled because this report is grouped above the conversion-action grain. Add{" "}
            <strong>{missingMatchFields.join(", ")}</strong> and press Apply to edit these conversions from
            this view.
          </p>
        )}

        {loaded && !reconciled && (
          <p className="conv-breakdown__mismatch">
            The actions below add up to {storedTotal.toLocaleString()}, but the report shows{" "}
            {(target.reported ?? 0).toLocaleString()} in this cell - so they are not what it is made of,
            and they are here to read rather than to edit.{" "}
            {missingMatchFields.length > 0 ? (
              <>
                Add <strong>{missingMatchFields.join(", ")}</strong> and press Apply so this row can be
                matched the way the report matched it.
              </>
            ) : (
              <>
                The report is grouped coarser than conversions are stored, so this cell covers several of
                them; Bulk conversions adjustment can edit that as a spreadsheet.
              </>
            )}
          </p>
        )}

        {rows.length > 0 && (
          <ul className="conv-breakdown__list">
            {rows.map((row) => {
              const key = toKey(row);
              const text = valueOf(row);
              const isInvalid = parseValue(text) === null;
              return (
                <li key={key} className="conv-breakdown__row">
                  <span className="conv-breakdown__action" title={row.conversionAction ?? ""}>
                    {row.conversionAction || "Unnamed action"}
                  </span>
                  <span className="conv-breakdown__category">{row.conversionCategory}</span>
                  {canEdit ? (
                    <input
                      type="number"
                      min="0"
                      step="any"
                      disabled={saving}
                      className={cn("conv-breakdown__input", isInvalid && "conv-breakdown__input--invalid")}
                      aria-label={`Conversions for ${row.conversionAction || "unnamed action"}`}
                      aria-invalid={isInvalid}
                      value={text}
                      onChange={(event) => {
                        if (!saving) {
                          setEdited((current) => ({ ...current, [key]: event.target.value }));
                        }
                      }}
                    />
                  ) : (
                    <span className="conv-breakdown__reading">{(row.conversions ?? 0).toLocaleString()}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {failure && <p className="form-error conv-breakdown__state">{failure}</p>}

        <footer className="conv-breakdown__foot">
          {canEdit && (
            <span className="conv-breakdown__hint">
              {saveHint}
            </span>
          )}
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={saving}
            onClick={requestClose}
          >
            {canEdit ? "Cancel" : "Close"}
          </button>
          {canEdit && (
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={invalid || changed.length === 0 || saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </footer>
      </section>
    </Modal>
  );
}
