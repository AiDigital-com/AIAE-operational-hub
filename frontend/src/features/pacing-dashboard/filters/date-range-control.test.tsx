import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DateRangeControl } from "./date-range-control";
import { useUrlFilters } from "./use-url-filters";

function SearchParamsProbe() {
  const [params] = useSearchParams();
  return <div data-testid="params">{params.toString()}</div>;
}

/** The real `useUrlFilters` hook driving a real router, exactly how `filter-bar.tsx` wires it -
 *  so "picking a range updates the URL" is proved end to end, not against a mock. */
function Harness({ minDate, maxDate }: { minDate?: string; maxDate?: string } = {}) {
  const { filters, setFilters } = useUrlFilters();
  return (
    <>
      <DateRangeControl filters={filters} setFilters={setFilters} minDate={minDate} maxDate={maxDate} />
      <SearchParamsProbe />
    </>
  );
}

function renderControl(props?: { minDate?: string; maxDate?: string }) {
  render(
    <MemoryRouter initialEntries={["/dash"]}>
      <Harness {...props} />
    </MemoryRouter>
  );
}

const params = () => screen.getByTestId("params").textContent ?? "";

describe("DateRangeControl - segment states", () => {
  it("renders five segments in one group: Flight, 1d, 3d, 7d, Custom", () => {
    renderControl();
    const group = screen.getByRole("tablist", { name: "Date range" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Flight" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "1d" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "3d" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "7d" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Custom date range" })).toBeInTheDocument();
  });

  it("clicking a quick range (7d) selects it and writes range=7 to the URL", async () => {
    renderControl();
    await userEvent.click(screen.getByRole("tab", { name: "7d" }));

    expect(screen.getByRole("tab", { name: "7d" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Flight" })).toHaveAttribute("aria-selected", "false");
    expect(params()).toBe("range=7");
  });

  it("a dangling ?range=custom with no dates shows Flight as selected, not Custom", () => {
    render(
      <MemoryRouter initialEntries={["/dash?range=custom"]}>
        <Harness />
      </MemoryRouter>
    );
    expect(screen.getByRole("tab", { name: "Flight" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Custom date range" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("DateRangeControl - the Custom segment IS the calendar trigger", () => {
  it("picking a complete range applies it, updates the URL, and the segment reads back the range", async () => {
    renderControl({ minDate: "2026-09-01", maxDate: "2026-09-30" });
    await userEvent.click(screen.getByRole("tab", { name: "Custom date range" }));
    await userEvent.click(document.querySelector('[data-ymd="2026-09-01"]')!);
    await userEvent.click(document.querySelector('[data-ymd="2026-09-10"]')!);

    expect(params()).toBe("range=custom&from=2026-09-01&to=2026-09-10");
    // The segment stops reading "Custom" and reads back the range, per the owner's ask.
    const segment = screen.getByRole("tab", { name: /Custom date range: /i });
    expect(segment).toHaveTextContent("Sep 1 – Sep 10");
    expect(segment).toHaveAttribute("aria-selected", "true");
  });

  it("does not write a dangling custom range: a half pick dismissed via Close changes nothing", async () => {
    renderControl({ minDate: "2026-09-01", maxDate: "2026-09-30" });
    await userEvent.click(screen.getByRole("tab", { name: "Custom date range" }));
    await userEvent.click(document.querySelector('[data-ymd="2026-09-01"]')!);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(params()).toBe("");
    expect(screen.getByRole("tab", { name: "Flight" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking the active Custom segment reopens the calendar", async () => {
    renderControl({ minDate: "2026-09-01", maxDate: "2026-09-30" });
    await userEvent.click(screen.getByRole("tab", { name: "Custom date range" }));
    await userEvent.click(document.querySelector('[data-ymd="2026-09-01"]')!);
    await userEvent.click(document.querySelector('[data-ymd="2026-09-10"]')!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Custom date range: / }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clicking Flight while a custom range is active clears it back to Flight", async () => {
    renderControl({ minDate: "2026-09-01", maxDate: "2026-09-30" });
    await userEvent.click(screen.getByRole("tab", { name: "Custom date range" }));
    await userEvent.click(document.querySelector('[data-ymd="2026-09-01"]')!);
    await userEvent.click(document.querySelector('[data-ymd="2026-09-10"]')!);
    expect(params()).toBe("range=custom&from=2026-09-01&to=2026-09-10");

    await userEvent.click(screen.getByRole("tab", { name: "Flight" }));
    expect(params()).toBe("");
    expect(screen.getByRole("tab", { name: "Custom date range" })).toHaveAttribute("aria-selected", "false");
  });
});
