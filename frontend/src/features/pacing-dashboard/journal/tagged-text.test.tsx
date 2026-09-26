import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaggedText } from "./tagged-text";
import type { TagSource } from "./tags-core";

const SOURCES: TagSource[] = [{ type: "LI", value: "42", display: "42 — Video Prospecting" }];

describe("TaggedText", () => {
  it("renders plain text with no tags unchanged", () => {
    render(<TaggedText text="Kicked off the campaign" sources={[]} />);
    expect(screen.getByText("Kicked off the campaign")).toBeInTheDocument();
  });

  it("renders a known tag as a badge carrying its type and value", () => {
    render(<TaggedText text="Paused #LI:42 for review" sources={SOURCES} />);
    expect(screen.getByText("LI")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByTitle("LI: 42")).toBeInTheDocument();
  });

  it("renders an unknown tag muted with a dashed marker, not as a confirmed reference", () => {
    render(<TaggedText text="Paused #LI:999 for review" sources={SOURCES} />);
    expect(screen.getByTitle("unknown LI: 999")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("keeps the surrounding text around a badge intact", () => {
    render(<TaggedText text="before #ch:Display after" sources={[{ type: "ch", value: "Display", display: "Display" }]} />);
    expect(screen.getByText(/before/)).toBeInTheDocument();
    expect(screen.getByText(/after/)).toBeInTheDocument();
    expect(screen.getByTitle("ch: Display")).toBeInTheDocument();
  });
});
