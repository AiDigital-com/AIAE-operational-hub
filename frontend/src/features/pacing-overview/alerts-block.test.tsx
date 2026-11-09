import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

function many(count: number, severity: PacingAlertV1["severity"] = "critical"): PacingAlertV1[] {
  return Array.from({ length: count }, (_, i) =>
    alert({ severity, liId: String(600000 + i), value: `-${i}.0pp` })
  );
}

const dataGap = (gap: number) =>
  alert({
    type: "data_gap",
    severity: "info",
    text: `Data gap: ${gap}d between 2026-10-02 and 2026-10-08`,
    value: `${gap}d`,
    label: "data gap",
    liId: undefined,
    name: undefined,
  });

describe("AlertsBlock", () => {
  it("should lead with the number and keep the whole sentence as the title", () => {
    render(<AlertsBlock alerts={[alert()]} />);

    expect(screen.getByText("-88.8pp")).toBeInTheDocument();
    expect(screen.getByText("under target")).toBeInTheDocument();
    expect(screen.getByTitle(/severely under target/)).toBeInTheDocument();
  });

  it("should name a line item's alert by its id and a pacing-wide one as Campaign, as the reference does", () => {
    render(<AlertsBlock alerts={[alert(), alert({ severity: "critical", liId: undefined, label: "data is stale", value: "32d" })]} />);

    expect(screen.getByText("LI 599888")).toBeInTheDocument();
    expect(screen.getByText("Campaign")).toBeInTheDocument();
  });

  it("should put info alerts under Warning with the warnings, never in a group of their own", () => {
    // Given: Andy's Summer + North Carolina - the reference shows WARNING 4, data gaps included.
    render(
      <AlertsBlock
        alerts={[
          alert({ severity: "warning", value: "+0.05pp", label: "CTR above target", liId: "670060" }),
          alert({ severity: "warning", value: "32d", label: "data is stale", liId: undefined }),
          dataGap(2),
          dataGap(5),
        ]}
      />
    );

    // Then:
    const heading = screen.getByText("Warning").parentElement as HTMLElement;
    expect(within(heading).getByText("4")).toBeInTheDocument();
    expect(screen.queryByText(/notes/i)).not.toBeInTheDocument();
    expect(screen.getByTitle(/Data gap: 2d/)).toHaveClass("alerts__card--warning");
  });

  it("should give warnings the cards when nothing is critical, and the pill line otherwise", () => {
    const { container, rerender } = render(<AlertsBlock alerts={many(2, "warning")} />);
    expect(container.querySelectorAll(".alerts__card")).toHaveLength(2);
    expect(container.querySelector(".alerts__line")).not.toBeInTheDocument();

    rerender(<AlertsBlock alerts={[...many(1, "critical"), ...many(2, "warning"), dataGap(5)]} />);
    expect(container.querySelectorAll(".alerts__card")).toHaveLength(1);
    expect(container.querySelectorAll(".alerts__pill")).toHaveLength(3);
  });

  it("should show every card, as the reference does, and collapse only the warning line past five", async () => {
    render(<AlertsBlock alerts={[...many(7, "critical"), ...many(8, "warning")]} />);

    expect(document.querySelectorAll(".alerts__card")).toHaveLength(7);
    expect(document.querySelectorAll(".alerts__pill")).toHaveLength(5);

    await userEvent.click(screen.getByRole("button", { name: "+ 3 more ↓" }));
    expect(document.querySelectorAll(".alerts__pill")).toHaveLength(8);

    await userEvent.click(screen.getByRole("button", { name: "Collapse ↑" }));
    expect(document.querySelectorAll(".alerts__pill")).toHaveLength(5);
  });

  it("should count every alert in the heading", () => {
    render(<AlertsBlock alerts={many(130)} />);

    const heading = screen.getByText("Critical").parentElement as HTMLElement;
    expect(within(heading).getByText("130")).toBeInTheDocument();
  });

  it("should filter to a line item when its alert is clicked, and mark the one selected", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<AlertsBlock alerts={[alert(), dataGap(5)]} onSelect={onSelect} />);

    await userEvent.click(screen.getByTitle(/severely under target/));
    expect(onSelect).toHaveBeenCalledWith("599888");

    // A pacing-wide alert has no line item to filter to.
    await userEvent.click(screen.getByTitle(/Data gap/));
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(<AlertsBlock alerts={[alert(), dataGap(5)]} onSelect={onSelect} selection={["599888"]} />);
    expect(screen.getByTitle(/severely under target/)).toHaveClass("alerts__card--active");
  });

  it("should render a detector that has no number by its label alone", () => {
    render(<AlertsBlock alerts={[alert({ value: undefined, label: "data is stale", liId: undefined })]} />);

    expect(screen.getByText("data is stale")).toBeInTheDocument();
  });

  it("should render nothing at all when there are no alerts", () => {
    const { container } = render(<AlertsBlock alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
