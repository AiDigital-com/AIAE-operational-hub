import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { CheckIcon, CloseIcon, CopyIcon, EditIcon, PlusIcon, SearchIcon, TrashIcon, UploadIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import {
  createPacingLibraryEntry,
  deletePacingLibraryEntry,
  listPacingLibrary,
  setPacingLibraryLike,
  updatePacingLibraryEntry,
} from "./api";
import {
  WIDGET_CAP,
  copyWidget,
  editSeedTitle,
  hasSwitch,
  newGroupId,
  newWidgetId,
  setTileEnabled,
  tileEnabled,
  tileTitle,
  widgetTitle,
  withWidgetRemoved,
} from "./widgets/widget-tiles";
import { WidgetPreview } from "./widget-preview";
import { WidgetEditor } from "./widget-editor";
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

/** Nothing to copy: a linked tile whose library entry is gone has no definition, only the broken
 *  ref - and copying that would put a SECOND unavailable tile on the dashboard. */
const COPY_NO_DEFINITION = "Nothing to copy: this tile's library entry is unavailable";
const COPY_AT_CAP = `Widget limit reached (${WIDGET_CAP})`;

interface SaveDialogState {
  widgetId: string;
  name: string;
  description: string;
  busy: boolean;
  error: string | null;
}

/**
 * Resolves what a widget instance actually draws.
 *
 * A LINKED instance carries no spec - the library entry is the definition, and copying it into the
 * instance is exactly what Pacing forbids, because the copy stops matching the moment the author
 * edits theirs. So the drawable widget is the entry's definition wearing the instance's id.
 * Null when the entry is gone; the card still lists it so it can be removed.
 */
export function resolveWidget(
  widget: PacingWidgetInstance,
  libraryEntries: Record<string, unknown> | undefined
): PacingWidgetInstance | null {
  if (!widget.lib) return widget;
  const entry = libraryEntries?.[widget.lib.key] as { definition?: unknown } | undefined;
  const definition = entry?.definition as Partial<PacingWidgetInstance> | undefined;
  if (!definition) return null;
  return { ...definition, id: widget.id, lib: widget.lib } as PacingWidgetInstance;
}

interface PacingDashboardLibraryProps {
  display: PacingDisplayShape;
  saving: boolean;
  saveError: string | null;
  /** Definitions for the linked instances on this pacing, keyed by entry id. */
  libraryEntries: Record<string, unknown> | undefined;
  /** Saves the WHOLE patch (widgets + groups + the on/off map) back to the pacing; the caller owns
   *  the displayRev CAS and reports a conflict (US-118) rather than silently overwriting. */
  onSave: (patch: {
    widgets: PacingWidgetInstance[];
    groups: PacingWidgetGroup[];
    enabled: Record<string, boolean>;
  }) => void;
  isAdmin: boolean;
  /** A widget to open the builder on at once - a tile's "Edit…" on the dashboard behind. */
  initialWidgetId?: string | null;
  /** Called once that has been honoured, so reopening the drawer lands on the list. */
  onWidgetEditorOpened?: () => void;
}

/**
 * The widget-library management panel (§6, US-116/117/118): the widgets currently on this pacing
 * (reorder, group, remove, save-to-library) plus the shared catalog to browse and add from. Renders
 * widget IDENTITY (title/kind/origin), not a re-creation of an arbitrary widget's own visual content -
 * reproducing Pacing's full widget-spec rendering engine is out of scope here (see the migration
 * report); the dashboard's own health/financial/chart sections above render the real figures directly.
 */
export function PacingDashboardLibrary({ display, saving, saveError, onSave, isAdmin, libraryEntries, initialWidgetId, onWidgetEditorOpened }: PacingDashboardLibraryProps) {
  const queryClient = useQueryClient();
  const widgets = useMemo(() => display.widgets ?? [], [display.widgets]);
  const groups = useMemo(() => display.groups ?? [], [display.groups]);
  const enabled = useMemo(() => display.enabled ?? {}, [display.enabled]);
  const groupedIds = useMemo(() => new Set(groups.flatMap((g) => g.tileIds)), [groups]);
  const atCap = widgets.length >= WIDGET_CAP;

  /** Which widget the builder is open on, if any. Id, not the object: the draft is the source of
   *  truth and a held object would go stale the moment an edit landed. */
  const [editingId, setEditingId] = useState<string | null>(initialWidgetId ?? null);
  // A tile's "Edit…" arrives as a prop rather than as a call, because the drawer mounts this panel
  // only when its tab is shown. Consumed once: reopening the drawer afterwards lands on the list.
  useEffect(() => {
    if (!initialWidgetId) return;
    setEditingId(initialWidgetId);
    onWidgetEditorOpened?.();
  }, [initialWidgetId, onWidgetEditorOpened]);
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
    onSave({ widgets: next, groups, enabled });
  }

  function removeWidget(widgetId: string) {
    // US-116: removing affects only this pacing - the library entry it may be linked to is untouched.
    // The group sweep and the on/off cleanup both come from `widget-tiles`, which runs Pacing's own
    // `sweepGroups`, so a frame never keeps a ghost member and a stale off-switch cannot attach
    // itself to a later widget that happens to reuse the id.
    setSelected((current) => {
      const next = new Set(current);
      next.delete(widgetId);
      return next;
    });
    onSave(withWidgetRemoved(widgets, groups, enabled, widgetId));
  }

  /**
   * Turn a tile on or off. Absent ≡ on, so turning one ON removes its entry rather than storing
   * `true` - the stored map stays the size of what someone actually switched off.
   *
   * A switched-off widget keeps everything else: its definition, its place in the order, its group
   * membership. It is hidden from the dashboard, not removed from the pacing, which is why the
   * control is a switch on the card rather than a second kind of delete.
   */
  function toggleWidget(widgetId: string, on: boolean) {
    onSave({ widgets, groups, enabled: setTileEnabled(enabled, widgetId, on) });
  }

  /**
   * Fold a builder edit into the draft, in place.
   *
   * The builder reports an UPDATER, not a widget: `onPatch((w) => ({ ...w, spec: … }))`. It owns no
   * copy of the tile and never saves - it describes the change and hands it up, which is what lets
   * it live inside this drawer's draft rather than beside it.
   *
   * It is applied to what the tile DRAWS (`resolveWidget`), because that is what the builder was
   * opened on - applying it to the stored instance would feed a linked tile's empty shell through a
   * mutation written against the entry's definition.
   *
   * A LINKED instance is DETACHED by the edit, which is Pacing's own rule: the result is a
   * definition, and leaving a `lib` ref beside it would claim the tile still follows an entry it no
   * longer matches.
   */
  function patchWidget(widgetId: string, updater: (w: PacingWidgetInstance) => PacingWidgetInstance) {
    const current = widgets.find((w) => w.id === widgetId);
    if (!current) return;
    const drawn = resolveWidget(current, libraryEntries);
    if (!drawn) return;
    const next = { ...updater({ ...drawn, title: editSeedTitle(current, drawn) }), id: widgetId };
    delete next.lib;
    delete next.from;
    onSave({ widgets: widgets.map((w) => (w.id === widgetId ? next : w)), groups, enabled });
  }

  /**
   * Put an independent copy of a widget on this pacing, right after the original.
   *
   * The SOURCE is what the tile DRAWS, not the stored instance: a linked instance carries no spec of
   * its own, so copying it would produce a widget with nothing in it. `copyWidget` then drops `lib`
   * and `from`, because a copy is a private widget rather than a second linked tile - editing it can
   * never surprise the original entry's author, and this pacing does not count that entry twice.
   *
   * The copy deliberately does NOT join the original's group: a group is an arrangement someone
   * built, and silently widening it is not what "duplicate" says.
   */
  function duplicateWidget(widgetId: string) {
    if (atCap) return;
    const widget = widgets.find((w) => w.id === widgetId);
    if (!widget) return;
    const drawn = resolveWidget(widget, libraryEntries);
    if (!drawn) return; // the card's button is already disabled for this; belt to that brace
    const index = widgets.findIndex((w) => w.id === widgetId);
    // The name the CARD shows, through the same rule it uses: a linked tile's own title is an
    // override on top of its entry's name, and `resolveWidget` returns the entry's definition - so
    // taking the title off `drawn` alone would throw the user's rename away and call the copy
    // "Untitled widget (copy)".
    const copy = copyWidget({ ...drawn, title: tileTitle(widget, drawn) }, widgets.map((w) => w.id));
    const next = [...widgets];
    next.splice(index + 1, 0, copy);
    onSave({ widgets: next, groups, enabled });
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
    const nextGroup: PacingWidgetGroup = {
      id: newGroupId(groups.map((g) => g.id)),
      tileIds,
      bg: "slate",
      title: "New group",
    };
    onSave({ widgets, groups: [...groups, nextGroup], enabled });
    setSelected(new Set());
  }

  function ungroup(groupId: string) {
    onSave({ widgets, groups: groups.filter((g) => g.id !== groupId), enabled });
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
    if (atCap) return;
    const definition = (entry.definition ?? {}) as Partial<PacingWidgetInstance> & Record<string, unknown>;
    const key = entry.id;
    const isStandard = typeof key === "string" && key.startsWith("std:");
    const usedIds = widgets.map((w) => w.id);

    const instance: PacingWidgetInstance = isStandard
      ? (() => {
          // Copy, minus the two fields that only mean anything on a linked one.
          const { lib: _lib, from: _from, ...copied } = definition;
          return { ...copied, id: newWidgetId(usedIds) } as PacingWidgetInstance;
        })()
      : {
          id: newWidgetId(usedIds),
          kind: "composite",
          lib: { src: "user", key },
          profile: definition.profile,
          schemaVersion: 2,
          datasetType: definition.datasetType,
        };

    onSave({ widgets: [...widgets, instance], groups, enabled });
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
    // The name the card shows, for the same reason the copy takes it: a linked tile's own title is
    // an override, so neither half of the pair answers alone.
    const name = widget
      ? tileTitle(widget, resolveWidget(widget, libraryEntries))
      : widgetTitle({ title: undefined });
    setSaveDialog({ widgetId, name, description: "", busy: false, error: null });
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

  /** One place for the card's wiring, so the grouped and ungrouped lists cannot drift apart - they
   *  render the same card and already restated the whole prop list twice between them. */
  function cardProps(widget: PacingWidgetInstance) {
    // Resolved once per card: the picture, the name and the Duplicate button all ask the same
    // question of it, and a linked instance's answer is its library entry's definition.
    const drawn = resolveWidget(widget, libraryEntries);
    // Why a copy may be impossible, in the card's own words. Null means it is offered.
    const noCopy = !drawn ? COPY_NO_DEFINITION : atCap ? COPY_AT_CAP : null;
    return {
      widget,
      drawn,
      selected: selected.has(widget.id),
      dragging: dragId === widget.id,
      // `hasSwitch` is the one gate for "does this id get a control at all": an id dash-gate's
      // enabled{} may not carry gets no switch, rather than an affordance whose save is refused.
      on: tileEnabled(display, widget.id),
      switchable: hasSwitch(widget.id),
      noCopy,
      onToggleSelect: () => toggleSelected(widget.id),
      onToggleOn: (next: boolean) => toggleWidget(widget.id, next),
      onDuplicate: () => duplicateWidget(widget.id),
      // Editing needs what the tile DRAWS: a linked instance carries no spec, so opening the
      // builder on the bare ref would show an empty widget. Unavailable when the entry is gone,
      // for the same reason Duplicate is.
      onEdit: drawn ? () => setEditingId(widget.id) : null,
      onRemove: () => removeWidget(widget.id),
      onSaveToLibrary: () => openSaveDialog(widget.id),
      onDragStart: () => setDragId(widget.id),
      onDrop: () => dragId && reorder(dragId, widget.id),
    };
  }

  const editing = editingId ? widgets.find((w) => w.id === editingId) : undefined;
  if (editing) {
    // Opened on what the tile DRAWS, not the stored instance - a linked one carries no spec.
    const drawn = resolveWidget(editing, libraryEntries);
    if (drawn) {
      return (
        <WidgetEditor
          widget={{ ...drawn, title: editSeedTitle(editing, drawn) }}
          onPatch={(updater) => patchWidget(editing.id, updater)}
          onClose={() => setEditingId(null)}
        />
      );
    }
  }

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

        <ul className="pdl__grid">
          {groups.map((group) => {
            const members = widgets.filter((w) => group.tileIds.includes(w.id));
            if (members.length === 0) return null;
            return (
              <li key={group.id} className={cn("pdl__group", `pdl__group--${group.bg}`)}>
                {!group.hideTitle && <div className="pdl__group-title">{group.title || "Group"}</div>}
                <button type="button" className="pdl__group-ungroup" onClick={() => ungroup(group.id)}>
                  Ungroup
                </button>
                <ul className="pdl__grid pdl__grid--nested">
                  {members.map((widget) => (
                    <WidgetCard key={widget.id} {...cardProps(widget)} />
                  ))}
                </ul>
              </li>
            );
          })}
          {ungroupedWidgets.map((widget) => (
            <WidgetCard key={widget.id} {...cardProps(widget)} />
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
          <ul className="pdl__grid pdl__grid--library">
            {libraryQuery.data.map((entry) => (
              <li key={entry.id} className="pdl__card pdl__card--entry">
                {/* Only a widget entry is drawable: a block is several widgets and a layout is an
                    arrangement of them, and neither renders through the tile engine. They keep the
                    written card the list always was rather than an empty frame that reads broken. */}
                {entry.kind === "widget" && (
                  <WidgetPreview widget={(entry.definition ?? null) as PacingWidgetInstance | null} />
                )}
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
                  {/* Only where it earns its place: a widget card stays bare, and the chip appears
                      on the kinds a reader could otherwise mistake for one. The mixed "All" list is
                      what it is for. */}
                  {entry.kind !== "widget" && (
                    <span className={cn("pdl__library-kind", `pdl__library-kind--${entry.kind}`)}>{entry.kind}</span>
                  )}
                  {entry.description && <span className="pdl__library-desc">{entry.description}</span>}
                  <span className="pdl__library-meta">
                    {entry.ownerName ? `by ${entry.ownerName} · ` : ""}
                    {entry.usage} pacing{entry.usage === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="pdl__library-actions">
                  <button
                    type="button"
                    className={cn("pdl__like", entry.liked && "pdl__like--active")}
                    onClick={() => toggleLike(entry)}
                    aria-pressed={entry.liked}
                    aria-label={entry.liked ? `Unlike ${entry.name}` : `Like ${entry.name}`}
                    title={entry.liked ? "You like this" : "Like this entry"}
                  >
                    ♥<span className="pdl__like-n">{entry.likes}</span>
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
  drawn,
  selected,
  dragging,
  on,
  switchable,
  noCopy,
  onToggleSelect,
  onToggleOn,
  onDuplicate,
  onEdit,
  onRemove,
  onSaveToLibrary,
  onDragStart,
  onDrop,
}: {
  widget: PacingWidgetInstance;
  /** What this tile actually draws - the instance itself, or its library entry's definition wearing
   *  the instance's id. Null when a linked entry is gone: the card still lists it so it can be
   *  removed, and says why there is no picture. */
  drawn: PacingWidgetInstance | null;
  selected: boolean;
  dragging: boolean;
  /** Shown on the dashboard. Absent from `display.enabled` ≡ true. */
  on: boolean;
  /** Does this id get a switch at all - i.e. may `display.enabled` carry it. */
  switchable: boolean;
  /** Why Duplicate is unavailable, in the words the button shows; null when it is offered. */
  noCopy: string | null;
  onToggleSelect: () => void;
  onToggleOn: (next: boolean) => void;
  onDuplicate: () => void;
  /** Opens the widget builder on this tile. Null when there is no definition to open it on. */
  onEdit: (() => void) | null;
  onRemove: () => void;
  onSaveToLibrary: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const title = tileTitle(widget, drawn);
  return (
    <li
      className={cn(
        "pdl__card",
        selected && "pdl__card--selected",
        dragging && "pdl__card--dragging",
        !on && "pdl__card--off"
      )}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {/* Name ABOVE the picture, the way the retired gallery card was built - and the opposite way
          round from a library card, which leads with its picture. The difference is deliberate in
          the original and worth keeping: your own tiles are scanned by name, someone else's entries
          are scanned by what they look like.

          The controls used to share this row. Four of them do not fit: at the grid's 230px minimum a
          switch, Duplicate, Save and Remove leave the name about seven characters, which defeats the
          scanning this row exists for. They sit in their own bar under the picture instead - the
          same shape the library card beside it already uses. */}
      <div className="pdl__card-meta">
        <input
          type="checkbox"
          className="pdl__pick"
          checked={selected}
          onChange={onToggleSelect}
          title="Select for grouping"
          aria-label={`Select ${title} for grouping`}
        />
        <span className="pdl__card-title" title={title}>
          {title}
        </span>
        {widget.lib && <span className="pdl__widget-badge">linked</span>}
        {/* The dimming alone says "different", not "off" - and a widget that simply has no data to
            draw looks dim too. The word is what separates the two. */}
        {!on && <span className="pdl__widget-badge pdl__widget-badge--off">off</span>}
      </div>
      <WidgetPreview widget={drawn} />
      <div className="pdl__card-actions">
        {switchable && (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`Show ${title} on the dashboard`}
            className={cn("pdl__switch", on && "pdl__switch--on")}
            // The control carries no visible text, so the hover title is where the meaning of the
            // two positions is spelled out.
            title={on ? "Shown on the dashboard. Click to turn off." : "Not shown on the dashboard. Click to turn on."}
            onClick={() => onToggleOn(!on)}
          />
        )}
        <div className="pdl__card-icons">
          <button
            type="button"
            className="pdl__icon-btn"
            onClick={() => onEdit?.()}
            disabled={!onEdit}
            title={onEdit ? "Edit" : COPY_NO_DEFINITION.replace("copy", "edit")}
            aria-label={`Edit ${title}`}
          >
            <EditIcon />
          </button>
          <button
            type="button"
            className="pdl__icon-btn"
            onClick={onDuplicate}
            disabled={noCopy !== null}
            title={noCopy ?? "Duplicate"}
            aria-label={`Duplicate ${title}`}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            className="pdl__icon-btn"
            onClick={onSaveToLibrary}
            title="Save to library"
            aria-label={`Save ${title} to library`}
          >
            <UploadIcon />
          </button>
          <button type="button" className="pdl__icon-btn" onClick={onRemove} aria-label={`Remove ${title}`} title="Remove">
            <TrashIcon />
          </button>
        </div>
      </div>
    </li>
  );
}
