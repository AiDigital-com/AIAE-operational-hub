const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function textChange(a, b, path = '') {
  if (same(a, b)) return [];
  if (typeof a === 'string' && typeof b === 'string') return [/\.(?:title|label|text|sub|expr|tickLabel)$/.test(path) && !path.includes('.highlights.') ? path : null];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object'
    || Array.isArray(a) !== Array.isArray(b) || Object.keys(a).join() !== Object.keys(b).join()) return [null];
  return Object.keys(a).flatMap((key) => textChange(a[key], b[key], `${path}.${key}`));
}

export const emptyHistory = () => ({ past: [], future: [], lastKey: null, lastTime: 0 });
export const historyBoundary = (history) => history.lastKey == null ? history : { ...history, lastKey: null, lastTime: 0 };
export function recordHistory(history, before, after, now = Date.now()) {
  if (same(before, after)) return history;
  const changes = textChange(before, after);
  const key = changes.length === 1 ? changes[0] : null;
  const coalesce = key && key === history.lastKey && now - history.lastTime < 1000 && !history.future.length;
  return { past: coalesce ? history.past : [...history.past, before].slice(-50), future: [], lastKey: key, lastTime: now };
}
export function stepHistory(history, current, direction) {
  const undo = direction === 'undo';
  const from = undo ? history.past : history.future;
  if (!from.length) return { history, value: current };
  return { value: from.at(-1), history: {
    past: undo ? history.past.slice(0, -1) : [...history.past, current],
    future: undo ? [...history.future, current] : history.future.slice(0, -1),
    lastKey: null, lastTime: 0,
  } };
}
