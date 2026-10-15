// Catalog response reconciliation for the Library screen. Kept pure so request
// ordering can be exercised without a browser or a database.

export function reconcileLibraryList(current, incoming, requestGeneration, currentGeneration) {
  return requestGeneration === currentGeneration ? incoming : current;
}

export function reconcileLibraryVisibility(entries, shelf, entry, visibility) {
  const current = entries || [];
  // Standard contains bundled templates only. A user-entry response that lands
  // after navigation must not add one to that catalog.
  if (shelf === 'standard') return current;

  // Shared contains every team entry; Mine contains the viewer's entries at
  // either visibility. The entry passed here is the decorated list row from the
  // click, so inserting it retains likes, liked, usage and mine.
  const belongs = shelf === 'shared' ? visibility === 'team' : !!entry.mine;
  if (!belongs) return current.filter((row) => row.id !== entry.id);

  const index = current.findIndex((row) => row.id === entry.id);
  if (index < 0) return [...current, { ...entry, visibility }];
  return current.map((row, i) => (i === index ? { ...row, visibility } : row));
}
