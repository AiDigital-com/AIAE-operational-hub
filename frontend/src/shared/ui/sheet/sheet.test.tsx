import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./sheet";

describe("Sheet", () => {
  it("should not render anything when closed", () => {
    // Given/When:
    render(
      <Sheet open={false} onClose={vi.fn()} title="Test sheet">
        <button type="button">Inside</button>
      </Sheet>
    );

    // Then:
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should render the title, tabs, footer, and children when open", () => {
    // Given/When:
    render(
      <Sheet
        open
        onClose={vi.fn()}
        title="Test sheet"
        tabs={<button type="button">A tab</button>}
        footer={<button type="button">Save</button>}
      >
        <button type="button">Inside</button>
      </Sheet>
    );

    // Then:
    expect(screen.getByRole("dialog", { name: "Test sheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A tab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inside" })).toBeInTheDocument();
  });

  it("should close on Escape", async () => {
    // Given:
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Test sheet">
        <button type="button">Inside</button>
      </Sheet>
    );

    // When:
    await userEvent.keyboard("{Escape}");

    // Then:
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should close when the overlay (but not the panel) is clicked", async () => {
    // Given:
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Test sheet">
        <button type="button">Inside</button>
      </Sheet>
    );

    // When: clicking inside the panel
    await userEvent.click(screen.getByRole("button", { name: "Inside" }));

    // Then: does not close
    expect(onClose).not.toHaveBeenCalled();

    // When: clicking the overlay itself (the dialog's parent)
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    await userEvent.click(overlay);

    // Then:
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should focus the first focusable element on open", () => {
    // Given/When:
    render(
      <Sheet open onClose={vi.fn()} title="Test sheet">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Sheet>
    );

    // Then:
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("should trap Tab focus inside the panel, wrapping from the last element back to the first", async () => {
    // Given:
    render(
      <Sheet open onClose={vi.fn()} title="Test sheet">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Sheet>
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    second.focus();

    // When: tabbing forward from the last element
    await userEvent.tab();

    // Then: focus wraps to the first
    expect(first).toHaveFocus();

    // When: shift-tabbing back from the first element
    await userEvent.tab({ shift: true });

    // Then: focus wraps to the last
    expect(second).toHaveFocus();
  });
});
