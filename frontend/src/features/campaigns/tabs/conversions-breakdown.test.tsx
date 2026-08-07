import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyConversionAdjustments, listConversionBreakdown } from "../api";
import { ConversionsBreakdown, type ConversionBreakdownTarget } from "./conversions-breakdown";

vi.mock("../api", () => ({
  listConversionBreakdown: vi.fn(),
  applyConversionAdjustments: vi.fn(),
}));

const TARGET: ConversionBreakdownTarget = {
  date: "2026-04-23",
  levelOneName: "barr_SCOT_Fall Campaign_Display",
  levelThreeName: "RON-Competitive Conquesting",
  channel: "Display",
  reported: 5,
};

function aRow(action: string, conversions: number) {
  return {
    date: "2026-04-23",
    lineItemId: "LI-1",
    insertionOrderId: "IO-1",
    creativeId: `CR-${action}`,
    conversionAction: action,
    conversionCategory: "not set",
    lineItemName: "barr_SCOT_Fall Campaign_Display",
    creativeName: "RON-Competitive Conquesting",
    platform: "dv_360_dlv",
    conversions,
  };
}

/**
 * Renders the panel for a cell reporting `reported` conversions. It defaults to whatever the test's
 * rows add up to, because a panel whose rows do not add up to its cell is a case of its own - see the
 * reconciliation tests below - and every other test would otherwise be testing that one by accident.
 */
