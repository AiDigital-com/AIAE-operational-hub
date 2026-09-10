/**
 * The Create Pacing screen (§8 of the migration plan, US-121/122/123/124): reached from a campaign
 * already open, no search step. Lists every insertion order NetSuite has for the campaign - id,
 * name, budget, flight dates and status, read verbatim off Pacing's own row (never summed or
 * min/maxed from the line items) - with its child line items grouped underneath and a checkbox per
 * line item to select what to pace; line items another pacing already covers are marked and
 * un-ticked by default. Plan values (budget/impressions/rate type/margin/CTR/VCR/flight override) are
 * pre-filled from NetSuite/the reference tables and editable before confirming, with an "Auto" badge
 * on whichever ones came pre-filled. A bulk-edit toolbar (select rows -> field -> value, or paste a
 * table copied from a spreadsheet) and a "missing a value" filter make filling in a 190-line-item
 * campaign practical one field at a time instead of one row at a time.
 *
 * Every plan figure shown here is read verbatim from `GET .../pacing-draft` (Pacing's own validate
 * response) - nothing is summed, converted or otherwise computed in the Hub. The bulk-edit helpers in
 * `./bulk` only parse what a person typed or pasted into a plain string - not pacing arithmetic.
 */
import { useMemo, useState } from "react";
import { formatError } from "../../shared/format/error";
import { cn } from "../../shared/style/cn";
import { ChevronDownIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import { displayStatusLabel, resolveStatusStyle, StatusBadge } from "../../shared/ui/status-badge/status-badge";
import { useToast } from "../../shared/ui/toast/toast";
import {
  BULK_FIELDS,
  coerceValue,
  GAP_FILTERS,
  matchTable,
  viewOrder,
  type BulkFieldKey,
  type BulkSortKey,
  type BulkViewRow,
} from "./bulk";
import { fmtDate, fmtInt, fmtMoneyIn, parseEditableNumber } from "./format";
import { useCreatePacing, usePacingDraft } from "./hooks";
import { NumericField } from "./numeric-field";
import type {
  PacingCreateLineItemV1,
  PacingDraftLineItemV1,
  PacingDraftV1,
  PacingInsertionOrderV1,
  PacingInUseV1,
} from "./types";
import "./create-pacing-panel.css";

const RATE_TYPES = ["CPM", "CPC", "CPV", "Flat"];

type FieldKey = BulkFieldKey | "rateType";

interface RowValues {
  nativeBudget: string;
  targetImpressions: string;
  rateType: string;
  marginPercent: string;
  targetCtr: string;
  targetVcr: string;
  flightStart: string;
  flightEnd: string;
}

interface LineItemGroup {
  key: string;
  order: PacingInsertionOrderV1 | null;
  items: PacingDraftLineItemV1[];
}

function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/**
 * The fallbacks the reference tables do not supply, ported from the SPA
 * (CreatePacing.jsx:497-499): margin 25%, CTR and VCR zero.
 *
 * These are not invented defaults. The Mrg/KPI sheets REFINE a target per tactic;
 * they were never the only source of one, and a tactic absent from them has always
 * meant "the house figure applies", not "this line item has no margin". Leaving
 * margin empty instead makes every row fail the required-fields check — 190 of 190
 * on this campaign — so the gap filter reports the whole campaign as unfinished and
 * the reviewer has no way to tell the genuinely incomplete rows from the rest.
 *
 * Editable like everything else, and carrying no auto-filled badge: a badge claims
 * "NetSuite or the reference table said so", and here neither did.
 */
const MARGIN_FALLBACK_PCT = "25";
const RATE_TARGET_FALLBACK = "0";

interface SortState {
  key: BulkSortKey | null;
  dir: "asc" | "desc";
}

/**
 * One sortable column header, with the required-field marker where the field is one.
 *
 * A button rather than a click handler on the `th`: the header has to be reachable and
 * operable from the keyboard, and a `th` with an onClick is neither.
 */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  required = false,
}: {
  label: string;
  sortKey: BulkSortKey;
  sort: SortState;
  onSort: (key: BulkSortKey) => void;
  required?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className="pcreate__th-sortable"
    >
      <button type="button" className="pcreate__sort" onClick={() => onSort(sortKey)}>
        {label}
        {required && <span className="pcreate__req" title="Required before this pacing can be created"> *</span>}
        <span className={cn("pcreate__sort-mark", active && "pcreate__sort-mark--on")} aria-hidden="true">
          {active ? (sort.dir === "asc" ? "\u25B2" : "\u25BC") : "\u25BC"}
        </span>
      </button>
    </th>
  );
}

function initialRowValues(li: PacingDraftLineItemV1): RowValues {
  return {
    nativeBudget: numToStr(li.nativeBudget),
    targetImpressions: numToStr(li.targetImpressions),
    rateType: li.rateType ?? "",
    marginPercent: numToStr(li.marginPercent) || MARGIN_FALLBACK_PCT,
    targetCtr: numToStr(li.targetCtr) || RATE_TARGET_FALLBACK,
    targetVcr: numToStr(li.targetVcr) || RATE_TARGET_FALLBACK,
    flightStart: li.flightStart ?? "",
    flightEnd: li.flightEnd ?? "",
  };
}

