/**
 * The live, full NetSuite diff for one pacing (§13 of the migration plan, US-136 "NetSuite Diff and
 * Data Health"). Unlike the Overview's "NS diff" column - a nightly summary, computed once a day and
 * frozen forever once a pacing leaves Live - this is fetched fresh every single time this sheet
 * opens, for any pacing regardless of status, and never reads from that summary's cache. Opened from
 * "NetSuite diff" in a pacing's row menu (`pacing-tab.tsx`), which is deliberately NOT admin-gated:
 * unlike Revalidate, this writes nothing back, so anyone who can see the pacing may look.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatError } from "../../../shared/format/error";
import { cn } from "../../../shared/style/cn";
import { ChevronDownIcon } from "../../../shared/ui/icons/icons";
import { LoadingBlock } from "../../../shared/ui/loading-spinner/loading-spinner";
import { Sheet } from "../../../shared/ui/sheet/sheet";
import { fmtDate, fmtMoney } from "../../pacing/mock/format";
import { fmtInt } from "../../pacing-dashboard/format";
import { usePacingNsDiff } from "../../pacing-overview/hooks";
import type { OpenPacingState } from "../../pacing-overview/navigation";
import type {
  PacingNsDiffFieldChangeV1,
  PacingNsDiffForeignCampaignV1,
  PacingNsDiffLineItemFieldsV1,
  PacingNsDiffMissingInNetsuiteV1,
  PacingNsDiffMissingInPacingV1,
  PacingNsDiffOwnerMismatchV1,
  PacingNsDiffReportV1,
  PacingRowV1,
} from "../../pacing-overview/types";
import { formatFlightGroupHeader, groupByCoveredBy, groupByFlight } from "./pacing-ns-diff-sheet-format";
import "./pacing-ns-diff-sheet.css";

const MONEY_FIELDS = new Set(["target_spend", "native_budget"]);
const INT_FIELDS = new Set(["target_impressions", "planned_units"]);
const DATE_FIELDS = new Set(["flight_start", "flight_end"]);

// `override` reads as "moved on purpose", never as an error - a person changed a flight date
// deliberately, and the plain field disagreeing with it is expected, not a defect.
const SOURCE_LABEL: Record<string, string> = {
  override: "Moved on purpose",
  plan: "From plan",
};

/**
 * `PacingNsDiffFieldChangeV1.pacing`/`.netsuite` are genuinely polymorphic on the wire - a string for
 * channel/rate_type/flight_start/flight_end, a number for
 * native_budget/target_impressions/target_spend (see that type's own doc comment). Format by what
 * the value actually IS; `field` only picks which number formatter to use, never forces a string
 * through one.
 */
function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (DATE_FIELDS.has(field) && typeof value === "string") return fmtDate(value);
  if (typeof value === "number") {
    if (MONEY_FIELDS.has(field)) return fmtMoney(value);
    if (INT_FIELDS.has(field)) return fmtInt(value);
    return value.toLocaleString("en-US");
  }
  return String(value);
}

/** Same polymorphism as {@link formatFieldValue}, without the `$` - a native-currency figure is not
 *  necessarily USD, and prefixing it with a dollar sign would misstate the currency it is in. */
function formatNativeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

function SectionHeading({ children, count }: { children: string; count: number }) {
  return (
    <h4 className="pacing-ns-diff__heading">
      {children}
      <span className="pacing-ns-diff__count">{count}</span>
    </h4>
  );
}

