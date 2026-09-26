import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingJournalEntryV1, aPacingLineItemPlanV1 } from "@/test/factories";
import { JournalPanel } from "./journal-panel";
import type { DashboardFiltersPatch } from "../filters/use-url-filters";
import type { PacingJournalEntryV1 } from "../types";
import type { PacingLineItemPlanV1 } from "../../pacing-plan/types";

vi.mock("../api", () => ({
  addPacingJournalEntry: vi.fn(),
  updatePacingJournalEntry: vi.fn(),
  deletePacingJournalEntry: vi.fn(),
}));

/**
 * §15/STEP 8 - clicking a journal entry routes its tags into the dashboard filters and sets the
 * range to +/-7 days around the entry's own date, alongside the existing chart-highlight
 * behaviour. See `journal-panel.tsx`'s `handleEntryClick`, ported from the reference SPA's
 * `JournalPanel.jsx:handleEntryClick`.
 */
describe("JournalPanel row click -> filter routing", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderPanel(journal: PacingJournalEntryV1[], setFilters: (patch: DashboardFiltersPatch) => void) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["pacing", "dashboard", "nike-ss26"], { journal });
    const planByLineItem: Record<string, PacingLineItemPlanV1> = {
      "555": aPacingLineItemPlanV1({ lineItemId: "555", channel: "Video" }),
    };
    const onHighlightDate = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <JournalPanel
          slug="nike-ss26"
          journal={journal}
          planByLineItem={planByLineItem}
          factsDaily={[{ line_item_id: "555", date: "2026-08-05", platform: "TTD", tactic: "retargeting" }]}
          onHighlightDate={onHighlightDate}
          setFilters={setFilters}
        />
      </QueryClientProvider>
    );
    return { onHighlightDate };
  }

  // The message renders as tag badges, not plain text, so a click target is found by role
  // (there is exactly one entry per test here) rather than by message text.
  async function clickEntry() {
    const user = userEvent.setup();
    const row = screen.getByRole("listitem");
    await user.click(row);
  }

  it("routes #LI: to selection, sets the range to +/-7 days around the entry date, and keeps the highlight", async () => {
    const setFilters = vi.fn();
    const { onHighlightDate } = renderPanel(
      [aPacingJournalEntryV1({ id: "e1", ts: "2026-08-05", msg: "Bumped budget #LI:555" })],
      setFilters
    );
    await clickEntry();

    expect(onHighlightDate).toHaveBeenCalledWith("2026-08-05");
    expect(setFilters).toHaveBeenCalledTimes(1);
    const patch = setFilters.mock.calls[0][0];
    expect(patch.selection).toEqual(["555"]);
    expect(patch.range).toBe("custom");
    expect(patch.customRange).toEqual({ from: "2026-07-29", to: "2026-08-12" });
  });

  it("routes #ch:, #dsp:, #label: and breakdown tags (#aud: -> audience) into channels/platforms/labels/brkf", async () => {
    const setFilters = vi.fn();
    renderPanel(
      [
        aPacingJournalEntryV1({
          id: "e2",
          ts: "2026-08-05",
          msg: "#ch:Video #dsp:TTD #label:brand #aud:sports_fans #tactic:retargeting",
        }),
      ],
      setFilters
    );
    await clickEntry();

    const patch = setFilters.mock.calls[0][0];
    expect(patch.channels).toEqual(["Video"]);
    expect(patch.platforms).toEqual(["TTD"]);
    expect(patch.labels).toEqual(["brand"]);
    // Multi-dim brkf: both the #aud: tag (-> 'audience') and #tactic: apply, in encounter order.
    expect(patch.brk).toBe("audience");
    expect(patch.brkf).toEqual(["audience:sports_fans", "tactic:retargeting"]);
  });

  it("does nothing to filters (but still highlights) when setFilters is not provided", async () => {
    const onHighlightDate = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const journal = [aPacingJournalEntryV1({ id: "e3", ts: "2026-08-05", msg: "No tags here" })];
    queryClient.setQueryData(["pacing", "dashboard", "nike-ss26"], { journal });
    render(
      <QueryClientProvider client={queryClient}>
        <JournalPanel slug="nike-ss26" journal={journal} onHighlightDate={onHighlightDate} />
      </QueryClientProvider>
    );
    await clickEntry();
    expect(onHighlightDate).toHaveBeenCalledWith("2026-08-05");
  });
});
