import { useEffect, useRef, useState } from 'react';
import {
  compositionInsertPosition,
  compositionPath,
  dropCompositionNode,
  findCompositionNode,
} from './composition-model.js';
import {
  compositionScrollDelta,
  dragThresholdPassed,
  pointFraction,
  pointNearRect,
  renderedDropAxis,
} from './composition-drag.js';

export function dropPlacement(node, fraction) {
  return node?.kind === 'container' ? (fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'inside')
    : fraction < .5 ? 'before' : 'after';
}

function currentPosition(view, nodeId, targetId, placement) {
  const sourcePath = compositionPath(view, nodeId);
  const sourceParent = sourcePath.at(-2);
  const position = compositionInsertPosition(view, targetId, placement);
  if (!sourceParent || !position || sourceParent.id !== position.parentId) return false;
  const sourceIndex = sourceParent.children.findIndex((child) => child.id === nodeId);
  const insertAt = sourceIndex < position.index ? position.index - 1 : position.index;
  return insertAt === sourceIndex;
}

function allowsScroll(element, axis) {
  let style;
  try { style = getComputedStyle(element); } catch { return false; }
  const overflow = axis === 'x' ? style.overflowX || style.overflow : style.overflowY || style.overflow;
  return /^(auto|scroll|overlay)$/.test(overflow || '');
}

function canScrollBy(element, delta) {
  const maxX = Math.max(0, (element.scrollWidth || 0) - (element.clientWidth || 0));
  const maxY = Math.max(0, (element.scrollHeight || 0) - (element.clientHeight || 0));
  return (delta.x < 0 && allowsScroll(element, 'x') && element.scrollLeft > 0)
    || (delta.x > 0 && allowsScroll(element, 'x') && element.scrollLeft < maxX)
    || (delta.y < 0 && allowsScroll(element, 'y') && element.scrollTop > 0)
    || (delta.y > 0 && allowsScroll(element, 'y') && element.scrollTop < maxY);
}

