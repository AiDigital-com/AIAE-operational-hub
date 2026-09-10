import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AlertsBlock } from "./alerts-block";
import type { PacingAlertV1 } from "./types";

function alert(overrides: Partial<PacingAlertV1> = {}): PacingAlertV1 {
  return {
    type: "pacing_off_pace",
    severity: "critical",
    text: "Pacing -88.8pp severely under target — NW | Native Display Nextdoor",
    value: "-88.8pp",
    label: "under target",
    liId: "599888",
    name: "NW | Native Display Nextdoor",
    ...overrides,
  } as PacingAlertV1;
}

/** What a 180-line-item pacing actually produces. */
function many(count: number, severity: PacingAlertV1["severity"] = "critical"): PacingAlertV1[] {
  return Array.from({ length: count }, (_, i) =>
    alert({ severity, liId: String(600000 + i), value: `-${i}.0pp` })
  );
}

describe("AlertsBlock", () => {
  it("should lead with the number, not the sentence", () => {
    // Given: a hundred sentences is a wall; a hundred numbers can be scanned.
    render(<AlertsBlock alerts={[alert()]} />);

    // Then:
    expect(screen.getByText("-88.8pp")).toBeInTheDocument();
    expect(screen.getByText("under target")).toBeInTheDocument();
    // The whole sentence stays reachable for one alert under the cursor.
    expect(screen.getByTitle(/severely under target/)).toBeInTheDocument();
  });

  it("should show the line item id alongside its description", () => {
    // Given: 599888 and 600433 are both "Southwest | Native Display Nextdoor
    // TM271064#99". Without the id they read as one row alerting twice.
    render(
      <AlertsBlock
        alerts={[
          alert({ liId: "599888", name: "Southwest | Native Display Nextdoor" }),
          alert({ liId: "600433", name: "Southwest | Native Display Nextdoor", value: "-100.0pp" }),
        ]}
      />
    );

    // Then:
    expect(screen.getByText(/599888/)).toBeInTheDocument();
    expect(screen.getByText(/600433/)).toBeInTheDocument();
  });

  it("should collapse the tail instead of printing a hundred and thirty alerts", async () => {
    // Given: the real figure from campaign 40539's 180-line-item pacing.
    render(<AlertsBlock alerts={many(130)} />);

    // Then: a handful shown, the rest counted.
    expect(screen.getAllByTitle(/severely under target/)).toHaveLength(5);
    expect(screen.getByRole("button", { name: "and 125 more" })).toBeInTheDocument();

    // When: the user asks for them.
    await userEvent.click(screen.getByRole("button", { name: "and 125 more" }));

    // Then:
    expect(screen.getAllByTitle(/severely under target/)).toHaveLength(130);
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
  });

  it("should count every alert in the heading, not only the visible ones", () => {
    // Given: the count is how a reader knows the collapse is hiding something.
    render(<AlertsBlock alerts={many(130)} />);

    // Then:
    const heading = screen.getByText("Critical").parentElement as HTMLElement;
    expect(within(heading).getByText("130")).toBeInTheDocument();
  });

  it("should give warnings the cards when nothing is critical", () => {
    // Given: on a pacing whose only problems are warnings, they are the worst news
    // there is — the retired SPA's rule, and it keeps the block from reading empty.
    const { container, rerender } = render(<AlertsBlock alerts={many(2, "warning")} />);
    expect(container.querySelector(".alerts__cards")).toBeInTheDocument();

    // When: something critical arrives, warnings step down to pills.
    rerender(<AlertsBlock alerts={[...many(1, "critical"), ...many(2, "warning")]} />);
    expect(container.querySelector(".alerts__pills")).toBeInTheDocument();
  });

  it("should render a detector that has no number without leaving a hole", () => {
    // Given: `value` is null for the few types with no meaningful figure.
    render(<AlertsBlock alerts={[alert({ value: null, label: "data is stale", liId: undefined })]} />);

    // Then: the label takes the headline slot rather than an empty one.
    expect(screen.getByText("data is stale")).toBeInTheDocument();
  });

  it("should render nothing at all when there are no alerts", () => {
    const { container } = render(<AlertsBlock alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
