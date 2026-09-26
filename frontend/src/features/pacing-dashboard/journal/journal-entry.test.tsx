import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { aPacingJournalEntryV1 } from "@/test/factories";
import { JournalEntryRow } from "./journal-entry";
import type { JournalTagPaletteApi } from "./journal-panel";

/** A palette that never opens (no `#` typed) - `onInput` just passes the value straight through, the
 *  same as the "no tag palette" fallback the reference itself has for a bare textarea. */
function noopTagPalette(): JournalTagPaletteApi {
  return {
    onInput: (ta, setValue) => setValue(ta.value),
    onKeyDown: () => false,
    close: () => {},
  };
}

function renderRow(overrides: Parameters<typeof aPacingJournalEntryV1>[0] = {}, props: Partial<Parameters<typeof JournalEntryRow>[0]> = {}) {
  const entry = aPacingJournalEntryV1(overrides);
  const onStartEdit = vi.fn();
  const onCancelEdit = vi.fn();
  const onSaveEdit = vi.fn().mockResolvedValue({ ok: true });
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(
    <ul>
      <JournalEntryRow
        entry={entry}
        sources={[]}
        isEditing={false}
        dateMin=""
        dateMax="2026-09-25"
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onDelete={onDelete}
        tagPalette={noopTagPalette()}
        {...props}
      />
    </ul>
  );
  return { entry, onStartEdit, onCancelEdit, onSaveEdit, onDelete };
}

describe("JournalEntryRow", () => {
  it("should show the date, author and message", () => {
    renderRow({ ts: "2026-08-05", uid: "azat@aidigital.com", msg: "Launched creative refresh" });

    expect(screen.getByText("Launched creative refresh")).toBeInTheDocument();
    expect(screen.getByText("azat@aidigital.com")).toBeInTheDocument();
  });

  it("should not show an edited marker when editedAt is unset", () => {
    renderRow({ editedAt: undefined });
    expect(screen.queryByText("edited")).not.toBeInTheDocument();
  });

  it("should show the edited marker when editedAt is set", () => {
    renderRow({ editedAt: "2026-08-06T10:00:00Z" });
    expect(screen.getByText("edited")).toBeInTheDocument();
  });

  it("should show the edit affordance only when canEdit is true", () => {
    renderRow({ canEdit: true });
    expect(screen.getByLabelText("Edit entry")).toBeInTheDocument();
  });

  it("should hide the edit affordance when canEdit is false", () => {
    renderRow({ canEdit: false });
    expect(screen.queryByLabelText("Edit entry")).not.toBeInTheDocument();
  });

  it("should always show delete, regardless of canEdit (Pacing's delete has no author check)", () => {
    renderRow({ canEdit: false });
    expect(screen.getByLabelText("Delete entry")).toBeInTheDocument();
  });

  it("should require a second click to actually delete", async () => {
    const { onDelete } = renderRow();

    await userEvent.click(screen.getByLabelText("Delete entry"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete?")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Confirm delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("should auto-revert the delete confirm after 3 seconds", async () => {
    const { onDelete } = renderRow();

    await userEvent.click(screen.getByLabelText("Delete entry"));
    expect(screen.getByText("Delete?")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByLabelText("Delete entry")).toBeInTheDocument(), { timeout: 4000 });
    expect(onDelete).not.toHaveBeenCalled();
  }, 8000);

  it("should render an inline editor in place of the message while editing", () => {
    renderRow({ msg: "Original text" }, { isEditing: true });

    expect(screen.getByRole("textbox")).toHaveValue("Original text");
    expect(screen.queryByText("Original text", { selector: "span" })).not.toBeInTheDocument();
  });

  it("should save on Cmd/Ctrl+Enter", async () => {
    const { onSaveEdit } = renderRow({ msg: "Original" }, { isEditing: true });
    const textarea = screen.getByRole("textbox");

    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Updated note");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    expect(onSaveEdit).toHaveBeenCalledWith("Updated note", expect.any(String));
  });

  it("should cancel on Escape without saving", async () => {
    const { onCancelEdit, onSaveEdit } = renderRow({ msg: "Original" }, { isEditing: true });
    const textarea = screen.getByRole("textbox");

    await userEvent.type(textarea, "{Escape}");

    expect(onCancelEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).not.toHaveBeenCalled();
  });
});
