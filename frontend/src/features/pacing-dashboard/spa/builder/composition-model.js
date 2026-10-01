// The editor projects existing saved layouts onto the same tree it creates from scratch.
// Opening does not persist that projection: ReportBuilder applies it inside the first edit.
import { LIMITS } from '../report-v2.js';
import { addView } from '../report-draft.js';
import { layoutRecipe } from '../layout-recipes.js';
import { LAYOUT_BLOCK_CHOICES, freshLayoutBlock, mergeLayoutFields } from './layout-model.js';

const arr = (value) => Array.isArray(value) ? value : [];
const obj = (value) => value && typeof value === 'object' && !Array.isArray(value);
const copy = (value) => structuredClone(value);

export const COMPOSITION_NODE_CHOICES = Object.freeze([
  { kind: 'container', label: 'Container', group: 'Arrange', icon: '▦' },
  { kind: 'recipe:flightBullet', label: 'Flight', hint: 'Editable day, progress and remaining time', group: 'Compositions' },
  ...[['chart', 'Chart'], ['table', 'Table'], ['kpi', 'KPI'], ['pie', 'Donut'], ['compare', 'Compare']]
    .map(([kind, label]) => ({ kind, label, group: 'Data', icon: kind === 'chart' ? '▥' : '#' })),
  ...LAYOUT_BLOCK_CHOICES.map(([type, label, hint]) => ({
    kind: `atom:${type}`, label: type === 'flightBullet' ? 'Flight summary' : label, hint, group: ['header', 'note'].includes(type) ? 'Text' : 'Readings',
    icon: ['header', 'note'].includes(type) ? 'T' : '◉',
  })),
]);

export function compositionAddChoices(widget, env = {}) {
  const dim = arr(env.dims).find((entry) => entry.kind === 'dim' && entry.available !== false && !entry.reason && !entry.disabled && !entry.disabledReason && !entry.refusal);
  return COMPOSITION_NODE_CHOICES.map((choice) => {
    if (choice.kind === 'compare' && widget?.spec?.dataset?.type !== 'deliveryCm360') {
      return { ...choice, disabledReason: 'Add the CM360 source in Data first' };
    }
    if (choice.kind === 'pie') return dim
      ? { ...choice, opts: { sliceByKey: dim.key } }
      : { ...choice, disabledReason: 'No breakdown dimension is available' };
    return choice;
  });
}

function allocator(spec) {
  const used = new Set();
  const read = (value) => {
    if (Array.isArray(value)) value.forEach(read);
    else if (obj(value)) {
      if (typeof value.id === 'string') used.add(value.id);
      Object.values(value).forEach(read);
    }
  };
  read(spec);
  return (prefix = 'node') => {
    for (let n = 1; n < 100000; n += 1) {
      const id = `${prefix}${n}`;
      if (!used.has(id)) { used.add(id); return id; }
    }
    throw new Error('No free composition ID');
  };
}

export const compositionChildren = (node) => node?.kind === 'container' ? arr(node.children) : [];
export function findCompositionNode(root, id) {
  if (root?.id === id) return root;
  for (const node of compositionChildren(root)) {
    const match = findCompositionNode(node, id);
    if (match) return match;
  }
  return null;
}
export function compositionPath(root, id) {
  if (root?.id === id) return [root];
  for (const node of compositionChildren(root)) {
    const path = compositionPath(node, id);
    if (path.length) return [root, ...path];
  }
  return [];
}
export function compositionContainers(root) {
  return root?.kind === 'container'
    ? [root, ...compositionChildren(root).flatMap(compositionContainers)] : [];
}
const descendants = (node) => [node, ...compositionChildren(node).flatMap(descendants)];

