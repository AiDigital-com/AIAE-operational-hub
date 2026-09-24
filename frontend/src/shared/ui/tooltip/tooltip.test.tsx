import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./tooltip";

/**
 * The bug this guards: every caller sits inside a table that scrolls, and the bubble used to be an
 * absolutely-positioned `nowrap` line inside that table. A dozen alerts made it wider than the
 * window - clipped at the table's edge, and off the screen past it.
 */

/** Pins the anchor - the wrapper, not the child - at a known spot, since jsdom lays nothing out. */
function anchorAt(rect: Partial<DOMRect>) {
  const anchor = screen.getByText("badge").closest(".tooltip") as HTMLElement;
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    top: 100, bottom: 120, left: 400, right: 420, width: 20, height: 20, x: 400, y: 100,
    toJSON: () => ({}), ...rect,
  } as DOMRect);
  return anchor;
}

/** And a known bubble size, which jsdom otherwise reports as 0×0. */
function bubbleSize(width: number, height: number) {
  Object.defineProperty(HTMLDivElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLDivElement) {
      return this.classList.contains("tooltip__bubble")
        ? ({ width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
        : ({ width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    },
  });
}

function renderTooltip(content = "the detail") {
  render(
    <Tooltip content={content}>
      <span>badge</span>
    </Tooltip>
  );
}

const bubble = () => document.querySelector(".tooltip__bubble") as HTMLElement;

describe("Tooltip", () => {
  beforeEach(() => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
    bubbleSize(200, 60);
  });

  it("shows nothing until it is hovered", async () => {
    renderTooltip();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.hover(screen.getByText("badge"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("the detail");
  });

  it("is rendered outside the table so nothing can clip it", async () => {
    renderTooltip();
    await userEvent.hover(screen.getByText("badge"));

    // Portalled to <body>. Positioned inside the row, the scrolling table cut it off.
    expect(document.body.querySelector(":scope > .tooltip__bubble")).not.toBeNull();
  });

  it("opens above the anchor when there is room", async () => {
    renderTooltip();
    anchorAt({ top: 300, bottom: 320 });
    await userEvent.hover(screen.getByText("badge"));

    // 300 - 60 (its own height) - 8 (the gap). Above by preference: below would cover the next rows.
    expect(bubble().style.top).toBe("232px");
  });

  it("drops below the anchor for a row near the top of the screen", async () => {
    renderTooltip();
    anchorAt({ top: 20, bottom: 40 });
    await userEvent.hover(screen.getByText("badge"));

    // Would have been -48 above: off the top of the window, which is no more readable than off the
    // right of it.
    expect(bubble().style.top).toBe("48px");
  });

  it("pulls back from the right edge instead of running off it", async () => {
    renderTooltip();
    anchorAt({ left: 980, right: 1000, width: 20 });
    await userEvent.hover(screen.getByText("badge"));

    // Centred it would start at 980 + 10 - 100 = 890 and end at 1090, past a 1000px window.
    expect(bubble().style.left).toBe("792px");
  });

  it("dismisses itself when the table underneath it scrolls", async () => {
    // A fixed bubble does not move with the anchor, so staying open would leave it explaining a row
    // that is no longer there.
    renderTooltip();
    await userEvent.hover(screen.getByText("badge"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // Capture phase on window, so a scroll inside the table - which does not bubble - still lands.
    act(() => window.dispatchEvent(new Event("scroll")));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
