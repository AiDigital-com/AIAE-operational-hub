// workspace/src/lib/dashboard/chips/migrate.js — legacy text → chip holder, for ONE placement.
// Display only in P0 (the editor's read-only strip); the writer of phase P1 calls the same
// function, so what the strip shows is what will be stored.
import FormulaChips from '@shared/formula-chips';
import { parse, identifiersOf } from '../widget-formula.js';

const FUNCTION_WORDS = new Set(['cumsum', 'rolling', 'shift', 'min', 'max', 'abs', 'round', 'if', 'and', 'or']);
const ID_RE = /(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])/g;

/**
 * fromLegacy(expr, placement) → { expr, chips } | { expr, chips: null, unresolved }
 *   placement = { grain: 'agg'|'date'|'li'|'dateLi'|'dim'|'control'|'ds'|'aux', role: 'row'|'total', cm: boolean }
 *   `cm` is true when the FORMULA reads CM360 (its plain delivery fields are then the matched
 *   BQ half), not when the slot merely has a CM360 join.
 * Identifiers become `_cN` in order of first appearance; the same identifier is one chip.
 */
export function fromLegacy(expr, placement) {
  const src = typeof expr === 'string' ? expr : '';
  if (!parse(src).ok) return { expr: src, chips: null, unresolved: [] };
  const names = identifiersOf(src);
  const chips = {}; const refOf = {}; const unresolved = [];
  names.forEach((name) => {
    const chip = FormulaChips.chipForLegacy(name, placement);
    if (!chip) { unresolved.push(name); return; }
    const ref = `_c${Object.keys(chips).length + 1}`;
    chips[ref] = chip; refOf[name] = ref;
  });
  if (unresolved.length) return { expr: src, chips: null, unresolved };
  const out = src.replace(ID_RE, (m, lead, word, offset) => {
    // A function call keeps its name, with or without space before the bracket.
    if (FUNCTION_WORDS.has(word) && /^\s*\(/.test(src.slice(offset + m.length))) return m;
    return refOf[word] ? lead + refOf[word] : m;
  });
  return { expr: out, chips };
}
