import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Spotlight } from "./spotlight";
import { DEFAULT_FILTERS } from "./types";
import type { PacingLineItemPlanV1 } from "../types";
import type { FactRow } from "../journal/fact-dims";

const LI_PLAN = {
  "100": { channel: "Video", labels: ["priority"], description: "Hero video" },
  "200": { channel: "Display", labels: [] },
} as unknown as Record<string, PacingLineItemPlanV1>;

const FACTS: FactRow[] = [{ platform: "TTD", tactic: "Prospecting" }];

function renderSpotlight(onApply = vi.fn()) {
  render(<Spotlight filters={DEFAULT_FILTERS} onApply={onApply} liPlan={LI_PLAN} factsDaily={FACTS} />);
  return { onApply };
}

describe("Spotlight", () => {
  it("shows nothing until focused", () => {
    renderSpotlight();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("browse mode on focus with an empty query: two sections, sub-grouped by kind", async () => {
    renderSpotlight();
    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("SCOPE · paces the dashboard")).toBeInTheDocument();
    expect(screen.getByText("LENS · breakdown only")).toBeInTheDocument();
    // "Line item"/"Channel"/"Platform" each appear twice: once as the group header, once more as
    // the per-row kind tag - both are real, so this asserts the group header specifically.
    expect(document.querySelector(".spot__group")).toHaveTextContent("Line item");
    expect(screen.getByText("100 — Hero video")).toBeInTheDocument();
    expect(screen.getAllByText("Channel").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Platform").length).toBeGreaterThan(0);
  });

  it("typing switches to a flat fuzzy search and tags each row with its tier", async () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "hero");

    expect(screen.queryByText("SCOPE · paces the dashboard")).not.toBeInTheDocument();
    expect(screen.getByText("100 — Hero video")).toBeInTheDocument();
    expect(screen.getByText("SCOPE")).toBeInTheDocument(); // the tier tag shown only while typing
  });

  it("clicking a result applies the matching patch and clears the query", async () => {
    const { onApply } = renderSpotlight();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "Video");
    await userEvent.click(screen.getByText("Video"));

    expect(onApply).toHaveBeenCalledWith({ channels: ["Video"], selection: [] });
    expect(input).toHaveValue("");
  });

  it("Enter picks the active row", async () => {
    const { onApply } = renderSpotlight();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "Video");
    await userEvent.keyboard("{Enter}");

    expect(onApply).toHaveBeenCalledWith({ channels: ["Video"], selection: [] });
  });

  it("Escape clears the query", async () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "Video");
    expect(input).toHaveValue("Video");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });

  it("ArrowDown/ArrowUp traverse SELECTABLE rows only, skipping section/group headers", async () => {
    renderSpotlight();
    const input = screen.getByRole("combobox");
    await userEvent.click(input);

    // First browse option is the LI row; ArrowDown must land on the NEXT selectable option
    // (there is only one LI, so the next Line item... actually the next kind is Channel) rather
    // than a "SCOPE"/"Line item" header row - option ids are sequential (`spot-opt-0`, `-1`, ...)
    // regardless of how many header rows sit between them.
    const firstOption = document.getElementById("spot-opt-0");
    expect(firstOption).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowDown}");
    const secondOption = document.getElementById("spot-opt-1");
    expect(secondOption).toHaveAttribute("aria-selected", "true");
    expect(firstOption).toHaveAttribute("aria-selected", "false");

    await userEvent.keyboard("{ArrowUp}");
    expect(document.getElementById("spot-opt-0")).toHaveAttribute("aria-selected", "true");
  });

  it("closes on an outside click", async () => {
    render(
      <div>
        <Spotlight filters={DEFAULT_FILTERS} onApply={vi.fn()} liPlan={LI_PLAN} factsDaily={FACTS} />
        <button type="button">outside</button>
      </div>
    );
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("a dim value backed by a declared split is still tagged LENS, not SCOPE (2026-09-25 item 4 - this build has no dim-scope.js to back a Scope claim up)", async () => {
    const splitLiPlan = {
      "100": {
        channel: "Video",
        labels: [],
        containers: [
          {
            target_impressions: 1000,
            dim_children: [{ dim_key: "geo", dim_value: "TX", target_mode: "absolute", target_value: 400 }],
          },
        ],
      },
    } as unknown as Record<string, PacingLineItemPlanV1>;
    render(
      <Spotlight
        filters={DEFAULT_FILTERS}
        onApply={vi.fn()}
        liPlan={splitLiPlan}
        factsDaily={[{ platform: "TTD", geo: "TX" }]}
      />
    );
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.type(input, "TX");

    // No more "· split" marker (that claimed the value paces the dashboard, which it does not
    // here) - the row shows the LENS tier tag instead.
    expect(screen.queryByText("· split")).not.toBeInTheDocument();
    expect(screen.getByText("LENS")).toBeInTheDocument();
  });
});
