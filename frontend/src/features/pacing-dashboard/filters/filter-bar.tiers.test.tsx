import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterBar } from "./filter-bar";
import { DEFAULT_FILTERS } from "./types";
import type { PacingLineItemPlanV1 } from "../types";
import type { FactRow } from "../journal/fact-dims";

/** The applied filters in two outlined boxes, as the reference's `TierBox`: SCOPE (solid chips,
 *  the range last) then LENS (outline chips), with the cut's tier from the board's own answer. */
const LI_PLAN = {
  "100": {
    channel: "Video",
    labels: [],
    containers: [{ target_impressions: 1000, dim_children: [{ dim_key: "geo", dim_value: "TX", target_mode: "absolute", target_value: 400 }] }],
  },
} as unknown as Record<string, PacingLineItemPlanV1>;
const FACTS: FactRow[] = [{ line_item_id: "100", platform: "TTD", geo: "TX" }];
const FILTERS = { ...DEFAULT_FILTERS, channels: ["Video"], platforms: ["TTD"], brkf: ["geo:TX"], range: "7" };

const boxes = () => [...document.querySelectorAll<HTMLElement>(".fb-tier")];
const chipsIn = (box: HTMLElement) => [...box.querySelectorAll(".fb-chip")].map((c) => c.firstElementChild?.textContent);

describe("FilterBar - Scope and Lens boxes", () => {
  it("puts plan-backed filters in SCOPE, the range last, and delivery-only ones in LENS", () => {
    render(<FilterBar filters={FILTERS} setFilters={vi.fn()} liPlan={LI_PLAN} factsDaily={FACTS} scopeFilters={{ brkf: ["geo:TX"] }} />);
    const [scope, lens] = boxes();

    expect(within(scope).getByText("scope")).toHaveAttribute("data-tip", expect.stringContaining("paces the dashboard"));
    expect(chipsIn(scope)).toEqual(["Video", "geo: TX", "7d"]);
    expect(chipsIn(lens)).toEqual(["The Trade Desk"]);
    expect(lens.querySelector(".fb-chip")).toHaveClass("fb-chip--lens");
  });

  it("a cut the period has no plan for reads as Lens", () => {
    render(<FilterBar filters={FILTERS} setFilters={vi.fn()} liPlan={LI_PLAN} factsDaily={FACTS} scopeFilters={{ brkf: [] }} />);
    const [, lens] = boxes();

    expect(chipsIn(lens)).toEqual(["The Trade Desk", "geo: TX"]);
  });

  it("a chip's × removes through the same path as before", () => {
    const setFilters = vi.fn();
    render(<FilterBar filters={FILTERS} setFilters={setFilters} liPlan={LI_PLAN} factsDaily={FACTS} scopeFilters={{ brkf: ["geo:TX"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove The Trade Desk filter" }));

    expect(setFilters).toHaveBeenCalledWith({ platforms: [] });
  });
});
