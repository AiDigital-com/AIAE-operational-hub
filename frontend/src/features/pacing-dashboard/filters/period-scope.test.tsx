import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeriodScopeBanner, PeriodScopeControl, periodKeyOf, type ScopePeriod } from "./period-scope";

const SEP: ScopePeriod = { fs: "2026-09-01", fe: "2026-09-07", label: "1st" };
const OCT: ScopePeriod = { fs: "2026-10-06", fe: "2026-10-12", label: "6th" };

describe("PeriodScopeControl", () => {
  it("should mark Full Flight as current and ask to switch when Period Scope is pressed", async () => {
    // Given:
    const onToggle = vi.fn();
    render(<PeriodScopeControl scoped={false} periods={[SEP, OCT]} selectedKey={null} onToggle={onToggle} onSelect={vi.fn()} />);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Period Scope" }));

    // Then:
    expect(screen.getByRole("button", { name: "Full Flight" })).toHaveAttribute("aria-pressed", "true");
    expect(onToggle).toHaveBeenCalledWith("period");
    // No picker while the whole flight is shown.
    expect(screen.queryByRole("button", { name: /6th|1st|Select period/ })).not.toBeInTheDocument();
  });

  it("should show the selected period by its name and switch to another one picked from the list", async () => {
    // Given:
    const onSelect = vi.fn();
    render(<PeriodScopeControl scoped periods={[SEP, OCT]} selectedKey={periodKeyOf(OCT)} onToggle={vi.fn()} onSelect={onSelect} />);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "6th" }));
    await userEvent.click(screen.getByRole("option", { name: "1st" }));

    // Then:
    expect(onSelect).toHaveBeenCalledWith("2026-09-01|2026-09-07");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("should not offer a picker when there is only one period to choose", () => {
    // Given / When:
    render(<PeriodScopeControl scoped periods={[OCT]} selectedKey={periodKeyOf(OCT)} onToggle={vi.fn()} onSelect={vi.fn()} />);

    // Then:
    expect(screen.queryByRole("button", { name: "6th" })).not.toBeInTheDocument();
  });

  it("should name an unnamed period by its dates with the year", () => {
    // Given / When:
    const unnamed: ScopePeriod = { fs: "2026-10-06", fe: "2026-10-12" };
    render(<PeriodScopeControl scoped periods={[SEP, unnamed]} selectedKey={periodKeyOf(unnamed)} onToggle={vi.fn()} onSelect={vi.fn()} />);

    // Then:
    expect(screen.getByRole("button", { name: /Oct 6, 2026.*Oct 12, 2026/ })).toBeInTheDocument();
  });
});

describe("PeriodScopeBanner", () => {
  it("should say which period is shown while the data sits inside it", () => {
    // Given / When:
    render(<PeriodScopeBanner scoped state="in_period" periods={[SEP, OCT]} selectedKey={periodKeyOf(OCT)} />);

    // Then:
    expect(screen.getByText("Period scope active")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/showing Oct 6, 2026 – Oct 12, 2026 only\(6th\)/);
  });

  it("should warn when the selected period has ended or not started yet", () => {
    // Given / When:
    const { rerender } = render(<PeriodScopeBanner scoped state="ended" periods={[SEP, OCT]} selectedKey={periodKeyOf(SEP)} />);

    // Then:
    expect(screen.getByText("Out of period")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/has ended — newer delivery is outside this period/);

    // When:
    rerender(<PeriodScopeBanner scoped state="upcoming" periods={[SEP, OCT]} selectedKey={periodKeyOf(OCT)} />);

    // Then:
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/hasn’t started yet — no delivery in this period yet/);
  });

  it("should say the full flight is shown when the containers define no period", () => {
    // Given / When:
    render(<PeriodScopeBanner scoped state="no_period" periods={[]} selectedKey={null} />);

    // Then:
    expect(screen.getByText("Period scope on")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("no period defined — showing full flight");
  });

  it("should draw nothing while the whole flight is shown", () => {
    // Given / When:
    const { container } = render(<PeriodScopeBanner scoped={false} state={null} periods={[SEP]} selectedKey={null} />);

    // Then:
    expect(container).toBeEmptyDOMElement();
  });
});
