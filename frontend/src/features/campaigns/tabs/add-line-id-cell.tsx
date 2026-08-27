import { useEffect, useRef, useState } from "react";
import { DataTablePopover } from "../../../shared/ui/data-table/data-table-popover";
import { LoadingSpinner } from "../../../shared/ui/loading-spinner/loading-spinner";
import { ADD_LINE_LEVEL_ENUM } from "../constants/add-line";
import { useCampaignHasConstructedEntities, useConstructedIdsPreview, useResolveConstructedName } from "../hooks";
import type { AddLineLevel } from "../model/add-line";
import "./add-line-id-cell.css";

interface AddLineIdCellProps {
  campaignId: number;
  level: AddLineLevel;
  platform: string;
  accountId: string;
  typedName: string;
  currentId: string;
  nameLvl1: string;
  nameLvl2: string;
  nameLvl3: string;
  onResolved: (level: AddLineLevel, id: string) => void;
}

/**
 * One added row's read-only constructed-id cell (PDI_117 D1 - the id is never typed).
 *
 * Resolution is per level, not per row (D2): the sibling name cell's typed value (still a plain input,
 * unchanged) is debounced and resolved against the campaign's own mart data independently for each of
 * the three levels, so one row may legitimately end up with real ids at some levels and generated ones
 * at others (an existing insertion order and line item with a brand-new creative is the common case).
 *
 * - Exactly one matching entity fills the id silently.
 * - Several matching entities open a disambiguation popover listing `id · date range · impressions`.
 * - No matching entity asks "no match for this name - create it as new?"; only once the user confirms
 *   is the id generated server-side and shown as a preview badge. There is no whole-row mode - each
 *   level decides for itself, and nothing is ever created without that level's own explicit confirmation.
 *
 * Level 1 also probes whether the campaign has any mart data at all, and explains why no match will ever
 * be found when it does not - the user still has to confirm, the explanation only says why.
 */
export function AddLineIdCell({
  campaignId, level, platform, accountId, typedName, currentId,
  nameLvl1, nameLvl2, nameLvl3, onResolved,
}: AddLineIdCellProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [confirmedNewFor, setConfirmedNewFor] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const trimmedName = typedName.trim();
  const resolveQuery = useResolveConstructedName(
    campaignId, ADD_LINE_LEVEL_ENUM[level], platform, accountId, typedName, true
  );
  const emptyCampaignQuery = useCampaignHasConstructedEntities(campaignId, level === "LVL1");
  const isConfirmedNew = confirmedNewFor === typedName && trimmedName !== "";
  const previewQuery = useConstructedIdsPreview(campaignId, nameLvl1, nameLvl2, nameLvl3, isConfirmedNew);

  const matches = resolveQuery.data?.content ?? [];
  const singleMatch = matches.length === 1 ? matches[0] : undefined;
  const campaignIsEmpty = level === "LVL1" && emptyCampaignQuery.isSuccess && emptyCampaignQuery.data === false;
  const previewKey = level === "LVL1" ? "level1" : level === "LVL2" ? "level2" : "level3";
  const preview = previewQuery.data?.[previewKey];

  // Fills the id silently once resolution settles on exactly one entity - never on render, since that
  // would be a state update during render.
  useEffect(() => {
    if (singleMatch && singleMatch.id !== currentId) {
      onResolved(level, singleMatch.id);
    }
  }, [singleMatch, currentId, level, onResolved]);

  // Stages the generated id once the user has confirmed this level is new and the preview settles (D5
  // still re-derives it server-side at Save; this only keeps the client's own required-field check and
  // save payload in step with what the badge already shows).
  useEffect(() => {
    if (isConfirmedNew && preview && preview.id !== currentId) {
      onResolved(level, preview.id);
    }
  }, [isConfirmedNew, preview, currentId, level, onResolved]);

  if (trimmedName === "") {
    return <div className="add-line-id"><span className="add-line-id__value">-</span></div>;
  }

  if (resolveQuery.isFetching) {
    return <div className="add-line-id"><LoadingSpinner label={`Resolving ${level} id`} size="sm" /></div>;
  }

  if (matches.length > 1) {
    // A level can resolve to several entities and still have an already-made choice (D2's popover
    // stores it via onResolved, same as a single match). That choice must keep showing after the pick -
    // matches.length > 1 stays true forever once ambiguous, so it cannot gate the render on its own.
    // If the previously chosen id is no longer among the current matches (the name was edited after
    // choosing), the choice is stale and falls back to the picker prompt instead of showing a value that
    // no longer belongs to this name.
    const chosenMatch = currentId ? matches.find((entity) => entity.id === currentId) : undefined;
    return (
      <div className="add-line-id">
        {chosenMatch ? (
          <>
            <span className="add-line-id__value">{chosenMatch.id}</span>
            <button
              ref={anchorRef}
              type="button"
              className="add-line-id__change"
              aria-label={`${level} id - ${matches.length} matches, ${chosenMatch.id} chosen, change`}
              onClick={() => setPopoverOpen(true)}
            >
              Change
            </button>
          </>
        ) : (
          <button
            ref={anchorRef}
            type="button"
            className="add-line-id__ambiguous"
            aria-label={`${level} id - ${matches.length} matches, pick one`}
            onClick={() => setPopoverOpen(true)}
          >
            {matches.length} matches - pick one
          </button>
        )}
        {popoverOpen && (
          <DataTablePopover
            label={`${level} entity`}
            anchor={anchorRef.current}
            footer={
              <button type="button" className="button button--secondary button--sm" onClick={() => setPopoverOpen(false)}>
                Close
              </button>
            }
          >
            <ul className="add-line-id__pop-list">
              {matches.map((entity) => (
                <li key={entity.id}>
                  <button
                    type="button"
                    className="add-line-id__pop-item"
                    onClick={() => {
                      onResolved(level, entity.id);
                      setPopoverOpen(false);
                    }}
                  >
                    <span className="add-line-id__pop-item-id">{entity.id}</span>
                    <span className="add-line-id__pop-item-meta">
                      {entity.first_date ?? "?"} to {entity.last_date ?? "?"}
                      {entity.impressions != null && ` - ${entity.impressions.toLocaleString()} imp`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </DataTablePopover>
        )}
      </div>
    );
  }

  if (matches.length === 1) {
    return <div className="add-line-id"><span className="add-line-id__value">{currentId || "-"}</span></div>;
  }

  // matches.length === 0: nothing to resolve to.
  if (!isConfirmedNew) {
    return (
      <div className="add-line-id">
        <button
          type="button"
          className="add-line-id__ambiguous"
          aria-label={`${level} id - no match, create it as new?`}
          onClick={() => setConfirmedNewFor(typedName)}
        >
          No match - create it as new?
        </button>
        {campaignIsEmpty && (
          <p className="add-line-id__hint">This campaign has no platform data yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="add-line-id">
      {previewQuery.isFetching ? (
        <LoadingSpinner label={`Generating ${level} id`} size="sm" />
      ) : preview ? (
        <span className="add-line-id__badge" title={`origin: ${preview.origin}`}>{preview.id}</span>
      ) : (
        <span className="add-line-id__value">-</span>
      )}
    </div>
  );
}
