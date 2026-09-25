import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./modal";

describe("Modal", () => {
  afterEach(() => {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
    document.body.classList.remove("modal-open");
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

  it("should render its own close button and close when it is clicked", async () => {
    // Given: no caller-supplied close control — the primitive owns the only one
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test modal">
        <button type="button">Inside</button>
      </Modal>
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    // Then:
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it("should focus the first control in the body on open, not the header's close button", () => {
    // Given/When:
    render(
      <Modal open onClose={vi.fn()} title="Test modal">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    );

    // Then: opening a modal should put the caret where the work is. The close button sits earlier in
    // the DOM, so "the first focusable element" would land on the way OUT of the dialog instead.
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close" })).not.toHaveFocus();
  });

  it("should still focus the close button when the body has nothing focusable", () => {
    // Given/When:
    render(
      <Modal open onClose={vi.fn()} title="Test modal">
        <p>Nothing to interact with.</p>
      </Modal>
    );

    // Then: focus must stay inside the dialog for the Tab trap to hold, so the header is the
    // fallback rather than leaving focus on whatever was behind the overlay.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("should not steal focus back on a re-render while someone is typing", async () => {
    // Given: the caller passes a fresh onClose each render, as nearly every call site does.
    function Harness() {
      const [text, setText] = useState("");
      return (
        <Modal open onClose={() => undefined} title="Test modal">
          <input aria-label="Field" value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      );
    }
    render(<Harness />);
    const field = screen.getByLabelText("Field");

    // When: each keystroke re-renders the parent, which used to re-run the focus effect.
    await userEvent.type(field, "abc");

    // Then:
    expect(field).toHaveValue("abc");
    expect(field).toHaveFocus();
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
    expect(document.body).toHaveClass("modal-open");

    // When:
    rerender(
      <Modal open={false} onClose={vi.fn()} title="Test modal">
        <button type="button">Inside</button>
      </Modal>
    );

    // Then:
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body).not.toHaveClass("modal-open");
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
    expect(document.body).toHaveClass("modal-open");

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
    expect(document.body).not.toHaveClass("modal-open");
  });

  it("should render into document.body rather than the caller's own DOM subtree", () => {
    // Given: a caller that opens its own stacking context, the way `<aside class="sidebar">` does -
    // rendered in place, an overlay nested inside it could never outrank page content beside it
    render(
      <div data-testid="ancestor" style={{ position: "sticky" }}>
        <Modal open onClose={vi.fn()} title="Test modal">
          <button type="button">Inside</button>
        </Modal>
      </div>
    );

    // Then: the dialog is not a descendant of that ancestor - it is a portal, mounted directly on body
    const ancestor = screen.getByTestId("ancestor");
    const dialog = screen.getByRole("dialog");
    expect(ancestor).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
    // And it still renders exactly once, not once in place plus once portaled
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("should trap Tab focus inside the card, wrapping from the last element back to the first", async () => {
    // Given: the card's own close button is the first focusable element, ahead of the children
    render(
      <Modal open onClose={vi.fn()} title="Test modal">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>
    );
    const close = screen.getByRole("button", { name: "Close" });
    const second = screen.getByRole("button", { name: "Second" });
    second.focus();

    // When: tabbing forward from the last element
    await userEvent.tab();

    // Then: focus wraps to the first (the close button)
    expect(close).toHaveFocus();

    // When: shift-tabbing back from the first element
    await userEvent.tab({ shift: true });

    // Then: focus wraps to the last
    expect(second).toHaveFocus();
  });
});
