import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** The narrowest a column may be dragged. Below this a column stops being readable at all, and the drag
 *  becomes a way to lose a column rather than to size it. */
export const MIN_COLUMN_WIDTH = 72;

/** How far one arrow-key press moves a column edge. */
export const COLUMN_RESIZE_STEP = 12;

/**
 * Widths the user has dragged, by column id.
 *
 * An absent id means "whatever the stylesheet says" - the table is auto-layout, so an untouched column
 * still sizes itself to its content. Deliberately not persisted by this hook: whether a width outlives
 * the session is the consumer's decision, and neither current consumer saves one.
 *
 * @return the widths and the setter the resize handle calls
 */
export function useColumnWidths(): {
  columnWidths: Record<string, number>;
  resizeColumn: (columnId: string, width: number) => void;
} {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  /** Sets one column's width, floored so a column can never be dragged away to nothing. */
  const resizeColumn = useCallback((columnId: string, width: number) => {
    setColumnWidths((current) => ({ ...current, [columnId]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) }));
  }, []);

  return { columnWidths, resizeColumn };
}

/**
 * Reconciles a saved column order with the columns actually on screen.
 *
 * A saved order is a snapshot of the columns that existed when someone last arranged them, so it goes out
 * of date the moment a column is added - a metric ticked in the picker, an optional dashboard column
 * switched back on. Rendering copes with that by placing the unmentioned ones behind the mentioned ones,
 * but a move cannot: it looks its column up in the saved order, finds nothing, and does nothing at all.
 * That is a column the user can see, can pick up, and cannot move.
 *
 * Appending the missing ids reproduces exactly where the table is already drawing them, so a move works
 * from the arrangement on screen rather than from the one that was saved.
 *
 * Ids in the saved order that are no longer shown are kept: a column switched off and on again should come
 * back where it was left, not at the end.
 *
 * @param savedOrder the order last saved, possibly empty
 * @param shownIds the ids currently rendered, in the order they render when nothing is saved
 * @return the saved order plus every shown id it did not mention, in render order
 */
export function withShownColumns(savedOrder: readonly string[], shownIds: readonly string[]): string[] {
  if (savedOrder.length === 0) return [...shownIds];
  const mentioned = new Set(savedOrder);
  return [...savedOrder, ...shownIds.filter((id) => !mentioned.has(id))];
}

/**
 * Inserts one id at a boundary drawn against the ids that remain once it is removed - the way a drop (or
 * an arrow-key nudge) actually asks for a move to read: "land right here", rather than "take this
 * column's slot and shift it aside". `boundaryIndex` is a position in that *reduced* list: `0` lands
 * before its first remaining id, `without.length` lands after its last. Removing `id` shifts every index
 * to its right left by one, so a caller converting a screen position (or a neighbouring id) into this
 * index has to account for that shift itself - this function only ever sees the already-adjusted number.
 *
 * Returns the same array reference when the landing boundary reproduces the current order, so a drop
 * that lands where it started cannot churn whatever state holds the order (and through it every memo
 * keyed on it).
 *
 * @param ids           the current display order, including `id`
 * @param id            the column being moved
 * @param boundaryIndex where it lands, against `ids` with `id` removed
 * @returns the reordered ids, or `ids` unchanged when `id` is absent or the move is a no-op
 */
export function insertAtBoundary(ids: string[], id: string, boundaryIndex: number): string[] {
  const without = ids.filter((existing) => existing !== id);
  if (without.length === ids.length) return ids;
  const at = Math.max(0, Math.min(boundaryIndex, without.length));
  const next = [...without.slice(0, at), id, ...without.slice(at)];
  return next.every((value, index) => value === ids[index]) ? ids : next;
}

/**
 * Read/write access to the surrounding shell's collapsed state.
 *
 * Structurally typed rather than imported so this module stays inside `shared/`: the app shell's own
 * `SidebarCollapse` satisfies it, and a consumer with no shell can pass nothing at all.
 */
export interface CollapsibleSpace {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export interface UseTableExpandOptions {
  /** The shell space the expanded table borrows, and is expected to put back. */
  space?: CollapsibleSpace;
  /** Brought back under the eye on both transitions. Expanding hides everything above the table and
   *  collapsing puts it back, which moves the table a screenful or two while the scroll offset stays
   *  where it was - so without this the user is left looking at whatever now occupies that offset. */
  anchorRef?: RefObject<HTMLElement | null>;
}

/**
 * The expand/collapse state machine, including borrowing the shell's width and giving it back.
 *
 * `expanded` is reported rather than acted on, because the two consumers hide different chrome: the
 * rules that hide it are descendant selectors naming the consumer's own blocks, so the consumer stamps
 * its own root modifier from this flag while the table's own sizing comes from the shared stylesheet.
 *
 * @param options the borrowed space and the element to scroll back into view
 * @return the flag, a toggle, and an explicit collapse
 */
export function useTableExpand(options: UseTableExpandOptions = {}): {
  expanded: boolean;
  toggleExpanded: () => void;
  collapse: () => void;
} {
  const { space, anchorRef } = options;
  const [expanded, setExpanded] = useState(false);
  // What the space was before expanding took it away, so collapsing gives back what it found rather
  // than assuming the user wants it open.
  const spaceBeforeExpand = useRef(false);
  // Read through a ref so the callbacks below keep one identity for the life of the component: `space`
  // is a fresh object on every render of the shell's provider.
  const spaceRef = useRef(space);
  spaceRef.current = space;

  /** Puts the table back inline and the borrowed space back the way expanding found it. */
  const collapse = useCallback(() => {
    setExpanded(false);
    spaceRef.current?.setCollapsed(spaceBeforeExpand.current);
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => {
      if (current) {
        spaceRef.current?.setCollapsed(spaceBeforeExpand.current);
        return false;
      }
      spaceBeforeExpand.current = spaceRef.current?.collapsed ?? false;
      spaceRef.current?.setCollapsed(true);
      return true;
    });
  }, []);

  // `null` until the first paint, so opening the tab does not scroll anything.
  const paintedExpanded = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (paintedExpanded.current !== null && paintedExpanded.current !== expanded) {
      anchorRef?.current?.scrollIntoView({ block: "start" });
    }
    paintedExpanded.current = expanded;
  }, [expanded, anchorRef]);

  // Expanded is a mode, not a route, so Escape has to get out of it - there is no other affordance once
  // the page chrome is hidden and the user has scrolled away from the Collapse button.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") collapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, collapse]);

  // Navigating away mid-expand must not leave the space collapsed on the next page - the table that
  // borrowed it is gone, and nothing else would ever hand it back.
  const restoreOnUnmount = useRef(() => {});
  restoreOnUnmount.current = () => {
    if (expanded) spaceRef.current?.setCollapsed(spaceBeforeExpand.current);
  };
  useEffect(() => () => restoreOnUnmount.current(), []);

  return { expanded, toggleExpanded, collapse };
}
