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
import { netPctToRatio, netRatioToPct } from "../pacing-plan/line-item-fields";
import { useCreatePacing, usePacingDraft } from "./hooks";
import { NumericField } from "./numeric-field";
import type {
  PacingCampaignLinkV1,
  PacingCreateLineItemV1,
  PacingCreateV1,
  PacingDraftLineItemV1,
  PacingDraftV1,
  PacingInsertionOrderV1,
  PacingInUseV1,
} from "./types";
import "./create-pacing-panel.css";

const RATE_TYPES = ["CPM", "CPC", "CPV", "CPI", "Flat"];

/** The generated contract's closed data-source vocabulary (Pacing's own `ALLOWED_DATA_SOURCES`). */
type PacingDataSourceValue = NonNullable<NonNullable<PacingCreateV1["data"]>["source"]>;

/** Pacing's own data-source allowlist, labelled in plain words - a value outside it would be
 *  silently replaced by Pacing, so the choice is closed here. */
const DATA_SOURCES: ReadonlyArray<{ value: PacingDataSourceValue; label: string }> = [
  { value: "platform_mart", label: "Platform mart (raw feed)" },
  { value: "platform_mart_adjustments_view", label: "Platform mart + manual adjustments" },
];

/**
 * One derived campaign of the current selection: the id/name plus how many selected line items
 * belong to it - recomputed live as rows are ticked and unticked.
 */
interface DerivedCampaign {
  id: string;
  name: string | null;
  count: number;
}

/**
 * The campaign set the created pacing will be linked to, derived from the SELECTED line items
 * exactly the way Pacing's own `CampaignSet.deriveCampaigns` does it: distinct campaign id in
 * first-appearance order, line items with no campaign skipped (deliberate on the Pacing side - a
 * misc/manual line item must not block the others). This is a preview of a decision Pacing makes
 * itself; nothing here is sent as the set, only its ORDER can be pinned.
 */
function deriveCampaignSet(
  lineItems: PacingDraftLineItemV1[],
  selectedIds: Set<string>
): { campaigns: DerivedCampaign[]; withoutCampaign: number } {
  const byId = new Map<string, DerivedCampaign>();
  let withoutCampaign = 0;
  for (const li of lineItems) {
    if (!selectedIds.has(li.lineItemId)) continue;
    const id = li.campaignId == null || li.campaignId === "" ? null : String(li.campaignId);
    if (!id) {
      withoutCampaign += 1;
      continue;
    }
    const existing = byId.get(id);
    if (existing) existing.count += 1;
    else byId.set(id, { id, name: li.campaignName || null, count: 1 });
  }
  return { campaigns: [...byId.values()], withoutCampaign };
}

/**
 * A human rendering of an exchange rate: at most 6 decimals, trailing zeros trimmed - never a raw
 * float like 0.704503184354 in a display field.
 */
function formatRate(rate: number): string {
  return String(Number(rate.toFixed(6)));
}

/** One campaign-links editor row; kept as plain strings until submit filters the empty ones out. */
interface LinkRow {
  name: string;
  url: string;
}

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

/** Net % cell validation, the one copy: blank is legal (= invoiced at gross); anything else must be
 *  a percentage in (0, 100]. Both the submit gate and the row's own invalid styling read this, so
 *  the button and the explanation can never disagree. */
function netPctOk(value: string): boolean {
  const raw = String(value ?? "").trim();
  if (raw === "") return true;
  const n = parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 100;
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
  /** The campaign to fetch a draft for. Omitted by the Create Pacing modal, which passes `draft`. */
  campaignId?: number;
  /**
   * An already-fetched draft (the Create Pacing modal's step-1 lookup result). When
   * present, the panel fetches nothing of its own and reads campaign/client/agency off the draft.
   */
  draft?: PacingDraftV1;
  campaignName?: string;
  clientName?: string;
  agencyName?: string;
  /** The back button's label; defaults to the campaign tab's "Back to pacings". */
  backLabel?: string;
  onClose: () => void;
  /**
   * Called with the new pacing's id plus the primary campaign of the pinned set (null when the
   * derived set was somehow empty) - what the Create Pacing modal navigates to. Callers that already
   * know their campaign may ignore the second argument.
   */
  onCreated: (pacingId: string, primaryCampaignId: string | null) => void;
}

