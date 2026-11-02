import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type MutableRefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { PacingDashboardV1 } from "../types";
import type { NotesEditorHandle } from "./notes-editor";
import type { NotesNode } from "./notes-doc";
import { NotesButton, NotesPanel } from "./notes-panel";

vi.mock("../api", () => ({
  savePacingCampaignNotes: vi.fn(),
}));

/** What the fake editor hands to Save; set per test. */
let typedDoc: NotesNode;
/** What the panel seeded the editor with. */
let seededDoc: NotesNode | null;

// TipTap is replaced by a stand-in: these cases are about the panel - what it reads, sends and
// guards - not about the editor library.
vi.mock("./notes-editor", () => ({
  default: function FakeEditor({
    initialDoc,
    onDirtyChange,
    editorRef,
  }: {
    initialDoc: NotesNode;
    onDirtyChange: (dirty: boolean) => void;
    editorRef: MutableRefObject<NotesEditorHandle | null>;
  }) {
    seededDoc = initialDoc;
    editorRef.current = { getJSON: () => typedDoc };
    return (
      <button type="button" onClick={() => onDirtyChange(true)}>
        Type something
      </button>
    );
  },
}));

const DOC: NotesNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Launch on Monday" }] }],
};

function renderPanel(campaign: { notesRich?: NotesNode | null; notes?: string | null } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["pacing", "dashboard", "nike-ss26"], {
    campaign: { slug: "nike-ss26", pacingId: "p1", name: "Nike", notesRich: campaign.notesRich ?? null, notes: campaign.notes ?? "" },
  } as unknown as PacingDashboardV1);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <NotesPanel
        open
        onClose={onClose}
        slug="nike-ss26"
        notesRich={campaign.notesRich ?? null}
        notes={campaign.notes ?? ""}
      />
    </QueryClientProvider>
  );
  return { onClose, queryClient };
}

describe("NotesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    typedDoc = DOC;
    seededDoc = null;
  });

  it("should invite the first note on a pacing with none, with nothing to copy", () => {
    // Given / When:
    renderPanel();

    // Then:
    expect(screen.getByRole("dialog", { name: "Campaign notes" })).toBeInTheDocument();
    expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add notes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("should show the stored document with Edit and Copy", () => {
    // Given / When:
    renderPanel({ notesRich: DOC, notes: "Launch on Monday" });

    // Then:
    expect(screen.getByText("Launch on Monday")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("should show an older pacing's plain text and seed the editor from it", async () => {
    // Given:
    renderPanel({ notesRich: null, notes: "Typed at create\nSecond line" });
    expect(screen.getByText("Typed at create")).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Type something" });

    // Then:
    expect(seededDoc).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Typed at create" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second line" }] },
      ],
    });
  });

  it("should save the whole document, show it at once and go back to reading", async () => {
    // Given:
    vi.mocked(api.savePacingCampaignNotes).mockResolvedValue(undefined);
    const { queryClient } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Add notes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Type something" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then: sent as is, and the cached dashboard carries it the way Pacing stores it
    expect(api.savePacingCampaignNotes).toHaveBeenCalledWith("nike-ss26", DOC);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    const cached = queryClient.getQueryData<PacingDashboardV1>(["pacing", "dashboard", "nike-ss26"]);
    expect(cached?.campaign?.notesRich).toEqual(DOC);
    expect(cached?.campaign?.notes).toBe("Launch on Monday");
  });

  it("should clear both copies in the cache when an empty document is saved, as Pacing does", async () => {
    // Given:
    vi.mocked(api.savePacingCampaignNotes).mockResolvedValue(undefined);
    typedDoc = { type: "doc", content: [{ type: "paragraph" }] };
    const { queryClient } = renderPanel({ notesRich: DOC, notes: "Launch on Monday" });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(await screen.findByRole("button", { name: "Type something" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then:
    await waitFor(() => {
      const cached = queryClient.getQueryData<PacingDashboardV1>(["pacing", "dashboard", "nike-ss26"]);
      expect(cached?.campaign?.notesRich).toBeNull();
      expect(cached?.campaign?.notes).toBe("");
    });
  });

  it("should keep the editor open and say why when Pacing refuses the document", async () => {
    // Given:
    vi.mocked(api.savePacingCampaignNotes).mockRejectedValue(
      new Error("The Pacing service rejected the request: the campaign notes are too long (128 KB at most).")
    );
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Add notes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Type something" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then:
    expect(await screen.findByText(/too long \(128 KB at most\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("should ask before throwing away unsaved edits, on Cancel and on Esc", async () => {
    // Given:
    const { onClose } = renderPanel({ notesRich: DOC, notes: "Launch on Monday" });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(await screen.findByRole("button", { name: "Type something" }));

    // When: Cancel
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Then: asked, not closed - and Keep editing goes back to the editor
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    // When: Esc, then Discard
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    // Then:
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.savePacingCampaignNotes).not.toHaveBeenCalled();
  });

  it("should close at once when nothing was changed", async () => {
    // Given:
    const { onClose } = renderPanel({ notesRich: DOC });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Type something" });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Then:
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("NotesButton", () => {
  it("should mark a pacing that has notes with a dot and open the panel on click", async () => {
    // Given:
    function Harness() {
      const [opened, setOpened] = useState(false);
      return (
        <>
          <NotesButton hasNotes onOpen={() => setOpened(true)} />
          {opened && <p>opened</p>}
        </>
      );
    }
    const { container } = render(<Harness />);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Campaign notes (has notes)" }));

    // Then:
    expect(container.querySelector(".notes-button__dot")).not.toBeNull();
    expect(screen.getByText("opened")).toBeInTheDocument();
  });

  it("should draw no dot on a pacing without notes", () => {
    const { container } = render(<NotesButton hasNotes={false} onOpen={() => {}} />);

    expect(screen.getByRole("button", { name: "Campaign notes" })).toBeInTheDocument();
    expect(container.querySelector(".notes-button__dot")).toBeNull();
  });
});
