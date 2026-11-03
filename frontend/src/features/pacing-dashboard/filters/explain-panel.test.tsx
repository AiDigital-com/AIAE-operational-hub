import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterBar } from "./filter-bar";
import { placeExplainPanel } from "./explain-panel";
import { DEFAULT_FILTERS } from "./types";
import type { PacingLineItemPlanV1 } from "../types";
import type { FactRow } from "../journal/fact-dims";

describe("placeExplainPanel", () => {
  const panel = { width: 300, height: 60 };
  const viewport = { width: 1200, height: 800 };

  it("goes to the right of its anchor when there is room", () => {
    expect(placeExplainPanel({ left: 100, right: 200, top: 50, bottom: 70 }, panel, viewport)).toEqual({ left: 208, top: 50 });
  });

  it("goes below, then above, when the right side is full", () => {
    expect(placeExplainPanel({ left: 1000, right: 1100, top: 50, bottom: 70 }, panel, viewport)).toEqual({ left: 892, top: 78 });
    expect(placeExplainPanel({ left: 1000, right: 1100, top: 760, bottom: 780 }, panel, viewport)).toEqual({ left: 892, top: 692 });
  });
});

/** Line 100 reads two keywords as `Brand KW` - the reported case. */
const LI_PLAN = {
  "100": { channel: "Search", labels: [], dimGroups: [{ dim_key: "keyword", name: "Brand KW", values: ["kw_a", "kw_b"] }] },
} as unknown as Record<string, PacingLineItemPlanV1>;
const FACTS: FactRow[] = [{ line_item_id: "100", date: "2026-08-05", keyword: "Brand KW" }];

describe("FilterBar - the explanation panel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a spotlight row rested on says what a value group stands for", () => {
    render(<FilterBar filters={DEFAULT_FILTERS} setFilters={vi.fn()} liPlan={LI_PLAN} factsDaily={FACTS} />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseEnter(screen.getByText("Brand KW"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(); // not before the rest delay

    act(() => vi.advanceTimersByTime(300));

    const panel = screen.getByRole("tooltip");
    expect(panel).toHaveTextContent("1 line has delivery here");
    expect(panel).toHaveTextContent("Brand KW = kw_a, kw_b on LI 100");
  });

  it("an applied chip explains itself on hover and takes the panel down on leave", () => {
    const filters = { ...DEFAULT_FILTERS, brk: "keyword", brkf: ["keyword:Brand KW"] };
    render(<FilterBar filters={filters} setFilters={vi.fn()} liPlan={LI_PLAN} factsDaily={FACTS} />);
    const chip = screen.getByText("keyword: Brand KW").closest(".fb-chip")!;

    fireEvent.mouseEnter(chip);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Brand KW = kw_a, kw_b on LI 100");

    fireEvent.mouseLeave(chip);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("the chip's × explains it on focus", () => {
    const filters = { ...DEFAULT_FILTERS, platforms: ["TTD"] };
    render(<FilterBar filters={filters} setFilters={vi.fn()} liPlan={LI_PLAN} factsDaily={[{ line_item_id: "100", platform: "TTD" }]} />);

    fireEvent.focus(screen.getByRole("button", { name: /Remove .* filter/ }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("1 line has delivery here");
  });
});
