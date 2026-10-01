import { useCallback, useRef, useState } from 'react';
import { emptyHistory, historyBoundary, recordHistory, stepHistory } from './history-model.js';

export default function useWidgetHistory(widget, onPatch) {
  const state = useRef({ id: widget.id, history: emptyHistory(), current: widget });
  const [, refresh] = useState(0);
  const [revision, setRevision] = useState(0);
  if (state.current.id !== widget.id) state.current = { id: widget.id, history: emptyHistory(), current: widget };
  state.current.current = widget;
  const boundary = useCallback(() => {
    state.current.history = historyBoundary(state.current.history);
  }, []);
  const write = (updater) => {
    const before = state.current.current;
    const after = typeof updater === 'function' ? updater(before) : updater;
    const next = recordHistory(state.current.history, before, after);
    if (next === state.current.history) return;
    state.current = { id: widget.id, history: next, current: after };
    onPatch(() => after);
    refresh((n) => n + 1);
  };
  const step = (direction) => {
    const { history, value } = stepHistory(state.current.history, state.current.current, direction);
    if (history === state.current.history) return;
    state.current = { id: widget.id, history, current: value };
    onPatch(() => value);
    setRevision((n) => n + 1);
  };
  return { write, undo: () => step('undo'), redo: () => step('redo'), boundary, revision,
    canUndo: !!state.current.history.past.length, canRedo: !!state.current.history.future.length };
}