function toViewRow(li: PacingDraftLineItemV1, row: RowValues): BulkViewRow {
  return {
    lineItemId: li.lineItemId,
    channel: li.channel ?? null,
    rateType: row.rateType,
    flightStart: row.flightStart,
    flightEnd: row.flightEnd,
    marginPercent: row.marginPercent,
    targetImpressions: row.targetImpressions,
    nativeBudget: row.nativeBudget,
    targetCtr: row.targetCtr,
    targetVcr: row.targetVcr,
  };
}

function isFilled(v: string): boolean {
  return Boolean(String(v ?? "").trim());
}

/** A line item is ready to create when every required plan value is filled (§8's result-header count). */
function rowReady(row: RowValues): boolean {
  return (
    isFilled(row.targetImpressions) &&
    isFilled(row.nativeBudget) &&
    isFilled(row.marginPercent) &&
    isFilled(row.flightStart) &&
    isFilled(row.flightEnd)
  );
}

function hasFlightDates(row: RowValues): boolean {
  return isFilled(row.flightStart) && isFilled(row.flightEnd);
}

function dirtyKey(lineItemId: string, field: FieldKey): string {
  return `${lineItemId}:${field}`;
}

/** Whether a field's pre-fill should still carry the "Auto" badge (US-124): the source NetSuite/
 *  reference-table value was present, and the user has not typed over it yet. */
function isAutoFilled(sourceValue: unknown, lineItemId: string, field: FieldKey, dirty: Set<string>): boolean {
  return sourceValue != null && !dirty.has(dirtyKey(lineItemId, field));
}

/** Sorts not-yet-delivered line items (Pacing's `notFoundIds`) to the end of `items`, stable
 *  otherwise - the rows a reviewer can actually act on stay at the top of each group. */
function sortNotFoundLast(items: PacingDraftLineItemV1[], notFoundSet: Set<string>): PacingDraftLineItemV1[] {
  const usable: PacingDraftLineItemV1[] = [];
  const notFound: PacingDraftLineItemV1[] = [];
  for (const li of items) (notFoundSet.has(li.lineItemId) ? notFound : usable).push(li);
  return [...usable, ...notFound];
}

/** Groups line items under the campaign's real insertion orders (§8, US-122) - one group per entry in
 *  `insertionOrders`, in the order Pacing returned them, matched to its line items by `orderNumber`.
 *  A line item whose order isn't in `insertionOrders` (data gap) still gets its own trailing group
 *  rather than being silently dropped. Within each group, not-yet-delivered line items sort last. */
function groupByInsertionOrder(
  insertionOrders: PacingInsertionOrderV1[],
  lineItems: PacingDraftLineItemV1[],
  notFoundSet: Set<string>
): LineItemGroup[] {
  const byOrderNumber = new Map<string, PacingDraftLineItemV1[]>();
  for (const li of lineItems) {
    const key = li.orderNumber ?? "";
    if (!byOrderNumber.has(key)) byOrderNumber.set(key, []);
    byOrderNumber.get(key)?.push(li);
  }
  const groups: LineItemGroup[] = [];
  const consumed = new Set<string>();
  insertionOrders.forEach((order, i) => {
    const key = order.orderNumber ?? "";
    consumed.add(key);
    groups.push({
      key: order.orderNumber || `order-${i}`,
      order,
      items: sortNotFoundLast(byOrderNumber.get(key) ?? [], notFoundSet),
    });
  });
  for (const [key, items] of byOrderNumber) {
    if (consumed.has(key)) continue;
    groups.push({ key: key || "Unassigned", order: null, items: sortNotFoundLast(items, notFoundSet) });
  }
  return groups;
}

interface CreatePacingPanelProps {
  campaignId: number;
  campaignName: string;
  clientName?: string;
  agencyName?: string;
  onClose: () => void;
  onCreated: (pacingId: string) => void;
}

export function CreatePacingPanel({
  campaignId,
  campaignName,
  clientName,
  agencyName,
  onClose,
  onCreated,
}: CreatePacingPanelProps) {
  const draftQuery = usePacingDraft(campaignId);

  return (
    <section className="pcreate">
      <header className="pcreate__header">
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          ← Back to pacings
        </button>
        <h2 className="pcreate__title">Create Pacing</h2>
        <dl className="pcreate__context">
          <div className="pcreate__context-cell">
            <dt>Agency</dt>
            <dd>{agencyName || draftQuery.data?.agency || "—"}</dd>
          </div>
          <div className="pcreate__context-cell">
            <dt>Client</dt>
            <dd>{clientName || draftQuery.data?.client || "—"}</dd>
          </div>
          <div className="pcreate__context-cell">
            <dt>Campaign</dt>
            <dd>{campaignName || "—"}</dd>
          </div>
        </dl>
      </header>

      {draftQuery.isPending && <LoadingBlock label="Loading campaign line items" />}
      {draftQuery.isError && <p className="form-error">{formatError(draftQuery.error)}</p>}
      {draftQuery.isSuccess && (
        <CreatePacingForm
          campaignId={campaignId}
          defaultPacingName={draftQuery.data.campaign || campaignName}
          draft={draftQuery.data}
          onCreated={onCreated}
        />
      )}
    </section>
  );
}

