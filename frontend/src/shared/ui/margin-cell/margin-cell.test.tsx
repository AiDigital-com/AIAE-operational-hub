import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarginCell } from "./margin-cell";

describe("MarginCell", () => {
  it("should render a dash when there is no actual margin", () => {
    // Given / When:
    render(<MarginCell actual={null} target={90} />);

    // Then:
    const cell = screen.getByText("—");
    expect(cell).toHaveClass("margin-cell--na");
  });

  it("should apply the good modifier when actual meets or exceeds target", () => {
    // Given / When:
    const { container } = render(<MarginCell actual={92.9} target={90} />);

    // Then:
    const cell = container.querySelector(".margin-cell") as HTMLElement;
    expect(cell).toHaveClass("margin-cell--good");
    expect(cell.textContent).toContain("92.9%");
    expect(cell.textContent).toContain("/ 90%");
  });

  it("should apply the warn modifier when actual trails target by up to 5 points", () => {
    // Given / When:
    const { container } = render(<MarginCell actual={86} target={90} />);

    // Then:
    const cell = container.querySelector(".margin-cell") as HTMLElement;
    expect(cell).toHaveClass("margin-cell--warn");
    expect(cell.textContent).toContain("86.0%");
  });

  it("should apply the bad modifier when actual trails target by more than 5 points", () => {
    // Given / When:
    const { container } = render(<MarginCell actual={77.8} target={90} />);

    // Then:
    const cell = container.querySelector(".margin-cell") as HTMLElement;
    expect(cell).toHaveClass("margin-cell--bad");
    expect(cell.textContent).toContain("77.8%");
  });
});