function projectLayout(view, mint) {
  // Malformed data stays on its repair surface; conversion must not erase its evidence.
  if (!Array.isArray(view.rows) || view.rows.some((row) => !obj(row) || !Array.isArray(row.cols)
    || row.cols.some((col) => !obj(col) || !Array.isArray(col.bricks)))) return view;
  const { rows, kind, ...rest } = view;
  return {
    ...rest, kind: 'container', direction: 'column', frame: 'none',
    children: rows.map((row) => {
      const { cols, ...rowFields } = row;
      return {
        id: mint('row'), kind: 'container', title: '', direction: 'row', frame: 'none',
        ...rowFields,
        children: cols.map((col) => {
          const { bricks, ...columnFields } = col;
          return {
            id: mint('panel'), kind: 'container', title: '', direction: 'column', frame: 'none',
            ...columnFields,
            ...(col.frame === 'card' && Object.hasOwn(col, 'sub') ? { hideSubtitle: true } : {}),
            ...(col.frame === 'signal' && Object.hasOwn(col, 'badge') ? { hideBadge: true } : {}),
            children: bricks.map((brick) => ({ id: mint('item'), kind: 'atom', brick: copy(brick) })),
          };
        }),
      };
    }),
  };
}

export function toCompositionSpec(spec) {
  if (!obj(spec) || !Array.isArray(spec.views)) return spec;
  if (spec.views.length === 1 && spec.views[0]?.kind === 'container') return spec;
  const mint = allocator(spec);
  const projected = spec.views.map((view) => view?.kind === 'layout' ? projectLayout(view, mint) : view);
  if (projected.some((view) => view?.kind === 'layout')) return spec;
  if (projected.length === 1 && projected[0]?.kind === 'container') return { ...spec, views: projected };
  const children = [];
  for (let i = 0; i < projected.length; i += 1) {
    const row = [];
    do {
      const { besideNext, ...node } = projected[i];
      row.push(node);
      if (!besideNext || i === projected.length - 1) break;
      i += 1;
    } while (i < projected.length);
    children.push(row.length === 1 ? row[0] : {
      id: mint('row'), kind: 'container', title: '', direction: 'row', distribution: 'content', frame: 'none', children: row,
    });
  }
  return { ...spec, views: [{ id: mint('root'), kind: 'container', title: '', direction: 'column', frame: 'none', children }] };
}

function rootOf(spec, viewId) { return arr(spec?.views).find((view) => view?.id === viewId); }
function transform(node, id, mutate) {
  if (node?.id === id) return mutate(node);
  if (node?.kind !== 'container') return node;
  const children = compositionChildren(node).map((child) => transform(child, id, mutate));
  return children.every((child, i) => child === node.children[i]) ? node : { ...node, children };
}
export function patchCompositionNode(spec, viewId, nodeId, mutateOrFields) {
  const mutate = typeof mutateOrFields === 'function' ? mutateOrFields
    : (node) => mergeLayoutFields(node, mutateOrFields);
  const views = arr(spec?.views).map((view) => view?.id === viewId ? transform(view, nodeId, mutate) : view);
  return views.every((view, i) => view === spec.views[i]) ? spec : { ...spec, views };
}

function prepare(spec, kind, opts = {}) {
  const mint = allocator(spec);
  if (kind.startsWith('recipe:')) {
    const recipe = layoutRecipe(kind.slice(7));
    if (recipe) return { spec, node: {
      id: mint('container'), kind: 'container', title: '', direction: 'column', frame: 'none', gap: recipe.gap || 'compact',
      children: recipe.bricks.map((brick) => ({ id: mint('item'), kind: 'atom', brick })),
    } };
  }
  if (kind === 'container') return { spec, node: {
    id: mint('container'), kind, title: '', direction: 'column', frame: 'none', children: [],
  } };
  if (kind === 'atom' || kind.startsWith('atom:')) return { spec, node: {
    id: mint('item'), kind: 'atom', brick: freshLayoutBlock(opts.type || kind.slice(5), spec),
  } };
  const next = addView(spec, kind, opts);
  const node = next.views[next.views.length - 1];
  return { node, spec: { ...next, views: next.views.slice(0, -1) } };
}
export function freshCompositionNode(kind, spec, opts = {}) { return prepare(spec, kind, opts).node; }

