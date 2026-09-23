import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { brickRenderer } from "./brick-registry";
import type { BrickCtx } from "./brick-data";
import type { PacingMetricsBag } from "../types-metrics";
import type { Brick } from "./widget-types";

/**
 * What the hero's bricks draw out of the metric bag.
 *
 * Every case here is a figure Pacing computed, sent, and this side threw away: a unit word, the
 * sentence under a target, the two pace percentages, a metric's own target. None of them errored -
 * a dropped field renders as a slightly emptier card - so each is pinned by what must be on screen.
 */

/** A bag carrying only what the brick under test reads; everything else is an empty shape. */
function bag(partial: Partial<PacingMetricsBag>): PacingMetricsBag {
  return {
    asOf: "2026-09-21",
    campaign: {},
    scalars: {},
    series: [],
    daily: [],
    sources: {},
    readings: {},
    bound: {},
    ...partial,
  } as PacingMetricsBag;
}

function renderBrick(brick: Brick, ctx: BrickCtx) {
  const Component = brickRenderer(brick.type);
  if (!Component) throw new Error(`no renderer for ${brick.type}`);
  render(<Component brick={brick} ctx={ctx} />);
}

describe("detailCard brick", () => {
  it("should print each line's unit word and explainer, not the number alone", () => {
    // Given: the "Needed to be on pace" card as Pacing sends it - two figures, each with the
    // arithmetic behind it
    const ctx: BrickCtx = {
      metrics: bag({
        sources: {
          neededPerDay: {
            lines: [
              { value: "25,436/day", unit: "impr", note: "2,289,249 impr ÷ 90 days." },
              { value: "$32.58/day", unit: "spend", note: "25,436 impr × $1.28 CPM ÷ 1000." },
            ],
            sub: "Rates needed on Sep 21.",
          },
        },
      }),
    };

    // When:
    renderBrick({ type: "detailCard", label: "Needed to be on pace", source: "neededPerDay" } as Brick, ctx);

    // Then: "25,436/day" on its own is a rate with no unit and no reason - the card has to say
    // both, or the reader cannot tell impressions from spend, or where either came from
    expect(screen.getByText("25,436/day")).toBeInTheDocument();
    expect(screen.getByText("impr")).toBeInTheDocument();
    expect(screen.getByText("2,289,249 impr ÷ 90 days.")).toBeInTheDocument();
    expect(screen.getByText("$32.58/day")).toBeInTheDocument();
    expect(screen.getByText("spend")).toBeInTheDocument();
    expect(screen.getByText("Rates needed on Sep 21.")).toBeInTheDocument();
  });

  it("should not paint a 'plan not set' line as a figure", () => {
    // Given: a unit with no goal at all, plus the card's own status
    const ctx: BrickCtx = {
      metrics: bag({
        sources: {
          planUnits: {
            lines: [
              { value: "4,998,739", unit: "impr", note: null },
              { value: "Clicks plan not set", unit: null, note: null, muted: true },
            ],
            sub: null,
            status: "b",
          },
        },
      }),
    };

    // When:
    renderBrick({ type: "detailCard", label: "Flight Plan units", source: "planUnits" } as Brick, ctx);

    // Then: it is not a number, so it must not wear the figure's class or the card's tone -
    // an absent plan painted red reads as a plan that is failing
    const muted = screen.getByText("Clicks plan not set").closest("div");
    expect(muted).toHaveClass("wgt-detail__value--muted");
    expect(muted).not.toHaveStyle({ color: "rgb(200, 58, 58)" });
  });
});

describe("unitBars brick", () => {
  const units = [
    {
      unit: "Impressions",
      hasPlan: true,
      actual: 2384129,
      actualPct: 47.69,
      plannedPct: 48.57,
      paceDelta: -0.88,
      opText: "On track",
      status: "g" as const,
    },
  ];

  it("should name the pace gap it draws", () => {
    // Given: delivery 0.9pp behind the plan curve
    renderBrick({ type: "unitBars" } as Brick, { metrics: bag({ readings: { deliveryUnits: units } }) });

    // Then: the bar shows the gap between fill and tick; without these three it shows the gap and
    // refuses to name it
    expect(screen.getByText(/Actual 47\.7%/)).toBeInTheDocument();
    expect(screen.getByText(/Plan 48\.6%/)).toBeInTheDocument();
    expect(screen.getByText("−0.9 pp")).toBeInTheDocument();
    expect(screen.getByText("behind plan ·")).toBeInTheDocument();
    expect(screen.getByText("On track")).toBeInTheDocument();
  });

  it("should show a count and no bar for a unit with no goal", () => {
    // Given: a unit carrying no plan
    const noPlan = [{ ...units[0], hasPlan: false, actualPct: 0, plannedPct: 0, paceDelta: 0 }];
    const { container } = render(
      (() => {
        const C = brickRenderer("unitBars")!;
        return <C brick={{ type: "unitBars" } as Brick} ctx={{ metrics: bag({ readings: { deliveryUnits: noPlan } }) }} />;
      })()
    );

    // Then: there is no pace to be on or off, and a 0%-wide bar would read as one that is failing
    expect(screen.getByText(/plan not set/)).toBeInTheDocument();
    expect(container.querySelector(".wgt-unitbar__track")).toBeNull();
  });
});

describe("a metric measured against its own target", () => {
  const marginCtx: BrickCtx = {
    metrics: bag({
      bound: {
        [JSON.stringify({ metric: "margin" })]: { value: 84.41, target: 71.94, invert: false, sub: "vs target" },
      },
    }),
  };

  it("should read a self-target as the metric's own target, not as its value", () => {
    // Given: the hero's margin gauge - `bind: margin, target: margin`. Read literally that is a
    // number compared with itself, which is a delta of zero on every campaign forever.
    renderBrick(
      {
        type: "gauge",
        bind: { metric: "margin" },
        target: { metric: "margin" },
        invert: false,
        spread: 10,
        format: "pp",
      } as Brick,
      marginCtx
    );

    // Then:
    expect(screen.getByText("+12.5pp")).toBeInTheDocument();
    expect(screen.queryByText("+0.0pp")).toBeNull();
  });

  it("should draw the corridor the brick asked for", () => {
    // Given: the same gauge, whose `spread` says what counts as a lot
    renderBrick(
      { type: "gauge", bind: { metric: "margin" }, target: { metric: "margin" }, spread: 10, format: "pp" } as Brick,
      marginCtx
    );

    // Then: "+12.5 pp" alone says nothing about whether that is a wide miss or a rounding error
    expect(screen.getByText("−10 pp")).toBeInTheDocument();
    expect(screen.getByText("+10 pp")).toBeInTheDocument();
  });
});
