import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingJournalEntryV1, aPacingLineItemPlanV1 } from "@/test/factories";
import { ApiError } from "../../../shared/api/api-error";
import * as api from "../api";
import { JournalPanel, type JournalPanelProps } from "./journal-panel";
import type { PacingJournalEntryV1 } from "../types";

vi.mock("../api", () => ({
  addPacingJournalEntry: vi.fn(),
  updatePacingJournalEntry: vi.fn(),
  deletePacingJournalEntry: vi.fn(),
}));

function renderPanel(
  journal: PacingJournalEntryV1[],
  flightStart?: string,
  flightEnd?: string,
  extra: Partial<JournalPanelProps> = {}
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed the cache the mutations patch, the same key `usePacingDashboard` reads.
  queryClient.setQueryData(["pacing", "dashboard", "nike-ss26"], { journal });
  render(
    <QueryClientProvider client={queryClient}>
      <JournalPanel slug="nike-ss26" journal={journal} flightStart={flightStart} flightEnd={flightEnd} {...extra} />
    </QueryClientProvider>
  );
  return { queryClient };
}

describe("JournalPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show entries sorted newest-first", () => {
    renderPanel([
      aPacingJournalEntryV1({ id: "a", ts: "2026-08-01", msg: "Oldest" }),
      aPacingJournalEntryV1({ id: "b", ts: "2026-08-10", msg: "Newest" }),
      aPacingJournalEntryV1({ id: "c", ts: "2026-08-05", msg: "Middle" }),
    ]);

    const messages = screen.getAllByText(/Oldest|Newest|Middle/).map((el) => el.textContent);
    expect(messages).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("should show the entry count badge in the header", () => {
    renderPanel([aPacingJournalEntryV1(), aPacingJournalEntryV1()]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("should render an empty-state line plus the add form when the journal is empty", () => {
    renderPanel([]);
    expect(screen.getByText("No entries yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("should call addPacingJournalEntry and patch the cache instead of invalidating", async () => {
    vi.mocked(api.addPacingJournalEntry).mockResolvedValue([
      aPacingJournalEntryV1({ id: "new", msg: "A new note" }),
    ]);
    const { queryClient } = renderPanel([]);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await userEvent.type(screen.getByLabelText("New journal note"), "A new note");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.addPacingJournalEntry).toHaveBeenCalledTimes(1));
    expect(api.addPacingJournalEntry).toHaveBeenCalledWith(
      "nike-ss26",
      expect.objectContaining({ message: "A new note" })
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(queryClient.getQueryData(["pacing", "dashboard", "nike-ss26"])).toEqual({
        journal: [expect.objectContaining({ id: "new", msg: "A new note" })],
      })
    );
  });

  it("should submit the add form on Enter and insert a newline on Shift+Enter", async () => {
    vi.mocked(api.addPacingJournalEntry).mockResolvedValue([aPacingJournalEntryV1({ msg: "line1\nline2" })]);
    renderPanel([]);

    const textarea = screen.getByLabelText("New journal note");
    await userEvent.type(textarea, "line1");
    await userEvent.type(textarea, "{Shift>}{Enter}{/Shift}");
    await userEvent.type(textarea, "line2");
    expect(api.addPacingJournalEntry).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("line1\nline2");

    await userEvent.type(textarea, "{Enter}");
    await waitFor(() => expect(api.addPacingJournalEntry).toHaveBeenCalledTimes(1));
  });

  it("should call updatePacingJournalEntry and patch the cache when an editable entry is saved", async () => {
    const entry = aPacingJournalEntryV1({ id: "e1", msg: "Before", canEdit: true, ts: "2026-08-01" });
    vi.mocked(api.updatePacingJournalEntry).mockResolvedValue([{ ...entry, msg: "After" }]);
    const { queryClient } = renderPanel([entry]);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(screen.getByLabelText("Edit entry"));
    const textareas = screen.getAllByRole("textbox");
    const editor = textareas[textareas.length - 1];
    await userEvent.clear(editor);
    await userEvent.type(editor, "After");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.updatePacingJournalEntry).toHaveBeenCalledTimes(1));
    expect(api.updatePacingJournalEntry).toHaveBeenCalledWith(
      "nike-ss26",
      "e1",
      expect.objectContaining({ message: "After" })
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("should hide the edit affordance for an entry the viewer cannot edit", () => {
    renderPanel([aPacingJournalEntryV1({ canEdit: false })]);
    expect(screen.queryByLabelText("Edit entry")).not.toBeInTheDocument();
  });

  it("should call deletePacingJournalEntry after the two-step confirm and patch the cache", async () => {
    const entry = aPacingJournalEntryV1({ id: "e1", canEdit: false });
    vi.mocked(api.deletePacingJournalEntry).mockResolvedValue([]);
    const { queryClient } = renderPanel([entry]);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(screen.getByLabelText("Delete entry"));
    await userEvent.click(screen.getByLabelText("Confirm delete"));

    await waitFor(() => expect(api.deletePacingJournalEntry).toHaveBeenCalledWith("nike-ss26", "e1"));
    expect(invalidateSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(queryClient.getQueryData(["pacing", "dashboard", "nike-ss26"])).toEqual({ journal: [] })
    );
  });

  it("should show the first 6 entries then reveal the rest via Show all / Collapse", async () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      aPacingJournalEntryV1({ id: `e${i}`, ts: `2026-08-${String(i + 1).padStart(2, "0")}`, msg: `Note ${i}` })
    );
    renderPanel(entries);

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Show all (8)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all (8)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(8);

    await userEvent.click(screen.getByRole("button", { name: "Collapse to 6" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  // Matches the retired SPA's `JournalPanel.jsx` `handleAdd`/`saveEdit` messages verbatim (gap A). The
  // native <input type="date"> only hints at min/max - a value set directly (as a paste would land)
  // sails through unless this check runs in JS, on both the add form and the inline row editor.
  describe("date validation", () => {
    it("should reject an add-form date before flight start, without calling the API", async () => {
      renderPanel([], "2020-01-01", undefined);

      fireEvent.change(screen.getByLabelText("New journal note"), { target: { value: "Too early" } });
      fireEvent.change(screen.getByLabelText("Note date"), { target: { value: "2019-12-31" } });
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(screen.getByText("Date is before flight start (2020-01-01)")).toBeInTheDocument();
      expect(api.addPacingJournalEntry).not.toHaveBeenCalled();
    });

    it("should reject an add-form date after flight end, when the flight has already ended", async () => {
      renderPanel([], "2020-01-01", "2020-06-01");

      fireEvent.change(screen.getByLabelText("New journal note"), { target: { value: "Too late" } });
      fireEvent.change(screen.getByLabelText("Note date"), { target: { value: "2020-07-01" } });
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(screen.getByText("Date cannot be after flight end (2020-06-01)")).toBeInTheDocument();
      expect(api.addPacingJournalEntry).not.toHaveBeenCalled();
    });

    it("should reject an add-form date after today, when the flight has not ended", async () => {
      renderPanel([], "2020-01-01", undefined);

      fireEvent.change(screen.getByLabelText("New journal note"), { target: { value: "Too far ahead" } });
      fireEvent.change(screen.getByLabelText("Note date"), { target: { value: "2099-01-01" } });
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      expect(screen.getByText("Date cannot be after today")).toBeInTheDocument();
      expect(api.addPacingJournalEntry).not.toHaveBeenCalled();
    });

    it("should reject an inline-edit date before flight start, without calling the API", async () => {
      const entry = aPacingJournalEntryV1({ id: "e1", msg: "Before", canEdit: true, ts: "2020-06-01" });
      renderPanel([entry], "2020-01-01", undefined);

      await userEvent.click(screen.getByLabelText("Edit entry"));
      fireEvent.change(screen.getByLabelText("Edit note date"), { target: { value: "2019-12-31" } });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByText("Date is before flight start (2020-01-01)")).toBeInTheDocument();
      expect(api.updatePacingJournalEntry).not.toHaveBeenCalled();
    });

    it("should reject an inline-edit date after flight end, when the flight has already ended", async () => {
      const entry = aPacingJournalEntryV1({ id: "e1", msg: "Before", canEdit: true, ts: "2020-06-01" });
      renderPanel([entry], "2020-01-01", "2020-06-01");

      await userEvent.click(screen.getByLabelText("Edit entry"));
      fireEvent.change(screen.getByLabelText("Edit note date"), { target: { value: "2020-07-01" } });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByText("Date cannot be after flight end (2020-06-01)")).toBeInTheDocument();
      expect(api.updatePacingJournalEntry).not.toHaveBeenCalled();
    });

    it("should reject an inline-edit date after today, when the flight has not ended", async () => {
      const entry = aPacingJournalEntryV1({ id: "e1", msg: "Before", canEdit: true, ts: "2020-06-01" });
      renderPanel([entry], "2020-01-01", undefined);

      await userEvent.click(screen.getByLabelText("Edit entry"));
      fireEvent.change(screen.getByLabelText("Edit note date"), { target: { value: "2099-01-01" } });
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByText("Date cannot be after today")).toBeInTheDocument();
      expect(api.updatePacingJournalEntry).not.toHaveBeenCalled();
    });
  });

  // Ported from the retired SPA's `JournalPanel.jsx` `handleAdd`/`startCooldown` (gap: the "Saved"
  // toast and the anti-double-click cooldown were the two pieces §15's first pass left out).
  describe("Saved toast and the anti-double-click cooldown", () => {
    it("should show a Saved toast for a moment after a successful add, and block an immediate resubmit", async () => {
      vi.mocked(api.addPacingJournalEntry).mockResolvedValue([aPacingJournalEntryV1({ id: "new", msg: "First note" })]);
      renderPanel([]);

      await userEvent.type(screen.getByLabelText("New journal note"), "First note");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

      // The cooldown is an anti-double-click guard, not a second rate limit - it blocks the Add
      // button for 2s after a successful save, then releases it (never the 15s lockout the
      // reference explicitly tore out for reading as "saving is slow").
      await userEvent.type(screen.getByLabelText("New journal note"), "Second note, typed immediately");
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
      expect(api.addPacingJournalEntry).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled(), { timeout: 3000 });
    }, 6000);

    it("should start the cooldown on a 429/OPH_058 rate-limit response too, and show the server's message", async () => {
      vi.mocked(api.addPacingJournalEntry).mockRejectedValue(
        new ApiError("You're saving notes too quickly. Please wait a moment and try again.", 429)
      );
      renderPanel([]);

      await userEvent.type(screen.getByLabelText("New journal note"), "Too fast");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() =>
        expect(screen.getByText("You're saving notes too quickly. Please wait a moment and try again.")).toBeInTheDocument()
      );
      // The typed message is preserved on failure, not cleared.
      expect(screen.getByLabelText("New journal note")).toHaveValue("Too fast");
      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

      await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled(), { timeout: 3000 });
    }, 6000);

    it("should not start the cooldown on a non-rate-limit failure", async () => {
      vi.mocked(api.addPacingJournalEntry).mockRejectedValue(new ApiError("Something went wrong.", 500));
      renderPanel([]);

      await userEvent.type(screen.getByLabelText("New journal note"), "Server error");
      await userEvent.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() => expect(screen.getByText("Something went wrong.")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    });
  });

  // Ported from the retired SPA's `journal-tags-core.js` + `TagPalette.jsx`/`JournalTags.jsx` wiring
  // (the tag system, §15 follow-up). The pure core's own behaviour is golden-tested in
  // `tags-core.test.ts`; these exercise it wired into the real composer/palette/pills.
  describe("tag palette", () => {
    function withSources(extra: Partial<JournalPanelProps> = {}): Partial<JournalPanelProps> {
      return {
        planByLineItem: { "42": aPacingLineItemPlanV1({ lineItemId: "42", channel: "Display" }) },
        factsDaily: [{ line_item_id: "42", date: "2026-08-01", platform: "dv_360_dlv", tactic: "Prospecting" }],
        ...extra,
      };
    }

    it("should open the palette listing LI/channel/dsp sources when # is typed", async () => {
      renderPanel([], undefined, undefined, withSources());

      await userEvent.type(screen.getByLabelText("New journal note"), "#");

      expect(screen.getByRole("listbox", { name: "Insert tag" })).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument(); // LI source, no name available on this side
      expect(screen.getByText("Display")).toBeInTheDocument(); // channel source
      expect(screen.getByText("DV360")).toBeInTheDocument(); // dsp source, pretty label
    });

    it("should fuzzy-filter palette results as the query is typed", async () => {
      renderPanel([], undefined, undefined, withSources());

      await userEvent.type(screen.getByLabelText("New journal note"), "#disp");

      expect(screen.getByText("Display")).toBeInTheDocument();
      expect(screen.queryByText("DV360")).not.toBeInTheDocument();
    });

    it("should insert the highlighted tag on Enter, replacing the # token", async () => {
      renderPanel([], undefined, undefined, withSources());
      const textarea = screen.getByLabelText("New journal note") as HTMLTextAreaElement;

      await userEvent.type(textarea, "moved to #disp");
      expect(screen.getByRole("listbox", { name: "Insert tag" })).toBeInTheDocument();

      await userEvent.keyboard("{Enter}");

      expect(textarea.value).toBe("moved to #ch:Display ");
      expect(screen.queryByRole("listbox", { name: "Insert tag" })).not.toBeInTheDocument();
      // Enter picked the tag, not submitted the form.
      expect(api.addPacingJournalEntry).not.toHaveBeenCalled();
    });

    it("should close the palette on Escape without submitting", async () => {
      renderPanel([], undefined, undefined, withSources());
      const textarea = screen.getByLabelText("New journal note");

      await userEvent.type(textarea, "#");
      expect(screen.getByRole("listbox", { name: "Insert tag" })).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("listbox", { name: "Insert tag" })).not.toBeInTheDocument();
      expect(api.addPacingJournalEntry).not.toHaveBeenCalled();
    });
  });

  // Ported from the retired SPA's `JournalTags.jsx`.
  describe("tag filter pills", () => {
    it("should filter the entry list down to entries carrying the clicked tag, and clear back to all", async () => {
      renderPanel([
        aPacingJournalEntryV1({ id: "a", ts: "2026-08-01", msg: "#LI:42 kickoff" }),
        aPacingJournalEntryV1({ id: "b", ts: "2026-08-02", msg: "No tag here" }),
      ]);

      expect(screen.getByText(/kickoff/)).toBeInTheDocument();
      expect(screen.getByText("No tag here")).toBeInTheDocument();

      await userEvent.click(screen.getByTitle("Filter by #LI:42"));

      expect(screen.getByText(/kickoff/)).toBeInTheDocument();
      expect(screen.queryByText("No tag here")).not.toBeInTheDocument();

      await userEvent.click(screen.getByTitle("Clear filter"));

      expect(screen.getByText("No tag here")).toBeInTheDocument();
    });

    it("should render no pills row when no entry carries a tag", () => {
      renderPanel([aPacingJournalEntryV1({ msg: "Plain note" })]);
      expect(screen.queryByTitle(/^Filter by /)).not.toBeInTheDocument();
    });
  });
});