function renderBreakdown(
  reported: number | null = 5,
  onSaved = vi.fn(),
  onClose = vi.fn(),
  targetOverrides: Partial<ConversionBreakdownTarget> = {}
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ConversionsBreakdown
        campaignId={42}
        target={{ ...TARGET, reported, ...targetOverrides }}
        onClose={onClose}
        onSaved={onSaved}
      />
    </QueryClientProvider>
  );
  return { onSaved, onClose };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("ConversionsBreakdown", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should show a spinner while the breakdown loads", () => {
    // Given: a read that has not answered yet
    vi.mocked(listConversionBreakdown).mockReturnValue(new Promise(() => {}));

    // When:
    renderBreakdown();

    // Then:
    expect(screen.getByLabelText("Loading conversions")).toBeInTheDocument();
  });

  it("should render as a dialog and close from the footer action", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });
    const { onClose } = renderBreakdown(4);

    // When:
    expect(await screen.findByRole("dialog", { name: "Conversions by action" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Then:
    expect(onClose).toHaveBeenCalled();
  });

  it("should warn before an outside click discards unsaved edits", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });
    const { onClose } = renderBreakdown(4);
    const input = await screen.findByLabelText("Conversions for All Pages");
    await userEvent.clear(input);
    await userEvent.type(input, "10");

    // When:
    await userEvent.click(document.querySelector(".modal__overlay") as HTMLElement);

    // Then:
    expect(screen.getByRole("dialog", { name: "Discard unsaved conversion edits?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    // Then:
    expect(screen.getByRole("dialog", { name: "Conversions by action" })).toBeInTheDocument();
    expect(screen.getByLabelText("Conversions for All Pages")).toHaveValue(10);
  });

  it("should discard unsaved edits after confirmation", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });
    const { onClose } = renderBreakdown(4);
    const input = await screen.findByLabelText("Conversions for All Pages");
    await userEvent.clear(input);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    // Then:
    expect(onClose).toHaveBeenCalled();
  });

  it("should surface a failed read instead of an empty panel", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockRejectedValue(new Error("BigQuery said no"));

    // When:
    renderBreakdown();

    // Then: an empty list would read as "this row has no conversions", which is a different fact
    expect(await screen.findByText("BigQuery said no")).toBeInTheDocument();
  });

  it("should explain an empty breakdown rather than offering an edit", async () => {
    // Given: a row the conversions mart reports nothing for, under a cell that reports nothing either
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [] });

    // When:
    renderBreakdown(0);

    // Then: a figure can only be adjusted where one is reported - there is no action to attach it to
    expect(await screen.findByText(/No conversions are attached to this row/)).toBeInTheDocument();
  });

  it("should total the actions and follow the edits", async () => {
    // Given: two actions summing to the 5 the report shows
    vi.mocked(listConversionBreakdown).mockResolvedValue({
      rows: [aRow("All Pages", 4), aRow("Purchase", 1)],
    });
    renderBreakdown();
    expect(await screen.findByText("5")).toBeInTheDocument();

    // When: one action is raised
    const input = screen.getByLabelText("Conversions for All Pages");
    await userEvent.clear(input);
    await userEvent.type(input, "10");

    // Then: the total is what the cell will read once saved - the whole reason for editing here
    await waitFor(() => expect(screen.getByText("11")).toBeInTheDocument());
    expect(screen.getByText("1 row changed")).toBeInTheDocument();
  });

  it("should send only the rows whose figure actually changed", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({
      rows: [aRow("All Pages", 4), aRow("Purchase", 1)],
    });
    vi.mocked(applyConversionAdjustments).mockResolvedValue({ applied: 1 });
    const { onSaved, onClose } = renderBreakdown(5);
    await screen.findByLabelText("Conversions for All Pages");

    // When:
    const input = screen.getByLabelText("Conversions for All Pages");
    await userEvent.clear(input);
    await userEvent.type(input, "10");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: the untouched action is not rewritten, and identity travels as it was read
    await waitFor(() => expect(applyConversionAdjustments).toHaveBeenCalledTimes(1));
    expect(applyConversionAdjustments).toHaveBeenCalledWith(42, {
      rows: [{
        date: "2026-04-23",
        lineItemId: "LI-1",
        insertionOrderId: "IO-1",
        creativeId: "CR-All Pages",
        conversionAction: "All Pages",
        conversionCategory: "not set",
        conversions: 10,
      }],
    });
    expect(onSaved).toHaveBeenCalledWith(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("should disable conversion editing while saving", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });
    const pending = deferred<{ applied: number }>();
    vi.mocked(applyConversionAdjustments).mockReturnValue(pending.promise);
    const { onClose } = renderBreakdown(4);
    const input = await screen.findByLabelText("Conversions for All Pages");
    await userEvent.clear(input);
    await userEvent.type(input, "10");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then:
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(input).toBeDisabled();

    // And: outside-click close is ignored until the save settles.
    await userEvent.click(document.querySelector(".modal__overlay") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    pending.resolve({ applied: 1 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("should refuse to save a figure that is not a number", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });
    renderBreakdown(4);
    const input = await screen.findByLabelText("Conversions for All Pages");

    // When: the cell is emptied
    await userEvent.clear(input);

    // Then: blocked with a reason, rather than sent as a zero nobody asked for
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/has to be a number/)).toBeInTheDocument();
    expect(applyConversionAdjustments).not.toHaveBeenCalled();
  });

  it("should explain that Save is disabled until a value changes", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });

    // When:
    renderBreakdown(4);

    // Then:
    expect(await screen.findByText("Change at least one value to save.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("should show rows that do not add up to the cell without offering to edit them", async () => {
    // Given: the campaign-level case - the report attached this cell's conversions without matching
    // level 3, so matching on it here finds a different, smaller set
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });
    renderBreakdown(31);

    // Then: both figures are named, so the user can see the panel is looking at a different cut.
    expect(await screen.findByText(/add up to 4/)).toBeInTheDocument();
    expect(screen.getByText(/report shows 31/)).toBeInTheDocument();
    expect(screen.getByText(/grouped coarser than conversions are stored/)).toBeInTheDocument();
    expect(screen.queryByText("Channel")).not.toBeInTheDocument();

    // And nothing here can be written: an edit would replace rows the cell is not made of
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Conversions for All Pages")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("4")).toBeInTheDocument();
  });

  it("should name missing row identity dimensions without asking for dimensions already present", async () => {
    // Given: a report grouped by constructed ids and channel but not by the constructed names the
    // conversion breakdown endpoint needs to read the same row grain.
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 0)] });
    renderBreakdown(4, vi.fn(), vi.fn(), {
      levelOneName: "",
      levelThreeName: undefined,
      channel: "Display",
    });

    // Then: the remedy points at the missing name columns, not at Channel which the row already has.
    expect(await screen.findByText(/add up to 0/)).toBeInTheDocument();
    expect(screen.getByText("Constructed name L1, Constructed name L3")).toBeInTheDocument();
    expect(screen.queryByText("Channel")).not.toBeInTheDocument();
  });

  it("should disable editing when the report grouping is above the conversion grain", async () => {
    // Given: the row still carries enough values to open the breakdown, but the report config says it is
    // grouped above the conversion grain, so editing from this row would imply a narrower key than the
    // report actually shows.
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 7)] });
    renderBreakdown(7, vi.fn(), vi.fn(), {
      missingDimensions: ["Constructed name L1", "Constructed name L3"],
    });

    // Then: the message tells the user exactly why editing is disabled and how to unblock it.
    expect(await screen.findByText(/Editing is disabled/)).toBeInTheDocument();
    expect(screen.getByText("Constructed name L1, Constructed name L3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Conversions for All Pages")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("should not call a rounding difference a mismatch", async () => {
    // Given: the same conversions, summed in a different order than BigQuery summed them
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 0.1), aRow("Purchase", 0.2)] });

    // When: the report's own figure for the cell
    renderBreakdown(0.3);

    // Then: 0.1 + 0.2 is not 0.3 in a double, and refusing the edit over that would be absurd
    expect(await screen.findByLabelText("Conversions for All Pages")).toBeInTheDocument();
    expect(screen.queryByText(/report shows/)).not.toBeInTheDocument();
  });

  it("should edit a fractional figure like any other", async () => {
    // Given: a stored figure with a fraction in it. Not a curiosity - the mart holds ~79k of them,
    // because platforms that split credit across touchpoints write a share of a conversion rather than
    // a whole one. Treating a conversion as a countable action and refusing these would shut the panel
    // on real rows.
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 2.5)] });
    vi.mocked(applyConversionAdjustments).mockResolvedValue({ applied: 1 });
    renderBreakdown(2.5);
    const input = await screen.findByLabelText("Conversions for All Pages");

    // When:
    await userEvent.clear(input);
    await userEvent.type(input, "3.5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: the fraction travels as typed, neither rejected nor rounded on its way out
    await waitFor(() => expect(applyConversionAdjustments).toHaveBeenCalledTimes(1));
    expect(vi.mocked(applyConversionAdjustments).mock.calls[0][1].rows[0].conversions).toBe(3.5);
  });

  it("should keep the panel open and show why a save failed", async () => {
    // Given:
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [aRow("All Pages", 4)] });
    vi.mocked(applyConversionAdjustments).mockRejectedValue(new Error("permission denied"));
    const { onClose } = renderBreakdown(4);
    const input = await screen.findByLabelText("Conversions for All Pages");

    // When:
    await userEvent.clear(input);
    await userEvent.type(input, "10");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: closing on failure would lose the edit and imply it landed
    expect(await screen.findByText("permission denied")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
