import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ContainersTable } from "./containers-table";
import type { ContainerChildReading, ContainerReading, PacingMetricsBag } from "./types-metrics";

function aChild(over: Partial<ContainerChildReading> = {}): ContainerChildReading {
  return {
    id: "x1",
    kind: "dim",
    label: "Audience: Sports fans",
    dimKey: "audience",
    dimValue: "Sports fans",
    fs: "2026-03-01",
    fe: "2026-03-31",
    target: 100_000,
    actual: 60_000,
    spend: 900,
    clientCost: 3000,
    progress: { remaining: 40_000, daysLeft: 10, neededPerDay: 4000, state: "active" },
    margin: { effM: 30, marginActual: 70, hasMargin: true, status: "g" },
    ...over,
  };
}

function aContainer(over: Partial<ContainerReading> = {}): ContainerReading {
  return {
    id: "c1",
    name: "March push",
    fs: "2026-03-01",
    fe: "2026-03-31",
    target: 400_000,
    actual: 200_000,
    spend: 3000,
    clientCost: 10_000,
    progress: { remaining: 200_000, daysLeft: 10, neededPerDay: 20_000, state: "active" },
    margin: { effM: 30, marginActual: 70, hasMargin: true, status: "g" },
    dateChildren: [],
    dimChildren: [],
    ...over,
  };
}

function bag(containers: Record<string, ContainerReading[]> | undefined): PacingMetricsBag {
  return {
    asOf: "2026-03-21",
    campaign: {},
    scalars: {},
    series: [],
    daily: [],
    sources: {},
    readings: {},
    bound: {},
    containers,
  } as PacingMetricsBag;
}

describe("ContainersTable (§10 display, US-129)", () => {
  it("says nothing at all when no line item is split up", () => {
    const { container } = render(<ContainersTable metrics={bag({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing when the payload predates the feature entirely", () => {
    const { container } = render(<ContainersTable metrics={bag(undefined)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("survives a pacing with no metrics yet", () => {
    const { container } = render(<ContainersTable metrics={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("nests each child under its container, with the parent's own figures on top", async () => {
    const user = userEvent.setup();
    render(
      <ContainersTable
        metrics={bag({
          "599904": [
            aContainer({
              dateChildren: [aChild({ id: "d1", kind: "date", label: "Week 1", target: 250_000, actual: 150_000 })],
              dimChildren: [aChild({ id: "x1" })],
            }),
          ],
        })}
      />
    );

    expect(screen.getByText("LI 599904")).toBeInTheDocument();
    expect(screen.getByText("March push")).toBeInTheDocument();
    // The parent's own target, read not summed from its children.
    expect(screen.getByText("400,000")).toBeInTheDocument();
    // Both kinds of child, open by default, each labelled by what kind of cut it is.
    expect(screen.getByText("Week 1")).toBeInTheDocument();
    expect(screen.getByText("Audience: Sports fans")).toBeInTheDocument();
    expect(screen.getByText("period")).toBeInTheDocument();
    expect(screen.getByText("split")).toBeInTheDocument();

    // And they fold away, because a line item with several containers is otherwise a wall.
    await user.click(screen.getByRole("button", { name: /March push/ }));
    expect(screen.queryByText("Week 1")).not.toBeInTheDocument();
  });

  it("shows a sub-breakdown's target as Pacing resolved it, never re-deriving a percent", () => {
    // 30% of the parent's 400,000 arrives already resolved to 120,000. Re-deriving it
    // here is the double-application bug; the number must be rendered as sent.
    render(
      <ContainersTable
        metrics={bag({ "1": [aContainer({ dimChildren: [aChild({ target: 120_000, actual: 0 })] })] })}
      />
    );
    const row = screen.getByText("Audience: Sports fans").closest("tr")!;
    expect(within(row).getByText("120,000")).toBeInTheDocument();
  });

  it("shows a dash, not 0%, for a split that has not delivered", () => {
    render(
      <ContainersTable
        metrics={bag({
          "1": [aContainer({
            dimChildren: [aChild({ actual: 0, margin: { effM: 30, marginActual: null, hasMargin: false, status: null } })],
          })],
        })}
      />
    );
    const row = screen.getByText("Audience: Sports fans").closest("tr")!;
    // A realized margin of 0% would read as "losing everything"; nothing delivered is not that.
    expect(within(row).queryByText("0.0%")).not.toBeInTheDocument();
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("carries Pacing's verdict in words as well as tone", () => {
    render(
      <ContainersTable
        metrics={bag({
          "1": [aContainer({ margin: { effM: 30, marginActual: 12, hasMargin: true, status: "b" } })],
        })}
      />
    );
    // The tint alone is unreadable to someone who cannot distinguish it, and in print.
    expect(screen.getByText("Below target")).toBeInTheDocument();
  });

  it("reads a met target as delivered rather than as a stalled zero-per-day", () => {
    render(
      <ContainersTable
        metrics={bag({
          "1": [aContainer({
            actual: 500_000,
            progress: { remaining: 0, daysLeft: 3, neededPerDay: 0, state: "active" },
          })],
        })}
      />
    );
    expect(screen.getByText("delivered")).toBeInTheDocument();
    expect(screen.queryByText(/0\/day/)).not.toBeInTheDocument();
  });

  it("names a dimension the way the plan editor does, not by its raw key", () => {
    // Pacing sends `label: "audience: Sports fans"` — the stable key. The editor that
    // authored it says "Audience". Two screens naming one thing two ways makes a reader
    // doubt both.
    render(
      <ContainersTable
        metrics={bag({ "1": [aContainer({ dimChildren: [aChild()] })] })}
      />
    );
    expect(screen.getByText("Audience: Sports fans")).toBeInTheDocument();
    expect(screen.queryByText("audience: Sports fans")).not.toBeInTheDocument();
  });

  it("falls back to the raw key for a dimension this screen has never heard of", () => {
    render(
      <ContainersTable
        metrics={bag({
          "1": [aContainer({
            dimChildren: [aChild({ dimKey: "brand_new_axis", dimValue: "X", label: "brand_new_axis: X" })],
          })],
        })}
      />
    );
    expect(screen.getByText("brand_new_axis: X")).toBeInTheDocument();
  });

  it("says how far short a finished container fell", () => {
    render(
      <ContainersTable
        metrics={bag({
          "1": [aContainer({
            progress: { remaining: 40_000, daysLeft: 0, neededPerDay: 0, state: "ended" },
          })],
        })}
      />
    );
    expect(screen.getByText(/40,000 short/)).toBeInTheDocument();
  });
});