function MissingInNetsuiteSection({ entries }: { entries: PacingNsDiffMissingInNetsuiteV1[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="pacing-ns-diff__section">
      <SectionHeading count={entries.length}>No longer in NetSuite</SectionHeading>
      <ul className="pacing-ns-diff__list">
        {entries.map((entry) => (
          <li key={entry.lineItemId} className="pacing-ns-diff__entry">
            <div className="pacing-ns-diff__entry-id">{entry.lineItemId}</div>
            <dl className="pacing-ns-diff__fields">
              {entry.channel && (
                <div className="pacing-ns-diff__field">
                  <dt>Channel</dt>
                  <dd>{entry.channel}</dd>
                </div>
              )}
              <div className="pacing-ns-diff__field">
                <dt>Target spend</dt>
                <dd>{entry.targetSpend != null ? fmtMoney(entry.targetSpend) : "—"}</dd>
              </div>
              <div className="pacing-ns-diff__field">
                <dt>Target impressions</dt>
                <dd>{entry.targetImpressions != null ? fmtInt(entry.targetImpressions) : "—"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One `missingInPacing` entry card — extracted so the flight groups and the "covered by another
 *  pacing" groups (below) can both render the same markup instead of duplicating it. */
function MissingInPacingEntryCard({ entry }: { entry: PacingNsDiffMissingInPacingV1 }) {
  return (
    <li className="pacing-ns-diff__entry">
      <div className="pacing-ns-diff__entry-id">
        {entry.lineItemId}
        {entry.campaignName && <span className="pacing-ns-diff__entry-sub"> · {entry.campaignName}</span>}
      </div>
      <dl className="pacing-ns-diff__fields">
        {entry.orderNumber && (
          <div className="pacing-ns-diff__field">
            <dt>Order number</dt>
            <dd>{entry.orderNumber}</dd>
          </div>
        )}
        {entry.channel && (
          <div className="pacing-ns-diff__field">
            <dt>Channel</dt>
            <dd>{entry.channel}</dd>
          </div>
        )}
        {entry.rateType && (
          <div className="pacing-ns-diff__field">
            <dt>Rate type</dt>
            <dd>{entry.rateType}</dd>
          </div>
        )}
        {entry.nativeBudget != null && (
          <div className="pacing-ns-diff__field">
            <dt>Native budget</dt>
            <dd>{fmtMoney(entry.nativeBudget)}</dd>
          </div>
        )}
        {entry.plannedUnits != null && (
          <div className="pacing-ns-diff__field">
            <dt>Planned units</dt>
            <dd>{fmtInt(entry.plannedUnits)}</dd>
          </div>
        )}
        {(entry.flightStart || entry.flightEnd) && (
          <div className="pacing-ns-diff__field">
            <dt>Flight</dt>
            <dd>
              {entry.flightStart ? fmtDate(entry.flightStart) : "—"} –{" "}
              {entry.flightEnd ? fmtDate(entry.flightEnd) : "—"}
            </dd>
          </div>
        )}
        {entry.description && (
          <div className="pacing-ns-diff__field pacing-ns-diff__field--wide">
            <dt>Description</dt>
            <dd>{entry.description}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/**
 * A collapsed-by-default disclosure, opened on click. Plain local `useState` toggle with a rotating
 * chevron — the same pattern `pacing-tab.tsx`'s own row expand/collapse (`expandedId`) already
 * establishes; this codebase has no shared Disclosure/Accordion component to reuse instead.
 */
function CollapsibleGroup({
  header,
  defaultOpen = false,
  className,
  children,
}: {
  header: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("pacing-ns-diff__group", className)}>
      <button
        type="button"
        className="pacing-ns-diff__group-head"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <ChevronDownIcon className={cn("pacing-ns-diff__group-chevron", open && "pacing-ns-diff__group-chevron--open")} />
        {header}
      </button>
      {open && <div className="pacing-ns-diff__group-body">{children}</div>}
    </div>
  );
}

/** `missingInPacing` entries grouped by flight, each group collapsed by default (§13 follow-up,
 *  found live on campaign 40539: 90 near-identical entries read as "April isn't covered" only once
 *  they are grouped by flight instead of scrolled past one at a time). Reused both for the uncovered
 *  list and inside each "covered by another pacing" group, so the two read the same way. */
function FlightGroupList({ entries }: { entries: readonly PacingNsDiffMissingInPacingV1[] }) {
  const groups = groupByFlight(entries);
  return (
    <ul className="pacing-ns-diff__list pacing-ns-diff__flight-groups">
      {groups.map((group) => (
        <li key={`${group.flightStart ?? "none"}::${group.flightEnd ?? "none"}`}>
          <CollapsibleGroup header={formatFlightGroupHeader(group.flightStart, group.flightEnd, group.entries.length)}>
            <ul className="pacing-ns-diff__list">
              {group.entries.map((entry) => (
                <MissingInPacingEntryCard key={entry.lineItemId} entry={entry} />
              ))}
            </ul>
          </CollapsibleGroup>
        </li>
      ))}
    </ul>
  );
}

/**
 * The `coveredBy`-carrying entries, collapsed under one "Covered by another pacing" block (§13
 * follow-up: a campaign with two Live pacings reported the same ten line items as missing on both -
 * not a bug, so it reads differently from a genuine gap rather than being hidden). Grouped by the
 * OTHER pacing (usually one, but not assumed to be exactly one), each group headed by that pacing's
 * name as a link to the SAME navigation `pacing-tab.tsx`'s own "also covers" links use - the campaign
 * to open is this entry's own `campaignId`, since the covering pacing is on the same campaign by
 * construction.
 */
function CoveredByBlock({ entries }: { entries: readonly PacingNsDiffMissingInPacingV1[] }) {
  if (entries.length === 0) return null;
  const groups = groupByCoveredBy(entries);
  return (
    <CollapsibleGroup header={`Covered by another pacing (${entries.length})`} className="pacing-ns-diff__group--covered">
      <ul className="pacing-ns-diff__list">
        {groups.map((group) => {
          const campaignId = group.campaignId != null ? Number(group.campaignId) : NaN;
          const state: OpenPacingState = { openPacingId: group.pacingId };
          return (
            <li key={group.pacingId} className="pacing-ns-diff__covered-group">
              <div className="pacing-ns-diff__covered-group-head">
                {Number.isFinite(campaignId) ? (
                  <Link to={`/campaigns/${campaignId}/pacing`} state={state}>
                    {group.pacingName}
                  </Link>
                ) : (
                  group.pacingName
                )}
                <span className="pacing-ns-diff__count">{group.entries.length}</span>
              </div>
              <FlightGroupList entries={group.entries} />
            </li>
          );
        })}
      </ul>
    </CollapsibleGroup>
  );
}

function MissingInPacingSection({ entries }: { entries: PacingNsDiffMissingInPacingV1[] }) {
  if (entries.length === 0) return null;
  // §13 follow-up: `coveredBy` splits this list into a genuine gap (uncovered, shown open) and
  // entries an OTHER Live pacing of the same campaign already carries (covered, collapsed below).
  // The heading count stays the TOTAL — nothing here is ever hidden, only reorganized.
  const uncovered = entries.filter((entry) => entry.coveredBy == null);
  const covered = entries.filter((entry) => entry.coveredBy != null);
  return (
    <section className="pacing-ns-diff__section">
      <SectionHeading count={entries.length}>Missing from this pacing</SectionHeading>
      <FlightGroupList entries={uncovered} />
      <CoveredByBlock entries={covered} />
    </section>
  );
}

function FieldChangeRow({ change }: { change: PacingNsDiffFieldChangeV1 }) {
  // Never drop one currency: a currency-converted pacing shows both the USD pair AND the
  // native-currency pair for target_spend specifically (the only field this can be present on).
  const hasNative = change.field === "target_spend" && (change.pacingNative != null || change.netsuiteNative != null);
  return (
    <div className="pacing-ns-diff__field-change">
      <span className="pacing-ns-diff__field-name">{change.field}</span>
      <span className="pacing-ns-diff__field-values">
        {formatFieldValue(change.field, change.pacing)} <span className="pacing-ns-diff__arrow">→</span>{" "}
        {formatFieldValue(change.field, change.netsuite)}
      </span>
      {change.source && (
        <span className="pacing-ns-diff__source-badge">{SOURCE_LABEL[change.source] ?? change.source}</span>
      )}
      {hasNative && (
        <span className="pacing-ns-diff__field-native">
          Native: {formatNativeValue(change.pacingNative)} <span className="pacing-ns-diff__arrow">→</span>{" "}
          {formatNativeValue(change.netsuiteNative)}
        </span>
      )}
    </div>
  );
}

function LineItemFieldsSection({ title, entries }: { title: string; entries: PacingNsDiffLineItemFieldsV1[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="pacing-ns-diff__section">
      <SectionHeading count={entries.length}>{title}</SectionHeading>
      <ul className="pacing-ns-diff__list">
        {entries.map((entry) => (
          <li key={entry.lineItemId} className="pacing-ns-diff__entry">
            <div className="pacing-ns-diff__entry-id">{entry.lineItemId}</div>
            <div className="pacing-ns-diff__field-changes">
              {entry.fields.map((change) => (
                <FieldChangeRow key={change.field} change={change} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ForeignCampaignSection({ entries }: { entries: PacingNsDiffForeignCampaignV1[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="pacing-ns-diff__section">
      <SectionHeading count={entries.length}>Moved to another campaign</SectionHeading>
      <ul className="pacing-ns-diff__list">
        {entries.map((entry) => (
          <li key={entry.lineItemId} className="pacing-ns-diff__entry">
            <div className="pacing-ns-diff__entry-id">{entry.lineItemId}</div>
            <p className="pacing-ns-diff__entry-note">
              Stored under campaign {entry.pacingCampaignId ?? "—"}, but NetSuite reports it under{" "}
              {entry.netsuiteCampaignName ?? entry.netsuiteCampaignId ?? "—"}.{" "}
              {entry.inPacingCampaignSet
                ? "That campaign is one of this pacing's own."
                : "That campaign is not one of this pacing's own."}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OwnerDiffSection({ entries }: { entries: PacingNsDiffOwnerMismatchV1[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="pacing-ns-diff__section">
      <SectionHeading count={entries.length}>Owner differs from NetSuite</SectionHeading>
      <ul className="pacing-ns-diff__list">
        {entries.map((entry) => (
          <li key={entry.campaignId} className="pacing-ns-diff__entry">
            <div className="pacing-ns-diff__entry-id">{entry.campaignName ?? entry.campaignId}</div>
            {/* Both values, neither presumed correct - same framing as the Overview's OwnerCell /
                netSuiteLeadMismatch: which of the two is out of date is the reader's call. */}
            <p className="pacing-ns-diff__entry-note">
              Pacing: {entry.ownerName ?? "—"} · NetSuite: {entry.mpoTeamLead ?? "—"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NsDiffReport({ report }: { report: PacingNsDiffReportV1 }) {
  const noDifferences =
    report.inSync &&
    report.missingInNetsuite.length === 0 &&
    report.missingInPacing.length === 0 &&
    report.fieldDiff.length === 0 &&
    report.planDiff.length === 0 &&
    report.foreignCampaign.length === 0 &&
    report.ownerDiff.length === 0;

  if (noDifferences) {
    return <p className="pacing-ns-diff__empty">No differences — this pacing matches NetSuite.</p>;
  }

  return (
    <>
      <MissingInNetsuiteSection entries={report.missingInNetsuite} />
      <MissingInPacingSection entries={report.missingInPacing} />
      <LineItemFieldsSection title="Field differences" entries={report.fieldDiff} />
      <LineItemFieldsSection title="Plan differences" entries={report.planDiff} />
      <ForeignCampaignSection entries={report.foreignCampaign} />
      <OwnerDiffSection entries={report.ownerDiff} />
      {report.notCheckedLineItems && report.notCheckedLineItems.length > 0 && (
        <p className="pacing-ns-diff__note">
          Not checked: {report.notCheckedLineItems.join(", ")} — these carry a manually-added id
          NetSuite's master has no record of, so they could not be compared.
        </p>
      )}
    </>
  );
}

interface PacingNsDiffSheetProps {
  /** The pacing to show the diff for, or `null` when the sheet is closed. Kept mounted with
   *  `open`/`onClose` (the same shape `Sheet` itself takes) rather than conditionally rendered, so
   *  `Sheet`'s own close transition and the query's `enabled` gate both work off one boolean. */
  row: PacingRowV1 | null;
  onClose: () => void;
}

export function PacingNsDiffSheet({ row, onClose }: PacingNsDiffSheetProps) {
  const open = row != null;
  const pacingId = row?.id ?? "";
  const query = usePacingNsDiff(pacingId, open);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={row ? `NetSuite diff — ${row.name}` : "NetSuite diff"}
      className="pacing-ns-diff"
    >
      {query.isPending && <LoadingBlock label="Checking against NetSuite" />}
      {query.isError && <p className="form-error">{formatError(query.error)}</p>}
      {query.isSuccess && query.data && <NsDiffReport report={query.data} />}
    </Sheet>
  );
}
