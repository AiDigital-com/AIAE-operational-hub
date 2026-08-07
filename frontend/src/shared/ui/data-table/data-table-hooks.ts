import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

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

/** The handlers a header cell spreads onto its own `<th>` to take part in drag-to-reorder. */
export interface ColumnDragProps {
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLTableCellElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLTableCellElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTableCellElement>) => void;
}

export interface UseColumnDragOptions {
  /** Moves the dragged column to where the dropped-on column sits. The caller decides whether the move
   *  is allowed - a two-group table refuses a metric dropped among its dimensions - and where the new
   *  order is kept, which is why this hook holds no order of its own. */
  onReorder: (fromId: string, toId: string) => void;
  /** Keyboard equivalent of dragging one slot left or right. */
  onNudge?: (columnId: string, offset: -1 | 1) => void;
  /** Off while the table is being edited: a table full of inputs is not a table to rearrange, and a
   *  stray drag mid-edit would move a column out from under a half-typed value. */
  disabled?: boolean;
}

/**
 * Drag-to-reorder for column headers.
 *
 * Native HTML5 drag rather than a library: it is four handlers on a cell that already exists, and a
 * dependency for that would be the larger change. The handlers must be spread onto the `<th>` itself -
 * a drop target is the element the browser dispatches at, and an inner wrapper would never see it.
 *
 * @param options the reorder callbacks and the disabled flag
 * @return the id currently being dragged, and the per-column handler factory
 */
export function useColumnDrag(options: UseColumnDragOptions): {
  draggingColumnId: string | null;
  columnDragProps: (columnId: string) => ColumnDragProps;
} {
  const { disabled = false } = options;
  /** The column being dragged, or null. Held in state rather than in the drag event so the drop target
   *  can refuse a drag from another group without reading dataTransfer, which is write-only mid-drag. */
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  // Read through a ref so `columnDragProps` keeps one identity per drag state rather than one per render.
  // It is called once per column while the header renders, and a consumer that passes its callbacks
  // inline - which is the natural way to write them - would otherwise re-spread new handlers onto every
  // `<th>` on every keystroke elsewhere on the page.
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const columnDragProps = useCallback(
    (columnId: string): ColumnDragProps => ({
      draggable: !disabled,
      onDragStart: () => setDraggingColumnId(columnId),
      onDragEnd: () => setDraggingColumnId(null),
      onDragOver: (event) => {
        // preventDefault is what marks this cell as a place a drop may land; without it the browser refuses.
        if (draggingColumnId && draggingColumnId !== columnId) event.preventDefault();
      },
      onDrop: (event) => {
        event.preventDefault();
        if (draggingColumnId) callbacksRef.current.onReorder(draggingColumnId, columnId);
        setDraggingColumnId(null);
      },
      onKeyDown: (event) => {
        const onNudge = callbacksRef.current.onNudge;
        if (disabled || !event.altKey || !onNudge) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        onNudge(columnId, event.key === "ArrowLeft" ? -1 : 1);
      },
    }),
    [disabled, draggingColumnId]
  );

  return { draggingColumnId, columnDragProps };
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
