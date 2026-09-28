import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../shared/ui/toast/toast";
import { DocumentsChips } from "./documents-chips";
import type { DocumentsChipsProps } from "./documents-chips";

function renderChips(overrides: Partial<DocumentsChipsProps> = {}) {
  const onOpenDocuments = vi.fn();
  render(
    <ToastProvider>
      <DocumentsChips
        links={[]}
        orderNumber=""
        sourceUrl=""
        onOpenDocuments={onOpenDocuments}
        {...overrides}
      />
    </ToastProvider>
  );
  return { onOpenDocuments };
}

describe("DocumentsChips", () => {
  it("should render every saved link as a new-tab anchor, DSPs first", () => {
    // Given: a mixed cloud (US-140: links open in a new tab)
    renderChips({
      links: [
        { name: "Asana", url: "https://app.asana.com/0/1/2" },
        { name: "DV360", url: "https://displayvideo.google.com/p/1" },
        { name: "Media Plan", url: "https://drive.google.com/x" },
      ],
    });

    // Then: all three are links with the new-tab attributes
    const anchors = screen.getAllByRole("link").filter((a) => a.textContent !== "Data source");
    expect(anchors.map((a) => a.textContent)).toEqual(["DV360", "Asana", "Media Plan"]);
    for (const anchor of anchors) {
      expect(anchor).toHaveAttribute("target", "_blank");
      expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("should offer a single Add pill that opens the Documents tab when no links are saved (US-140)", async () => {
    // Given: an empty field must show an Add action
    const { onOpenDocuments } = renderChips({ links: [] });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "+ Add documents" }));

    // Then:
    expect(onOpenDocuments).toHaveBeenCalledTimes(1);
  });

  it("should hide the Add pill once any link exists", () => {
    // Given:
    renderChips({ links: [{ name: "IO", url: "https://example.com/io" }] });

    // Then: the pill is an empty-state affordance, not a permanent button
    expect(screen.queryByRole("button", { name: "+ Add documents" })).not.toBeInTheDocument();
  });

  it("should show a disabled Data source chip while no source is connected", () => {
    // Given: the mocked state this deployment lives in - nothing writes the source column yet
    // (owner decision, §16): the chip is drawn grey and inert, with the explanation on it
    renderChips({ sourceUrl: "" });

    // Then: present, explained, and NOT a link
    const chip = screen.getByTitle("Source not connected yet");
    expect(chip).toHaveTextContent("Data source");
    expect(chip.tagName).not.toBe("A");
    expect(screen.queryByRole("link", { name: "Data source" })).not.toBeInTheDocument();
  });

  it("should turn the Data source chip into a working link the moment a source URL exists", () => {
    // Given: the same prop path, non-empty - no code change is supposed to be needed when the
    // column starts being written, so this state must already work today
    renderChips({ sourceUrl: "https://docs.google.com/spreadsheets/d/abc" });

    // Then:
    const chip = screen.getByRole("link", { name: "Data source" });
    expect(chip).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/abc");
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByTitle("Source not connected yet")).not.toBeInTheDocument();
  });

  it("should copy the IO number on click and confirm with a toast", async () => {
    // Given: the IO is a number to paste into NetSuite, not a link - a click copies it
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderChips({ orderNumber: "SO-12345" });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Copy IO SO-12345" }));

    // Then:
    expect(writeText).toHaveBeenCalledWith("SO-12345");
    await waitFor(() => expect(screen.getByText("IO SO-12345 copied")).toBeInTheDocument());
  });
});