/** Explicit, undoable expansion. Preserve the original endpoint ID and outer geometry. */
export function expandCompositionRecipe(spec, viewId, nodeId) {
  const node = findCompositionNode(rootOf(spec, viewId), nodeId);
  if (node?.kind !== 'atom' || !layoutRecipe(node.brick?.type)
    || Object.keys(node.brick).some((key) => key !== 'type')) return spec;
  const { brick, ...outer } = node;
  const replacement = { ...prepare(spec, `recipe:${brick.type}`).node, ...outer, kind: 'container' };
  const next = patchCompositionNode(spec, viewId, nodeId, () => replacement);
  return fits(rootOf(next, viewId)) ? next : spec;
}

function fits(root) {
  const nodes = descendants(root);
  const maxDepth = (node) => 1 + Math.max(0, ...compositionChildren(node).map(maxDepth));
  return nodes.length <= (LIMITS.compositionNodes || 384)
    && maxDepth(root) <= (LIMITS.compositionDepth || 6)
    && nodes.every((node) => compositionChildren(node).length <= (LIMITS.containerChildren || 32))
    && nodes.filter((node) => node.kind === 'atom').length <= (LIMITS.compositionAtoms || 192)
    && nodes.filter((node) => !['atom', 'container', 'layout'].includes(node.kind)).length <= LIMITS.views;
}
export function addCompositionNode(spec, viewId, parentId, nodeOrKind, index, opts = {}) {
  const parent = findCompositionNode(rootOf(spec, viewId), parentId);
  if (parent?.kind !== 'container') return spec;
  const prepared = typeof nodeOrKind === 'string' ? prepare(spec, nodeOrKind, opts) : { spec, node: copy(nodeOrKind) };
  const next = patchCompositionNode(prepared.spec, viewId, parentId, (node) => {
    const children = [...compositionChildren(node)];
    children.splice(Number.isInteger(index) ? Math.max(0, Math.min(index, children.length)) : children.length, 0, prepared.node);
    return { ...node, children };
  });
  return fits(rootOf(next, viewId)) ? next : spec;
}

export function removeCompositionNode(spec, viewId, nodeId) {
  const root = rootOf(spec, viewId);
  const path = compositionPath(root, nodeId);
  if (path.length < 2) return spec;
  const removed = new Set(descendants(path[path.length - 1]).map((node) => node.id));
  const next = patchCompositionNode(spec, viewId, path[path.length - 2].id, (parent) => ({
    ...parent, children: compositionChildren(parent).filter((node) => node.id !== nodeId),
  }));
  return { ...next, interactions: arr(next.interactions).filter((wire) => !removed.has(wire.sourceViewId) && !removed.has(wire.targetViewId)) };
}

export function relocateCompositionNode(spec, viewId, nodeId, targetParentId, index) {
  const root = rootOf(spec, viewId);
  const path = compositionPath(root, nodeId);
  const node = path[path.length - 1];
  if (path.length < 2 || findCompositionNode(node, targetParentId)
    || findCompositionNode(root, targetParentId)?.kind !== 'container') return spec;
  const source = path[path.length - 2];
  const oldIndex = source.children.findIndex((child) => child.id === nodeId);
  let insertAt = index;
  if (source.id === targetParentId && Number.isInteger(index) && oldIndex < index) insertAt -= 1;
  // Moving preserves interaction endpoints. Only actual removal deletes their wires.
  const removed = patchCompositionNode(spec, viewId, source.id, (parent) => ({
    ...parent, children: compositionChildren(parent).filter((child) => child.id !== nodeId),
  }));
  const next = addCompositionNode(removed, viewId, targetParentId, node, insertAt);
  return next === removed ? spec : next;
}

export function moveCompositionNode(spec, viewId, nodeId, direction) {
  const path = compositionPath(rootOf(spec, viewId), nodeId);
  if (path.length < 2 || ![-1, 1].includes(direction)) return spec;
  const parent = path[path.length - 2];
  const index = parent.children.findIndex((node) => node.id === nodeId);
  if (index + direction < 0 || index + direction >= parent.children.length) return spec;
  return relocateCompositionNode(spec, viewId, nodeId, parent.id, index + (direction > 0 ? 2 : -1));
}

