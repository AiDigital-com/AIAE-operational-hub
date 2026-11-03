import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { aPacingJournalEntryV1, aPacingLineItemPlanV1 } from "@/test/factories";
import { JournalPanel } from "./journal-panel";
import type { FactRow } from "./fact-dims";
import type { PacingJournalEntryV1 } from "../types";

vi.mock("../api", () => ({
  addPacingJournalEntry: vi.fn(),
  updatePacingJournalEntry: vi.fn(),
  deletePacingJournalEntry: vi.fn(),
}));

/**
 * Value groups in the journal, as the reference's `JournalPanel.jsx`: tags are offered and routed
 * by what the board shows (the group), while an entry tagged with a value before it joined a group
 * still reads as a known tag.
 */
const RAW: FactRow[] = [
  { line_item_id: "555", date: "2026-08-05", keyword: "kw_a" },
  { line_item_id: "555", date: "2026-08-05", keyword: "kw_b" },
];
const SHOWN: FactRow[] = [
  { line_item_id: "555", date: "2026-08-05", keyword: "Brand KW" },
  { line_item_id: "555", date: "2026-08-05", keyword: "Brand KW" },
];

function renderPanel(journal: PacingJournalEntryV1[], setFilters = vi.fn(), rawFactsDaily: FactRow[] | null = RAW) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <JournalPanel
        slug="nike-ss26"
        journal={journal}
        planByLineItem={{ "555": aPacingLineItemPlanV1({ lineItemId: "555", channel: "Video" }) }}
        factsDaily={SHOWN}
        rawFactsDaily={rawFactsDaily ?? undefined}
        setFilters={setFilters}
      />
    </QueryClientProvider>
  );
  return setFilters;
}

// The entry row's own badge - the tag pills above the list carry the same text.
const badgeOf = (value: string) => within(screen.getByRole("listitem")).getByText(value).closest(".jtag-badge");

describe("JournalPanel - value groups", () => {
  it("routes a group's tag to a filter on the group's name", async () => {
    const setFilters = renderPanel([aPacingJournalEntryV1({ id: "e1", ts: "2026-08-05", msg: "#keyword:Brand_KW" })]);
    await userEvent.setup().click(screen.getByRole("listitem"));

    expect(setFilters.mock.calls[0][0].brkf).toEqual(["keyword:Brand KW"]);
  });

  it("still knows a tag written on a member before it joined the group", () => {
    renderPanel([aPacingJournalEntryV1({ id: "e2", ts: "2026-08-05", msg: "#keyword:kw_a" })]);

    expect(badgeOf("kw_a")).not.toHaveClass("jtag-badge--unknown");
  });

  it("does not know a member when only the grouped rows are given", () => {
    renderPanel([aPacingJournalEntryV1({ id: "e3", ts: "2026-08-05", msg: "#keyword:kw_a" })], vi.fn(), null);

    expect(badgeOf("kw_a")).toHaveClass("jtag-badge--unknown");
  });
});