export function CreatePacingPanel({
  campaignId,
  draft,
  campaignName,
  clientName,
  agencyName,
  backLabel = "← Back to pacings",
  onClose,
  onCreated,
}: CreatePacingPanelProps) {
  // Disabled entirely when a pre-fetched draft is passed - the hook's `enabled` gate reads undefined.
  const draftQuery = usePacingDraft(draft ? undefined : campaignId);
  const effectiveDraft = draft ?? draftQuery.data;

  return (
    <section className="pcreate">
      <header className="pcreate__header">
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          {backLabel}
        </button>
        <h2 className="pcreate__title">Create Pacing</h2>
        <dl className="pcreate__context">
          <div className="pcreate__context-cell">
            <dt>Agency</dt>
            <dd>{agencyName || effectiveDraft?.agency || "—"}</dd>
          </div>
          <div className="pcreate__context-cell">
            <dt>Client</dt>
            <dd>{clientName || effectiveDraft?.client || "—"}</dd>
          </div>
          <div className="pcreate__context-cell">
            <dt>Campaign</dt>
            <dd>{campaignName || effectiveDraft?.campaign || "—"}</dd>
          </div>
        </dl>
      </header>

      {!draft && draftQuery.isPending && <LoadingBlock label="Loading campaign line items" />}
      {!draft && draftQuery.isError && <p className="form-error">{formatError(draftQuery.error)}</p>}
      {effectiveDraft && (
        <CreatePacingForm
          campaignId={campaignId}
          defaultPacingName={effectiveDraft.campaign || campaignName || ""}
          draft={effectiveDraft}
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
  campaignId?: number;
  defaultPacingName: string;
  draft: PacingDraftV1;
  onCreated: (pacingId: string, primaryCampaignId: string | null) => void;
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
  // Ids the caller looked up that came back with NO row at all (only possible on the id-lookup
  // selector): they cannot be shown as table rows, so they are named above the table instead of
  // silently vanishing from what the user pasted.
  const missingLookupIds = useMemo(() => {
    const present = new Set(lineItems.map((li) => li.lineItemId));
    return (draft.notFoundIds ?? []).filter((id) => !present.has(id));
  }, [draft.notFoundIds, lineItems]);
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

  // ── Settings block (the reference create screen's, minus what this fork does not have) ──
  const [dataSource, setDataSource] = useState<PacingDataSourceValue>("platform_mart");
  const [fetchCreatives, setFetchCreatives] = useState(false);
  const [fetchConversions, setFetchConversions] = useState(false);
  // Coefficient cost mode: a master toggle. ON seeds every line item's flag true and reveals the
  // per-row Coef column; OFF hides the column and clears the flags, so nothing the user set and then
  // hid rides the payload ("visible is saved" - the retired SPA's exact behavior).
  const [coefMode, setCoefMode] = useState(false);
  const [coefFlags, setCoefFlags] = useState<Set<string>>(() => new Set());
  // Net cost mode (Pacing spec 2026-09-07): the coef toggle's twin. The Net % cells hold PERCENT
  // strings ("85" for k = 0.85); the wire carries ratios. `netDirty` marks cells the user typed in -
  // they keep their value across a toggle and ride with the lock.
  const [netMode, setNetMode] = useState(false);
  const [netPcts, setNetPcts] = useState<Record<string, string>>({});
  const [netDirty, setNetDirty] = useState<Set<string>>(() => new Set());
  // Campaign links / notes, stored on the new pacing's config verbatim.
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [notes, setNotes] = useState("");
  // Create-time exchange-rate override. Only meaningful for a non-USD draft - Pacing ignores
  // body.rate for a USD campaign, so the control only renders when a converted line item exists.
  const nonUsdLineItem = useMemo(
    () => lineItems.find((li) => li.converted && li.currency && li.currency.toUpperCase() !== "USD") ?? null,
    [lineItems]
  );
  const nsRate = nonUsdLineItem?.exchangeRate ?? null;
  const [rateInput, setRateInput] = useState<string>(() => (nsRate != null ? formatRate(nsRate) : ""));
  const [rateEdited, setRateEdited] = useState(false);

  /** Flip the coefficient master toggle, seeding/clearing every row's flag with it. */
  function toggleCoefMode(on: boolean) {
    setCoefMode(on);
    setCoefFlags(on ? new Set(lineItems.map((li) => li.lineItemId)) : new Set());
  }

  function toggleCoefFlag(id: string) {
    setCoefFlags((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Flip the net master toggle - the coef toggle's twin (Pacing spec 2026-09-07 §5). ON reveals the
   *  per-row Net % column and seeds every cell from NetSuite's own ratio, keeping a cell the user
   *  already typed in; OFF hides the column, blanks the cells and clears their dirty marks, so
   *  nothing typed and then hidden rides the create body ("visible is saved"). */
  function toggleNetMode(on: boolean) {
    setNetMode(on);
    if (on) {
      setNetPcts((cur) => {
        const next: Record<string, string> = {};
        for (const li of lineItems) {
          next[li.lineItemId] = netDirty.has(li.lineItemId)
            ? (cur[li.lineItemId] ?? "")
            : netRatioToPct(li.nsNetRatio);
        }
        return next;
      });
    } else {
      setNetPcts({});
      setNetDirty(new Set());
    }
  }

  /** A manual Net % edit marks the cell dirty - the create body sends the lock for exactly these,
   *  so a revalidate keeps the hand-entered ratio instead of re-seeding NetSuite's. */
  function setNetPct(id: string, value: string) {
    setNetPcts((cur) => ({ ...cur, [id]: value }));
    setNetDirty((cur) => new Set(cur).add(id));
  }

  function updateLink(index: number, patch: Partial<LinkRow>) {
    setLinks((cur) => cur.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

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

  // ── The derived campaign set (§3 of the migration plan: derived, never picked) ──
  // Recomputed live over exactly the line items the create body will carry, mirroring Pacing's own
  // deriveCampaigns. Empty means the pacing would be linked to NO campaign - invisible to every
  // Client Services user and inert on the pacing list - so Create is blocked below with the reason
  // spelled out, not a generic validation error.
  const { campaigns: derivedCampaigns, withoutCampaign } = useMemo(
    () => deriveCampaignSet(lineItems, submittableIds),
    [lineItems, submittableIds]
  );
  // Which derived campaign leads. The pin only ever REORDERS the derived set (Pacing's
  // applyPinnedOrder ignores unknown ids and never changes membership); a pinned campaign whose
  // last line item was just unticked simply falls back to the first derived one.
  const [primaryPin, setPrimaryPin] = useState<string | null>(null);
  const orderedCampaigns = useMemo(() => {
    if (derivedCampaigns.length === 0) return [];
    const primary = derivedCampaigns.find((c) => c.id === primaryPin) ?? derivedCampaigns[0];
    return [primary, ...derivedCampaigns.filter((c) => c.id !== primary.id)];
  }, [derivedCampaigns, primaryPin]);

  // Net % validity: blank is legal (= invoiced at gross); a non-blank cell must be a percentage in
  // (0, 100]. Only rows actually being created gate the submit.
  const invalidNetIds = useMemo(() => {
    if (!netMode) return [];
    return [...submittableIds].filter((id) => !netPctOk(netPcts[id] ?? ""));
  }, [netMode, netPcts, submittableIds]);

  const canSubmit =
    submittableIds.size > 0 &&
    derivedCampaigns.length > 0 &&
    pacingName.trim().length > 0 &&
    invalidNetIds.length === 0 &&
    !createMutation.isPending;

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
          // Carried straight back, never edited: it is NetSuite's own answer to who runs this
          // campaign, and storing it at create is what lets the new pacing show the
          // owner-vs-NetSuite comparison (§11) from its first minute instead of blank until the
          // nightly refresh catches up.
          mpoTeamLead: li.mpoTeamLead,
          targetImpressions: parseEditableNumber(row.targetImpressions),
          marginPercent: parseEditableNumber(row.marginPercent),
          targetCtr: parseEditableNumber(row.targetCtr),
          targetVcr: parseEditableNumber(row.targetVcr),
          // Always a boolean, exactly as the retired SPA sent it: master ON forwards the row's
          // checkbox, master OFF forwards false - never whatever a hidden checkbox last held.
          costCoef: coefMode ? coefFlags.has(li.lineItemId) : false,
          // Net cost mode: the ratio rides only while the master toggle is on and the cell holds a
          // real net percentage (blank/100 sends nothing - Pacing's canon never persists the
          // identity). The lock rides on the cell being DIRTY, not on a ratio being sent: typing 100
          // or clearing a seeded cell is a deliberate "invoiced at gross" that must survive a
          // revalidate. NetSuite's own ratio rides WHATEVER the toggle says - it only seeds the
          // Reset-to-NS baseline, and changes no number by itself.
          ...(netMode && netPctToRatio(netPcts[li.lineItemId] ?? "") != null
            ? { netRatio: netPctToRatio(netPcts[li.lineItemId] ?? "") as number }
            : {}),
          ...(netMode && netDirty.has(li.lineItemId) ? { netRatioLocked: true } : {}),
          ...(li.nsNetRatio != null ? { nsNetRatio: li.nsNetRatio } : {}),
        };
      });

    // The rate override rides only for a non-USD draft (Pacing ignores it for USD), and only as a
    // positive number: an emptied/garbled input falls back to the NetSuite-detected rate.
    const parsedRate = Number(rateInput);
    const effectiveRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : nsRate;
    const cleanLinks: PacingCampaignLinkV1[] = links
      .map((row) => ({ name: row.name.trim(), url: row.url.trim() }))
      .filter((row) => row.name && row.url);
    const body: PacingCreateV1 = {
      pacingName: pacingName.trim(),
      lineItems: requestLineItems,
      // The client/agency pair from the draft - without it the new pacing's config has neither until
      // somebody runs Revalidate, and the Overview's "agency · client" subtitle renders blank.
      ...(draft.client ? { client: draft.client } : {}),
      ...(draft.agency ? { agency: draft.agency } : {}),
      // The pinned ORDER of the derived set - first entry is the campaign the Hub navigates to when
      // this pacing is opened. Pacing re-derives the set itself; this can only reorder it.
      ...(orderedCampaigns.length > 0 ? { campaigns: orderedCampaigns.map((c) => c.id) } : {}),
      data: { source: dataSource, fetchCreatives, fetchConversions, coefEnabled: coefMode, netEnabled: netMode },
      ...(nonUsdLineItem && effectiveRate != null ? { rate: effectiveRate, rateLocked: rateEdited } : {}),
      ...(cleanLinks.length > 0 ? { campaignLinks: cleanLinks } : {}),
      ...(notes.trim() ? { campaignNotes: notes.trim() } : {}),
    };
    try {
      const result = await createMutation.mutateAsync(body);
      toast.showSuccess(`Pacing "${pacingName.trim()}" created.`);
      onCreated(result.pacingId, orderedCampaigns[0]?.id ?? null);
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
      {/* One header band, not two: the validated/ready counts AND the pacing name share the strip -
          each on its own full-width row they were two of the five chrome bands that squeezed the
          table down to a single visible line item. */}
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
        <span className="pcreate__name-inline">
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
        </span>
        <span className="pcreate__result-counts">
          <span className="pcreate__count pcreate__count--ok">{readyCount} ready</span>
          <span className="pcreate__count pcreate__count--need">{needCount} need input</span>
          <span className="pcreate__count pcreate__count--excluded">
            {excludedCount} excluded
            {excludedNotDelivered > 0 ? ` (${excludedNotDelivered} not yet delivered)` : ""}
          </span>
        </span>
      </div>

      {(draft.warnings?.length ?? 0) > 0 && (
        <ul className="pcreate__warnings">
          {draft.warnings?.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      )}

      {/* Ids the lookup could not return a row for AT ALL (id-lookup mode: a typo, or a line item
          NetSuite has no master row for). Distinct from a not-yet-delivered row, which IS in the
          table below - un-ticked and marked, re-tickable to pace early. */}
      {missingLookupIds.length > 0 && (
        <ul className="pcreate__warnings">
          <li>
            {missingLookupIds.length === 1 ? "This id" : "These ids"} returned no NetSuite row and{" "}
            {missingLookupIds.length === 1 ? "is" : "are"} not in the table: {missingLookupIds.join(", ")}. Check
            {missingLookupIds.length === 1 ? " it" : " them"} in NetSuite.
          </li>
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
                {coefMode && <col className="pcreate__col-coef" />}
                {netMode && <col className="pcreate__col-net" />}
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
                  <SortableHeader label="Rate" sortKey="rateType" sort={sort} onSort={toggleSort} />
                  <SortableHeader label="Flight" sortKey="flightStart" sort={sort} onSort={toggleSort} required />
                  <SortableHeader label="MP Budget" sortKey="nativeBudget" sort={sort} onSort={toggleSort} required />
                  <SortableHeader label="MP Units" sortKey="targetImpressions" sort={sort} onSort={toggleSort} required />
                  <SortableHeader label="Margin" sortKey="marginPercent" sort={sort} onSort={toggleSort} required />
                  {/* Only rendered while the coefficient master toggle is on - the column disappears
                      (and its flags clear) when the toggle goes off, so what is visible is exactly
                      what the create body carries. */}
                  {coefMode && <th className="pcreate__th-coef">Coef</th>}
                  {netMode && <th className="pcreate__th-net">Net %</th>}
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
                    coefMode={coefMode}
                    coefFlags={coefFlags}
                    onToggleCoef={toggleCoefFlag}
                    netMode={netMode}
                    netPcts={netPcts}
                    netDirty={netDirty}
                    onSetNetPct={setNetPct}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* ── The two config blocks share a row on a wide screen instead of stacking two
                 full-width bands - the table above them is the content, these are its settings. ── */}
          <div className="pcreate__blocks">
          {/* ── The derived campaign set (§3): shown before commit, never picked. ── */}
          <section className="pcreate__block" aria-labelledby="pcreate-campaigns-title">
            <h3 id="pcreate-campaigns-title" className="pcreate__block-title">
              Campaign link
            </h3>
            <p className="pcreate__block-hint">
              Derived from the selected line items — ticking rows on or off updates it.
            </p>
            {derivedCampaigns.length === 0 ? (
              <p
                className={cn(
                  "pcreate__campaigns-none",
                  submittableIds.size === 0 && "pcreate__campaigns-none--empty"
                )}
              >
                {submittableIds.size === 0
                  ? "Select at least one line item to derive the campaign."
                  : "None of the selected line items carries a NetSuite campaign, so this pacing would be " +
                    "linked to no campaign: Client Services users would not see it, and it could not be " +
                    "opened from the pacing list. Check these line items in NetSuite before creating."}
              </p>
            ) : (
              <>
                <ul className="pcreate__campaign-list">
                  {orderedCampaigns.map((campaign, index) => (
                    <li key={campaign.id} className="pcreate__campaign">
                      {derivedCampaigns.length > 1 ? (
                        <label className="pcreate__campaign-pick">
                          <input
                            type="radio"
                            name="pcreate-primary-campaign"
                            checked={index === 0}
                            onChange={() => setPrimaryPin(campaign.id)}
                          />
                          <span className="pcreate__campaign-name">{campaign.name || `Campaign ${campaign.id}`}</span>
                        </label>
                      ) : (
                        <span className="pcreate__campaign-name">{campaign.name || `Campaign ${campaign.id}`}</span>
                      )}
                      {index === 0 && <span className="pcreate__badge">Primary</span>}
                      <span className="pcreate__campaign-count">
                        {campaign.count} line item{campaign.count === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
                {derivedCampaigns.length > 1 && (
                  <p className="pcreate__block-hint">
                    Primary is the campaign this pacing opens under when someone opens it from a pacing
                    list.
                  </p>
                )}
                {withoutCampaign > 0 && (
                  <p className="pcreate__block-hint">
                    {withoutCampaign} selected line item{withoutCampaign === 1 ? " carries" : "s carry"} no
                    campaign — {withoutCampaign === 1 ? "it" : "they"} will still be paced, but{" "}
                    {withoutCampaign === 1 ? "does" : "do"} not affect the campaign link.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ── Settings (the reference create screen's block; net cost mode and the layout picker do
                 not exist in this fork and are deliberately absent). ── */}
          <section className="pcreate__block" aria-labelledby="pcreate-settings-title">
            <h3 id="pcreate-settings-title" className="pcreate__block-title">
              Settings
            </h3>
            <label className="pcreate__setting">
              <span className="pcreate__setting-label">Data source</span>
              <select
                className="pcreate__select pcreate__select--auto"
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as typeof dataSource)}
              >
                {DATA_SOURCES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pcreate__setting-check">
              <input type="checkbox" checked={fetchCreatives} onChange={(e) => setFetchCreatives(e.target.checked)} />
              <span>Fetch creatives (adds the Creative breakdown on refresh)</span>
            </label>
            <label className="pcreate__setting-check">
              <input
                type="checkbox"
                checked={fetchConversions}
                onChange={(e) => setFetchConversions(e.target.checked)}
              />
              <span>Fetch conversions (adds the Conversion Action breakdown)</span>
            </label>
            <label className="pcreate__setting-check">
              <input type="checkbox" checked={coefMode} onChange={(e) => toggleCoefMode(e.target.checked)} />
              <span>Coefficient cost mode (adds a per-row Coef column above; each line item starts on)</span>
            </label>
            <label className="pcreate__setting-check">
              <input type="checkbox" checked={netMode} onChange={(e) => toggleNetMode(e.target.checked)} />
              <span>Net cost mode (adds a per-row Net % column above, seeded from NetSuite)</span>
            </label>
            {/* What NetSuite already knows, offered as the action it implies rather than buried in
                the toggle's own label - where it read as part of the setting instead of as a reason
                to switch it on. Only while the toggle is OFF: once it is on, the column says it. */}
            {!netMode && (draft.netHint?.count ?? 0) > 0 && (
              <p className="pcreate__field-hint">
                NetSuite reports gross ≠ net on {draft.netHint?.count} line item
                {draft.netHint?.count === 1 ? "" : "s"} —{" "}
                <button type="button" className="pcreate__link-btn" onClick={() => toggleNetMode(true)}>
                  enable Net cost mode?
                </button>
              </p>
            )}
            {netMode && (draft.netHint?.count ?? 0) === 0 && (
              <p className="pcreate__field-hint">
                NetSuite reports no net ≠ gross ratio on these line items - enter Net % by hand where
                a line item is invoiced at net, or every figure stays gross.
              </p>
            )}
            {nonUsdLineItem && (
              <div className="pcreate__setting">
                <span className="pcreate__setting-label">
                  Exchange rate ({nonUsdLineItem.currency} → USD)
                </span>
                <div className="pcreate__rate-row">
                  {/* A plain input, not NumericField: its blurred display rounds to 2 decimals,
                      which is far too coarse for an exchange rate (0.704503 must not read as 0.7). */}
                  <input
                    type="text"
                    inputMode="decimal"
                    className="pcreate__input pcreate__input--rate"
                    value={rateInput}
                    aria-label="Exchange rate override"
                    onChange={(e) => {
                      setRateInput(e.target.value);
                      setRateEdited(true);
                    }}
                  />
                  {nsRate != null && <span className="pcreate__field-hint">NetSuite rate: {formatRate(nsRate)}</span>}
                  {rateEdited && nsRate != null && (
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => {
                        setRateInput(formatRate(nsRate));
                        setRateEdited(false);
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <span className="pcreate__field-hint">
                  Sets every line item's USD budget. Editing locks the rate so a later revalidate keeps it.
                </span>
              </div>
            )}
            <div className="pcreate__setting">
              <span className="pcreate__setting-label">Campaign links</span>
              {links.map((row, index) => (
                <div key={index} className="pcreate__link-row">
                  <input
                    className="pcreate__input pcreate__input--link-name"
                    placeholder="Name (e.g. Asana, IO)"
                    value={row.name}
                    aria-label={`Link ${index + 1} name`}
                    onChange={(e) => updateLink(index, { name: e.target.value })}
                  />
                  <input
                    className="pcreate__input pcreate__input--link-url"
                    placeholder="https://…"
                    value={row.url}
                    aria-label={`Link ${index + 1} URL`}
                    onChange={(e) => updateLink(index, { url: e.target.value })}
                  />
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => setLinks((cur) => cur.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => setLinks((cur) => [...cur, { name: "", url: "" }])}
                >
                  Add link
                </button>
              </div>
            </div>
            <label className="pcreate__setting">
              <span className="pcreate__setting-label">Campaign notes</span>
              <textarea
                className="pcreate__notes"
                rows={3}
                value={notes}
                placeholder="Free-text notes stored with the pacing"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </section>
          </div>
        </>
      )}

      {/* Inline, not only a toast: a bad_coef_config answer names the offending line items and
          fields, and a sentence that long has to stay on screen to be acted on. */}
      {createMutation.isError && (
        <p className="form-error pcreate__create-error">{formatError(createMutation.error)}</p>
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
  coefMode,
  coefFlags,
  onToggleCoef,
  netMode,
  netPcts,
  netDirty,
  onSetNetPct,
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
  coefMode: boolean;
  coefFlags: Set<string>;
  onToggleCoef: (id: string) => void;
  netMode: boolean;
  netPcts: Record<string, string>;
  netDirty: Set<string>;
  onSetNetPct: (id: string, value: string) => void;
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
        <td colSpan={12 + (coefMode ? 1 : 0) + (netMode ? 1 : 0)}>
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
            coefMode={coefMode}
            coefChecked={coefFlags.has(li.lineItemId)}
            onToggleCoef={() => onToggleCoef(li.lineItemId)}
            netMode={netMode}
            netPct={netPcts[li.lineItemId] ?? ""}
            netSeeded={li.nsNetRatio != null && !netDirty.has(li.lineItemId)}
            onSetNetPct={(value) => onSetNetPct(li.lineItemId, value)}
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
  coefMode,
  coefChecked,
  onToggleCoef,
  netMode,
  netPct,
  netSeeded,
  onSetNetPct,
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
  coefMode: boolean;
  coefChecked: boolean;
  onToggleCoef: () => void;
  netMode: boolean;
  /** The row's Net % cell value (a percent string; blank = invoiced at gross). */
  netPct: string;
  /** Whether the cell still holds NetSuite's own seed (drives the "Auto" badge). */
  netSeeded: boolean;
  onSetNetPct: (value: string) => void;
}) {
  const id = li.lineItemId;
  const missingFlight = !hasFlightDates(values);
  // Exactly the rows `invalidNetIds` gates the submit on (included + flighted = submittable), so a
  // row only ever reads "invalid" when it is in fact what is holding Create back.
  const netInvalid = netMode && includedChecked && !missingFlight && !netPctOk(netPct);

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
            ariaLabel={`Units for line item ${id}`}
            className="pcreate__input"
          />
          {isAutoFilled(li.targetImpressions, id, "targetImpressions", dirty) && (
            <span className="pcreate__badge">Auto</span>
          )}
        </div>
        {/* NetSuite's own reference figure, shown only once the plan value DIFFERS from it - while
            they are equal (the pre-fill, untouched) the hint would repeat the input above it on
            every row and double the row's height for nothing. */}
        {li.plannedUnits != null && parseEditableNumber(values.targetImpressions) !== li.plannedUnits && (
          <span className="pcreate__field-hint">NetSuite MP units: {fmtInt(li.plannedUnits)}</span>
        )}
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
      {coefMode && (
        <td className="pcreate__cell-coef">
          <input
            type="checkbox"
            checked={coefChecked}
            disabled={!includedChecked}
            onChange={onToggleCoef}
            aria-label={`Coefficient cost mode for line item ${id}`}
          />
        </td>
      )}
      {/* Net % - seeded from NetSuite, only rendered while the master net toggle is on. Blank is a
          legal value (= invoiced at gross), so no "missing" state; an out-of-range entry blocks the
          Create button, and tints the cell plus carries a row badge so the disabled button is
          explained where the bad value is. */}
      {netMode && (
        <td className="pcreate__cell-pct">
          <div className="pcreate__field">
            <NumericField
              value={netPct}
              onChange={onSetNetPct}
              ariaLabel={`Net percent for line item ${id}`}
              className={cn("pcreate__input", "pcreate__input--pct", netInvalid && "pcreate__input--invalid")}
            />
            {netSeeded && netPct !== "" && <span className="pcreate__badge">Auto</span>}
          </div>
        </td>
      )}
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
          {netInvalid && <StatusBadge label="Invalid net %" color="var(--bad)" />}
          {notFound && <StatusBadge label="Not delivered yet" color="var(--attention)" />}
          {inUseEntry && <StatusBadge label={`In "${inUseEntry.pacingName}"`} color="var(--attention)" />}
          {!missingFlight && !netInvalid && !notFound && !inUseEntry && (
            <StatusBadge label="Available" color="var(--good)" />
          )}
        </div>
      </td>
    </tr>
  );
}
