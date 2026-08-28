import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTableFilterBar } from "./data-table-filter-bar";
import type { AppliedFilter } from "./data-table-filter-bar-model";

function aFilter(overrides: Partial<AppliedFilter> = {}): AppliedFilter {
  return {
    id: "channel",
    label: "Channel",
    summary: "Display",
    hiddenColumn: false,
    edit: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
}

describe("DataTableFilterBar", () => {
  it("should render the Date pill and + Filter even with zero filters applied", () => {
    // Given: no filters applied
    // When: the bar renders
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );

    // Then: unlike DataTableChips, the bar still offers its two entry points
    expect(screen.getByRole("button", { name: "All dates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("should show Clear all only once at least one filter is applied", () => {
    // Given: one filter applied
    // When: the bar renders
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter()]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );

    // Then:
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });

  it("should render a chip per filter reading 'Label: summary'", () => {
    // Given: a filter labelled Channel with summary Display
    // When: the bar renders
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter({ label: "Channel", summary: "Display" })]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );

    // Then:
    expect(screen.getByText("Channel: Display")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear the Channel filter" })).toBeInTheDocument();
  });

  it("should mark a filter on a non-displayed column as hidden, dashed and explained", () => {
    // Given: a filter whose dimension is not among the table's own columns
    // When: the bar renders
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter({ hiddenColumn: true })]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );

    // Then: accessible through aria-label, not only a title tooltip
    const chip = screen.getByRole("button", { name: /Filtered on a column that is not displayed/ });
    expect(chip).toHaveAttribute("title", "Filtered on a column that is not displayed");
    expect(chip.closest(".data-table__chip")).toHaveClass("data-table__chip--hidden");
  });

  it("should not mark a filter on a displayed column as hidden", () => {
    // Given: a filter whose dimension is among the table's own columns
    // When: the bar renders
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter({ hiddenColumn: false })]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );

    // Then:
    const chip = screen.getByText("Channel: Display");
    expect(chip).not.toHaveAttribute("title");
    expect(chip.closest(".data-table__chip")).not.toHaveClass("data-table__chip--hidden");
  });

  it("should call onOpenDate with the pill itself as the anchor", async () => {
    // Given:
    const onOpenDate = vi.fn();
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={onOpenDate}
        filters={[]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    const pill = screen.getByRole("button", { name: "All dates" });

    // When:
    await userEvent.click(pill);

    // Then:
    expect(onOpenDate).toHaveBeenCalledWith(pill);
  });

  it("should call onOpenFieldPicker with the + Filter button itself as the anchor", async () => {
    // Given:
    const onOpenFieldPicker = vi.fn();
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[]}
        onOpenFieldPicker={onOpenFieldPicker}
        onClearAll={vi.fn()}
      />
    );
    const addFilter = screen.getByRole("button", { name: "Filter" });

    // When:
    await userEvent.click(addFilter);

    // Then:
    expect(onOpenFieldPicker).toHaveBeenCalledWith(addFilter);
  });

  it("should call a chip's edit with the chip label as the anchor when its label is clicked", async () => {
    // Given: clicking the label reopens the value popover (D5) - the × still removes it outright
    const edit = vi.fn();
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter({ edit })]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    const label = screen.getByText("Channel: Display");

    // When:
    await userEvent.click(label);

    // Then:
    expect(edit).toHaveBeenCalledWith(label);
  });

  it("should call a chip's clear when its × is clicked, not its edit", async () => {
    // Given:
    const edit = vi.fn();
    const clear = vi.fn();
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter({ edit, clear })]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
      />
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Clear the Channel filter" }));

    // Then:
    expect(clear).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
  });

  it("should call onClearAll when Clear all is clicked", async () => {
    // Given:
    const onClearAll = vi.fn();
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter()]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={onClearAll}
      />
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));

    // Then:
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("should disable every control while disabled", () => {
    // Given: the table is in Edit data mode, with one filter applied
    // When: the bar renders with disabled set
    render(
      <DataTableFilterBar
        dateLabel="All dates"
        onOpenDate={vi.fn()}
        filters={[aFilter()]}
        onOpenFieldPicker={vi.fn()}
        onClearAll={vi.fn()}
        disabled
      />
    );

    // Then:
    expect(screen.getByRole("button", { name: "All dates" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Filter" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeDisabled();
    expect(screen.getByText("Channel: Display")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear the Channel filter" })).toBeDisabled();
  });
});
