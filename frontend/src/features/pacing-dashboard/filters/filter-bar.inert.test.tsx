import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterBar } from "./filter-bar";
import { DEFAULT_FILTERS } from "./types";

/** Layout mode dims the bar on the bar itself. It used to be a wrapping <div>, and that wrapper
 *  became the sticky bar's containing block: the bar stopped staying on screen when scrolling. */
describe("FilterBar - inert (Layout mode)", () => {
  it("renders the sentinel and the bar as siblings, with no wrapper of its own", () => {
    const { container } = render(<FilterBar filters={DEFAULT_FILTERS} setFilters={vi.fn()} liPlan={{}} factsDaily={[]} />);

    expect([...container.children].map((n) => n.className)).toEqual(["fb__sentinel", "fb"]);
  });

  it("marks the bar itself inert and not sticky while Layout mode is open", () => {
    const { container } = render(<FilterBar inert filters={DEFAULT_FILTERS} setFilters={vi.fn()} liPlan={{}} factsDaily={[]} />);
    const bar = container.querySelector(".fb")!;

    expect(bar).toHaveClass("fb--inert");
    expect(bar).toHaveAttribute("inert");
  });
});
