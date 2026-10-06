// workspace/src/lib/dashboard/chips/windows.js — a chip's own window (spec §2.1, §4.2).
// Never calls widgetWindow: it REPRODUCES its anchor and clamp for lastDays, so `Last 7 days`
// on a Flight widget equals the same widget switched to 7d (tests/chip-windows-test.mjs).
// The anchor is the last data day inside the scope and the flight; the widget's own range
// never moves a chip window (plan decision f). No asOf means no data day and no anchor, so
// every anchored window answers empty, as widgetWindow answers null there.
// Imports nothing from the other chip modules: the chip family never matters here, lastDay
// is the last day WITH data on every family (plan decision e).
export const CHIP_LEAVES = 'outside the selected period';

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dI = (a, b) => Math.floor((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5) + 1;
const monthStart = (d) => d.slice(0, 8) + '01';
const monthEnd = (d) => { const [y, m] = d.split('-').map(Number); return addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1); };
const minOf = (...xs) => xs.filter(Boolean).sort()[0] || null;
const maxOf = (...xs) => xs.filter(Boolean).sort().slice(-1)[0] || null;

const EMPTY = Object.freeze({ kind: 'empty', key: 'e' });
const LEAVES = Object.freeze({ kind: 'leaves', reason: CHIP_LEAVES, key: 'l' });
const range = (from, to) => (from && to && from <= to ? { kind: 'range', from, to, key: `r:${from}:${to}` } : EMPTY);
const dates = (list) => (list.length ? { kind: 'dates', dates: new Set(list), list, key: `s:${list.join(',')}` } : EMPTY);

/**
 * resolveChipWindow(chip, env) → the window this chip reads.
 *   env = { range, asOf, flightStart, flightEnd, scope, dataDaysOf(ids) → string[], ids }
 *   → { kind: 'range', from, to, key } | { kind: 'dates', dates: Set, list, key }
 *     | { kind: 'empty', key: 'e' } | { kind: 'leaves', reason: CHIP_LEAVES, key: 'l' }
 */
export function resolveChipWindow(chip, env) {
  const period = chip.period || { kind: 'widget' };
  const clampFrom = maxOf(env.scope && env.scope.from, env.flightStart);
  const clampTo = minOf(env.scope && env.scope.to, env.flightEnd);
  const anchor = env.asOf ? minOf(env.asOf, clampTo) : null;
  const inScope = (w) => (!env.scope || w.kind !== 'range' || (w.from >= env.scope.from && w.to <= env.scope.to) ? w : LEAVES);
  const dataSet = (n) => {
    if (!anchor) return EMPTY;
    const all = env.dataDaysOf(env.ids).filter((d) => d <= anchor && (!clampFrom || d >= clampFrom));
    return dates(all.slice(-n));
  };
  const lastDays = (n) => {
    if (!anchor || !n) return EMPTY;
    let from = addDays(anchor, -(n - 1));
    if (clampFrom && from < clampFrom) from = clampFrom;
    return range(from, anchor);
  };
  const resolve = (p) => {
    switch (p.kind) {
      case 'widget': return env.range ? range(env.range.from, env.range.to) : range(env.flightStart, anchor);
      case 'lastDay': return dataSet(1);
      case 'lastDays': return chip.skipEmpty ? dataSet(p.n) : lastDays(p.n);
      case 'lastDataDays': return dataSet(p.n);
      case 'flightToDate': return inScope(range(env.flightStart, minOf(env.asOf, env.flightEnd)));
      case 'monthToDate': return anchor ? inScope(range(monthStart(anchor), anchor)) : EMPTY;
      case 'wholeMonth': return anchor ? inScope(range(monthStart(anchor), monthEnd(anchor))) : EMPTY;
      case 'previousMonth': { if (!anchor) return EMPTY; const prevEnd = addDays(monthStart(anchor), -1); return inScope(range(monthStart(prevEnd), prevEnd)); }
      case 'sinceDate': return inScope(range(p.date, anchor));
      case 'custom': return inScope(range(p.from, p.to));
      case 'previous': {
        const of = resolve(p.of || { kind: 'widget' });
        if (of.kind === 'range') {
          const to = addDays(of.from, -1);
          if (env.flightStart && to < env.flightStart) return EMPTY;
          return inScope(range(addDays(to, -(dI(of.from, of.to) - 1)), to));
        }
        if (of.kind === 'dates') {
          // The same clamp dataSet applies, and the same answer the calendar branch gives when the
          // scope cuts the days off: a day the scope hid is «outside the selected period», a day the
          // campaign never had is simply not there.
          const before = env.dataDaysOf(env.ids).filter((d) => d < of.list[0]);
          const inside = before.filter((d) => !clampFrom || d >= clampFrom);
          if (env.scope && inside.length < of.list.length && before.length > inside.length) return LEAVES;
          return dates(inside.slice(-of.list.length));
        }
        return of;
      }
      default: return EMPTY;
    }
  };
  return resolve(period);
}
