// workspace/src/lib/dashboard/chips/strict.js — compile a chip holder and evaluate it strictly.
// The arithmetic is widget-formula's own parser; only the reading differs: a ref that reads
// empty makes the result empty, and a division by zero is empty (spec §2.1, the one rule).
import { parse, FUNCTIONS } from '../widget-formula.js';

const compiled = new WeakMap();

/** compileHolder(holder) → { ast, refs: string[], windowed: boolean, error: string|null },
 *  cached by holder identity. `refs` lists the chip refs the formula reads, first-seen order;
 *  `windowed` is true when it calls a window function (cumsum/rolling/shift), which has no
 *  meaning on the aggregate and line item grains. */
export function compileHolder(holder) {
  const hit = compiled.get(holder);
  if (hit) return hit;
  const p = parse(holder.expr);
  let out;
  if (!p.ok) out = { ast: null, refs: [], windowed: false, error: p.error };
  else {
    const refs = []; let windowed = false;
    (function walk(n) {
      if (!n) return;
      if (n.t === 'id' && !refs.includes(n.name)) refs.push(n.name);
      if (n.t === 'call' && FUNCTIONS[n.fn] && FUNCTIONS[n.fn].tsOnly) windowed = true;
      if (n.t === 'bin' || n.t === 'cmp') { walk(n.l); walk(n.r); } else if (n.t === 'neg') walk(n.e); else if (n.t === 'call') n.args.forEach(walk);
    })(p.ast);
    out = { ast: p.ast, refs, windowed, error: null };
  }
  compiled.set(holder, out);
  return out;
}

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** evaluateStrict(ast, read) → number | null. `read(ref)` answers a chip's number or null. */
export function evaluateStrict(ast, read) {
  const ev = (n) => {
    switch (n.t) {
      case 'num': return n.v;
      case 'id': return fin(read(n.name));
      case 'neg': { const e = ev(n.e); return e == null ? null : -e; }
      case 'bin': {
        const l = ev(n.l); if (l == null) return null;
        const r = ev(n.r); if (r == null) return null;
        if (n.op === '+') return fin(l + r);
        if (n.op === '-') return fin(l - r);
        if (n.op === '*') return fin(l * r);
        return r === 0 ? null : fin(l / r);
      }
      case 'cmp': {
        const l = ev(n.l); if (l == null) return null;
        const r = ev(n.r); if (r == null) return null;
        switch (n.op) { case '>': return l > r ? 1 : 0; case '<': return l < r ? 1 : 0; case '>=': return l >= r ? 1 : 0; case '<=': return l <= r ? 1 : 0; case '==': return l === r ? 1 : 0; default: return l !== r ? 1 : 0; }
      }
      case 'call': {
        const a = n.args;
        switch (n.fn) {
          case 'min': case 'max': { const l = ev(a[0]); if (l == null) return null; const r = ev(a[1]); if (r == null) return null; return n.fn === 'min' ? Math.min(l, r) : Math.max(l, r); }
          case 'abs': { const x = ev(a[0]); return x == null ? null : Math.abs(x); }
          case 'round': { const x = ev(a[0]); if (x == null) return null; const d = a.length > 1 ? ev(a[1]) : 0; if (d == null) return null; const f = Math.pow(10, Math.max(0, Math.min(6, Math.round(d)))); return fin(Math.round(x * f) / f); }
          case 'if': { const c = ev(a[0]); if (c == null) return null; return ev(c ? a[1] : a[2]); }
          case 'and': case 'or': { const l = ev(a[0]); if (l == null) return null; const r = ev(a[1]); if (r == null) return null; return n.fn === 'and' ? (l && r ? 1 : 0) : (l || r ? 1 : 0); }
          default: return null; // a window function: refused upstream (no date axis on these grains)
        }
      }
      default: return null;
    }
  };
  return ev(ast);
}
