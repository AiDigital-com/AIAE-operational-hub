import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listConstructedEntities, previewConstructedIds } from "../api";
import type { ConstructedEntityPageResponseV1, ConstructedIdsPreviewResponseV1 } from "../types";
import { AddLineIdCell } from "./add-line-id-cell";

vi.mock("../api", () => ({
  listConstructedEntities: vi.fn(),
  previewConstructedIds: vi.fn(),
}));

function emptyPage(): ConstructedEntityPageResponseV1 {
  return { pageNumber: 1, pageSize: 1, totalElements: 0, totalPages: 0, content: [] };
}

function pageWith(content: ConstructedEntityPageResponseV1["content"]): ConstructedEntityPageResponseV1 {
  return { pageNumber: 1, pageSize: 50, totalElements: content.length, totalPages: 1, content };
}

function generatedPreview(): ConstructedIdsPreviewResponseV1 {
  return {
    level1: { id: "OPH_generatedlevel1", origin: "GENERATED" },
    level2: { id: "OPH_generatedlevel2", origin: "GENERATED" },
    level3: { id: "OPH_generatedlevel3", origin: "GENERATED" },
  };
}

/** Wraps the controlled cell in the minimal state a real caller (`ReportingTab`) owns. */
function Harness({ typedName = "Retargeting" }: { typedName?: string }) {
  const [currentId, setCurrentId] = useState("");
  return (
    <>
      <AddLineIdCell
        campaignId={42}
        level="LVL1"
        platform=""
        accountId=""
        typedName={typedName}
        currentId={currentId}
        nameLvl1={typedName}
        nameLvl2="Insertion Order 1"
        nameLvl3="Creative 1"
        onResolved={(_level, id) => setCurrentId(id)}
      />
      <span data-testid="current-id">{currentId}</span>
    </>
  );
}

function renderCell(props?: Parameters<typeof Harness>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>
  );
}

