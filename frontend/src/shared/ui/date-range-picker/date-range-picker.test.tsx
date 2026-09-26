import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DateRangePicker, type DateRange } from "./date-range-picker";

/** Wraps the controlled component in the minimal state a real caller owns. */
function Harness({ minDate, maxDate, onChange }: { minDate?: string; maxDate?: string; onChange?: (r: DateRange) => void }) {
  const [value, setValue] = useState<DateRange>({ from: "", to: "" });
  return (
    <DateRangePicker
      value={value}
      minDate={minDate}
      maxDate={maxDate}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("DateRangePicker", () => {
  it("shows nothing until opened, then opens a dialog on trigger click", async () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Select range" }));
    expect(screen.getByRole("dialog", { name: "Select date range" })).toBeInTheDocument();
  });

  it("first click sets the start, second click applies the range and closes", async () => {
    const onChange = vi.fn();
    render(<Harness minDate="2026-09-01" maxDate="2026-09-30" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Select range" }));

    await userEvent.click(document.querySelector('[data-ymd="2026-09-05"]')!);
    expect(screen.getByText(/Start: 09\/05\/2026/)).toBeInTheDocument();

    await userEvent.click(document.querySelector('[data-ymd="2026-09-12"]')!);
    expect(onChange).toHaveBeenCalledWith({ from: "2026-09-05", to: "2026-09-12" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("picking an earlier day second swaps the ends so from <= to", async () => {
    const onChange = vi.fn();
    render(<Harness minDate="2026-09-01" maxDate="2026-09-30" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Select range" }));

    await userEvent.click(document.querySelector('[data-ymd="2026-09-12"]')!);
    await userEvent.click(document.querySelector('[data-ymd="2026-09-05"]')!);
    expect(onChange).toHaveBeenCalledWith({ from: "2026-09-05", to: "2026-09-12" });
  });

  it("a day outside min/max is disabled and unclickable", async () => {
    render(<Harness minDate="2026-09-01" maxDate="2026-09-10" />);
    await userEvent.click(screen.getByRole("button", { name: "Select range" }));

    const outOfRangeDay = document.querySelector('[data-ymd="2026-09-15"]');
    expect(outOfRangeDay).toBeDisabled();
  });

  it("Reset clears the value and closes without leaving a half pick behind", async () => {
    const onChange = vi.fn();
    render(<Harness minDate="2026-09-01" maxDate="2026-09-30" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Select range" }));
    await userEvent.click(document.querySelector('[data-ymd="2026-09-05"]')!);

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenCalledWith({ from: "", to: "" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Close dismisses without applying anything for a half pick", async () => {
    const onChange = vi.fn();
    render(<Harness minDate="2026-09-01" maxDate="2026-09-30" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Select range" }));
    await userEvent.click(document.querySelector('[data-ymd="2026-09-05"]')!);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports an external trigger via renderTrigger, positioned in place of the default button", async () => {
    render(
      <DateRangePicker
        value={{ from: "", to: "" }}
        onChange={vi.fn()}
        renderTrigger={({ open, toggle }) => (
          <button type="button" onClick={toggle}>
            {open ? "close it" : "open it"}
          </button>
        )}
      />
    );
    expect(screen.queryByRole("button", { name: "Select range" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "open it" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
