import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_STATUS_SEGMENTS, StatusBadge, displayStatusLabel } from "./status-badge";

describe("StatusBadge", () => {
  it("should render the label and the led with the given color", () => {
    // Given / When:
    const { container } = render(<StatusBadge label="Live" color="var(--good)" />);

    // Then:
    expect(screen.getByText("Live")).toBeInTheDocument();
    const led = container.querySelector(".status-badge__led") as HTMLElement;
    expect(led.style.background).toBe("var(--good)");
  });

  it("should apply the glow modifier when glow is true", () => {
    // Given / When:
    const { container } = render(<StatusBadge label="Live" color="var(--good)" glow />);

    // Then:
    expect(container.querySelector(".status-badge")).toHaveClass("status-badge--glow");
  });

  it("should not apply the glow modifier by default", () => {
    // Given / When:
    const { container } = render(<StatusBadge label="Paused" color="var(--attention)" />);

    // Then:
    expect(container.querySelector(".status-badge")).not.toHaveClass("status-badge--glow");
  });
});

describe("displayStatusLabel", () => {
  it("should rename the real NetSuite Finished status to Complete for display", () => {
    // Given / When / Then:
    expect(displayStatusLabel("Finished")).toBe("Complete");
  });

  it("should pass every other real status through verbatim", () => {
    // Given / When / Then:
    expect(displayStatusLabel("Live")).toBe("Live");
    expect(displayStatusLabel("Postponed")).toBe("Postponed");
    expect(displayStatusLabel("Canceled After Launch")).toBe("Canceled After Launch");
  });

  it("should render an em dash for a null or empty status", () => {
    // Given / When / Then:
    expect(displayStatusLabel(null)).toBe("—");
    expect(displayStatusLabel("")).toBe("—");
  });
});

describe("CAMPAIGN_STATUS_SEGMENTS", () => {
  it("should lead with an unfiltered All segment", () => {
    // Given / When / Then:
    expect(CAMPAIGN_STATUS_SEGMENTS[0]).toEqual({ key: "all", label: "All", value: "" });
  });

  it("should give every real NetSuite status its own segment - none reachable only via All", () => {
    // Given:
    const realStatuses = ["Live", "Paused", "Finished", "Postponed", "Canceled After Launch", "To Be Launched"];

    // When:
    const values = CAMPAIGN_STATUS_SEGMENTS.map((segment) => segment.value);

    // Then:
    for (const status of realStatuses) {
      expect(values).toContain(status);
    }
  });
});
