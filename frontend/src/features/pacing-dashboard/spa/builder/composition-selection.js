import { compositionPath, findCompositionNode } from './composition-model.js';

export const singleSelection = (id) => ({ activeId: id, ids: [id] });

/** One selection for the outline, canvas and every structural action. */
export function selectCompositionElement(root, selection, id, additive = false) {
  if (!findCompositionNode(root, id)) return selection;
  if (!additive || id === root.id) return singleSelection(id);
  const current = selection.ids.filter((entry) => entry !== root.id);
  const ids = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
  return ids.length ? { activeId: ids.includes(id) ? id : ids.at(-1), ids } : singleSelection(root.id);
}

export function reconcileCompositionSelection(root, selection) {
  const ids = selection.ids.filter((id) => findCompositionNode(root, id));
  if (!ids.length) return singleSelection(root.id);
  const activeId = ids.includes(selection.activeId) ? selection.activeId : ids.at(-1);
  return ids.length === selection.ids.length && activeId === selection.activeId ? selection : { activeId, ids };
}

export function canWrapSelection(root, ids) {
  if (!ids.length || ids.includes(root.id)) return false;
  const parents = ids.map((id) => compositionPath(root, id).at(-2)?.id);
  return !!parents[0] && parents.every((id) => id === parents[0]);
}