/**
 * Mounted once per successfully loaded draft: every piece of local state (selection, expanded
 * groups, edited plan values) is seeded from `draft` in its lazy initializer, which React runs only
 * on the first render - a background refetch of the same query does not silently reset an edit the
 * user already made.
 */
function CreatePacingForm({
  campaignId,
  defaultPacingName,
  draft,
  onCreated,
}: {
  campaignId: number;
  defaultPacingName: string;
  draft: PacingDraftV1;
  onCreated: (pacingId: string) => void;
}) {
  const toast = useToast();
  const createMutation = useCreatePacing(campaignId);
  const lineItems = useMemo(() => draft.lineItems ?? [], [draft.lineItems]);
  const insertionOrders = useMemo(() => draft.insertionOrders ?? [], [draft.insertionOrders]);
  const inUse = draft.inUse ?? {};
  // §8: Pacing's own "not yet delivered - excluded by default, re-enable to pace early" rule. On the
  // campaign selector this endpoint always uses, every id here means "not yet delivered" (never an
  // unknown/typo id - that reason only applies to a direct line-item-id selector this screen never
  // uses), so a fixed reason label is accurate, not a guess.
  const notFoundSet = useMemo(() => new Set(draft.notFoundIds ?? []), [draft.notFoundIds]);
  const groups = useMemo(
    () => groupByInsertionOrder(insertionOrders, lineItems, notFoundSet),
    [insertionOrders, lineItems, notFoundSet]
  );

  const [pacingName, setPacingName] = useState(defaultPacingName);
  const [values, setValues] = useState<Record<string, RowValues>>(() =>
    Object.fromEntries(lineItems.map((li) => [li.lineItemId, initialRowValues(li)]))
  );
  // Two independent per-row states (defect fix PDI-131), ported from the retired SPA's deliberate
  // split (CreatePacing.jsx:357/368/552 - excludedSet vs. selected):
  //   INCLUDED - a DEFAULT the system sets: everything is in except an in-use LI, a not-yet-delivered
  //   LI, or one missing flight dates. Still overridable per row. This is what `POST /api/pacings`
  //   receives (via submittableIds below).
  //   SELECTED - an INTENT the reviewer expresses, so it starts EMPTY. Drives ONLY the bulk-set
  //   toolbar, paste-from-sheet, and the "N selected ->" counter - never the create payload.
  const [included, setIncluded] = useState<Set<string>>(
    () =>
      new Set(
        lineItems
          .filter(
            (li) =>
              hasFlightDates(initialRowValues(li)) && !inUse[li.lineItemId] && !notFoundSet.has(li.lineItemId)
          )
          .map((li) => li.lineItemId)
      )
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.map((g) => g.key)));
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());

  // Bulk-edit toolbar state (§8, US-123/124 - "port the bulk-fill/filter-for-gaps loop").
  const [gapFilter, setGapFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortState>({ key: null, dir: "asc" });

  /** Click a header to sort by it; click the same one again to reverse. Ported from the
   *  SPA's toggleSort — no third "unsorted" state, because nobody wants to click twice
   *  to get back to an order they cannot name. */
  function toggleSort(key: BulkSortKey) {
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }
  const [bulkField, setBulkField] = useState<BulkFieldKey>("targetVcr");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  function toggleIncluded(id: string) {
    setIncluded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpanded(groupKey: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  function updateField(lineItemId: string, field: FieldKey, value: string) {
    setValues((cur) => ({ ...cur, [lineItemId]: { ...cur[lineItemId], [field]: value } }));
    setDirty((cur) => new Set(cur).add(dirtyKey(lineItemId, field)));
  }

  // Flight dates are required by the create contract; an included row's dates can only be BLANK if the
  // reviewer included it, then cleared its (now-editable) flight input afterwards - the checkbox
  // disables again at that point, but disabling doesn't un-tick an already-checked box, so this is a
  // real submit-time guard, not a redundant one.
  const submittableIds = useMemo(
    () => new Set(lineItems.filter((li) => included.has(li.lineItemId) && hasFlightDates(values[li.lineItemId])).map((li) => li.lineItemId)),
    [lineItems, included, values]
  );
  const canSubmit = submittableIds.size > 0 && pacingName.trim().length > 0 && !createMutation.isPending;

  // Every visible row's current on-screen values, for the gap filter and its counts - live edits,
  // not the original draft response (a bulk-filled flight date must clear "missing" immediately).
  const allViewRows = useMemo(() => lineItems.map((li) => toViewRow(li, values[li.lineItemId])), [lineItems, values]);
  const gapCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [key, filter] of Object.entries(GAP_FILTERS)) {
      if (key !== "all") counts[key] = allViewRows.filter((r) => filter.test(r)).length;
    }
    return counts;
  }, [allViewRows]);
  const gapOptions = Object.entries(GAP_FILTERS).filter(
    ([key]) => key === "all" || (gapCounts[key] ?? 0) > 0 || key === gapFilter
  );

  // Gap filter applies WITHIN each insertion-order group, so the grouping (US-122) survives filtering.
  const visibleGroups = useMemo(
    () =>
      groups.map((g) => {
        const rows = g.items.map((li) => toViewRow(li, values[li.lineItemId]));
        const idxs = viewOrder(rows, { gapFilter, sortKey: sort.key ?? undefined, sortDir: sort.dir });
        return { ...g, items: idxs.map((i) => g.items[i]) };
      }),
    [groups, values, gapFilter, sort]
  );
  /** How many rows the current filter leaves, for the "N of 190 rows" note beside it. */
  const visibleCount = useMemo(
    () => visibleGroups.reduce((n, g) => n + g.items.length, 0),
    [visibleGroups]
  );

  // The other half of the gap filter (ported from CreatePacing.jsx:764 toggleSelectAllVisible):
  // filter to the rows still missing a value, select all VISIBLE + INCLUDED ones, apply once. Only
  // the currently-filtered rows are touched - any selection outside the filter is left alone, which is
  // what makes it safe to run again with a different filter.
  const visibleActiveIds = useMemo(
    () =>
      visibleGroups
        .flatMap((g) => g.items.map((li) => li.lineItemId))
        .filter((id) => included.has(id)),
    [visibleGroups, included]
  );
  const allVisibleSelected = visibleActiveIds.length > 0 && visibleActiveIds.every((id) => selected.has(id));

  /**
   * What is selected AND still actionable — the only count worth showing.
   *
   * `selected` can outlive what it refers to: exclude a row after ticking it, or filter
   * it out of view, and its id stays in the set while its checkbox is gone from the
   * screen. Counting the raw set then reports "1 selected" over a table where nothing
   * appears selected, and the toolbar offers to write a value into a row that will not
   * be created. applyBulkSet already skips those; the label has to agree with it.
   */
  const activeSelected = useMemo(
    () => [...selected].filter((id) => included.has(id)),
    [selected, included]
  );

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleActiveIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...visibleActiveIds]);
    });
  }

  // A row can be bulk-SELECTED while included, then get manually excluded afterwards (its bulk
  // checkbox disables at that point but disabling doesn't clear the selection) - this guard, ported
  // from the SPA's shared `applyValues`, is what keeps that stale selection from writing to an
  // excluded row.
  function applyBulkSet() {
    const field = BULK_FIELDS.find((f) => f.key === bulkField);
    if (!field) return;
    const result = coerceValue(field.kind, bulkValue);
    if (!result.ok) {
      setBulkError(result.error);
      return;
    }
    setBulkError(null);
    for (const id of selected) {
      if (!included.has(id)) continue;
      updateField(id, field.key, result.value);
    }
    // Selection clears on apply, as the SPA does (CreatePacing.jsx:791). A bulk set
    // is one deliberate act over one deliberate set of rows; leaving them ticked
    // means the NEXT value silently lands on the same rows, which is the whole
    // failure this split was made to prevent — just one step further along.
    setSelected(new Set());
    setBulkValue("");
  }

  const pastePreview = useMemo(() => {
    if (!pasteOpen || !pasteText.trim()) return null;
    return matchTable(
      pasteText,
      lineItems.map((li) => ({ lineItemId: li.lineItemId }))
    );
  }, [pasteOpen, pasteText, lineItems]);

  function applyPaste() {
    if (!pastePreview || pastePreview.error || !pastePreview.updates?.length) return;
    for (const u of pastePreview.updates) {
      const id = lineItems[u.index]?.lineItemId;
      if (id != null && included.has(id)) updateField(id, u.field, u.value);
    }
    setPasteOpen(false);
    setPasteText("");
  }

  async function handleSubmit() {
    const requestLineItems: PacingCreateLineItemV1[] = lineItems
      .filter((li) => submittableIds.has(li.lineItemId))
      .map((li) => {
        const row = values[li.lineItemId];
        return {
          lineItemId: li.lineItemId,
          channel: li.channel,
          flightStart: row.flightStart || "",
          flightEnd: row.flightEnd || "",
          rateType: row.rateType || undefined,
          description: li.description,
          nativeBudget: parseEditableNumber(row.nativeBudget),
          currency: li.currency,
          exchangeRate: li.exchangeRate,
          campaignId: li.campaignId,
          campaignName: li.campaignName,
          orderNumber: li.orderNumber,
          targetImpressions: parseEditableNumber(row.targetImpressions),
          marginPercent: parseEditableNumber(row.marginPercent),
          targetCtr: parseEditableNumber(row.targetCtr),
          targetVcr: parseEditableNumber(row.targetVcr),
        };
      });

    try {
      const result = await createMutation.mutateAsync({
        pacingName: pacingName.trim(),
        lineItems: requestLineItems,
      });
      toast.showSuccess(`Pacing "${pacingName.trim()}" created.`);
      onCreated(result.pacingId);
    } catch (error) {
      toast.showError(formatError(error));
    }
  }

  if (draft.ok === false) {
    return (
      <div className="pcreate__blocked">
        <p className="form-error">
          {draft.error || "This campaign cannot be paced as it stands today."}
        </p>
      </div>
    );
  }

  // Result-header counts (§8): "ready" / "need input" / "excluded" over the reviewer's live edits -
  // how a person tells the form is finished without scrolling every row. Driven by INCLUDED (what
  // will actually be created), never by the bulk-edit SELECTED set.
  const readyCount = lineItems.filter((li) => included.has(li.lineItemId) && rowReady(values[li.lineItemId])).length;
  const needCount = included.size - readyCount;
  const excludedCount = lineItems.length - included.size;
  // How much of "excluded" is Pacing's own auto-exclusion (not yet delivered) rather than a manual
  // untick or a missing-flight/in-use row - so a 90-of-190 auto-exclusion reads as that, not as "the
  // user forgot to tick things".
  const excludedNotDelivered = lineItems.filter(
    (li) => !included.has(li.lineItemId) && notFoundSet.has(li.lineItemId)
  ).length;
  const primaryOrder = draft.orderNumber;
  const extraOrders = (draft.orderNumbers?.length ?? 0) - (primaryOrder ? 1 : 0);

  return (
    <div className="pcreate__body">
      <div className="pcreate__result">
        <span className="pcreate__result-title">
          {lineItems.length} line item{lineItems.length === 1 ? "" : "s"} validated
        </span>
        {primaryOrder && (
          <span className="pcreate__result-io">
            IO {primaryOrder}
            {extraOrders > 0 ? ` (+${extraOrders})` : ""}
          </span>
        )}
        <span className="pcreate__result-counts">
          <span className="pcreate__count pcreate__count--ok">{readyCount} ready</span>
          <span className="pcreate__count pcreate__count--need">{needCount} need input</span>
          <span className="pcreate__count pcreate__count--excluded">
            {excludedCount} excluded
            {excludedNotDelivered > 0 ? ` (${excludedNotDelivered} not yet delivered)` : ""}
          </span>
        </span>
      </div>

      <div className="pcreate__name-row">
        <label className="pcreate__name-label" htmlFor="pcreate-name">
          Pacing name
        </label>
        <input
          id="pcreate-name"
          type="text"
          className="pcreate__name-input"
          value={pacingName}
          onChange={(e) => setPacingName(e.target.value)}
        />
      </div>

      {(draft.warnings?.length ?? 0) > 0 && (
        <ul className="pcreate__warnings">
          {draft.warnings?.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      )}

      {lineItems.length === 0 ? (
        <p className="pcreate__empty">NetSuite has no line items for this campaign.</p>
      ) : (
        <>
          <div className="pcreate__bulk-bar">
            {gapOptions.length > 1 && (
              <select
                className="pcreate__select pcreate__select--auto"
                value={gapFilter}
                title="Filter rows"
                aria-label="Filter rows"
                onChange={(e) => setGapFilter(e.target.value)}
              >
                {gapOptions.map(([key, filter]) => (
                  <option key={key} value={key}>
                    {key === "all" ? filter.label : `${filter.label} (${gapCounts[key]})`}
                  </option>
                ))}
              </select>
            )}
            {gapFilter !== "all" && (
              <span className="pcreate__filter-count">
                {visibleCount} of {lineItems.length} rows
              </span>
            )}
            <button type="button" className="button button--ghost button--sm" onClick={() => setPasteOpen((v) => !v)}>
              {pasteOpen ? "Close paste" : "Paste from sheet"}
            </button>
            {activeSelected.length > 0 && (
              <div className="pcreate__bulk-set">
                <span className="pcreate__bulk-set-label">{activeSelected.length} selected →</span>
                <select
                  className="pcreate__select pcreate__select--auto"
                  aria-label="Bulk-set field"
                  value={bulkField}
                  onChange={(e) => {
                    setBulkField(e.target.value as BulkFieldKey);
                    setBulkError(null);
                  }}
                >
                  {BULK_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <input
                  className="pcreate__input pcreate__input--bulk-value"
                  aria-label="Bulk-set value"
                  value={bulkValue}
                  placeholder="value"
                  onChange={(e) => {
                    setBulkValue(e.target.value);
                    setBulkError(null);
                  }}
                />
                <button
                  type="button"
                  className="button button--primary button--sm"
                  onClick={applyBulkSet}
                  disabled={!bulkValue.trim()}
                >
                  Apply
                </button>
                <button type="button" className="button button--ghost button--sm" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
                {bulkError && <span className="pcreate__bulk-error">{bulkError}</span>}
              </div>
            )}
          </div>

          {pasteOpen && (
            <div className="pcreate__paste">
              <p className="pcreate__paste-hint">
                Paste a table copied from Google Sheets: header row first, LI ID in the first column,
                then any of VCR · CTR · Margin · MP Units · MP Budget · Start · End (matched by
                header; extra columns are ignored).
              </p>
              <textarea
                className="pcreate__paste-input"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="LI ID\tMP Units\tMargin %\n123456\t500000\t20"
              />
              {pastePreview && (
                <div className="pcreate__paste-preview">
                  {pastePreview.error ? (
                    <span className="pcreate__paste-error">{pastePreview.error}</span>
                  ) : (
                    <>
                      <span>
                        {(pastePreview.updates?.length ?? 0)} value{(pastePreview.updates?.length ?? 0) === 1 ? "" : "s"} matched
                        {pastePreview.notFound?.length ? `, ${pastePreview.notFound.length} id(s) not found` : ""}.
                      </span>
                      <button
                        type="button"
                        className="button button--primary button--sm"
                        onClick={applyPaste}
                        disabled={!pastePreview.updates?.length}
                      >
                        Apply paste
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="pcreate__table-wrap">
            <table className="pcreate__table">
              <colgroup>
                <col className="pcreate__col-check" />
                <col className="pcreate__col-include" />
                <col className="pcreate__col-li" />
                <col className="pcreate__col-channel" />
                <col className="pcreate__col-flight" />
                <col className="pcreate__col-budget" />
                <col className="pcreate__col-impr" />
                <col className="pcreate__col-rate" />
                <col className="pcreate__col-pct" />
                <col className="pcreate__col-pct" />
                <col className="pcreate__col-pct" />
                <col className="pcreate__col-status" />
              </colgroup>
              <thead>
                <tr>
                  {/* Two distinct controls, never one checkbox doing both jobs (PDI-131 fix): this one
                      is bulk-edit targeting only - a checkbox with no visible label, exactly like
                      today, but it no longer decides what gets created. */}
                  {/* Labelled, like the column beside it. An unlabelled checkbox column next to a
                      labelled one reads as "and what is this one for" — which is exactly what it got
                      asked. "Edit" says what ticking it prepares: the bulk-edit toolbar. */}
                  {/* A bare checkbox, exactly as the SPA had it (CreatePacing.jsx:1256). A label
                      under it made this the only two-line cell in the header, and a two-line cell
                      among one-line ones cannot share their baseline however it is aligned — which
                      is what five rounds of alignment fixes were chasing. What the two columns are
                      for is said once, above the table, where it is read once. */}
                  <th className="pcreate__col-select-th" title="Select all visible, includable rows for the bulk-edit toolbar">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all visible line items for bulk edit"
                    />
                  </th>
                  {/* This column decides what `POST /api/pacings` receives - labelled, and each row's
                      cell carries a background fill so the two checkbox columns read apart at a
                      glance without a side stripe. */}
                  <th className="pcreate__col-include-th" />
                  {/* Sortable, and marked where the field is required — both carried over from the
                      SPA's own header (CreatePacing.jsx:1265-1276). On 190 rows an unsorted table is
                      a list you can only read top to bottom, and "which of these must I fill in" is
                      not answerable by looking at it. */}
                  <SortableHeader label="Line item" sortKey="lineItemId" sort={sort} onSort={toggleSort} />
                  <SortableHeader label="Channel" sortKey="channel" sort={sort} onSort={toggleSort} />
                  <SortableHeader label="Flight" sortKey="flightStart" sort={sort} onSort={toggleSort} required />
                  <SortableHeader label="Budget" sortKey="nativeBudget" sort={sort} onSort={toggleSort} required />
                  <SortableHeader label="Impressions" sortKey="targetImpressions" sort={sort} onSort={toggleSort} required />
                  <SortableHeader label="Rate" sortKey="rateType" sort={sort} onSort={toggleSort} />
                  <SortableHeader label="Margin" sortKey="marginPercent" sort={sort} onSort={toggleSort} required />
                  <SortableHeader label="CTR" sortKey="targetCtr" sort={sort} onSort={toggleSort} />
                  <SortableHeader label="VCR" sortKey="targetVcr" sort={sort} onSort={toggleSort} />
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => (
                  <GroupRows
                    key={group.key}
                    group={group}
                    expanded={expanded.has(group.key)}
                    onToggle={() => toggleExpanded(group.key)}
                    included={included}
                    onToggleIncluded={toggleIncluded}
                    selected={selected}
                    onToggleSelected={toggleSelected}
                    values={values}
                    dirty={dirty}
                    onUpdateField={updateField}
                    inUse={inUse}
                    notFoundSet={notFoundSet}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <footer className="pcreate__footer">
        <span className="pcreate__included-count">
          {included.size} of {lineItems.length} line item{lineItems.length === 1 ? "" : "s"} included
        </span>
        <button type="button" className="button button--primary" disabled={!canSubmit} onClick={handleSubmit}>
          {createMutation.isPending ? "Creating…" : "Create Pacing"}
        </button>
      </footer>
    </div>
  );
}

function GroupRows({
  group,
  expanded,
  onToggle,
  included,
  onToggleIncluded,
  selected,
  onToggleSelected,
  values,
  dirty,
  onUpdateField,
  inUse,
  notFoundSet,
}: {
  group: LineItemGroup;
  expanded: boolean;
  onToggle: () => void;
  included: Set<string>;
  onToggleIncluded: (id: string) => void;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  values: Record<string, RowValues>;
  dirty: Set<string>;
  onUpdateField: (lineItemId: string, field: FieldKey, value: string) => void;
  inUse: Record<string, PacingInUseV1>;
  notFoundSet: Set<string>;
}) {
  const order = group.order;
  const label = order ? `IO ${order.orderNumber ?? group.key}` : "No insertion order";
  const statusStyle = order?.orderStatus ? resolveStatusStyle(order.orderStatus) : null;
  // order_budget is NetSuite's native-currency figure for the order (unlike a line item's
  // budgetTotal, which the mapper already converts to USD) - labelled with a child line item's own
  // currency rather than assumed USD, so a CAD/foreign order doesn't get a misleading "$" prefix.
  const orderCurrency = group.items[0]?.currency ?? undefined;

  return (
    <>
      <tr className="pcreate__group-row">
        <td colSpan={12}>
          <button type="button" className="pcreate__group-toggle" onClick={onToggle} aria-expanded={expanded}>
            <ChevronDownIcon className={cn("pcreate__chevron", expanded && "pcreate__chevron--open")} />
            <span className="pcreate__group-label">{label}</span>
            {order?.orderName && <span className="pcreate__group-meta">{order.orderName}</span>}
            {order?.orderBudget != null && (
              <span className="pcreate__group-meta">{fmtMoneyIn(order.orderBudget, orderCurrency)}</span>
            )}
            {(order?.orderStartDate || order?.orderEndDate) && (
              <span className="pcreate__group-meta">
                {fmtDate(order?.orderStartDate)} – {fmtDate(order?.orderEndDate)}
              </span>
            )}
            {statusStyle && (
              <StatusBadge
                className="pcreate__group-status"
                label={displayStatusLabel(order?.orderStatus)}
                color={statusStyle.color}
                glow={statusStyle.glow}
              />
            )}
            <span className="pcreate__group-count">
              {group.items.length} line item{group.items.length === 1 ? "" : "s"}
            </span>
          </button>
        </td>
      </tr>
      {expanded &&
        group.items.map((li) => (
          <LineItemRow
            key={li.lineItemId}
            li={li}
            includedChecked={included.has(li.lineItemId)}
            onToggleIncluded={() => onToggleIncluded(li.lineItemId)}
            selectedChecked={selected.has(li.lineItemId)}
            onToggleSelected={() => onToggleSelected(li.lineItemId)}
            values={values[li.lineItemId]}
            dirty={dirty}
            onUpdateField={onUpdateField}
            inUseEntry={inUse[li.lineItemId]}
            notFound={notFoundSet.has(li.lineItemId)}
          />
        ))}
    </>
  );
}

function LineItemRow({
  li,
  includedChecked,
  onToggleIncluded,
  selectedChecked,
  onToggleSelected,
  values,
  dirty,
  onUpdateField,
  inUseEntry,
  notFound,
}: {
  li: PacingDraftLineItemV1;
  includedChecked: boolean;
  onToggleIncluded: () => void;
  selectedChecked: boolean;
  onToggleSelected: () => void;
  values: RowValues;
  dirty: Set<string>;
  onUpdateField: (lineItemId: string, field: FieldKey, value: string) => void;
  inUseEntry?: PacingInUseV1;
  notFound: boolean;
}) {
  const id = li.lineItemId;
  const missingFlight = !hasFlightDates(values);

  return (
    <tr className={cn("pcreate__row", !includedChecked && "pcreate__row--excluded")}>
      {/* Bulk-edit target only (PDI-131 fix) - plain, untinted checkbox, disabled once the row is not
          included (nothing to bulk-edit on a line item that will not be created). */}
      <td className="pcreate__cell-check">
        <input
          type="checkbox"
          checked={selectedChecked}
          disabled={!includedChecked}
          onChange={onToggleSelected}
          aria-label={`Select line item ${id} for bulk edit`}
        />
      </td>
      {/* Decides what `POST /api/pacings` receives — a BUTTON, not a second checkbox.
          Two identical checkboxes side by side are indistinguishable at a glance, and
          the two do unrelated things: one aims the bulk toolbar, this one decides
          whether the line item exists in the pacing at all. The SPA drew them the same
          way round (CreatePacing.jsx:145-162): a checkbox for selection, a ± button for
          include/exclude, plus a class on the whole row so an excluded one reads as
          excluded without looking at any control. */}
      <td className="pcreate__cell-include">
        <button
          type="button"
          className={cn("pcreate__incl", includedChecked ? "pcreate__incl--in" : "pcreate__incl--out")}
          disabled={missingFlight}
          onClick={onToggleIncluded}
          aria-pressed={includedChecked}
          title={
            missingFlight
              ? "Needs flight dates before it can be included"
              : includedChecked
                ? "Exclude this line item"
                : "Include this line item"
          }
          aria-label={`Include line item ${id}`}
        >
          {includedChecked ? "−" : "+"}
        </button>
      </td>
      <td className="pcreate__cell-li">
        <span className="pcreate__li-id">{id}</span>
        <span className="pcreate__li-desc">{li.description || "—"}</span>
      </td>
      <td className="pcreate__cell-channel">{li.channel || "—"}</td>
      <td className="pcreate__cell-flight">
        <div className="pcreate__flight-field">
          <input
            type="date"
            className="pcreate__flight-input"
            value={values.flightStart}
            aria-label={`Flight start for line item ${id}`}
            onChange={(e) => onUpdateField(id, "flightStart", e.target.value)}
          />
          <input
            type="date"
            className="pcreate__flight-input"
            value={values.flightEnd}
            aria-label={`Flight end for line item ${id}`}
            onChange={(e) => onUpdateField(id, "flightEnd", e.target.value)}
          />
        </div>
      </td>
      <td className="pcreate__cell-budget">
        <div className="pcreate__field">
          <NumericField
            value={values.nativeBudget}
            onChange={(v) => onUpdateField(id, "nativeBudget", v)}
            ariaLabel={`Budget for line item ${id}`}
            className="pcreate__input pcreate__input--money"
          />
          {isAutoFilled(li.nativeBudget, id, "nativeBudget", dirty) && <span className="pcreate__badge">Auto</span>}
        </div>
        {li.converted && (
          <span className="pcreate__field-hint">
            {li.currency} · validated ≈ {fmtMoneyIn(li.budgetTotal, "USD")}
          </span>
        )}
      </td>
      <td className="pcreate__cell-impr">
        <div className="pcreate__field">
          <NumericField
            value={values.targetImpressions}
            onChange={(v) => onUpdateField(id, "targetImpressions", v)}
            ariaLabel={`Target impressions for line item ${id}`}
            className="pcreate__input"
          />
          {isAutoFilled(li.targetImpressions, id, "targetImpressions", dirty) && (
            <span className="pcreate__badge">Auto</span>
          )}
        </div>
        {li.plannedUnits != null && (
          <span className="pcreate__field-hint">NetSuite MP units: {fmtInt(li.plannedUnits)}</span>
        )}
      </td>
      <td className="pcreate__cell-rate">
        <div className="pcreate__field">
          <select
            className="pcreate__select"
            value={values.rateType}
            aria-label={`Rate type for line item ${id}`}
            onChange={(e) => onUpdateField(id, "rateType", e.target.value)}
          >
            <option value="">—</option>
            {RATE_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {rt}
              </option>
            ))}
            {values.rateType && !RATE_TYPES.includes(values.rateType) && (
              <option value={values.rateType}>{values.rateType}</option>
            )}
          </select>
          {isAutoFilled(li.rateType, id, "rateType", dirty) && <span className="pcreate__badge">Auto</span>}
        </div>
      </td>
      <td className="pcreate__cell-pct">
        <div className="pcreate__field">
          <NumericField
            value={values.marginPercent}
            onChange={(v) => onUpdateField(id, "marginPercent", v)}
            ariaLabel={`Target margin for line item ${id}`}
            className="pcreate__input pcreate__input--pct"
          />
          {isAutoFilled(li.marginPercent, id, "marginPercent", dirty) && <span className="pcreate__badge">Auto</span>}
        </div>
      </td>
      <td className="pcreate__cell-pct">
        <div className="pcreate__field">
          <NumericField
            value={values.targetCtr}
            onChange={(v) => onUpdateField(id, "targetCtr", v)}
            ariaLabel={`Target CTR for line item ${id}`}
            className="pcreate__input pcreate__input--pct"
          />
          {isAutoFilled(li.targetCtr, id, "targetCtr", dirty) && <span className="pcreate__badge">Auto</span>}
        </div>
      </td>
      <td className="pcreate__cell-pct">
        <div className="pcreate__field">
          <NumericField
            value={values.targetVcr}
            onChange={(v) => onUpdateField(id, "targetVcr", v)}
            ariaLabel={`Target VCR for line item ${id}`}
            className="pcreate__input pcreate__input--pct"
          />
          {isAutoFilled(li.targetVcr, id, "targetVcr", dirty) && <span className="pcreate__badge">Auto</span>}
        </div>
      </td>
      <td className="pcreate__cell-status">
        <div className="pcreate__status-stack">
          {/* Distinct reasons, never collapsed into one generic "excluded": each names a different
              next action (fill in a date vs. decide about the other pacing vs. wait for delivery), and
              a row can carry more than one at once (§8). */}
          {missingFlight && <StatusBadge label="Missing flight dates" color="var(--bad)" />}
          {notFound && <StatusBadge label="Not delivered yet" color="var(--attention)" />}
          {inUseEntry && <StatusBadge label={`In "${inUseEntry.pacingName}"`} color="var(--attention)" />}
          {!missingFlight && !notFound && !inUseEntry && <StatusBadge label="Available" color="var(--good)" />}
        </div>
      </td>
    </tr>
  );
}