// Row spans are ratios. Retain authored weights when possible, reduce whole-number
// ratios first, then scale the WHOLE row together when a group exceeds the bound.
const rowWeight = (node) => node.span || 1;
function fitRowWeights(weights) {
  if (!weights.every((weight) => Number.isFinite(weight) && weight > 0)) return null;
  const maximum = Math.max(0, ...weights);
  if (maximum <= LIMITS.layoutSpan) return weights;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const common = weights.every(Number.isInteger) ? weights.reduce(gcd) : 1;
  const integerReduction = maximum / common <= LIMITS.layoutSpan;
  const divisor = integerReduction ? common : maximum / LIMITS.layoutSpan;
  const scaled = weights.map((weight) => !integerReduction && weight === maximum ? LIMITS.layoutSpan : weight / divisor);
  // Refuse an unrepresentable floating-point result atomically, never turn a tiny
  // positive span into zero (which the renderer would reinterpret as default width).
  return scaled.every((weight) => Number.isFinite(weight) && weight > 0 && weight <= LIMITS.layoutSpan) ? scaled : null;
}
const withRowWeight = (node, weight) => rowWeight(node) === weight ? node : { ...node, span: weight };

/** Wrapping is one transaction. Original children, IDs and interaction endpoints survive. */
export function wrapCompositionNodes(spec, viewId, nodeIds) {
  const root = rootOf(spec, viewId);
  const ids = new Set(nodeIds);
  const paths = [...ids].map((id) => compositionPath(root, id));
  if (!paths.length || paths.some((path) => path.length < 2)) return spec;
  const parent = paths[0].at(-2);
  if (paths.some((path) => path.at(-2).id !== parent.id)) return spec;
  const children = parent.children.filter((node) => ids.has(node.id));
  const wrapper = {
    ...freshCompositionNode('container', spec), direction: parent.direction,
    children,
    ...(parent.direction === 'row' ? { span: children.reduce((sum, node) => sum + rowWeight(node), 0) }
      : children.length === 1 && Object.hasOwn(children[0], 'span') ? { span: children[0].span } : {}),
  };
  const first = parent.children.findIndex((node) => ids.has(node.id));
  let siblings = parent.children.flatMap((child, index) => index === first ? [wrapper] : ids.has(child.id) ? [] : [child]);
  if (parent.direction === 'row') {
    const weights = fitRowWeights(siblings.map(rowWeight));
    if (!weights) return spec;
    siblings = siblings.map((node, index) => withRowWeight(node, weights[index]));
  }
  const next = patchCompositionNode(spec, viewId, parent.id, (node) => ({ ...node, children: siblings }));
  return fits(rootOf(next, viewId)) ? next : spec;
}

export function unwrapCompositionNode(spec, viewId, nodeId) {
  const path = compositionPath(rootOf(spec, viewId), nodeId);
  const node = path.at(-1);
  if (path.length < 2 || node?.kind !== 'container') return spec;
  const parent = path.at(-2);
  let promoted = node.children;
  if (parent.direction === 'row' && promoted.length) {
    const total = promoted.reduce((sum, child) => sum + rowWeight(child), 0);
    const factor = rowWeight(node) / total;
    const weights = promoted.map((child) => factor > 0 ? rowWeight(child) * factor : (rowWeight(node) * rowWeight(child)) / total);
    if (!weights.every((weight) => Number.isFinite(weight) && weight > 0)) return spec;
    promoted = promoted.map((child, index) => withRowWeight(child, weights[index]));
  }
  let siblings = parent.children.flatMap((child) => child.id === nodeId ? promoted : [child]);
  if (parent.direction === 'row') {
    const weights = fitRowWeights(siblings.map(rowWeight));
    if (!weights) return spec;
    siblings = siblings.map((child, index) => withRowWeight(child, weights[index]));
  }
  const next = patchCompositionNode(spec, viewId, parent.id, (current) => ({ ...current, children: siblings }));
  // Mixed directions adopt the parent's arrangement after the editor's confirmation.
  // A wrapper is not a data endpoint; retain all wires belonging to its contents.
  return fits(rootOf(next, viewId)) ? next : spec;
}

