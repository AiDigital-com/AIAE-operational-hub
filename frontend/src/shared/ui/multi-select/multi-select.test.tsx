import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MultiSelect, type MultiSelectOption } from "./multi-select";

const AGENCIES: MultiSelectOption[] = [
  { id: 1, name: "Northstar Media" },
  { id: 2, name: "Blue Chair" },
].map((agency) => ({ id: agency.id, label: agency.name }));

/** Wraps the controlled component in the minimal state a real caller owns. */
function Harness({
  options = AGENCIES,
  onChange,
  ...rest
}: Partial<Parameters<typeof MultiSelect>[0]> & { onChange?: (selected: number[]) => void } = {}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  return (
    <MultiSelect
      label="All agencies"
      options={options}
      selected={selected}
      onChange={(next) => {
        setSelected(next);
        onChange?.(next);
      }}
      search={search}
      onSearchChange={setSearch}
      {...rest}
    />
  );
}

describe("MultiSelect", () => {
  it("should show the label and no options until it is opened", () => {
    // Given / When:
    render(<Harness />);

    // Then:
    expect(screen.getByRole("button", { name: "All agencies" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Blue Chair" })).not.toBeInTheDocument();
  });

  it("should report each selected id back to the caller", async () => {
    // Given:
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // When:
    await userEvent.click(screen.getByRole("checkbox", { name: "Blue Chair" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Northstar Media" }));

    // Then:
    expect(onChange).toHaveBeenNthCalledWith(1, [2]);
    expect(onChange).toHaveBeenNthCalledWith(2, [2, 1]);
  });

  it("should de-select an option that is clicked again", async () => {
    // Given:
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Blue Chair" }));

    // When:
    await userEvent.click(screen.getByRole("checkbox", { name: "Blue Chair" }));

    // Then:
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("should summarize a single selection by name and several by count", async () => {
    // Given:
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // When:
    await userEvent.click(screen.getByRole("checkbox", { name: "Blue Chair" }));

    // Then:
    expect(screen.getByRole("button", { name: "All agencies" })).toHaveTextContent("Blue Chair");

    // When:
    await userEvent.click(screen.getByRole("checkbox", { name: "Northstar Media" }));

    // Then:
    expect(screen.getByRole("button", { name: "All agencies" })).toHaveTextContent("2 selected");
  });

  it("should clear the whole selection at once", async () => {
    // Given:
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Blue Chair" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Clear All agencies" }));

    // Then:
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("should hand the typed term to the caller instead of filtering the options itself", async () => {
    // Given: searching is the caller's job, so it can run server-side
    const onSearchChange = vi.fn();
    render(
      <MultiSelect
        label="All agencies"
        options={AGENCIES}
        selected={[]}
        onChange={vi.fn()}
        search=""
        onSearchChange={onSearchChange}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // When:
    await userEvent.type(screen.getByLabelText("Search all agencies"), "b");

    // Then: both options are still listed - this component never filters them
    expect(onSearchChange).toHaveBeenCalledWith("b");
    expect(screen.getByRole("checkbox", { name: "Northstar Media" })).toBeInTheDocument();
  });

  it("should keep listing a selected option the current search no longer returns", async () => {
    // Given: "Blue Chair" is selected while it is still in the option list
    const props = {
      label: "All agencies",
      onChange: vi.fn(),
      onSearchChange: vi.fn(),
    };
    const { rerender } = render(
      <MultiSelect {...props} options={AGENCIES} selected={[]} search="" />
    );
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Blue Chair" }));

    // When: a new search term returns a page that excludes it (same instance, so it stays open)
    rerender(
      <MultiSelect
        {...props}
        options={[{ id: 3, label: "Explore Communications" }]}
        selected={[2]}
        search="explore"
      />
    );

    // Then: it stays listed and checked, so the active filter can still be undone
    expect(screen.getByRole("checkbox", { name: "Blue Chair" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Explore Communications" })).toBeInTheDocument();
  });

  it("should show a loading indicator while options are being fetched", async () => {
    // Given:
    render(<Harness isPending />);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // Then:
    expect(screen.getByRole("status", { name: "Loading all agencies" })).toBeInTheDocument();
  });

  it("should show a human-readable error when the options fail to load", async () => {
    // Given:
    render(<Harness error={new Error("Something went wrong. Please try again.")} />);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // Then:
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("should offer to load more when more options exist than are loaded", async () => {
    // Given:
    const onLoadMore = vi.fn();
    render(<Harness hasMore onLoadMore={onLoadMore} />);
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    // Then:
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("should close on Escape", async () => {
    // Given:
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // When:
    await userEvent.keyboard("{Escape}");

    // Then:
    expect(screen.queryByRole("checkbox", { name: "Blue Chair" })).not.toBeInTheDocument();
  });

  it("should close when clicking outside of it", async () => {
    // Given:
    render(
      <div>
        <Harness />
        <button type="button">Elsewhere</button>
      </div>
    );
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));

    // Then:
    expect(screen.queryByRole("checkbox", { name: "Blue Chair" })).not.toBeInTheDocument();
  });

  it("should tell the user when there is nothing matching the search", async () => {
    // Given:
    render(
      <MultiSelect
        label="All agencies"
        options={[]}
        selected={[]}
        onChange={vi.fn()}
        search="zzz"
        onSearchChange={vi.fn()}
      />
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: "All agencies" }));

    // Then:
    expect(screen.getByText('No matches for “zzz”.')).toBeInTheDocument();
  });
});