/** Pointer capture works for mouse, pen and touch; only the grip suppresses page scrolling. */
export default function useCompositionDrag({ hostRef, spec, view, onDrop, onNotice }) {
  const [drag, setDrag] = useState(null);
  const latest = useRef(null);
  latest.current = { spec, view, onDrop, onNotice };
  const cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), []);
  const start = (event, nodeId) => {
    if (event.button !== 0 || event.isPrimary === false || nodeId === view.id) return;
    cleanup.current();
    // Keep an ordinary click and the button's native focus intact. Scrolling is
    // suppressed by touch-action on the grip; preventDefault starts with the drag.
    event.stopPropagation();
    const grip = event.currentTarget;
    const pointerId = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    let target = null;
    let pointer = origin;
    let raf;
    let lastTarget = '';
    try { grip.setPointerCapture?.(pointerId); } catch { /* capture is an enhancement */ }
    const locate = () => {
      const hit = document.elementFromPoint(pointer.x, pointer.y);
      const first = hit?.closest('[data-composition-drop]');
      if (!first || !hostRef.current?.contains(first)) {
        target = null;
        if (lastTarget !== 'outside') { setDrag({ nodeId }); lastTarget = 'outside'; }
        return;
      }
      const rows = [];
      for (let row = first; row; row = row.parentElement?.closest?.('[data-composition-drop]')) {
        if (!hostRef.current.contains(row) || rows.includes(row)) break;
        rows.push(row);
      }
      // The outline's parent row is a DOM sibling rather than an ancestor. Add the
      // model ancestors from the same surface so a full/deep target can fall back to
      // a valid surrounding container without jumping to the duplicate preview tree.
      const scope = first.closest('.sp-comp-structure, .sp-comp-preview') || hostRef.current;
      const path = compositionPath(latest.current.view, first.dataset.compositionDrop);
      const available = [...(scope.querySelectorAll?.('[data-composition-drop]') || [])];
      for (const ancestor of path.slice(0, -1).reverse()) {
        const row = available.find((candidate) => candidate.dataset.compositionDrop === ancestor.id);
        if (row && !rows.includes(row)) rows.push(row);
      }

      target = null;
      const source = findCompositionNode(latest.current.view, nodeId);
      for (const row of rows) {
        const targetId = row.dataset.compositionDrop;
        const node = findCompositionNode(latest.current.view, targetId);
        if (!node) continue;
        // Empty space can hit the root directly. A child that merely refuses a drop
        // must not silently turn into "append to root", which can move it far away.
        if (row !== first && targetId === latest.current.view.id) continue;
        const rect = row.getBoundingClientRect();
        // A row container can stack on a narrow canvas. Follow its rendered tracks,
        // so the insertion direction agrees with the place the user can actually see.
        const template = row.dataset.compositionAxis === 'row'
          ? getComputedStyle(row.parentElement).gridTemplateColumns : '';
        const axis = renderedDropAxis(row.dataset.compositionAxis, template);
        const fraction = pointFraction(pointer, rect, axis);
        const placement = targetId === latest.current.view.id ? 'inside' : dropPlacement(node, fraction);
        const candidate = dropCompositionNode(latest.current.spec, latest.current.view.id, nodeId, targetId, placement);
        if (candidate !== latest.current.spec) {
          target = { targetId, placement, axis };
          break;
        }
        // Hovering the source, one of its descendants, or its current insertion
        // boundary means "do nothing". Do not turn that into a surprising parent move.
        if (targetId === nodeId || findCompositionNode(source, targetId)
          || currentPosition(latest.current.view, nodeId, targetId, placement)) break;
      }
      const key = `${target?.targetId || ''}:${target?.placement || ''}:${target?.axis || ''}`;
      if (key !== lastTarget) { setDrag({ nodeId, ...target }); lastTarget = key; }
    };
    const scrollHost = () => {
      const hovered = document.elementFromPoint(pointer.x, pointer.y);
      const candidates = [];
      const direct = hovered?.closest?.('.sp-comp-structure, .sp-comp-preview-scroll');
      if (direct) candidates.push(direct);
      candidates.push(...(hostRef.current?.querySelectorAll?.('.sp-comp-structure, .sp-comp-preview-scroll') || []));
      for (let node = hostRef.current?.parentElement; node; node = node.parentElement) candidates.push(node);
      const root = hostRef.current;
      for (const candidate of [...new Set(candidates)]) {
        if (!candidate || !(root?.contains(candidate) || candidate.contains?.(root))) continue;
        const rect = candidate.getBoundingClientRect?.();
        if (!rect || !pointNearRect(rect, pointer)) continue;
        const delta = compositionScrollDelta(rect, pointer);
        if (canScrollBy(candidate, delta)) return { candidate, delta };
      }
      return null;
    };
    const scroll = () => {
      const scrollable = active ? scrollHost() : null;
      if (scrollable) {
        const { candidate, delta } = scrollable;
        const before = { left: candidate.scrollLeft, top: candidate.scrollTop };
        if (delta.y) candidate.scrollTop += delta.y;
        if (delta.x) candidate.scrollLeft += delta.x;
        if (candidate.scrollLeft !== before.left || candidate.scrollTop !== before.top) locate();
      }
      raf = requestAnimationFrame(scroll);
    };
    const move = (next) => {
      if (next.pointerId !== pointerId) return;
      pointer = { x: next.clientX, y: next.clientY };
      if (!active && !dragThresholdPassed(origin, pointer)) return;
      active = true;
      next.preventDefault();
      locate();
    };
    const finish = (next) => {
      if (next.pointerId !== pointerId) return;
      if (Number.isFinite(next.clientX) && Number.isFinite(next.clientY)) {
        pointer = { x: next.clientX, y: next.clientY };
      }
      if (!active && dragThresholdPassed(origin, pointer)) active = true;
      // Pointerup can carry the final coalesced coordinates without a preceding
      // pointermove. Resolve once more so a release outside cannot use a stale target.
      if (active) { next.preventDefault(); locate(); }
      const drop = target;
      cleanup.current();
      // A completed pointer drag must not also select the element under the release.
      if (active) {
        const suppressClick = (click) => { click.preventDefault(); click.stopPropagation(); };
        document.addEventListener('click', suppressClick, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', suppressClick, true), 0);
      }
      if (active && drop) latest.current.onDrop(nodeId, drop.targetId, drop.placement);
      else if (active) latest.current.onNotice('Move cancelled. Choose a place before, after or inside a container.');
    };
    const cancel = (next) => {
      if (next.type === 'keydown' && next.key !== 'Escape') return;
      if ('pointerId' in next && next.pointerId !== pointerId) return;
      if (next.type === 'keydown') { next.preventDefault(); next.stopPropagation(); }
      cleanup.current();
      if (active) latest.current.onNotice('Move cancelled.');
    };
    const lostCapture = (next) => cancel(next);
    cleanup.current = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', cancel, true);
      window.removeEventListener('blur', cancel);
      grip.removeEventListener?.('lostpointercapture', lostCapture);
      cancelAnimationFrame(raf);
      try {
        if (grip.hasPointerCapture?.(pointerId)) grip.releasePointerCapture(pointerId);
      } catch { /* the browser may already have released it */ }
      setDrag(null);
      cleanup.current = () => {};
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', cancel, true);
    window.addEventListener('blur', cancel);
    grip.addEventListener?.('lostpointercapture', lostCapture);
    raf = requestAnimationFrame(scroll);
  };
  return { drag, start };
}
