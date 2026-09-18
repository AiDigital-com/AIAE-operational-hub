import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingCreateResultV1, aPacingDraftLineItemV1, aPacingDraftV1, aPacingInsertionOrderV1 } from "@/test/factories";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { createPacing, getPacingDraft } from "./api";
import { CreatePacingPanel } from "./create-pacing-panel";
import type { PacingCreateV1 } from "./types";

vi.mock("./api", () => ({
  getPacingDraft: vi.fn(),
  createPacing: vi.fn(),
}));

function renderPanel(onCreated = vi.fn(), onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onCreated,
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <CreatePacingPanel
            campaignId={42}
            campaignName="Ourisman Ford 2026"
            agencyName="MediaCo"
            clientName="Acme"
            onClose={onClose}
            onCreated={onCreated}
          />
        </ToastProvider>
      </QueryClientProvider>
    ),
  };
}

describe("CreatePacingPanel", () => {
  beforeEach(() => {
    vi.mocked(getPacingDraft).mockReset();
    vi.mocked(createPacing).mockReset();
  });

  it("pre-fills agency/client/campaign from the navigation with no search step (US-121)", async () => {
    // Given:
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [] }));

    // When:
    renderPanel();

    // Then: the campaign context renders immediately, and the draft loads with no search input
    expect(screen.getByText("MediaCo")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Ourisman Ford 2026")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await screen.findByText("NetSuite has no line items for this campaign.");
    expect(getPacingDraft).toHaveBeenCalledWith(42);
  });

  it("groups line items under their parent insertion order, showing the order's own fields, and expands/collapses (US-122)", async () => {
    // Given: two real IOs (id/name/budget/flight/status - not derived from their line items), one
    // line item each
    const orderA = aPacingInsertionOrderV1({
      orderId: "48000", orderNumber: "TM-100", orderName: "Northeast Buy", orderBudget: 50000,
      orderStartDate: "2026-01-01", orderEndDate: "2026-03-31", orderStatus: "Active",
    });
    const orderB = aPacingInsertionOrderV1({ orderId: "48001", orderNumber: "TM-200", orderName: undefined, orderStatus: "Closed" });
    const li1 = aPacingDraftLineItemV1({ lineItemId: "1", orderNumber: "TM-100", description: "Northeast" });
    const li2 = aPacingDraftLineItemV1({ lineItemId: "2", orderNumber: "TM-200", description: "Southwest" });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({ lineItems: [li1, li2], insertionOrders: [orderA, orderB] })
    );
    renderPanel();

    // Then: both groups render with the order's own data, expanded by default
    expect(await screen.findByText("IO TM-100")).toBeInTheDocument();
    expect(screen.getByText("IO TM-200")).toBeInTheDocument();
    expect(screen.getByText("Northeast Buy")).toBeInTheDocument(); // order name, not derived
    expect(screen.getByText("$50,000.00")).toBeInTheDocument(); // order's own budget, verbatim
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("Northeast")).toBeInTheDocument();
    expect(screen.getByText("Southwest")).toBeInTheDocument();

    // When: collapsing the first group
    await userEvent.click(screen.getByRole("button", { name: /IO TM-100/ }));

    // Then: only that group's line item disappears
    expect(screen.queryByText("Northeast")).not.toBeInTheDocument();
    expect(screen.getByText("Southwest")).toBeInTheDocument();

    // When: expanding it again
    await userEvent.click(screen.getByRole("button", { name: /IO TM-100/ }));

    // Then:
    expect(screen.getByText("Northeast")).toBeInTheDocument();
  });

  it("lists a line item whose order is missing from insertionOrders in its own group, not dropped (data-gap safety)", async () => {
    // Given: no insertionOrders at all (a data gap), but a line item still carries an orderNumber
    const li = aPacingDraftLineItemV1({ lineItemId: "1", orderNumber: "TM-999", description: "Orphan" });
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [li], insertionOrders: [] }));
    renderPanel();

    // Then: the line item still renders, under a fallback group - never silently dropped
    expect(await screen.findByText("Orphan")).toBeInTheDocument();
    expect(screen.getByText("No insertion order")).toBeInTheDocument();
  });

  it("auto-excludes not-yet-delivered line items by default, keeps them tickable, and sorts them last within their group (§8 notFoundIds)", async () => {
    // Given: one usable row and two not-yet-delivered rows, deliberately listed out of "usable first"
    // order, all under the same IO
    const notDelivered = aPacingDraftLineItemV1({ lineItemId: "2", orderNumber: "TM-1", description: "Not delivered row" });
    const usable = aPacingDraftLineItemV1({ lineItemId: "1", orderNumber: "TM-1", description: "Usable row" });
    const both = aPacingDraftLineItemV1({ lineItemId: "3", orderNumber: "TM-1", description: "Both row" });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({
        lineItems: [notDelivered, usable, both],
        insertionOrders: [aPacingInsertionOrderV1({ orderNumber: "TM-1" })],
        notFoundIds: ["2", "3"],
        inUse: { "3": { pacingId: "p9", pacingName: "Other Pacing", status: "Live" } },
      })
    );
    const { container } = renderPanel();
    await screen.findByText("Usable row");

    // Then: not-delivered rows start un-ticked, but their checkbox is not disabled - "re-enable to
    // pace early" must stay possible, exactly like the in-use handling
    const usableCheckbox = screen.getByRole("button", { name: "Include line item 1" });
    const notDeliveredCheckbox = screen.getByRole("button", { name: "Include line item 2" });
    const bothCheckbox = screen.getByRole("button", { name: "Include line item 3" });
    expect(usableCheckbox).toHaveAttribute("aria-pressed", "true");
    expect(notDeliveredCheckbox).toHaveAttribute("aria-pressed", "false");
    expect(notDeliveredCheckbox).not.toBeDisabled();
    expect(bothCheckbox).toHaveAttribute("aria-pressed", "false");

    // Then: within the group, the usable row comes first even though the draft listed it second
    const ids = Array.from(container.querySelectorAll(".pcreate__li-id")).map((el) => el.textContent);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("marks a not-yet-delivered row and an in-use row with distinct reasons, and shows both on a row that is both (§8)", async () => {
    // Given:
    const usable = aPacingDraftLineItemV1({ lineItemId: "1", description: "Usable row" });
    const notDelivered = aPacingDraftLineItemV1({ lineItemId: "2", description: "Not delivered row" });
    const both = aPacingDraftLineItemV1({ lineItemId: "3", description: "Both row" });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({
        lineItems: [usable, notDelivered, both],
        notFoundIds: ["2", "3"],
        inUse: { "3": { pacingId: "p9", pacingName: "Other Pacing", status: "Live" } },
      })
    );
    renderPanel();
    await screen.findByText("Usable row");

    const row1 = screen.getByRole("button", { name: "Include line item 1" }).closest("tr") as HTMLElement;
    const row2 = screen.getByRole("button", { name: "Include line item 2" }).closest("tr") as HTMLElement;
    const row3 = screen.getByRole("button", { name: "Include line item 3" }).closest("tr") as HTMLElement;

    // Then: a plain row reads "Available"; a not-delivered-only row reads only that reason; a row
    // that is both shows BOTH reasons, never collapsed into one generic label
    expect(within(row1).getByText("Available")).toBeInTheDocument();
    expect(within(row2).getByText("Not delivered yet")).toBeInTheDocument();
    expect(within(row2).queryByText(/In "/)).not.toBeInTheDocument();
    expect(within(row3).getByText("Not delivered yet")).toBeInTheDocument();
    expect(within(row3).getByText('In "Other Pacing"')).toBeInTheDocument();
  });

  it("surfaces Pacing's own warnings, and breaks the excluded count out into how many are auto-excluded for non-delivery (§8)", async () => {
    // Given: a warning sentence Pacing wrote for the person creating the pacing, and 2 of 3 line
    // items auto-excluded for not having delivered yet
    const usable = aPacingDraftLineItemV1({ lineItemId: "1" });
    const notDelivered1 = aPacingDraftLineItemV1({ lineItemId: "2" });
    const notDelivered2 = aPacingDraftLineItemV1({ lineItemId: "3" });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({
        lineItems: [usable, notDelivered1, notDelivered2],
        notFoundIds: ["2", "3"],
        warnings: [
          "These LIs have not delivered yet and are excluded by default; re-enable to pace early: 2, 3",
        ],
      })
    );
    renderPanel();
    await screen.findByText("1");

    // Then: the warning sentence is shown verbatim, not swallowed
    expect(
      screen.getByText(/These LIs have not delivered yet and are excluded by default/)
    ).toBeInTheDocument();

    // Then: "excluded" names the auto-exclusion explicitly, not just a bare count a user could read as
    // "I forgot to tick things"
    expect(screen.getByText(/2 excluded/)).toBeInTheDocument();
    expect(screen.getByText(/2 not yet delivered/)).toBeInTheDocument();
  });

  it("selects line items not already in use by default, and un-ticks (but does not forbid) in-use ones (US-123)", async () => {
    // Given:
    const free = aPacingDraftLineItemV1({ lineItemId: "1", description: "Free line item" });
    const taken = aPacingDraftLineItemV1({ lineItemId: "2", description: "Taken line item" });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({
        lineItems: [free, taken],
        inUse: { "2": { pacingId: "p9", pacingName: "Other Pacing", status: "Live" } },
      })
    );
    renderPanel();
    await screen.findByText("Free line item");

    // Then: the free one is ticked, the taken one is marked and un-ticked - but its checkbox is not
    // disabled, so it can still be included
    const freeCheckbox = screen.getByRole("button", { name: "Include line item 1" });
    const takenCheckbox = screen.getByRole("button", { name: "Include line item 2" });
    expect(freeCheckbox).toHaveAttribute("aria-pressed", "true");
    expect(takenCheckbox).toHaveAttribute("aria-pressed", "false");
    expect(takenCheckbox).not.toBeDisabled();
    expect(screen.getByText('In "Other Pacing"')).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 line items included")).toBeInTheDocument();

    // When: the taken one is ticked anyway
    await userEvent.click(takenCheckbox);

    // Then:
    expect(screen.getByText("2 of 2 line items included")).toBeInTheDocument();
  });

  it("disables Create Pacing until at least one line item is included (US-123)", async () => {
    // Given: a single line item, already in use so it starts un-ticked
    const li = aPacingDraftLineItemV1({ lineItemId: "1" });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({
        lineItems: [li],
        inUse: { "1": { pacingId: "p9", pacingName: "Other", status: "Live" } },
      })
    );
    renderPanel();
    await screen.findByText("1");
    const submit = screen.getByRole("button", { name: "Create Pacing" });
    expect(submit).toBeDisabled();

    // When: included
    await userEvent.click(screen.getByRole("button", { name: "Include line item 1" }));

    // Then:
    expect(submit).toBeEnabled();
  });

  it("pre-fills plan values with an Auto badge, and drops the badge once the user edits that field (US-124)", async () => {
    // Given: planned_units (NetSuite reference) pre-fills target impressions - two different fields
    const li = aPacingDraftLineItemV1({
      lineItemId: "1",
      plannedUnits: 1432875,
      targetImpressions: 1432875,
      marginPercent: 15.5,
    });
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [li] }));
    renderPanel();
    await screen.findByText("1");

    const impressionsInput = screen.getByLabelText("Target impressions for line item 1");
    const marginInput = screen.getByLabelText("Target margin for line item 1");

    // Then: both pre-filled fields carry the Auto badge, and the NetSuite reference figure is shown
    // alongside the editable one rather than merged into it
    expect(impressionsInput).toHaveValue("1,432,875");
    expect(screen.getByText("NetSuite MP units: 1,432,875")).toBeInTheDocument();
    const impressionsCell = impressionsInput.closest("td") as HTMLElement;
    const marginCell = marginInput.closest("td") as HTMLElement;
    expect(within(impressionsCell).getByText("Auto")).toBeInTheDocument();
    expect(within(marginCell).getByText("Auto")).toBeInTheDocument();

    // When: the user edits the impressions field
    await userEvent.clear(impressionsInput);
    await userEvent.type(impressionsInput, "2000000");

    // Then: only that field's badge disappears - margin's stays, since it was not touched
    expect(within(impressionsCell).queryByText("Auto")).not.toBeInTheDocument();
    expect(within(marginCell).getByText("Auto")).toBeInTheDocument();
  });

  it("disables and un-ticks a line item missing flight dates, marking it distinctly", async () => {
    // Given:
    const li = aPacingDraftLineItemV1({ lineItemId: "1", flightStart: undefined, flightEnd: undefined });
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [li] }));
    renderPanel();
    await screen.findByText("1");

    // Then:
    expect(screen.getByRole("button", { name: "Include line item 1" })).toBeDisabled();
    expect(screen.getByText("Missing flight dates")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 line item included")).toBeInTheDocument();
  });

  it("submits exactly the included line items with their edited values, verbatim (US-123/124)", async () => {
    // Given: two line items, only one included, with an edited budget
    const li1 = aPacingDraftLineItemV1({
      lineItemId: "1", nativeBudget: 20633.4, targetImpressions: 1432875, orderNumber: "TM-1",
    });
    const li2 = aPacingDraftLineItemV1({ lineItemId: "2", orderNumber: "TM-1" });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({ campaign: "2026_Campaign", lineItems: [li1, li2] })
    );
    vi.mocked(createPacing).mockResolvedValue(aPacingCreateResultV1({ pacingId: "new-p1" }));
    const { onCreated } = renderPanel();
    await screen.findByText("1");

    // When: excluding the second line item and editing the first's budget
    await userEvent.click(screen.getByRole("button", { name: "Include line item 2" }));
    const budgetInput = screen.getByLabelText("Budget for line item 1");
    await userEvent.clear(budgetInput);
    await userEvent.type(budgetInput, "25000");
    await userEvent.click(screen.getByRole("button", { name: "Create Pacing" }));

    // Then: only the included line item is submitted, with the edited budget and the untouched
    // pre-filled impressions carried through UNCHANGED - nothing here was recomputed
    expect(createPacing).toHaveBeenCalledTimes(1);
    const body = vi.mocked(createPacing).mock.calls[0][0] as PacingCreateV1;
    expect(body.pacingName).toBe("2026_Campaign");
    expect(body.lineItems).toHaveLength(1);
    expect(body.lineItems[0].lineItemId).toBe("1");
    expect(body.lineItems[0].nativeBudget).toBe(25000);
    expect(body.lineItems[0].targetImpressions).toBe(1432875);
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-p1"));
  });

  it("shows validated/IO/ready-need-excluded counts in the result header (§8 counts)", async () => {
    // Given: one fully auto-filled (ready) line item, one missing a required value (needs input), and
    // one missing flight dates (starts un-selected, i.e. excluded)
    const ready = aPacingDraftLineItemV1({ lineItemId: "1" });
    // Impressions, not margin: margin falls back to 25% like the SPA's, so an absent
    // one no longer leaves a row incomplete. Impressions have no fallback - NetSuite's
    // planned_units or nothing - which is what "needs input" is actually about.
    const needsInput = aPacingDraftLineItemV1({ lineItemId: "2", targetImpressions: undefined });
    const excluded = aPacingDraftLineItemV1({ lineItemId: "3", flightStart: undefined, flightEnd: undefined });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({
        lineItems: [ready, needsInput, excluded],
        orderNumber: "TM-271064",
        orderNumbers: ["TM-271064", "TM-2", "TM-3"],
      })
    );
    renderPanel();

    // Then:
    expect(await screen.findByText("3 line items validated")).toBeInTheDocument();
    expect(screen.getByText("IO TM-271064 (+2)")).toBeInTheDocument();
    expect(screen.getByText("1 ready")).toBeInTheDocument();
    expect(screen.getByText("1 need input")).toBeInTheDocument();
    expect(screen.getByText("1 excluded")).toBeInTheDocument();
  });

  it("bulk-sets a field across every bulk-selected line item, tolerating a pasted-style value (§8 bulk edit)", async () => {
    // Given: two line items, neither with a VCR yet. Both are included by default (PDI-131 fix: that
    // default no longer doubles as bulk-selection), so the bulk-set toolbar only appears, and only
    // targets these rows, once they are explicitly ticked for bulk edit.
    const li1 = aPacingDraftLineItemV1({ lineItemId: "1", targetVcr: undefined });
    const li2 = aPacingDraftLineItemV1({ lineItemId: "2", targetVcr: undefined });
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [li1, li2] }));
    renderPanel();
    await screen.findByText("1");
    expect(screen.queryByLabelText("Bulk-set field")).not.toBeInTheDocument();

    // When: ticking both rows for bulk edit, then bulk-setting VCR to "70%" (coerceValue must strip
    // the % sign) across both
    await userEvent.click(screen.getByRole("checkbox", { name: "Select line item 1 for bulk edit" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select line item 2 for bulk edit" }));
    expect(screen.getByText("2 selected →")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Bulk-set field"), "targetVcr");
    await userEvent.type(screen.getByLabelText("Bulk-set value"), "70%");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: both rows got the coerced value, not the raw typed string
    expect(screen.getByLabelText("Target VCR for line item 1")).toHaveValue("70");
    expect(screen.getByLabelText("Target VCR for line item 2")).toHaveValue("70");
  });

  it("rejects an unparseable bulk-set value without touching any row", async () => {
    // Given:
    const li = aPacingDraftLineItemV1({ lineItemId: "1", targetVcr: undefined });
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [li] }));
    renderPanel();
    await screen.findByText("1");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select line item 1 for bulk edit" }));

    // When:
    await userEvent.selectOptions(screen.getByLabelText("Bulk-set field"), "targetVcr");
    await userEvent.type(screen.getByLabelText("Bulk-set value"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then:
    expect(screen.getByText("not a number")).toBeInTheDocument();
    // Untouched means untouched: the row keeps the "0" prefill gave it, not "".
    expect(screen.getByLabelText("Target VCR for line item 1")).toHaveValue("0");
  });

  it("filters the table to rows missing a value, and back to all rows (§8 gap filter)", async () => {
    // Given:
    // Prefill gives every row a VCR - the reference tables refine it, they are not its
    // only source, so an absent one falls back to "0" exactly as the SPA does
    // (CreatePacing.jsx:499). A row is therefore "missing VCR" only once somebody has
    // CLEARED it, which is what this filter is for: finding what an edit emptied.
    const cleared = aPacingDraftLineItemV1({ lineItemId: "1", targetVcr: undefined, description: "Missing VCR row" });
    const has = aPacingDraftLineItemV1({ lineItemId: "2", targetVcr: 0.7, description: "Has VCR row" });
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [cleared, has] }));
    renderPanel();
    await screen.findByText("Missing VCR row");
    expect(screen.getByText("Has VCR row")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Target VCR for line item 1"));

    // When: filtering to "Missing VCR"
    await userEvent.selectOptions(screen.getByLabelText("Filter rows"), "vcr");

    // Then: only the row missing VCR remains visible
    expect(screen.getByText("Missing VCR row")).toBeInTheDocument();
    expect(screen.queryByText("Has VCR row")).not.toBeInTheDocument();

    // When: back to all rows
    await userEvent.selectOptions(screen.getByLabelText("Filter rows"), "all");

    // Then:
    expect(screen.getByText("Has VCR row")).toBeInTheDocument();
  });

  it("selects/deselects only the visible, included rows for bulk edit, leaving a selection outside the filter alone (§8 select-all-visible)", async () => {
    // Given: three line items - one already selected for bulk edit outside any filter, one missing
    // VCR (excluded from the pacing so it can't be bulk-edited either), and two missing VCR that are
    // free to be selected
    // The gap is IMPRESSIONS, not VCR: VCR prefills to "0" (see initialRowValues), so a
    // row is never short of one straight out of validate. Impressions have no fallback.
    const preselected = aPacingDraftLineItemV1({ lineItemId: "1" });
    const notIncluded = aPacingDraftLineItemV1({
      lineItemId: "2", targetImpressions: undefined, flightStart: undefined, flightEnd: undefined,
    });
    const gapA = aPacingDraftLineItemV1({ lineItemId: "3", targetImpressions: undefined });
    const gapB = aPacingDraftLineItemV1({ lineItemId: "4", targetImpressions: undefined });
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({ lineItems: [preselected, notIncluded, gapA, gapB] })
    );
    renderPanel();
    await screen.findByText("1");

    // A selection made before any filter is picked
    await userEvent.click(screen.getByRole("checkbox", { name: "Select line item 1 for bulk edit" }));

    // When: filtering to "Missing required" (rows 2, 3, 4 - but 2 is not included) and ticking
    // "select all visible"
    await userEvent.selectOptions(screen.getByLabelText("Filter rows"), "required");
    const selectAll = screen.getByRole("checkbox", { name: "Select all visible line items for bulk edit" });
    await userEvent.click(selectAll);

    // Then: the two included+visible rows are now selected, the not-included one never gets a bulk
    // checkbox to click (disabled), and row 1's earlier selection (outside this filter) is untouched
    expect(screen.getByRole("checkbox", { name: "Select line item 3 for bulk edit" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select line item 4 for bulk edit" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select line item 2 for bulk edit" })).toBeDisabled();
    expect(screen.getByText("3 selected →")).toBeInTheDocument();

    // When: clicking "select all visible" again
    await userEvent.click(selectAll);

    // Then: only the two visible rows are cleared - row 1's selection (made outside this filter)
    // survives
    expect(screen.getByRole("checkbox", { name: "Select line item 3 for bulk edit" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select line item 4 for bulk edit" })).not.toBeChecked();
    expect(screen.getByText("1 selected →")).toBeInTheDocument();
  });

  it("applies a pasted spreadsheet table to the matching line items by id (§8 paste from sheet)", async () => {
    // Given:
    const li = aPacingDraftLineItemV1({ lineItemId: "123", targetImpressions: undefined });
    vi.mocked(getPacingDraft).mockResolvedValue(aPacingDraftV1({ lineItems: [li] }));
    renderPanel();
    await screen.findByText("123");

    // When: pasting a two-column table (LI ID + Margin %) copied from a spreadsheet
    await userEvent.click(screen.getByRole("button", { name: "Paste from sheet" }));
    const textarea = screen.getByPlaceholderText(/LI ID/);
    fireEvent.change(textarea, { target: { value: "LI ID\tMargin %\n123\t22" } });
    await screen.findByText(/1 value matched/);
    await userEvent.click(screen.getByRole("button", { name: "Apply paste" }));

    // Then:
    expect(screen.getByLabelText("Target margin for line item 123")).toHaveValue("22");
  });

  it("shows an error and no review table when Pacing will not let the campaign be paced as-is", async () => {
    // Given: e.g. mixed currencies across the campaign's line items - a normal 200 outcome, not a
    // thrown request failure
    vi.mocked(getPacingDraft).mockResolvedValue(
      aPacingDraftV1({ ok: false, error: "Mixed currencies across line items (CAD, EUR).", lineItems: [] })
    );
    renderPanel();

    // Then:
    expect(await screen.findByText("Mixed currencies across line items (CAD, EUR).")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Pacing" })).not.toBeInTheDocument();
  });
});
