import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotesDocument, NotesPlainText } from "./notes-render";

describe("NotesDocument", () => {
  it("should draw headings, lists, quotes and marks as the editor wrote them", () => {
    // Given:
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Decisions" }] },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Raise bids" }] }] }],
        },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Client said so" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Important", marks: [{ type: "bold" }, { type: "italic" }] }] },
      ],
    };

    // When:
    const { container } = render(<NotesDocument doc={doc} />);

    // Then:
    expect(screen.getByRole("heading", { level: 2, name: "Decisions" })).toBeInTheDocument();
    expect(container.querySelector("ol")).toHaveAttribute("start", "3");
    expect(screen.getByRole("listitem")).toHaveTextContent("Raise bids");
    expect(container.querySelector("blockquote")).toHaveTextContent("Client said so");
    expect(container.querySelector("em > strong, strong > em")).toHaveTextContent("Important");
  });

  it("should open an http link in a new tab, without handing it the opener", () => {
    // Given:
    const doc = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Media plan", marks: [{ type: "link", attrs: { href: "https://example.com/plan" } }] }],
      }],
    };

    // When:
    render(<NotesDocument doc={doc} />);

    // Then:
    const link = screen.getByRole("link", { name: "Media plan" });
    expect(link).toHaveAttribute("href", "https://example.com/plan");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("should draw an unsafe link as plain text and an unknown node as its text, never as markup", () => {
    // Given:
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "iframe", content: [{ type: "text", text: "<b>kept as text</b>" }] },
      ],
    };

    // When:
    const { container } = render(<NotesDocument doc={doc} />);

    // Then:
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("click")).toBeInTheDocument();
    expect(container.querySelector("iframe, b")).toBeNull();
    expect(container).toHaveTextContent("<b>kept as text</b>");
  });
});

describe("NotesPlainText", () => {
  it("should draw an older pacing's plain text one paragraph per non-blank line", () => {
    const { container } = render(<NotesPlainText text={"Launch Monday\n\nCheck pacing Friday"} />);

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container).toHaveTextContent("Launch Monday");
  });
});
