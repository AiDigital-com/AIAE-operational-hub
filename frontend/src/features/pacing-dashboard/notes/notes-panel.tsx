import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { formatError } from "../../../shared/format/error";
import { CloseIcon, NoteIcon } from "../../../shared/ui/icons/icons";
import { Sheet } from "../../../shared/ui/sheet/sheet";
import { useSavePacingCampaignNotes } from "../hooks";
import { docFromPlainText, hasAnyNotes, hasMeaningfulNotes, plainTextFromDoc, type NotesNode } from "./notes-doc";
import type { NotesEditorHandle } from "./notes-editor";
import { NotesDocument, NotesPlainText } from "./notes-render";
import "./notes.css";

/** TipTap is fetched the first time someone presses Edit, never for reading. */
const NotesEditor = lazy(() => import("./notes-editor"));

/** Where focus returns when the panel closes. */
const NOTES_BUTTON_SELECTOR = "[data-notes-button]";

interface NotesButtonProps {
  /** Whether the pacing has notes - draws the dot. */
  hasNotes: boolean;
  onOpen: () => void;
}

/**
 * The floating entry to the campaign notes, bottom-right of the dashboard. Always shown while the
 * dashboard is (that is how an empty pacing gets its first note), with a dot when notes exist.
 * Ported from the reference SPA's `NotesFab.jsx`; the page hides it in Layout mode and while the
 * settings drawer is open, as the reference does.
 */
export function NotesButton({ hasNotes, onOpen }: NotesButtonProps) {
  return (
    <button
      type="button"
      className="notes-button"
      aria-label={hasNotes ? "Campaign notes (has notes)" : "Campaign notes"}
      title="Campaign notes"
      onClick={onOpen}
      data-notes-button=""
    >
      <NoteIcon className="notes-button__icon" />
      {hasNotes && <span className="notes-button__dot" aria-hidden="true" />}
    </button>
  );
}

interface NotesPanelProps {
  open: boolean;
  onClose: () => void;
  slug: string;
  /** `campaign.notesRich` - the stored document, or null. */
  notesRich: unknown;
  /** `campaign.notes` - Pacing's plain-text shadow; the only copy on an older pacing. */
  notes: string | null | undefined;
}

/**
 * The campaign notes panel: a right-hand sheet that reads the notes and, on Edit, opens the
 * formatting editor. Save sends the whole document; Pacing validates it and derives the plain text.
 *
 * Ported from the reference SPA (`ogan-team`, `pages/Dashboard/components/Notes/NotesPanel.jsx`) onto
 * this app's `Sheet`: the same read/edit modes, Copy (as formatted text and as plain text), and the
 * same guard - closing with unsaved edits (Esc, the overlay, Cancel, ×) asks before discarding.
 * Anyone who can open the dashboard can edit its notes, as in the reference: Pacing checks dashboard
 * access on the save.
 */
export function NotesPanel({ open, onClose, slug, notesRich, notes }: NotesPanelProps) {
  const save = useSavePacingCampaignNotes(slug);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<NotesEditorHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Every open starts in read mode with nothing pending; the editor re-seeds on each entry.
  useEffect(() => {
    if (open) {
      setMode("read");
      setDirty(false);
      setConfirmDiscard(false);
      setError("");
    }
  }, [open]);

  const doc = hasMeaningfulNotes(notesRich) ? (notesRich as NotesNode) : null;
  const plain = (notes ?? "").trim() !== "" ? (notes as string) : "";
  const hasNotes = hasAnyNotes(notesRich, notes);
  const saving = save.isPending;

  function finishClose() {
    setConfirmDiscard(false);
    onClose();
    document.querySelector<HTMLElement>(NOTES_BUTTON_SELECTOR)?.focus();
  }

  function requestClose() {
    if (saving) return;
    if (mode === "edit" && dirty) {
      setConfirmDiscard(true);
      return;
    }
    finishClose();
  }

  function startEditing() {
    setMode("edit");
    setDirty(false);
    setError("");
  }

  async function handleSave() {
    if (saving) return;
    const next = editorRef.current?.getJSON();
    if (!next) return;
    setError("");
    try {
      await save.mutateAsync(next as Record<string, unknown>);
      setMode("read");
      setDirty(false);
    } catch (err) {
      setError(formatError(err) || "Save failed — try again");
    }
  }

  async function handleCopy() {
    const text = doc ? plainTextFromDoc(doc) : plain;
    const html = bodyRef.current?.innerHTML ?? "";
    try {
      if (navigator.clipboard?.write && typeof window.ClipboardItem === "function") {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard?.writeText(text);
      }
    } catch {
      // The browser refused the clipboard - nothing to undo, and nothing worth an error.
    }
  }

  const footer =
    mode === "read" ? (
      <div className="notes-panel__footer">
        <div className="notes-panel__footer-start">
          {hasNotes && (
            <button type="button" className="button button--ghost button--sm" onClick={() => void handleCopy()}>
              Copy
            </button>
          )}
        </div>
        <button type="button" className="button button--sm" onClick={startEditing}>
          {hasNotes ? "Edit" : "Add notes"}
        </button>
      </div>
    ) : (
      <div className="notes-panel__footer">
        <div className="notes-panel__footer-start" role="status">
          {confirmDiscard ? (
            <span className="notes-panel__question">Discard unsaved changes?</span>
          ) : error ? (
            <span className="form-error notes-panel__error">{error}</span>
          ) : null}
        </div>
        <div className="notes-panel__footer-actions">
          {confirmDiscard ? (
            <>
              <button type="button" className="button button--ghost button--sm" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
              <button type="button" className="button button--danger button--sm" onClick={finishClose}>
                Discard
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button--ghost button--sm" onClick={requestClose} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="button button--sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>
    );

  return (
    <Sheet
      open={open}
      onClose={requestClose}
      title="Campaign notes"
      className="notes-sheet"
      headerActions={
        <button type="button" title="Close (Esc)" aria-label="Close" onClick={requestClose}>
          <CloseIcon />
        </button>
      }
      footer={footer}
    >
      {mode === "read" ? (
        <div className="notes-panel__read" ref={bodyRef}>
          {doc ? (
            <NotesDocument doc={doc} />
          ) : plain ? (
            <NotesPlainText text={plain} />
          ) : (
            <p className="notes-panel__empty">No notes yet — capture launch context, decisions, links.</p>
          )}
        </div>
      ) : (
        <Suspense fallback={<p className="notes-panel__empty notes-panel__loading">Loading editor…</p>}>
          <NotesEditor initialDoc={doc ?? docFromPlainText(plain)} onDirtyChange={setDirty} editorRef={editorRef} />
        </Suspense>
      )}
    </Sheet>
  );
}
