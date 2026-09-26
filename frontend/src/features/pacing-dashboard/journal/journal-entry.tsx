import { useEffect, useRef, useState } from "react";
import { fmtDate } from "../../pacing/mock/format";
import type { PacingJournalEntryV1 } from "../types";
import type { JournalTagPaletteApi } from "./journal-panel";
import { renderTaggedText } from "./tagged-text";
import type { TagSource } from "./tags-core";

function autosize(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "auto";
  node.style.height = `${Math.min(Math.max(node.scrollHeight, 36), 160)}px`;
}

export interface JournalEntryRowProps {
  entry: PacingJournalEntryV1;
  /** Tag sources for known/unknown badge styling (`TaggedText`) - see `journal-panel.tsx`. */
  sources: readonly TagSource[];
  isEditing: boolean;
  dateMin: string;
  dateMax: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (message: string, date: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: () => Promise<void>;
  /** The shared caret-palette API from `JournalPanel` - the palette itself is a single portal the
   *  panel owns; this plugs the inline editor's textarea into it the same way the composer is. */
  tagPalette: JournalTagPaletteApi;
  /** Sets the chart's journal marker to this entry's date - never applies dashboard filters (the
   *  Hub's pacing dashboard has none). Omitted (no row click) when the panel has nowhere to send it. */
  onRowClick?: (date: string) => void;
}

/**
 * A single journal entry row (§15, US-139): date, author, message, an "edited" marker - or, while
 * `isEditing`, an inline textarea + date input swapped into the same row. Editing happens in place
 * rather than jumping to a composer at the top, so a long journal never loses the reader's scroll
 * position. Delete is a two-step confirm shown for every entry - Pacing's delete route has no author
 * check by design, so the affordance is not gated on `canEdit`.
 */
export function JournalEntryRow({
  entry,
  sources,
  isEditing,
  dateMin,
  dateMax,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  tagPalette,
  onRowClick,
}: JournalEntryRowProps) {
  const entryDate = (entry.ts ?? "").slice(0, 10);

  const [draftMessage, setDraftMessage] = useState(entry.msg);
  const [draftDate, setDraftDate] = useState(entryDate);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed the draft every time this row enters edit mode, so a reopened editor never shows a stale
  // message left over from a previous edit session.
  useEffect(() => {
    if (!isEditing) return;
    setDraftMessage(entry.msg);
    setDraftDate(entryDate);
    setEditError("");
    const raf = requestAnimationFrame(() => {
      autosize(textareaRef.current);
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  async function handleSave() {
    const message = draftMessage.trim();
    if (!message || saving) return;
    setSaving(true);
    setEditError("");
    const result = await onSaveEdit(message, draftDate);
    setSaving(false);
    if (!result.ok) setEditError(result.error ?? "Failed to save");
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation(); // never let the delete click also fire the row click
    if (deleting) return;
    if (confirmDelete) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDelete(false);
      setDeleting(true);
      void onDelete().finally(() => setDeleting(false));
    } else {
      setConfirmDelete(true);
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  function handleRowClick() {
    if (!onRowClick || isEditing || !entryDate) return;
    onRowClick(entryDate);
  }

  return (
    <li
      className={`journal-entry${isEditing ? " journal-entry--editing" : ""}${onRowClick && !isEditing ? " journal-entry--clickable" : ""}`}
      onClick={handleRowClick}
    >
      <div className="journal-entry__meta">
        <span className="journal-entry__date">{entryDate ? fmtDate(entryDate) : "—"}</span>
        {entry.uid && <span className="journal-entry__author">{entry.uid}</span>}
        {entry.editedAt && (
          <span className="journal-entry__edited" title={`Edited ${entry.editedAt.slice(0, 16).replace("T", " ")}`}>
            edited
          </span>
        )}
      </div>

      {isEditing ? (
        <div className="journal-entry__editor">
          <textarea
            ref={textareaRef}
            className="journal-entry__textarea"
            value={draftMessage}
            onChange={(e) => {
              // Shared tag palette: registers this textarea as the target, converts `\`→`#`,
              // recomputes suggestions at the caret - same wiring as the composer.
              tagPalette.onInput(e.target, setDraftMessage);
              autosize(e.target);
            }}
            onKeyDown={(e) => {
              if (tagPalette.onKeyDown(e)) return; // palette nav consumed it
              if (e.key === "Escape") {
                e.stopPropagation();
                onCancelEdit();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSave();
              }
            }}
            rows={2}
          />
          <div className="journal-entry__editor-row">
            <input
              type="date"
              className="journal-entry__date-input"
              aria-label="Edit note date"
              value={draftDate}
              min={dateMin || undefined}
              max={dateMax || undefined}
              onChange={(e) => setDraftDate(e.target.value)}
            />
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={() => void handleSave()}
              disabled={saving || !draftMessage.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={onCancelEdit}>
              Cancel
            </button>
            <span className="journal-entry__hint">⌘⏎ save · Esc cancel</span>
          </div>
          {editError && <p className="journal-entry__error">{editError}</p>}
        </div>
      ) : (
        <div className="journal-entry__body">
          <span className="journal-entry__message">{renderTaggedText(entry.msg, sources)}</span>
          <div className="journal-entry__actions">
            {entry.canEdit && (
              <button
                type="button"
                className="journal-entry__action"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartEdit();
                }}
                aria-label="Edit entry"
                title="Edit entry"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className={`journal-entry__action${confirmDelete ? " journal-entry__action--confirm" : ""}`}
              onClick={handleDeleteClick}
              aria-label={confirmDelete ? "Confirm delete" : "Delete entry"}
              title={confirmDelete ? "Click again to confirm deletion" : "Delete entry"}
              disabled={deleting}
            >
              {confirmDelete ? "Delete?" : "×"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
