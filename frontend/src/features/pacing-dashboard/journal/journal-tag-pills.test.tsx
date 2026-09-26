import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JournalTagPills } from "./journal-tag-pills";

describe("JournalTagPills", () => {
  it("renders nothing when no entry carries a tag", () => {
    const { container } = render(<JournalTagPills entries={[{ msg: "Plain note" }]} active={null} onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one pill per distinct tag across entries, deduped", () => {
    render(
      <JournalTagPills
        entries={[{ msg: "#LI:1 kickoff" }, { msg: "#LI:1 again" }, { msg: "#ch:Display go" }]}
        active={null}
        onToggle={vi.fn()}
      />
    );
    expect(screen.getByTitle("Filter by #LI:1")).toBeInTheDocument();
    expect(screen.getByTitle("Filter by #ch:Display")).toBeInTheDocument();
  });

  it("toggles the tag on click, and clears via the Clear pill", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<JournalTagPills entries={[{ msg: "#LI:1 kickoff" }]} active={null} onToggle={onToggle} />);

    await userEvent.click(screen.getByTitle("Filter by #LI:1"));
    expect(onToggle).toHaveBeenCalledWith("#LI:1");

    rerender(<JournalTagPills entries={[{ msg: "#LI:1 kickoff" }]} active="#LI:1" onToggle={onToggle} />);
    expect(screen.getByTitle("Clear filter")).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Filter by #LI:1"));
    expect(onToggle).toHaveBeenLastCalledWith(null); // clicking the active pill toggles it off

    await userEvent.click(screen.getByTitle("Clear filter"));
    expect(onToggle).toHaveBeenLastCalledWith(null);
  });
});
