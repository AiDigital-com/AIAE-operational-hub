import { evaluateOne, evaluateSeries } from './widget-formula.js';

// Highlights preserve the engine's arithmetic, but missing operands and undefined
// ratios cannot make a conditional style match. Validate the actual branch/window
// used by the formula; an unused if() branch does not invalidate a reading.
function checked(ast, ctx, series) {
  const size = series ? ctx.length : 1;
  const cache = new Map();
  const evaluate = (node) => {
    if (cache.has(node)) return cache.get(node);
    const computed = series ? evaluateSeries(node, ctx).values : [evaluateOne(node, ctx).value];
    let valid = computed.map(Number.isFinite);
    const children = node.t === 'bin' || node.t === 'cmp' ? [node.l, node.r]
      : node.t === 'neg' ? [node.e] : node.t === 'call' ? node.args : [];
    const parts = children.map(evaluate);
    if (node.t === 'num') valid = valid.map((ok) => ok && Number.isFinite(node.v));
    else if (node.t === 'id') {
      const raw = ctx.get(node.name);
      valid = valid.map((ok, i) => ok && Number.isFinite(Array.isArray(raw) ? raw[i] : raw));
    } else if (node.t === 'call' && node.fn === 'if') {
      valid = valid.map((ok, i) => ok && parts[0].valid[i]
        && parts[parts[0].values[i] ? 1 : 2].valid[i]);
    } else if (node.t === 'call' && ['cumsum', 'rolling', 'shift'].includes(node.fn)) {
      const x = parts[0];
      const arg = parts[1];
      const width = arg ? Math.max(node.fn === 'shift' ? 0 : 1, Math.round(arg.values[0])) : 0;
      const bad = [0];
      const sums = [0];
      x.valid.forEach((ok, i) => { bad.push(bad[i] + (ok ? 0 : 1)); });
      x.values.forEach((value, i) => { sums.push(sums[i] + value); });
      valid = valid.map((ok, i) => {
        if (!ok || (arg && !arg.valid[0])) return false;
        if (node.fn === 'shift') return i >= width && x.valid[i - width];
        const from = node.fn === 'cumsum' ? 0 : Math.max(0, i - width + 1);
        return bad[i + 1] === bad[from] && Number.isFinite(sums[i + 1] - sums[from]);
      });
    } else {
      valid = valid.map((ok, i) => ok && parts.every((part, j) => part.valid[
        node.t === 'call' && node.fn === 'round' && j === 1 ? 0 : i
      ]) && !(node.t === 'bin' && node.op === '/' && parts[1].values[i] === 0));
      if (node.t === 'bin') valid = valid.map((ok, i) => {
        const l = parts[0].values[i], r = parts[1].values[i];
        const raw = node.op === '+' ? l + r : node.op === '-' ? l - r : node.op === '*' ? l * r : l / r;
        return ok && Number.isFinite(raw);
      });
      if (node.t === 'call' && node.fn === 'round') {
        const factor = Math.pow(10, Math.max(0, Math.min(6, Math.round(parts[1]?.values[0] || 0))));
        valid = valid.map((ok, i) => ok && Number.isFinite(parts[0].values[i] * factor));
      }
    }
    const result = { values: computed, valid };
    cache.set(node, result);
    return result;
  };
  const result = evaluate(ast);
  return Array.from({ length: size }, (_, i) => result.valid[i] ? result.values[i] : null);
}

export const evaluateHighlightOne = (ast, ctx) => ({ value: checked(ast, ctx, false)[0], warned: false });
export const evaluateHighlightSeries = (ast, ctx) => ({ values: checked(ast, ctx, true), warned: false });
