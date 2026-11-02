import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type MutableRefObject } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import NotesEditor, { type NotesEditorHandle } from "./notes-editor";

/**
 * jsdom does no layout, and its `Range` has neither `getClientRects` nor `getBoundingClientRect`.
 * ProseMirror asks a Range for both when it scrolls the caret into view - which TipTap does a moment
 * after any toolbar button takes focus - so without these an editor test throws an unhandled error
 * after it has passed (seen on CI, where it surfaced in whichever test ran next). Empty rectangles are
 * what a browser reports for content it has not laid out; scoped to this file and put back after.
 */
const rangeProto = Range.prototype as unknown as Record<string, unknown>;
const originalRangeRects = rangeProto.getClientRects;
const originalRangeBox = rangeProto.getBoundingClientRect;
beforeAll(() => {
  rangeProto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  rangeProto.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
afterAll(() => {
  rangeProto.getClientRects = originalRangeRects;
  rangeProto.getBoundingClientRect = originalRangeBox;
});

const DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Launch on Monday" }] }],
};

function renderEditor() {
  const editorRef = createRef<NotesEditorHandle>() as MutableRefObject<NotesEditorHandle | null>;
  const onDirtyChange = vi.fn();
  render(<NotesEditor initialDoc={DOC} onDirtyChange={onDirtyChange} editorRef={editorRef} />);
  return { editorRef, onDirtyChange };
}

describe("NotesEditor (the real TipTap)", () => {
  it("should start from the stored document and hand the same document back unchanged", async () => {
    // Given / When:
    const { editorRef } = renderEditor();

    // Then:
    await waitFor(() => expect(editorRef.current).not.toBeNull());
    expect(screen.getByText("Launch on Monday")).toBeInTheDocument();
    expect(editorRef.current?.getJSON()).toEqual(DOC);
  });

  it("should offer the reference's toolbar", async () => {
    // Given / When:
    renderEditor();

    // Then:
    const toolbar = await screen.findByRole("toolbar", { name: "Formatting" });
    for (const name of ["Heading 1", "Bold", "Italic", "Underline", "Bulleted list", "Numbered list", "Quote", "Code block", "Link"]) {
      expect(toolbar).toContainElement(screen.getByRole("button", { name }));
    }
  });

  it("should refuse a link that is not http or https", async () => {
    // Given:
    renderEditor();
    await userEvent.click(await screen.findByRole("button", { name: "Link" }));

    // When:
    await userEvent.type(screen.getByRole("textbox", { name: "Link address" }), "javascript:alert(1)");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then:
    expect(screen.getByText("http(s):// links only")).toBeInTheDocument();
  });

  it("should report a change once the document no longer equals the one it started from", async () => {
    // Given:
    const { editorRef, onDirtyChange } = renderEditor();
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    // When: a formatting change made through the toolbar
    await userEvent.click(screen.getByRole("button", { name: "Heading 1" }));

    // Then:
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(editorRef.current?.getJSON().content?.[0]?.type).toBe("heading");
    // The focus a toolbar button asks for scrolls to the caret a moment later; wait for it, so a
    // missing layout API fails HERE rather than in whichever test happens to be running then.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
