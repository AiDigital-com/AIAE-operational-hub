import type { PacingLibraryEntryV1 } from "../pacing-dashboard/types";

/** One choice in the create screen's "Dashboard layout" list. */
export interface CreationLayoutOption {
  id: string;
  label: string;
}

/**
 * One list for creation: shared Layouts and the caller's own private Layouts - a port of the
 * reference's `workspace/src/lib/create-layout-options.js`. The same shared entry can appear on both
 * shelves; its id is its identity. Sorted by name, then author; a name that two entries share reads
 * with its author beside it, so the two can be told apart.
 */
export function creationLayoutOptions(
  shared: readonly PacingLibraryEntryV1[] | undefined,
  mine: readonly PacingLibraryEntryV1[] | undefined
): CreationLayoutOption[] {
  const entries = new Map<string, PacingLibraryEntryV1>();
  for (const entry of [...(shared ?? []), ...(mine ?? [])]) {
    if (entry.kind === "layout") entries.set(entry.id, entry);
  }
  const sorted = [...entries.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.ownerName ?? "").localeCompare(b.ownerName ?? "") ||
      a.id.localeCompare(b.id)
  );
  const counts = new Map<string, number>();
  for (const entry of sorted) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  return sorted.map((entry) => ({
    id: entry.id,
    label:
      (counts.get(entry.name) ?? 0) > 1
        ? `${entry.name} · ${entry.ownerName || (entry.mine ? "You" : "Shared")}`
        : entry.name,
  }));
}
