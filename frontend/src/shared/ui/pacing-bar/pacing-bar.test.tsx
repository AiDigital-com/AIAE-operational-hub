import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PacingBar } from "./pacing-bar";

describe("PacingBar", () => {
  it("should render a dash and no fill when pacing is null", () => {
    // Given / When:
    render(<PacingBar pp={null} />);

    // Then:
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("should render a positive pacing value with a leading plus sign", () => {
    // Given / When:
    render(<PacingBar pp={4.4} />);

    // Then:
    expect(screen.getByText("+4.4 pp")).toBeInTheDocument();
  });

  it("should render a negative pacing value without a leading plus sign", () => {
    // Given / When:
    render(<PacingBar pp={-3.1} />);

    // Then:
    expect(screen.getByText("-3.1 pp")).toBeInTheDocument();
  });

  it("should clamp an extreme pacing value's fill width to the ±45pp visual range", () => {
    // Given: an extreme value like the mockup's own edge case (+9515.1pp)
    const { container } = render(<PacingBar pp={9515.1} />);

    // When:
    const fill = container.querySelector(".pacing-bar__fill") as HTMLElement;

    // Then: at pp>1000 the position clamps to +45, so fill spans from 50% to 95% (45% wide)
    expect(fill.style.width).toBe("45%");
    expect(fill.style.left).toBe("50%");
  });
});
