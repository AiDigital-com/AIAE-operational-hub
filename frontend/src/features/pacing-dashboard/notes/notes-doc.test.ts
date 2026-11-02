import { describe, expect, it } from "vitest";
import {
  EMPTY_NOTES_DOC,
  docFromPlainText,
  hasAnyNotes,
  hasMeaningfulNotes,
  isAllowedHref,
  plainTextFromDoc,
} from "./notes-doc";

const text = (t: string) => ({ type: "text", text: t });

describe("notes-doc", () => {
  it("should derive one line per block and per hard break, dropping blank lines - Pacing's rule", () => {
    // Given:
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Launch")] },
        { type: "paragraph" },
        { type: "paragraph", content: [text("Line one"), { type: "hardBreak" }, text("line two")] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("a point")] }] }] },
      ],
    };

    // When / Then:
    expect(plainTextFromDoc(doc)).toBe("Launch\nLine one\nline two\na point");
  });

  it("should call a document with only whitespace empty, as Pacing does when it clears the notes", () => {
    expect(hasMeaningfulNotes({ type: "doc", content: [{ type: "paragraph", content: [text("   ")] }] })).toBe(false);
    expect(hasMeaningfulNotes(EMPTY_NOTES_DOC)).toBe(false);
    expect(hasMeaningfulNotes(null)).toBe(false);
    expect(hasMeaningfulNotes({ type: "doc", content: [{ type: "paragraph", content: [text("x")] }] })).toBe(true);
  });

  it("should count an older pacing's plain text as notes", () => {
    expect(hasAnyNotes(null, "Typed at create")).toBe(true);
    expect(hasAnyNotes(null, "  ")).toBe(false);
    expect(hasAnyNotes(undefined, null)).toBe(false);
  });

  it("should seed the editor from plain text, one paragraph per non-blank line", () => {
    expect(docFromPlainText("first\n\nsecond")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [text("first")] },
        { type: "paragraph", content: [text("second")] },
      ],
    });
    expect(docFromPlainText("")).toBe(EMPTY_NOTES_DOC);
  });

  it("should allow only http and https links", () => {
    expect(isAllowedHref("https://app.asana.com/0/1")).toBe(true);
    expect(isAllowedHref("http://example.com")).toBe(true);
    expect(isAllowedHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedHref("not a url")).toBe(false);
  });
});