describe("AddLineIdCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render no textbox for the id - it can never be typed", async () => {
    // Given:
    vi.mocked(listConstructedEntities).mockResolvedValue(emptyPage());

    // When:
    renderCell();

    // Then:
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("should show a spinner while the typed name is being resolved", async () => {
    // Given: a resolve request that never settles during the assertion window
    vi.mocked(listConstructedEntities).mockImplementation(() => new Promise(() => {}));

    // When:
    renderCell();

    // Then:
    expect(await screen.findByRole("status", { name: /Resolving LVL1 id/ })).toBeInTheDocument();
  });

  it("should silently fill the id when the typed name resolves to exactly one entity", async () => {
    // Given:
    vi.mocked(listConstructedEntities).mockResolvedValue(
      pageWith([{ name: "Retargeting", id: "12345", first_date: "2026-03-01", last_date: "2026-03-10", impressions: 500 }])
    );

    // When:
    renderCell();

    // Then: filled without any user action or confirmation, and the resolved value is read-only text
    await waitFor(() => expect(screen.getByTestId("current-id")).toHaveTextContent("12345"));
    expect(document.querySelector(".add-line-id__value")).toHaveTextContent("12345");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("should open a disambiguation popover listing id, date range and impressions when several entities match", async () => {
    // Given: constructed_name -> constructed_id is one-to-many (PDI_117-PLAN.md 2.1)
    vi.mocked(listConstructedEntities).mockResolvedValue(pageWith([
      { name: "Retargeting", id: "111", first_date: "2026-03-01", last_date: "2026-03-10", impressions: 500 },
      { name: "Retargeting", id: "222", first_date: "2026-04-01", last_date: "2026-04-10", impressions: 900 },
    ]));

    // When:
    renderCell();
    const ambiguousButton = await screen.findByRole("button", { name: "LVL1 id - 2 matches, pick one" });
    await userEvent.click(ambiguousButton);

    // Then: both candidates are listed with their discriminating data (reuses the shared
    // data-table-popover shell, whose title always carries its own "Filter — " prefix)
    expect(await screen.findByRole("dialog", { name: "Filter — LVL1 entity" })).toBeInTheDocument();
    expect(screen.getByText("111")).toBeInTheDocument();
    expect(screen.getByText("222")).toBeInTheDocument();
    expect(screen.getByText(/2026-03-01 to 2026-03-10 - 500 imp/)).toBeInTheDocument();
    expect(screen.getByText(/900 imp/)).toBeInTheDocument();

    // When: the user picks one
    await userEvent.click(screen.getByText("222"));

    // Then: that entity's id fills the cell and the popover closes
    await waitFor(() => expect(screen.getByTestId("current-id")).toHaveTextContent("222"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should show the chosen id, not the pick-one prompt, after a candidate is chosen from an ambiguous match", async () => {
    // Given: constructed_name -> constructed_id is one-to-many (PDI_117-PLAN.md 2.1) - matches.length > 1
    // stays true forever once ambiguous, so the chosen id must be read from currentId, not from the
    // matches count, or the cell would show "pick one" forever even after a valid pick.
    vi.mocked(listConstructedEntities).mockResolvedValue(pageWith([
      { name: "Retargeting", id: "111", first_date: "2026-03-01", last_date: "2026-03-10", impressions: 500 },
      { name: "Retargeting", id: "222", first_date: "2026-04-01", last_date: "2026-04-10", impressions: 900 },
      { name: "Retargeting", id: "333", first_date: "2026-05-01", last_date: "2026-05-10", impressions: 100 },
    ]));

    // When: the user opens the popover and picks a candidate
    renderCell();
    const ambiguousButton = await screen.findByRole("button", { name: "LVL1 id - 3 matches, pick one" });
    await userEvent.click(ambiguousButton);
    await userEvent.click(screen.getByText("222"));

    // Then: the chosen id is shown like a resolved value, and the pick-one prompt is gone
    await waitFor(() => expect(screen.getByTestId("current-id")).toHaveTextContent("222"));
    expect(document.querySelector(".add-line-id__value")).toHaveTextContent("222");
    expect(screen.queryByRole("button", { name: "LVL1 id - 3 matches, pick one" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should reopen the popover and update the displayed id when the user changes an already-chosen candidate", async () => {
    // Given: a candidate has already been chosen from a 3-match popover
    vi.mocked(listConstructedEntities).mockResolvedValue(pageWith([
      { name: "Retargeting", id: "111", first_date: "2026-03-01", last_date: "2026-03-10", impressions: 500 },
      { name: "Retargeting", id: "222", first_date: "2026-04-01", last_date: "2026-04-10", impressions: 900 },
      { name: "Retargeting", id: "333", first_date: "2026-05-01", last_date: "2026-05-10", impressions: 100 },
    ]));
    renderCell();
    await userEvent.click(await screen.findByRole("button", { name: "LVL1 id - 3 matches, pick one" }));
    await userEvent.click(screen.getByText("222"));
    await waitFor(() => expect(screen.getByTestId("current-id")).toHaveTextContent("222"));

    // When: the user reopens the popover through the adjacent control and picks a different candidate
    const changeButton = await screen.findByRole("button", { name: "LVL1 id - 3 matches, 222 chosen, change" });
    await userEvent.click(changeButton);
    expect(await screen.findByRole("dialog", { name: "Filter — LVL1 entity" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("333"));

    // Then: the displayed id updates to the new choice and the popover closes
    await waitFor(() => expect(screen.getByTestId("current-id")).toHaveTextContent("333"));
    expect(document.querySelector(".add-line-id__value")).toHaveTextContent("333");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should fall back to the pick-one prompt when the previously chosen id is no longer among the matches", async () => {
    // Given: a candidate is chosen for "Retargeting"
    vi.mocked(listConstructedEntities).mockResolvedValue(pageWith([
      { name: "Retargeting", id: "111", first_date: "2026-03-01", last_date: "2026-03-10", impressions: 500 },
      { name: "Retargeting", id: "222", first_date: "2026-04-01", last_date: "2026-04-10", impressions: 900 },
    ]));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function EditableHarness() {
      const [typedName, setTypedName] = useState("Retargeting");
      const [currentId, setCurrentId] = useState("");
      return (
        <>
          <input aria-label="type name" value={typedName} onChange={(event) => setTypedName(event.target.value)} />
          <AddLineIdCell
            campaignId={42}
            level="LVL1"
            platform=""
            accountId=""
            typedName={typedName}
            currentId={currentId}
            nameLvl1={typedName}
            nameLvl2="Insertion Order 1"
            nameLvl3="Creative 1"
            onResolved={(_level, id) => setCurrentId(id)}
          />
          <span data-testid="current-id">{currentId}</span>
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <EditableHarness />
      </QueryClientProvider>
    );
    await userEvent.click(await screen.findByRole("button", { name: "LVL1 id - 2 matches, pick one" }));
    await userEvent.click(screen.getByText("222"));
    await waitFor(() => expect(screen.getByTestId("current-id")).toHaveTextContent("222"));

    // When: the name is edited so the previous name's matches ("111"/"222") no longer apply and the
    // new name resolves to a different ambiguous set that does not include the stale chosen id
    vi.mocked(listConstructedEntities).mockResolvedValue(pageWith([
      { name: "Prospecting", id: "444", first_date: "2026-06-01", last_date: "2026-06-10", impressions: 50 },
      { name: "Prospecting", id: "555", first_date: "2026-07-01", last_date: "2026-07-10", impressions: 75 },
    ]));
    await userEvent.clear(screen.getByLabelText("type name"));
    await userEvent.type(screen.getByLabelText("type name"), "Prospecting");

    // Then: back to the pick-one prompt, not a stale id that no longer belongs to this name. The stale
    // "222" still lives in staged row state (D5 - the server re-validates and rejects it anyway), so the
    // assertion targets the cell's own display rather than any text on the page.
    expect(await screen.findByRole("button", { name: "LVL1 id - 2 matches, pick one" })).toBeInTheDocument();
    expect(document.querySelector(".add-line-id__value")).not.toBeInTheDocument();
    expect(document.querySelector(".add-line-id__change")).not.toBeInTheDocument();
  });

  it("should ask for confirmation, not generate silently, when the typed name matches nothing", async () => {
    // Given: D2/V8 - no whole-row mode; a level that resolves to nothing must be explicitly confirmed
    // before anything is generated
    vi.mocked(listConstructedEntities).mockResolvedValue(emptyPage());

    // When:
    renderCell();

    // Then: a confirmation prompt, not an id and not a silently-generated badge
    expect(await screen.findByRole("button", { name: "LVL1 id - no match, create it as new?" })).toBeInTheDocument();
    expect(screen.getByTestId("current-id")).toHaveTextContent("");
    expect(vi.mocked(previewConstructedIds)).not.toHaveBeenCalled();
  });

  it("should generate and show an OPH_ id badge only after the user confirms the level is new", async () => {
    // Given:
    vi.mocked(listConstructedEntities).mockResolvedValue(emptyPage());
    vi.mocked(previewConstructedIds).mockResolvedValue(generatedPreview());

    // When:
    renderCell();
    const confirmButton = await screen.findByRole("button", { name: "LVL1 id - no match, create it as new?" });
    await userEvent.click(confirmButton);

    // Then:
    expect(await screen.findByTitle("origin: GENERATED")).toHaveTextContent("OPH_generatedlevel1");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("current-id")).toHaveTextContent("OPH_generatedlevel1"));
  });

  it("should reset the confirmation when the typed name changes after confirming", async () => {
    // Given: the user confirms one name as new, then edits it - the stale confirmation must not carry
    // over to a different name
    vi.mocked(listConstructedEntities).mockResolvedValue(emptyPage());
    vi.mocked(previewConstructedIds).mockResolvedValue(generatedPreview());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function EditableHarness() {
      const [typedName, setTypedName] = useState("First Name");
      const [currentId, setCurrentId] = useState("");
      return (
        <>
          <input aria-label="type name" value={typedName} onChange={(event) => setTypedName(event.target.value)} />
          <AddLineIdCell
            campaignId={42}
            level="LVL1"
            platform=""
            accountId=""
            typedName={typedName}
            currentId={currentId}
            nameLvl1={typedName}
            nameLvl2="Insertion Order 1"
            nameLvl3="Creative 1"
            onResolved={(_level, id) => setCurrentId(id)}
          />
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <EditableHarness />
      </QueryClientProvider>
    );
    await userEvent.click(await screen.findByRole("button", { name: "LVL1 id - no match, create it as new?" }));
    await screen.findByText("OPH_generatedlevel1");

    // When: the name is edited
    await userEvent.clear(screen.getByLabelText("type name"));
    await userEvent.type(screen.getByLabelText("type name"), "Second Name");

    // Then: back to asking for confirmation, not still showing the previous generated badge
    expect(await screen.findByRole("button", { name: "LVL1 id - no match, create it as new?" })).toBeInTheDocument();
    expect(screen.queryByText("OPH_generatedlevel1")).not.toBeInTheDocument();
  });

  it("should explain when the campaign has no mart data at all, alongside the confirmation prompt", async () => {
    // Given: the level-1 lookup (used both to resolve and as the empty-campaign probe) returns nothing
    vi.mocked(listConstructedEntities).mockResolvedValue(emptyPage());

    // When:
    renderCell();

    // Then: explained, but the user must still confirm - no silent auto-generation
    expect(await screen.findByText(/This campaign has no platform data yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LVL1 id - no match, create it as new?" })).toBeInTheDocument();
    expect(screen.getByTestId("current-id")).toHaveTextContent("");
  });

  it("should not show the empty-campaign hint when the campaign has mart data", async () => {
    // Given: the campaign is not empty
    vi.mocked(listConstructedEntities).mockResolvedValue(pageWith([
      { name: "Something", id: "999", first_date: "2026-01-01", last_date: "2026-01-02", impressions: 10 },
    ]));

    // When:
    renderCell({ typedName: "Retargeting" });

    // Then: "Something" matches nothing for "Retargeting", so still a confirmation prompt, but no hint
    await waitFor(() => expect(listConstructedEntities).toHaveBeenCalled());
    expect(screen.queryByText(/This campaign has no platform data yet/)).not.toBeInTheDocument();
  });

  it("should debounce the typed name into one resolve request, not one per keystroke", async () => {
    // Given:
    vi.mocked(listConstructedEntities).mockResolvedValue(emptyPage());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function TypingHarness() {
      const [typedName, setTypedName] = useState("");
      const [currentId, setCurrentId] = useState("");
      return (
        <>
          <input
            aria-label="type name"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
          />
          <AddLineIdCell
            campaignId={42}
            level="LVL1"
            platform=""
            accountId=""
            typedName={typedName}
            currentId={currentId}
            nameLvl1={typedName}
            nameLvl2=""
            nameLvl3=""
            onResolved={(_level, id) => setCurrentId(id)}
          />
        </>
      );
    }

    // When: typed one character at a time, quickly
    render(
      <QueryClientProvider client={queryClient}>
        <TypingHarness />
      </QueryClientProvider>
    );
    await userEvent.type(screen.getByLabelText("type name"), "Retargeting", { delay: 1 });

    // Then: the settled value resolves exactly once, not once per keystroke (11 keystrokes typed above)
    await waitFor(() =>
      expect(listConstructedEntities).toHaveBeenCalledWith(
        42, "LVL1", undefined, undefined, "Retargeting", 1, expect.any(Number), expect.anything()
      )
    );
    const resolveCallsForSettledName = vi.mocked(listConstructedEntities).mock.calls
      .filter((call) => call[4] === "Retargeting");
    expect(resolveCallsForSettledName).toHaveLength(1);
  });

  it("should issue only the empty-campaign probe while the typed name is blank", async () => {
    // Given:
    vi.mocked(listConstructedEntities).mockResolvedValue(emptyPage());

    // When:
    renderCell({ typedName: "" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then: the resolve read never fires for a blank name - only the level-1 empty-campaign probe does
    expect(listConstructedEntities).toHaveBeenCalledTimes(1);
  });
});
