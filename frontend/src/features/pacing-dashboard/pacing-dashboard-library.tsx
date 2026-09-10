import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, SearchIcon, TrashIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import {
  createPacingLibraryEntry,
  deletePacingLibraryEntry,
  listPacingLibrary,
  setPacingLibraryLike,
  updatePacingLibraryEntry,
} from "./api";
import type {
  PacingDisplayShape,
  PacingLibraryEntryV1,
  PacingLibraryKindV1,
  PacingWidgetGroup,
  PacingWidgetInstance,
} from "./types";
import "./pacing-dashboard-library.css";

const SEARCH_DEBOUNCE_MS = 250;
const KIND_OPTIONS: Array<{ value: PacingLibraryKindV1 | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "widget", label: "Widgets" },
  { value: "block", label: "Blocks" },
  { value: "layout", label: "Layouts" },
];

function randomSuffix(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** A fresh widget-instance id matching Pacing's `WIDGET_INSTANCE_RE = /^w_[a-z0-9]{4,16}$/`. */
function newWidgetId(): string {
  return `w_${randomSuffix(10)}`;
}

/** A fresh group id matching Pacing's `GROUP_ID_RE = /^g_[a-z0-9]{4,16}$/`. */
function newGroupId(): string {
  return `g_${randomSuffix(10)}`;
}

function widgetTitle(widget: PacingWidgetInstance): string {
  return widget.title?.trim() || "Untitled widget";
}

interface SaveDialogState {
  widgetId: string;
  name: string;
  description: string;
  busy: boolean;
  error: string | null;
}

interface PacingDashboardLibraryProps {
  display: PacingDisplayShape;
  saving: boolean;
  saveError: string | null;
  /** Saves the WHOLE patch (widgets + groups) back to the pacing; the caller owns the displayRev CAS
   *  and reports a conflict (US-118) rather than silently overwriting. */
  onSave: (patch: { widgets: PacingWidgetInstance[]; groups: PacingWidgetGroup[] }) => void;
  isAdmin: boolean;
}

/**
 * The widget-library management panel (§6, US-116/117/118): the widgets currently on this pacing
 * (reorder, group, remove, save-to-library) plus the shared catalog to browse and add from. Renders
 * widget IDENTITY (title/kind/origin), not a re-creation of an arbitrary widget's own visual content -
 * reproducing Pacing's full widget-spec rendering engine is out of scope here (see the migration
 * report); the dashboard's own health/financial/chart sections above render the real figures directly.
 */
export function PacingDashboardLibrary({ display, saving, saveError, onSave, isAdmin }: PacingDashboardLibraryProps) {
  const queryClient = useQueryClient();
  const widgets = useMemo(() => display.widgets ?? [], [display.widgets]);
  const groups = useMemo(() => display.groups ?? [], [display.groups]);
  const groupedIds = useMemo(() => new Set(groups.flatMap((g) => g.tileIds)), [groups]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);

  const [q, setQInput] = useState("");
  const search = useDebounce(q, SEARCH_DEBOUNCE_MS).trim();
  const [sort, setSort] = useState<"usage" | "likes">("usage");
  // The three shelves Pacing actually serves, defaulting to the one that has
  // something in it. There is no "everything" shelf: `shelf=standard` returns the
  // 28 built-in templates, `mine` the viewer's own, and anything else every shared
  // entry. A fourth option meaning "all" sent no shelf at all, which the server
  // reads as "shared" — so a fresh installation, where nobody has shared anything
  // yet, opened the library on an empty list with all 28 templates one unmarked
  // click away. The retired SPA had the same three, in this order, defaulting the
  // same way (LibraryScreen.jsx's SHELVES).
  const [shelf, setShelf] = useState<"standard" | "shared" | "mine">("standard");
  const [kind, setKind] = useState<PacingLibraryKindV1 | "all">("all");

  const libraryQuery = useQuery({
    queryKey: ["pacing", "library", search, sort, shelf, kind],
    queryFn: () =>
      listPacingLibrary({
        q: search || undefined,
        sort,
        shelf,
        kind: kind === "all" ? undefined : kind,
      }),
  });

  const [saveDialog, setSaveDialog] = useState<SaveDialogState | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string; busy: boolean } | null>(null);

  function reorder(widgetId: string, overId: string) {
    if (widgetId === overId) return;
    const fromIndex = widgets.findIndex((w) => w.id === widgetId);
    const toIndex = widgets.findIndex((w) => w.id === overId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = [...widgets];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onSave({ widgets: next, groups });
  }

  function removeWidget(widgetId: string) {
    const nextWidgets = widgets.filter((w) => w.id !== widgetId);
    // US-116: removing affects only this pacing - the library entry it may be linked to is untouched.
    // Dropping it out of any group too, so a group never carries a dangling reference.
    const nextGroups = groups
      .map((g) => ({ ...g, tileIds: g.tileIds.filter((id) => id !== widgetId) }))
      .filter((g) => g.tileIds.length > 0);
    setSelected((current) => {
      const next = new Set(current);
      next.delete(widgetId);
      return next;
    });
    onSave({ widgets: nextWidgets, groups: nextGroups });
  }

  function toggleSelected(widgetId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(widgetId)) next.delete(widgetId);
      else next.add(widgetId);
      return next;
    });
  }

  function groupSelected() {
    if (selected.size < 2) return;
    const tileIds = Array.from(selected);
    const nextGroup: PacingWidgetGroup = { id: newGroupId(), tileIds, bg: "slate", title: "New group" };
    onSave({ widgets, groups: [...groups, nextGroup] });
    setSelected(new Set());
  }

  function ungroup(groupId: string) {
    onSave({ widgets, groups: groups.filter((g) => g.id !== groupId) });
  }

  /**
   * Put a library entry on this pacing — as a LINK or as a COPY, depending on
   * which shelf it came from. Ported from the SPA's `libraryInstance`
   * (lib/dashboard/widget-ops.js); the two shapes are not interchangeable and
   * Pacing's validator refuses a mixture.
   *
   * A USER entry (a uuid key) becomes a linked instance: id, kind, lib, profile,
   * schemaVersion, datasetType — and NO spec. The entry is the definition, so
   * carrying a copy of it would be a second one that stops matching the moment
   * the author edits theirs. Pacing says so outright: "a linked instance carries
   * no spec; the entry is the definition".
   *
   * A STANDARD template (a `std:` key) is code that ships with Pacing, with no
   * row to link to. Its definition is copied in whole, and `lib`/`from` are
   * dropped — a link to something that has no id would be a dangling one.
   */
  function addFromLibrary(entry: PacingLibraryEntryV1) {
    if (entry.kind !== "widget") return; // §6 scope: block/layout apply needs the canvas editor (§7/§9)
    const definition = (entry.definition ?? {}) as Partial<PacingWidgetInstance> & Record<string, unknown>;
    const key = entry.id;
    const isStandard = typeof key === "string" && key.startsWith("std:");

    const instance: PacingWidgetInstance = isStandard
      ? (() => {
          // Copy, minus the two fields that only mean anything on a linked one.
          const { lib: _lib, from: _from, ...copied } = definition;
          return { ...copied, id: newWidgetId() } as PacingWidgetInstance;
        })()
      : {
          id: newWidgetId(),
          kind: "composite",
          lib: { src: "user", key },
          profile: definition.profile,
          schemaVersion: 2,
          datasetType: definition.datasetType,
        };

    onSave({ widgets: [...widgets, instance], groups });
  }

  async function toggleLike(entry: PacingLibraryEntryV1) {
    try {
      await setPacingLibraryLike(entry.id, !entry.liked);
      queryClient.invalidateQueries({ queryKey: ["pacing", "library"] });
    } catch (error) {
      setLibraryError(formatError(error));
    }
  }

  async function removeFromLibrary(entry: PacingLibraryEntryV1) {
    if (!entry.updatedAt) return;
    setLibraryError(null);
    const outcome = await deletePacingLibraryEntry(entry.id, entry.updatedAt).catch((error: unknown) => {
      setLibraryError(formatError(error));
      return null;
    });
    if (!outcome) return;
    if (outcome.status === "conflict") {
      setLibraryError(
        outcome.conflict.reason === "stale_entry"
          ? "Someone else changed this library entry. Reopen the library and try again."
          : formatError(outcome.conflict)
      );
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["pacing", "library"] });
  }

  async function confirmRename(entry: PacingLibraryEntryV1) {
    if (!renaming || !entry.updatedAt || !renaming.name.trim()) return;
    setRenaming({ ...renaming, busy: true });
    const outcome = await updatePacingLibraryEntry(
      entry.id, renaming.name.trim(), entry.description ?? undefined, entry.definition ?? {}, entry.updatedAt
    ).catch((error: unknown) => {
      setLibraryError(formatError(error));
      return null;
    });
    if (!outcome) {
      setRenaming({ ...renaming, busy: false });
      return;
    }
    if (outcome.status === "conflict") {
      setLibraryError(
        outcome.conflict.reason === "stale_entry"
          ? "Someone else changed this library entry. Reopen the library and try again."
          : formatError(outcome.conflict)
      );
      setRenaming(null);
      return;
    }
    setRenaming(null);
    queryClient.invalidateQueries({ queryKey: ["pacing", "library"] });
  }

  function openSaveDialog(widgetId: string) {
    const widget = widgets.find((w) => w.id === widgetId);
    setSaveDialog({ widgetId, name: widgetTitle(widget ?? { id: widgetId }), description: "", busy: false, error: null });
  }

  async function confirmSaveToLibrary() {
    if (!saveDialog) return;
    const widget = widgets.find((w) => w.id === saveDialog.widgetId);
    if (!widget || !saveDialog.name.trim()) return;
    setSaveDialog({ ...saveDialog, busy: true, error: null });
    try {
      const outcome = await createPacingLibraryEntry(
        "widget",
        saveDialog.name.trim(),
        saveDialog.description.trim() || undefined,
        widget
      );
      if (outcome.status === "conflict") {
        setSaveDialog({
          ...saveDialog,
          busy: false,
          error:
            outcome.conflict.reason === "library_full"
              ? "Your library is full. Delete an entry you no longer need."
              : formatError(outcome.conflict),
        });
        return;
      }
      setSaveDialog(null);
      queryClient.invalidateQueries({ queryKey: ["pacing", "library"] });
    } catch (error) {
      setSaveDialog({ ...saveDialog, busy: false, error: error instanceof ApiError ? error.message : formatError(error) });
    }
  }

  const ungroupedWidgets = widgets.filter((w) => !groupedIds.has(w.id));

  return (
    <div className="pdl">
      <div className="pdl__section">
        <div className="pdl__section-head">
          <h3 className="pdl__section-title">This pacing&apos;s widgets</h3>
          <div className="pdl__section-actions">
            {saving && <span className="pdl__saving">Saving…</span>}
            {selected.size >= 2 && (
              <button type="button" className="button button--sm" onClick={groupSelected}>
                Group {selected.size} selected
              </button>
            )}
          </div>
        </div>
        {saveError && <p className="form-error">{saveError}</p>}
        {widgets.length === 0 && <p className="pdl__empty">No widgets yet — add one from the library below.</p>}

        <ul className="pdl__widget-list">
          {groups.map((group) => {
            const members = widgets.filter((w) => group.tileIds.includes(w.id));
            if (members.length === 0) return null;
            return (
              <li key={group.id} className={cn("pdl__group", `pdl__group--${group.bg}`)}>
                {!group.hideTitle && <div className="pdl__group-title">{group.title || "Group"}</div>}
                <button type="button" className="pdl__group-ungroup" onClick={() => ungroup(group.id)}>
                  Ungroup
                </button>
                <ul className="pdl__widget-list pdl__widget-list--nested">
                  {members.map((widget) => (
                    <WidgetCard
                      key={widget.id}
                      widget={widget}
                      selected={selected.has(widget.id)}
                      dragging={dragId === widget.id}
                      onToggleSelect={() => toggleSelected(widget.id)}
                      onRemove={() => removeWidget(widget.id)}
                      onSaveToLibrary={() => openSaveDialog(widget.id)}
                      onDragStart={() => setDragId(widget.id)}
                      onDrop={() => dragId && reorder(dragId, widget.id)}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
          {ungroupedWidgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              selected={selected.has(widget.id)}
              dragging={dragId === widget.id}
              onToggleSelect={() => toggleSelected(widget.id)}
              onRemove={() => removeWidget(widget.id)}
              onSaveToLibrary={() => openSaveDialog(widget.id)}
              onDragStart={() => setDragId(widget.id)}
              onDrop={() => dragId && reorder(dragId, widget.id)}
            />
          ))}
        </ul>
      </div>

      <div className="pdl__section">
        <div className="pdl__section-head">
          <h3 className="pdl__section-title">Widget library</h3>
        </div>
        <div className="pdl__filters">
          <label className="pdl__search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search library…"
              aria-label="Search widget library"
              value={q}
              onChange={(event) => setQInput(event.target.value)}
            />
          </label>
          <span className="select pdl__fsel">
            <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as "usage" | "likes")}>
              <option value="usage">Most used</option>
              <option value="likes">Most liked</option>
            </select>
          </span>
          <span className="select pdl__fsel">
            <select aria-label="Shelf" value={shelf} onChange={(event) => setShelf(event.target.value as typeof shelf)}>
              <option value="standard">Standard</option>
              <option value="shared">Shared</option>
              <option value="mine">Mine</option>
            </select>
          </span>
          <span className="select pdl__fsel">
            <select aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
        </div>

        {libraryError && <p className="form-error">{libraryError}</p>}
        {libraryQuery.isPending && <LoadingBlock label="Loading library" />}
        {libraryQuery.isError && <p className="form-error">{formatError(libraryQuery.error)}</p>}
        {libraryQuery.isSuccess && libraryQuery.data.length === 0 && (
          <p className="pdl__empty">Nothing matches — try a different search or filter.</p>
        )}
        {libraryQuery.isSuccess && libraryQuery.data.length > 0 && (
          <ul className="pdl__library-list">
            {libraryQuery.data.map((entry) => (
              <li key={entry.id} className="pdl__library-item">
                <div className="pdl__library-info">
                  {renaming?.id === entry.id ? (
                    <span className="pdl__rename">
                      <input
                        type="text"
                        value={renaming.name}
                        maxLength={80}
                        autoFocus
                        onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
                        onKeyDown={(event) => event.key === "Enter" && confirmRename(entry)}
                      />
                      <button
                        type="button"
                        className="pdl__rename-confirm"
                        disabled={renaming.busy || !renaming.name.trim()}
                        onClick={() => confirmRename(entry)}
                        aria-label="Confirm rename"
                      >
                        <CheckIcon />
                      </button>
                      <button
                        type="button"
                        className="pdl__rename-cancel"
                        onClick={() => setRenaming(null)}
                        aria-label="Cancel rename"
                      >
                        <CloseIcon />
                      </button>
                    </span>
                  ) : (
                    <span className="pdl__library-name">{entry.name}</span>
                  )}
                  <span className={cn("pdl__library-kind", `pdl__library-kind--${entry.kind}`)}>{entry.kind}</span>
                  {entry.description && <span className="pdl__library-desc">{entry.description}</span>}
                  <span className="pdl__library-meta">
                    {entry.ownerName ? `by ${entry.ownerName} · ` : ""}
                    {entry.usage} pacing{entry.usage === 1 ? "" : "s"} · {entry.likes} like{entry.likes === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="pdl__library-actions">
                  <button
                    type="button"
                    className={cn("pdl__like", entry.liked && "pdl__like--active")}
                    onClick={() => toggleLike(entry)}
                    aria-pressed={entry.liked}
                    aria-label={entry.liked ? "Unlike" : "Like"}
                  >
                    ♥
                  </button>
                  {entry.kind === "widget" && (
                    <button type="button" className="button button--sm" onClick={() => addFromLibrary(entry)}>
                      <PlusIcon /> Add
                    </button>
                  )}
                  {/* Only a widget entry can be renamed - Pacing rejects a PUT on a block/layout entry
                      (US-118: those are re-shared, not edited). */}
                  {(entry.mine || isAdmin) && entry.kind === "widget" && renaming?.id !== entry.id && (
                    <button
                      type="button"
                      className="pdl__remove"
                      onClick={() => setRenaming({ id: entry.id, name: entry.name, busy: false })}
                      aria-label={`Rename ${entry.name}`}
                    >
                      <EditIcon />
                    </button>
                  )}
                  {(entry.mine || isAdmin) && (
                    <button
                      type="button"
                      className="pdl__remove"
                      onClick={() => removeFromLibrary(entry)}
                      aria-label="Remove from library"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {saveDialog && (
        <div className="pdl__modal-backdrop" role="presentation" onClick={() => !saveDialog.busy && setSaveDialog(null)}>
          <div className="pdl__modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="pdl__modal-head">
              <h3>Save to library</h3>
              <button type="button" className="pdl__modal-close" onClick={() => setSaveDialog(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <p className="pdl__modal-note">
              This creates an independent copy in the shared library — it is a snapshot, not a link to this pacing.
            </p>
            <label className="pdl__modal-field">
              Name
              <input
                type="text"
                value={saveDialog.name}
                maxLength={80}
                onChange={(event) => setSaveDialog({ ...saveDialog, name: event.target.value })}
              />
            </label>
            <label className="pdl__modal-field">
              Description (optional)
              <textarea
                value={saveDialog.description}
                maxLength={240}
                onChange={(event) => setSaveDialog({ ...saveDialog, description: event.target.value })}
              />
            </label>
            {saveDialog.error && <p className="form-error">{saveDialog.error}</p>}
            <div className="pdl__modal-actions">
              <button type="button" className="button button--ghost" onClick={() => setSaveDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button"
                disabled={saveDialog.busy || !saveDialog.name.trim()}
                onClick={confirmSaveToLibrary}
              >
                {saveDialog.busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetCard({
  widget,
  selected,
  dragging,
  onToggleSelect,
  onRemove,
  onSaveToLibrary,
  onDragStart,
  onDrop,
}: {
  widget: PacingWidgetInstance;
  selected: boolean;
  dragging: boolean;
  onToggleSelect: () => void;
  onRemove: () => void;
  onSaveToLibrary: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  return (
    <li
      className={cn("pdl__widget", selected && "pdl__widget--selected", dragging && "pdl__widget--dragging")}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <span className="pdl__widget-handle" aria-hidden="true" />
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Select ${widgetTitle(widget)} for grouping`}
      />
      <span className="pdl__widget-title">{widgetTitle(widget)}</span>
      {widget.lib && <span className="pdl__widget-badge">from library</span>}
      <div className="pdl__widget-actions">
        <button type="button" className="button button--ghost button--sm" onClick={onSaveToLibrary}>
          Save to library
        </button>
        <button type="button" className="pdl__remove" onClick={onRemove} aria-label={`Remove ${widgetTitle(widget)}`}>
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}