export function compositionInsertPosition(root, targetId, placement = 'inside') {
  const path = compositionPath(root, targetId);
  const node = path.at(-1);
  if (!node) return null;
  if (placement === 'inside') return node.kind === 'container' ? { parentId: node.id, index: node.children.length } : null;
  if (path.length < 2 || !['before', 'after'].includes(placement)) return null;
  const parent = path.at(-2);
  return { parentId: parent.id, index: parent.children.findIndex((child) => child.id === targetId) + (placement === 'after' ? 1 : 0) };
}

export function dropCompositionNode(spec, viewId, nodeId, targetId, placement) {
  if (nodeId === targetId) return spec;
  const position = compositionInsertPosition(rootOf(spec, viewId), targetId, placement);
  if (!position) return spec;
  const next = relocateCompositionNode(spec, viewId, nodeId, position.parentId, position.index);
  return JSON.stringify(next) === JSON.stringify(spec) ? spec : next;
}

export function compositionWidth(node, parent, weight = node?.span || 1) {
  if (parent?.direction !== 'row') return null;
  const total = parent.children.reduce((sum, sibling) => sum + (sibling.id === node.id ? weight : sibling.span || 1), 0);
  return Math.round(weight / total * 100);
}

/** The conversion and switch setup commit together, or leave the original atom untouched. */
export function commitAtomSwitch(spec, viewId, original, converted, mutate) {
  const live = findCompositionNode(rootOf(spec, viewId), original.id);
  if (JSON.stringify(live) !== JSON.stringify(original)) return spec;
  const candidate = patchCompositionNode(spec, viewId, original.id, () => converted);
  const next = mutate(candidate);
  return next === candidate ? spec : next;
}

export function cloneCompositionNode(node, spec) {
  const mint = allocator(spec);
  const ids = new Map();
  const collect = (value) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (obj(value)) {
      if (typeof value.id === 'string') ids.set(value.id, mint('copy'));
      Object.values(value).forEach(collect);
    }
  };
  collect(node);
  const remap = (value, key) => {
    if (Array.isArray(value)) return value.map((child) => remap(child));
    if (obj(value)) return Object.fromEntries(Object.entries(value).map(([field, child]) => [field, remap(child, field)]));
    // Labels/formulas may happen to equal an ID; only reference fields are rewritten.
    // Widget controls live outside the duplicated subtree, in a separate ID namespace.
    // A series/column may legally have the same ID as one of those controls.
    return (key === 'id' || key === 'columnId' || key === 'sourceViewId' || key === 'targetViewId')
      && ids.has(value) ? ids.get(value) : value;
  };
  return remap(node);
}

export function duplicateCompositionNode(spec, viewId, nodeId) {
  const path = compositionPath(rootOf(spec, viewId), nodeId);
  if (path.length < 2) return spec;
  const parent = path[path.length - 2];
  const node = path[path.length - 1];
  const cloned = cloneCompositionNode(node, spec);
  const next = addCompositionNode(spec, viewId, parent.id, cloned, parent.children.indexOf(node) + 1);
  if (next === spec) return spec;
  const oldNodes = descendants(node);
  const newNodes = descendants(cloned);
  const ids = new Map(oldNodes.map((item, index) => [item.id, newNodes[index].id]));
  const mint = allocator(next);
  const wires = arr(spec.interactions).filter((wire) => ids.has(wire.sourceViewId) && ids.has(wire.targetViewId))
    .map((wire) => ({ ...wire, id: mint('interaction'), sourceViewId: ids.get(wire.sourceViewId), targetViewId: ids.get(wire.targetViewId) }));
  return wires.length ? { ...next, interactions: [...arr(next.interactions), ...wires] } : next;
}
