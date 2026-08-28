import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTableDateFilterPopover, DataTableFieldPickerPopover, DataTableValueFilterPopover } from "./data-table-popover";
import type { FilterField } from "./data-table-filter-bar-model";

/** A `<th>`-shaped anchor, since that is what a column filter is opened out of. */
function anAnchor(): HTMLElement {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  return anchor;
}

describe("DataTableValueFilterPopover", () => {
  it("should stage the checked values and commit them all on Done", async () => {
    // Given: a column whose filter offers three values, none applied yet
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <DataTableValueFilterPopover
        label="Channel"
        values={["Display", "Video", "Search"]}
        initialSelected={[]}
        anchor={anAnchor()}
        onApply={onApply}
        onClose={onClose}
      />
    );

    // When: two are checked and Done is pressed
    await userEvent.click(await screen.findByRole("checkbox", { name: "Display" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Search" }));
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then: the pair is applied once, as one narrowing rather than two
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(["Display", "Search"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should open with the values already applied checked", async () => {
    // Given: a filter opened on a column already narrowed to one value
    render(
      <DataTableValueFilterPopover
        label="Channel"
        values={["Display", "Video"]}
        initialSelected={["Video"]}
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Then: that value reads as checked and the other does not
    expect(await screen.findByRole("checkbox", { name: "Video" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Display" })).not.toBeChecked();
  });

  it("should narrow the list to what the search matches", async () => {
    // Given: a filter over values only one of which contains "vid"
    render(
      <DataTableValueFilterPopover
        label="Channel"
        values={["Display", "Video", "Search"]}
        initialSelected={[]}
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // When: that is typed into the search
    await userEvent.type(screen.getByRole("textbox", { name: "Search channel values" }), "vid");

    // Then: once the search settles, only the match is listed
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Display" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Video" })).toBeInTheDocument();
  });

  it("should say so when the search matches nothing", async () => {
    // Given: a filter over values none of which contain "zz"
    render(
      <DataTableValueFilterPopover
        label="Channel"
        values={["Display", "Video"]}
        initialSelected={[]}
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // When: that is typed into the search
    await userEvent.type(screen.getByRole("textbox", { name: "Search channel values" }), "zz");

    // Then: the empty list explains itself rather than reading as a failed load
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  });

  it("should check and clear every value from the list actions", async () => {
    // Given: a filter over two values
    const onApply = vi.fn();
    render(
      <DataTableValueFilterPopover
        label="Channel"
        values={["Display", "Video"]}
        initialSelected={[]}
        anchor={anAnchor()}
        onApply={onApply}
        onClose={vi.fn()}
      />
    );

    // When: Select all is pressed
    await userEvent.click(screen.getByRole("button", { name: "Select all" }));

    // Then: both are checked
    expect(await screen.findByRole("checkbox", { name: "Display" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Video" })).toBeChecked();

    // When: Clear is pressed and the filter committed
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then: nothing is applied, which is the filter switched off
    expect(onApply).toHaveBeenCalledWith([]);
  });

  it("should show a spinner instead of the list while the values are being read", () => {
    // Given: a filter whose values have not arrived yet
    render(
      <DataTableValueFilterPopover
        label="Channel"
        values={[]}
        initialSelected={[]}
        isPending
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Then: it says it is loading and offers nothing to check
    expect(screen.getByLabelText("Loading values")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("should show the consumer's error instead of the list when the read failed", () => {
    // Given: a filter whose value read failed
    render(
      <DataTableValueFilterPopover
        label="Channel"
        values={[]}
        initialSelected={[]}
        errorMessage="BigQuery said no."
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Then: the failure is stated rather than shown as an empty list
    expect(screen.getByText("BigQuery said no.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("DataTableDateFilterPopover", () => {
  it("should commit the staged range on Done", async () => {
    // Given: an unfiltered date column
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <DataTableDateFilterPopover
        range={{ from: "", to: "" }}
        anchor={anAnchor()}
        onApply={onApply}
        onClose={onClose}
      />
    );

    // When: both sides are picked and Done pressed
    const [from, to] = screen.getAllByLabelText(/From|To/);
    await userEvent.type(from, "2026-01-01");
    await userEvent.type(to, "2026-01-31");
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then: the window is applied once, not once per field
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-01-31" });
    expect(onClose).toHaveBeenCalled();
  });

  it("should refuse a range that starts after it ends", async () => {
    // Given: a date filter opened on a window whose start is past its end
    const onApply = vi.fn();
    render(
      <DataTableDateFilterPopover
        range={{ from: "2026-03-01", to: "2026-01-01" }}
        anchor={anAnchor()}
        onApply={onApply}
        onClose={vi.fn()}
      />
    );

    // Then: it says why and will not commit
    expect(screen.getByText("The start date is after the end date.")).toBeInTheDocument();
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    await userEvent.click(done);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("should clamp each field against the other so an impossible range is hard to pick", () => {
    // Given: a date filter with both sides set
    render(
      <DataTableDateFilterPopover
        range={{ from: "2026-01-01", to: "2026-01-31" }}
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Then: From cannot pass To, and To cannot precede From
    expect(screen.getByLabelText("From")).toHaveAttribute("max", "2026-01-31");
    expect(screen.getByLabelText("To")).toHaveAttribute("min", "2026-01-01");
  });

  it("should clear the window without staging anything", async () => {
    // Given: a date filter opened on an applied window
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <DataTableDateFilterPopover
        range={{ from: "2026-01-01", to: "2026-01-31" }}
        anchor={anAnchor()}
        onApply={onApply}
        onClose={onClose}
      />
    );

    // When: Clear is pressed
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    // Then: the open-ended window is applied immediately, not left staged behind a Done
    expect(onApply).toHaveBeenCalledWith({ from: "", to: "" });
    expect(onClose).toHaveBeenCalled();
  });

  it("should state the dataset's own bounds when the consumer knows them", () => {
    // Given: a date filter given a hint about the dates with data
    render(
      <DataTableDateFilterPopover
        range={{ from: "", to: "" }}
        hint="Data available 1 Jan 2026 — 31 Mar 2026."
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Then: it is said under the fields, rather than clamped onto them
    expect(screen.getByText("Data available 1 Jan 2026 — 31 Mar 2026.")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).not.toHaveAttribute("min");
  });

  it("should name itself after the column it filters", () => {
    // Given: a date filter on a column that is not called Date
    render(
      <DataTableDateFilterPopover
        label="Week (Mon start)"
        range={{ from: "", to: "" }}
        anchor={anAnchor()}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Then: the dialog is named for that column
    expect(screen.getByRole("dialog", { name: "Filter — Week (Mon start)" })).toBeInTheDocument();
  });
});

function aField(overrides: Partial<FilterField> = {}): FilterField {
  return { id: "channel", label: "Channel", ...overrides };
}

describe("DataTableFieldPickerPopover", () => {
  it("should name itself 'Add filter' rather than naming a column", () => {
    // Given / When: stage 1 of the Filters bar's + Filter control is not filtering any one column yet
    render(
      <DataTableFieldPickerPopover
        fields={[aField()]}
        filteredIds={[]}
        anchor={anAnchor()}
        onPick={vi.fn()}
      />
    );

    // Then:
    expect(screen.getByRole("dialog", { name: "Add filter" })).toBeInTheDocument();
  });

  it("should list every field sorted by label", () => {
    // Given / When: fields given out of alphabetical order
    render(
      <DataTableFieldPickerPopover
        fields={[aField({ id: "platform", label: "Platform" }), aField({ id: "channel", label: "Channel" })]}
        filteredIds={[]}
        anchor={anAnchor()}
        onPick={vi.fn()}
      />
    );

    // Then: scoped to the dialog itself - the anchor fixture is its own button in the document
    const rows = within(screen.getByRole("dialog")).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Channel");
    expect(rows[1]).toHaveTextContent("Platform");
  });

  it("should show a field's description as secondary text when present", () => {
    // Given / When: a dimension meaningless without its own hint
    render(
      <DataTableFieldPickerPopover
        fields={[aField({ id: "line_item_id", label: "Constructed id L1", description: "Per-platform meaning" })]}
        filteredIds={[]}
        anchor={anAnchor()}
        onPick={vi.fn()}
      />
    );

    // Then:
    expect(screen.getByText("Constructed id L1")).toBeInTheDocument();
    expect(screen.getByText("Per-platform meaning")).toBeInTheDocument();
  });

  it("should mark an already-filtered field with a Filtered badge", () => {
    // Given / When: the picker doubles as an editor for a field already carrying a filter
    render(
      <DataTableFieldPickerPopover
        fields={[aField()]}
        filteredIds={["channel"]}
        anchor={anAnchor()}
        onPick={vi.fn()}
      />
    );

    // Then:
    expect(screen.getByText("Filtered")).toBeInTheDocument();
  });

  it("should not badge a field that carries no filter", () => {
    // Given / When:
    render(
      <DataTableFieldPickerPopover
        fields={[aField()]}
        filteredIds={[]}
        anchor={anAnchor()}
        onPick={vi.fn()}
      />
    );

    // Then:
    expect(screen.queryByText("Filtered")).not.toBeInTheDocument();
  });

  it("should narrow the list to what the search matches", async () => {
    // Given: two fields, only one containing "chan"
    render(
      <DataTableFieldPickerPopover
        fields={[aField({ id: "platform", label: "Platform" }), aField({ id: "channel", label: "Channel" })]}
        filteredIds={[]}
        anchor={anAnchor()}
        onPick={vi.fn()}
      />
    );

    // When:
    await userEvent.type(screen.getByRole("textbox", { name: "Search fields" }), "chan");

    // Then: once the search settles, only the match is listed
    await waitFor(() => expect(screen.queryByText("Platform")).not.toBeInTheDocument());
    expect(screen.getByText("Channel")).toBeInTheDocument();
  });

  it("should say so when the search matches no field", async () => {
    // Given:
    render(
      <DataTableFieldPickerPopover
        fields={[aField()]}
        filteredIds={[]}
        anchor={anAnchor()}
        onPick={vi.fn()}
      />
    );

    // When:
    await userEvent.type(screen.getByRole("textbox", { name: "Search fields" }), "zzz");

    // Then:
    expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  });

  it("should call onPick with the clicked field's id", async () => {
    // Given: picking a field hands off to stage 2 (the value popover) - this popover has no Done of
    // its own to commit
    const onPick = vi.fn();
    render(
      <DataTableFieldPickerPopover
        fields={[aField({ id: "channel", label: "Channel" })]}
        filteredIds={[]}
        anchor={anAnchor()}
        onPick={onPick}
      />
    );

    // When:
    await userEvent.click(screen.getByText("Channel"));

    // Then:
    expect(onPick).toHaveBeenCalledWith("channel");
  });
});
