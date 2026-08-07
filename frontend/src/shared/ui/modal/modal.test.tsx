import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./modal";

describe("Modal", () => {
  afterEach(() => {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  it("should not render anything when closed", () => {
    // Given/When:
    render(
      <Modal open={false} onClose={vi.fn()} title="Test modal">
        <button type="button">Inside</button>
      </Modal>
    );

    // Then:
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should render the title, subtitle, and children when open", () => {
    // Given/When:
    render(
      <Modal open onClose={vi.fn()} title="Test modal" subtitle="A subtitle">
        <button type="button">Inside</button>
      </Modal>
    );

    // Then:
    expect(screen.getByRole("dialog", { name: "Test modal" })).toBeInTheDocument();
    expect(screen.getByText("A subtitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inside" })).toBeInTheDocument();
  });

  it("should close on Escape", async () => {
    // Given:
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test modal">
        <button type="button">Inside</button>
      </Modal>
    );

    // When:
    await userEvent.keyboard("{Escape}");

    // Then:
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("should close when the overlay (but not the card) is clicked", async () => {
    // Given:
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test modal">
        <button type="button">Inside</button>
      </Modal>
    );

    // When: clicking inside the card
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
      <Modal open onClose={vi.fn()} title="Test modal">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    );

    // Then:
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("should lock page scrolling while open and restore it when closed", () => {
    // Given:
    document.body.style.overflow = "auto";

    // When:
    const { rerender } = render(
      <Modal open onClose={vi.fn()} title="Test modal">
        <button type="button">Inside</button>
      </Modal>
    );

    // Then:
    expect(document.body.style.overflow).toBe("hidden");

    // When:
    rerender(
      <Modal open={false} onClose={vi.fn()} title="Test modal">
        <button type="button">Inside</button>
      </Modal>
    );

    // Then:
    expect(document.body.style.overflow).toBe("auto");
  });

  it("should keep page scrolling locked until every open modal is gone", () => {
    // Given:
    const { rerender } = render(
      <>
        <Modal open onClose={vi.fn()} title="First modal">
          <button type="button">First</button>
        </Modal>
        <Modal open onClose={vi.fn()} title="Second modal">
          <button type="button">Second</button>
        </Modal>
      </>
    );

    // When:
    rerender(
      <>
        <Modal open={false} onClose={vi.fn()} title="First modal">
          <button type="button">First</button>
        </Modal>
        <Modal open onClose={vi.fn()} title="Second modal">
          <button type="button">Second</button>
        </Modal>
      </>
    );

    // Then:
    expect(document.body.style.overflow).toBe("hidden");

    // When:
    rerender(
      <>
        <Modal open={false} onClose={vi.fn()} title="First modal">
          <button type="button">First</button>
        </Modal>
        <Modal open={false} onClose={vi.fn()} title="Second modal">
          <button type="button">Second</button>
        </Modal>
      </>
    );

    // Then:
    expect(document.body.style.overflow).toBe("");
  });

  it("should trap Tab focus inside the card, wrapping from the last element back to the first", async () => {
    // Given:
    render(
      <Modal open onClose={vi.fn()} title="Test modal">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
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
