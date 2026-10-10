// workspace/src/lib/dashboard/widget-formula.js
import MetricRegistry from '@shared/metric-registry';
//
// Formula engine for custom widgets (spec 2026-07-12 §3). Plain ESM, no React, no DOM,
// no eval — a hand-rolled recursive-descent parser over a whitelisted grammar:
//
//   expr    := term (('+'|'-') term)*
//   term    := unary (('*'|'/') unary)*
//   unary   := '-' unary | primary
//   primary := number | ident | func '(' args ')' | '(' expr ')'
//   cond    := expr ('>'|'<'|'>='|'<='|'=='|'!=') expr        // ONLY as if() arg 1
//
// Identifiers resolve against a caller-supplied whitelist (the widget's field set for
// its context). Division by zero → 0 (project canon, shared/pacing-core.js). NaN/±Inf
// coerce to 0 and raise a `warned` flag so the widget can show a badge without crashing.
//
// Two evaluation modes mirror the spec's contexts:
//   evaluateOne(ast, ctx)    — aggregate: one number from summed fields / plan scalars.
//   evaluateSeries(ast, ctx) — time-series over a CONTINUOUS calendar axis (the caller
//     expands fact rows to the full window; absent columns/days read as 0). Window
//     functions (cumsum / rolling / shift) exist only here:
//       cumsum(x)     in-window running total — matches the built-in cumulative charts
//                     (they start at 0 inside a Range window), keeping the "numbers
//                     never diverge" invariant.
//       rolling(x, n) trailing mean over the last min(i+1, n) in-window calendar days.
//       shift(x, n)   value n days back, 0 before the window.

// `coV` / `imV` are the VCR-ELIGIBLE pair — completes and impressions over the lines whose
// completes are video completes (metrics.js isVcrEligible). They joined with the Breakdown
// preset (section-widget parity 2026-09-04): `vcr` has always been `coV / imV`, so a table
// printing raw `co` beside it contradicts the rate in the next column the moment an audio
// line delivers a listen-through. The sums existed already (widget-data.js ZERO_FLOW); what
// was missing was a NAME, so a column and a formula could ask for them.
// The classic order first — the formula library lists this set in order — then every delivery
// key of the registry not already named (the six added 2026-09-08). `coViews`, `imV`, `coV`
// are engine-derived counts the registry does not carry.
const LEGACY_DAILY = ['im', 'cl', 'sp', 'co', 'coViews', 'cv', 'pc', 'pv', 'dc', 'imV', 'coV'];
export const FIELDS_DAILY = new Set(LEGACY_DAILY.concat(
  MetricRegistry.DELIVERY_KEYS.filter((k) => !LEGACY_DAILY.includes(k)),
));
// `imprExpected` is `expIm` gated to the IMPRESSION-PACED lines — campM's own `eI`, which
// counts no CPC line's plan clicks and no CPV line's plan views (widget-data.js
// expectedDeltas). It joined with the Daily Performance preset (section-widget parity
// 2026-09-04): the legacy totals row stacks it under delivered impressions, and `expIm` reads
// a different, larger number on every mixed-rate pacing.
// `clExpected` (2026-10-02) is the clicks twin: `expCl` gated to the CLICK-PACED lines,
// campM's own `clicksExpected`. The Daily Performance preset stacks it under delivered clicks;
// `expCl` also adds every other line's CTR target, which no totals row should stand against.
// The name is `cl` + Expected, not campM's: the chip editor ranks a field name that STARTS with
// the typed letters above a chip's own name (chips/tokens.js suggest), so a field called
// `clicksExpected` turned the typed word «clicks» into this chip instead of Clicks.
export const FIELDS_EXPECTED = new Set(['expIm', 'expCo', 'expCl', 'expVw', 'imprExpected', 'clExpected']);
export const FIELDS_RATES = new Set(['ctr', 'vcr', 'acr', 'cpm', 'cpc', 'cpv']);
export const FIELDS_PLAN = new Set([
  // `costBudTotal` is the whole flight's cost budget where `costBud` is prorated inside the
  // window (widget-data.js liPlanScalars). It joined the universe with the Targets preset
  // (sections-to-widgets M3): the legacy CPC target is `costBudTotal / planClicks`, and
  // the prorated field made that expression read a fraction of the target on any window.
  // `tgtCpm` joined with the Daily Performance preset (section-widget parity 2026-09-04):
  // cost budget over plan impressions on the CPM lines, which is the flight constant the
  // legacy totals row stacks under the CPM column and no combination of the fields beside
  // it can spell (`costBudTotal / planImpr` counts every line's budget, CPC and CPV too).
  //
  // The *Total twins (2026-09-23) are the whole plan of the four sums beside them. `budget`
  // and `planImpr` / `planClicks` / `planViews` follow a window the viewer narrowed; the
  // twins never do, which is what a flight target is built from — the Targets CPC target
  // became `costBudTotal / planClicksTotal` with them. Each twin sits right after its sum,
  // as `costBudTotal` sits after `costBud`: both formula pickers (FormulaEditorDialog,
  // FormulaField) list their Plan group in this set's order.
  //
  // `budgetToDate` (2026-09-23) is the client's plan over the days `costBud` covers: each
  // line's client money from the window's first day to its last day or asOf. The Finance
  // «Budget Plan to Date» cell reads it; `costBud / (1 - mTgt / 100)` is that number only
  // while every line carries the same margin.
  'budget', 'budgetTotal', 'budgetToDate', 'costBud', 'costBudTotal', 'planImpr', 'planImprTotal',
  'planClicks', 'planClicksTotal', 'planViews', 'planViewsTotal',
  'daysLeft', 'daysPassed', 'mTgt', 'ctrT', 'vcrT', 'acrT', 'tgtCpm',
]);

// The three counts the CM360 file carries, per placement per day (spec 2026-09-16 §2.1).
// A NAMESPACE OF THEIR OWN, never merged into TS_FIELDS or a dim set, and that is load
// bearing rather than tidy: a field set answers «what does the DELIVERY engine carry on this
// grain», and widening one with `cmIm` hands the engine a field it has no column for, which
// is the «Unknown field» every cm value was invented to avoid. The only thing that ever
// produces a number for one is `cmEvalAt` (cm-formula-context.js), off a joined pair.
export const FIELDS_CM = new Set(['cmIm', 'cmCl', 'cmCo']);

// …and the delivery half of the SAME comparison (§2.3). `cmIm / im` describes one matched
// population because both halves come off one pair; it is not the Δ% column and is not
// scaled. Kept beside FIELDS_CM because the pair is the rule.
//
// Exported (not just module-private) so `cm-formula-context.js`'s `DLV_IDS` — the SAME three
// identifiers, mapped to their metric names — can derive its membership from this Set
// instead of relisting it: that file already imports this one, and the reverse import would
// close a cycle.
export const FIELDS_CM_DELIVERY = new Set(['im', 'cl', 'co']);

/** Can the matched pairs (and the plan published beside them) answer this name? The whole
 *  vocabulary of an expression read off the comparison: the three CM360 counts, their delivery
 *  halves, and the plan fields. `validate` judges by it, and so does the builder when it
 *  decides whether a highlight rule on a cm-fed owner can be read at all. */
export const pairsServe = (name) => FIELDS_CM.has(name) || FIELDS_CM_DELIVERY.has(name) || FIELDS_PLAN.has(name);

// The four refusals a CM360 formula can meet. They live HERE, in the module that decides,
// and every surface imports them: report-render.js prints two of them on a model, the draft
// validator blocks Save with them, FormulaField and the Spotlight print them under an input.
// A sentence retyped at one of those doors is a tile and a Save gate telling the same author
// two different things about one expression.
// `NO_CM_JOIN` names no grain an author can pick since line items joined
// (docs/2026-09-29-cm360-by-line.md); it is the answer for a grain this module does not know,
// a stored config nobody could have built.
export const NO_CM_JOIN = 'CM360 joins to delivery by date, by mapping dimension or by line item, and these rows are none of them';
export const PIE_NO_CM = 'CM360 numbers are grouped by the mapping dimensions, so this value cannot be cut by this one';
export const CM_FORMULA_ONLY = 'A CM360 formula can name im, cl, co and the plan fields this grain carries beside the CM360 fields; nothing else';
export const CM_BQ_ONLY = 'Auxiliary expressions use the BQ context, which cannot describe this value\'s mapped population';
// …and the fifth, which is about a SHARE rather than about a formula. A row share divides one
// row's reading by the sum of every row's, and a running total is already the sum of the days
// before it: the percentages would add to far more than 100 and mean nothing on the way. Here
// for the reason the four above are here, said once for every surface that has to say it.
export const SHARE_NO_WINDOW = 'A row share cannot divide a running total, so pick a column that reads one day';

// name → { arity: [min, max], tsOnly }
export const FUNCTIONS = {
  cumsum: { arity: [1, 1], tsOnly: true },
  rolling: { arity: [2, 2], tsOnly: true },
  shift: { arity: [2, 2], tsOnly: true },
  min: { arity: [2, 2], tsOnly: false },
  max: { arity: [2, 2], tsOnly: false },
  abs: { arity: [1, 1], tsOnly: false },
  round: { arity: [1, 2], tsOnly: false },
  if: { arity: [3, 3], tsOnly: false },
  and: { arity: [2, 2], tsOnly: false },
  or: { arity: [2, 2], tsOnly: false },
};

// The two functions that read their arguments as conditions: each argument may be a
// comparison, and the call itself may stand where if() wants its condition.
const LOGIC_FNS = new Set(['and', 'or']);

/** What a window function gets off a date axis. It has a name because it now has TWO
 *  speakers: `validate` below, while the author is typing, and report-render.js's CM360
 *  window pass, which answers a STORED expression that reached a dimension axis
 *  (CM360-in-formulas spec §2.9). A retyped copy there would drift from the one the editor
 *  shows, and the reader would be told two different things about one expression. */
export const dateAxisRefusal = (fn) => `${fn}() needs a date axis, so use it in chart series or by-date tables`;

export const MAX_FORMULA_LENGTH = 500;

const CMP_OPS = new Set(['>', '<', '>=', '<=', '==', '!=']);

// ── Tokenizer ────────────────────────────────────────────────────────────────

export function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c >= '0' && c <= '9' || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      while (j < src.length && (src[j] >= '0' && src[j] <= '9' || src[j] === '.')) j++;
      const raw = src.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) return { error: `Bad number "${raw}"` };
      toks.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: 'id', name: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '>' || c === '<' || c === '=' || c === '!') {
      if (src[i + 1] === '=') { toks.push({ t: 'op', op: c + '=' }); i += 2; continue; }
      if (c === '=' || c === '!') return { error: `Unexpected "${c}"; comparisons use >= <= == !=` };
      toks.push({ t: 'op', op: c });
      i++;
      continue;
    }
    if ('+-*/(),'.includes(c)) { toks.push({ t: 'op', op: c }); i++; continue; }
    return { error: `Unexpected character "${c}"` };
  }
  return { toks };
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parse(src) {
  if (typeof src !== 'string' || src.trim() === '') {
    return { ok: false, error: 'Empty formula' };
  }
  if (src.length > MAX_FORMULA_LENGTH) {
    return { ok: false, error: `Formula is longer than ${MAX_FORMULA_LENGTH} characters` };
  }
  const tz = tokenize(src);
  if (tz.error) return { ok: false, error: tz.error };
  const toks = tz.toks;
  let pos = 0;

  const peek = () => toks[pos] || null;
  const isOp = (op) => { const t = peek(); return t && t.t === 'op' && t.op === op; };
  const take = () => toks[pos++];

  function fail(msg) { const e = new Error(msg); e.__parse = true; throw e; }

  function parseExpr() {
    let node = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = take().op;
      node = { t: 'bin', op, l: node, r: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parseUnary();
    while (isOp('*') || isOp('/')) {
      const op = take().op;
      node = { t: 'bin', op, l: node, r: parseUnary() };
    }
    return node;
  }
  function parseUnary() {
    if (isOp('-')) { take(); return { t: 'neg', e: parseUnary() }; }
    return parsePrimary();
  }
  // An expression with an optional comparison after it: what and() / or() take as arguments.
  function parseCompared() {
    const l = parseExpr();
    const t = peek();
    if (!t || t.t !== 'op' || !CMP_OPS.has(t.op)) return l;
    const op = take().op;
    const r = parseExpr();
    return { t: 'cmp', op, l, r };
  }
  function parseCond() {
    const node = parseCompared();
    if (node.t === 'cmp' || (node.t === 'call' && LOGIC_FNS.has(node.fn))) return node;
    fail('if() needs a comparison, and() or or() as its first argument, e.g. if(im > 0, …, …)');
  }
  function parsePrimary() {
    const t = peek();
    if (!t) fail('Unexpected end of formula');
    if (t.t === 'num') { take(); return { t: 'num', v: t.v }; }
    if (t.t === 'id') {
      take();
      if (isOp('(')) {
        take();
        const fn = t.name;
        const spec = FUNCTIONS[fn];
        if (!spec) fail(`Unknown function "${fn}"`);
        const args = [];
        if (fn === 'if') {
          args.push(parseCond());
          if (!isOp(',')) fail('if() expects 3 arguments');
          take();
          args.push(parseExpr());
          if (!isOp(',')) fail('if() expects 3 arguments');
          take();
          args.push(parseExpr());
        } else if (LOGIC_FNS.has(fn)) {
          args.push(parseCompared());
          while (isOp(',')) { take(); args.push(parseCompared()); }
        } else if (!isOp(')')) {
          args.push(parseExpr());
          while (isOp(',')) { take(); args.push(parseExpr()); }
        }
        if (!isOp(')')) fail(`Missing ")" after ${fn}(…`);
        take();
        const [lo, hi] = spec.arity;
        if (args.length < lo || args.length > hi) {
          fail(lo === hi
            ? `${fn}() expects ${lo} argument${lo > 1 ? 's' : ''}, got ${args.length}`
            : `${fn}() expects ${lo}–${hi} arguments, got ${args.length}`);
        }
        return { t: 'call', fn, args };
      }
      return { t: 'id', name: t.name };
    }
    if (t.t === 'op' && t.op === '(') {
      take();
      const node = parseExpr();
      if (!isOp(')')) fail('Missing ")"');
      take();
      return node;
    }
    fail(`Unexpected "${t.op ?? t.name ?? t.v}"`);
  }

  try {
    const ast = parseExpr();
    const left = peek();
    if (left) {
      const shown = left.t === 'num' ? left.v : (left.name ?? left.op);
      if (left.t === 'op' && CMP_OPS.has(left.op)) {
        return { ok: false, error: 'Comparisons are only allowed inside if(cond, a, b), and(a, b) or or(a, b)' };
      }
      return { ok: false, error: `Unexpected "${shown}" after the end of the formula` };
    }
    return { ok: true, ast };
  } catch (e) {
    if (e.__parse) return { ok: false, error: e.message };
    throw e;
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

function didYouMean(name, fieldSet) {
  // A `cm`-prefixed typo is someone reaching for the CM360 side (§2.10). Every candidate
  // here is a DELIVERY field, so the nearest one is `im` or `cl` — a suggestion that sends
  // the author back to exactly the number they were trying not to read. Silence is the
  // honest answer; the palette's CM360 group is where the right spelling lives.
  if (/^cm[A-Z]/.test(name)) return null;
  let best = null;
  let bestD = 3;
  for (const cand of [...fieldSet, ...Object.keys(FUNCTIONS)]) {
    const d = levenshtein(name.toLowerCase(), cand.toLowerCase());
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best;
}

function walk(node, visit) {
  visit(node);
  if (node.t === 'bin' || node.t === 'cmp') { walk(node.l, visit); walk(node.r, visit); }
  else if (node.t === 'neg') walk(node.e, visit);
  else if (node.t === 'call') node.args.forEach((a) => walk(a, visit));
}

/**
 * validate(src, contextKind, fieldSet, opts) — parse + semantic checks for a SLOT.
 *   contextKind 'ts'  — time-series (window functions allowed)
 *   contextKind 'agg' — aggregate (window functions rejected)
 *   fieldSet — Set of identifiers legal for THIS widget context (e.g. dim rows
 *              exclude plan scalars).
 *   opts.cm  — the CM360 join this slot HAS: 'date' | 'label' | 'line' | 'dateLine' |
 *              'window' | 'total' | null (spec 2026-09-16 §2.5; the two line joins,
 *              docs/2026-09-29-cm360-by-line.md). `formula-scope.js` derives it from the
 *              grain; the highlight family overrides it, because its join is not its grain's.
 *   opts.cmRefusal — the sentence to answer when a cm-bearing expression meets `cm: null`.
 *              The SLOT owns that sentence, not this module: a pie says PIE_NO_CM, an unknown
 *              grain says NO_CM_JOIN, and validate only decides when it is said.
 *   opts.cmOnly — this slot's OWNER is cm-fed, so a plain delivery expression beside it
 *              would describe a different population (§2.5). Refused per expression rather
 *              than by disabling the whole slot.
 *
 * → `{ ok: true }` on success, or `{ ok: false, error, hint? }` on a refusal.
 *
 * A CM-BEARING expression is judged against its OWN universe and never against `fieldSet`:
 * `cmIm` is in no field set by construction, so the ordinary unknown-field walk would answer
 * «Unknown field "cmIm"» for the one identifier this whole feature is about.
 */
export function validate(src, contextKind, fieldSet, opts = {}) {
  const p = parse(src);
  if (!p.ok) return p;
  const cm = opts.cm == null ? null : opts.cm;
  const cmRefusal = typeof opts.cmRefusal === 'string' && opts.cmRefusal ? opts.cmRefusal : NO_CM_JOIN;
  const names = identifiersOfAst(p.ast);
  const cmNamed = names.some((name) => FIELDS_CM.has(name));
  // Beside a cm-fed owner whose slot JOINS, a delivery expression is read off the same matched
  // pairs the owner's value is (2026-09-18): `cl` there is the pair's delivery half, so it
  // describes the owner's own mapped population and «red when cl < 100» is an honest
  // comparison. It is therefore judged exactly as a cm-bearing expression is. A constant names
  // nothing and stays legal in every slot.
  const onPairs = !cmNamed && names.length > 0 && !!opts.cmOnly && !!cm;
  const bearing = cmNamed || onPairs;
  if (bearing) {
    if (!cm) return { ok: false, error: cmRefusal };
    for (const name of names) {
      // §2.3: the comparison carries no spend, no conversions and no expected curve, so a
      // rate or an expected field beside a CM360 count would be a number from another
      // population. The plan fields ARE legal — the engine publishes them (§2.4) — and
      // whether THIS grain carries the one named is the runtime gate's question, not this
      // one's: a formula is authored before the row it will be read on exists.
      // A delivery expression read off the pairs (`onPairs`) is still stored as a BQ
      // expression, and the Save gate judges it against this grain's own field set. So it may
      // name a plan field only where that set carries it, or the field would accept what Save
      // refuses; a cm-bearing formula keeps the whole plan vocabulary, as before.
      if (pairsServe(name) && (cmNamed || !FIELDS_PLAN.has(name) || fieldSet.has(name))) continue;
      return { ok: false, error: CM_FORMULA_ONLY };
    }
  } else if (names.length && opts.cmOnly) {
    // A cm-fed owner whose slot has NO join (a pie; a grain this module does not know): the
    // pairs cannot answer, and the BQ context describes another population, so a delivery
    // expression stays refused.
    return { ok: false, error: CM_BQ_ONLY };
  }
  let bad = null;
  walk(p.ast, (n) => {
    if (bad) return;
    if (n.t === 'id' && !bearing && !fieldSet.has(n.name)) {
      const hint = didYouMean(n.name, fieldSet);
      bad = {
        ok: false,
        error: `Unknown field "${n.name}"`,
        ...(hint ? { hint: `did you mean ${hint}?` } : {}),
      };
    } else if (n.t === 'call' && contextKind !== 'ts' && FUNCTIONS[n.fn].tsOnly) {
      // The same sentence on both sides of the rail: a running total over CM360 needs a date
      // axis for exactly the reason a running total over delivery does.
      bad = { ok: false, error: dateAxisRefusal(n.fn) };
    }
  });
  return bad || { ok: true };
}

/** The field names a PARSED formula reads, first-seen order. Exported because
 *  `cm-formula-context.js` mints its marker off an AST it already holds (§2.2) and must not
 *  re-parse the same text to find out which identifiers are in it. */
export function identifiersOfAst(ast) {
  const out = [];
  walk(ast, (n) => { if (n.t === 'id' && !out.includes(n.name)) out.push(n.name); });
  return out;
}

/** The field names a formula reads, first-seen order; [] when it does not parse. */
export function identifiersOf(src) {
  const p = parse(src);
  return p.ok ? identifiersOfAst(p.ast) : [];
}

// ── Evaluation ───────────────────────────────────────────────────────────────

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function guard(v, state) {
  if (typeof v !== 'number' || !Number.isFinite(v)) { state.warned = true; return 0; }
  return v;
}

/**
 * evaluateOne(ast, ctx) → { value, warned } — aggregate context.
 *   ctx.get(name) → number | null (null/absent reads as 0 — absence-is-zero canon).
 */
export function evaluateOne(ast, ctx) {
  const state = { warned: false };
  const ev = (n) => {
    switch (n.t) {
      case 'num': return n.v;
      case 'id': return num(ctx.get(n.name));
      case 'neg': return -ev(n.e);
      case 'bin': {
        const l = ev(n.l), r = ev(n.r);
        if (n.op === '+') return guard(l + r, state);
        if (n.op === '-') return guard(l - r, state);
        if (n.op === '*') return guard(l * r, state);
        return r === 0 ? 0 : guard(l / r, state); // division by zero → 0
      }
      case 'cmp': {
        const l = ev(n.l), r = ev(n.r);
        switch (n.op) {
          case '>': return l > r ? 1 : 0;
          case '<': return l < r ? 1 : 0;
          case '>=': return l >= r ? 1 : 0;
          case '<=': return l <= r ? 1 : 0;
          case '==': return l === r ? 1 : 0;
          default: return l !== r ? 1 : 0;
        }
      }
      case 'call': {
        const a = n.args;
        switch (n.fn) {
          case 'min': return Math.min(ev(a[0]), ev(a[1]));
          case 'max': return Math.max(ev(a[0]), ev(a[1]));
          case 'abs': return Math.abs(ev(a[0]));
          case 'round': {
            const digits = a.length > 1 ? ev(a[1]) : 0;
            const f = Math.pow(10, Math.max(0, Math.min(6, Math.round(digits))));
            return guard(Math.round(ev(a[0]) * f) / f, state);
          }
          case 'if': return ev(a[0]) ? ev(a[1]) : ev(a[2]);
          case 'and': case 'or': {
            const l = ev(a[0]), r = ev(a[1]);
            return (n.fn === 'and' ? l && r : l || r) ? 1 : 0;
          }
          default:
            // Window functions have no meaning without a date axis; validate() blocks
            // them in 'agg' — reaching here means a stored config bypassed validation.
            state.warned = true;
            return 0;
        }
      }
      default: state.warned = true; return 0;
    }
  };
  return { value: guard(ev(ast), state), warned: state.warned };
}

/**
 * evaluateSeries(ast, ctx) → { values: number[], warned } — time-series context.
 *   ctx.length — days on the continuous calendar axis of the window;
 *   ctx.get(name) → number[] (aligned, length n) | number (scalar broadcast)
 *                   | null (absent column → zeros).
 * Every node evaluates to a full array; window functions consume their argument's
 * array wholesale, so rolling(cumsum(x), n)-style nesting works.
 */
export function evaluateSeries(ast, ctx) {
  const n = ctx.length;
  const state = { warned: false };
  const zeros = () => new Array(n).fill(0);

  const resolveField = (name) => {
    const col = ctx.get(name);
    if (col == null) return zeros();
    if (typeof col === 'number') return new Array(n).fill(num(col));
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = num(col[i]);
    return out;
  };

  const ev = (node) => {
    switch (node.t) {
      case 'num': return new Array(n).fill(node.v);
      case 'id': return resolveField(node.name);
      case 'neg': {
        const e = ev(node.e);
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = -e[i];
        return out;
      }
      case 'bin': {
        const l = ev(node.l), r = ev(node.r);
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
          switch (node.op) {
            case '+': out[i] = guard(l[i] + r[i], state); break;
            case '-': out[i] = guard(l[i] - r[i], state); break;
            case '*': out[i] = guard(l[i] * r[i], state); break;
            default: out[i] = r[i] === 0 ? 0 : guard(l[i] / r[i], state);
          }
        }
        return out;
      }
      case 'cmp': {
        const l = ev(node.l), r = ev(node.r);
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
          switch (node.op) {
            case '>': out[i] = l[i] > r[i] ? 1 : 0; break;
            case '<': out[i] = l[i] < r[i] ? 1 : 0; break;
            case '>=': out[i] = l[i] >= r[i] ? 1 : 0; break;
            case '<=': out[i] = l[i] <= r[i] ? 1 : 0; break;
            case '==': out[i] = l[i] === r[i] ? 1 : 0; break;
            default: out[i] = l[i] !== r[i] ? 1 : 0;
          }
        }
        return out;
      }
      case 'call': {
        const a = node.args;
        switch (node.fn) {
          case 'cumsum': {
            const x = ev(a[0]);
            const out = new Array(n);
            let run = 0;
            for (let i = 0; i < n; i++) { run += x[i]; out[i] = guard(run, state); }
            return out;
          }
          case 'rolling': {
            const x = ev(a[0]);
            const win = Math.max(1, Math.round(num(ev(a[1])[0])));
            const out = new Array(n);
            let run = 0;
            for (let i = 0; i < n; i++) {
              run += x[i];
              if (i >= win) run -= x[i - win];
              const denom = Math.min(i + 1, win);
              out[i] = guard(run / denom, state);
            }
            return out;
          }
          case 'shift': {
            const x = ev(a[0]);
            const by = Math.max(0, Math.round(num(ev(a[1])[0])));
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = i - by >= 0 ? x[i - by] : 0;
            return out;
          }
          case 'min': case 'max': {
            const l = ev(a[0]), r = ev(a[1]);
            const f = node.fn === 'min' ? Math.min : Math.max;
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = f(l[i], r[i]);
            return out;
          }
          case 'abs': {
            const x = ev(a[0]);
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = Math.abs(x[i]);
            return out;
          }
          case 'round': {
            const x = ev(a[0]);
            const digits = a.length > 1 ? num(ev(a[1])[0]) : 0;
            const f = Math.pow(10, Math.max(0, Math.min(6, Math.round(digits))));
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = guard(Math.round(x[i] * f) / f, state);
            return out;
          }
          case 'if': {
            const c = ev(a[0]), t = ev(a[1]), e = ev(a[2]);
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = c[i] ? t[i] : e[i];
            return out;
          }
          case 'and': case 'or': {
            const l = ev(a[0]), r = ev(a[1]);
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = (node.fn === 'and' ? l[i] && r[i] : l[i] || r[i]) ? 1 : 0;
            return out;
          }
          default: state.warned = true; return zeros();
        }
      }
      default: state.warned = true; return zeros();
    }
  };

  const values = ev(ast);
  for (let i = 0; i < n; i++) values[i] = guard(values[i], state);
  return { values, warned: state.warned };
}

/**
 * evaluateMaskedSeries(ast, ctx) → { values, present, warned } — the time-series evaluator
 * that CARRIES absence instead of flattening it (CM360-in-formulas spec §2.9).
 *
 *   ctx.length     — days on the published axis (cmDates / cmRowOrder, report-render.js);
 *   ctx.get(name)  → number (broadcast) | number[] (aligned, all present)
 *                    | { values, present } (aligned, with holes) | null (absent column).
 *
 * In `values` a hole is 0, exactly as the cm column beside it prints 0 for a day the CM360
 * file showed nothing on; presence lives only in the mask, and the CALLER writes
 * `present[i] ? values[i] : null`. `null` from `get` is NOT a hole: it is the delivery
 * path's absent column, zeros and present, because a name this context does not carry was
 * never a claim about a day.
 *
 * Why this exists next to `evaluateSeries` rather than inside it: the delivery path's canon
 * is absence-is-zero and every caller it has depends on that. A missing CM360 day is a fact
 * about the JOIN, which the system tells as a dash everywhere else (the cell, the Totals
 * row, the Δ%) — so a running total that skips it stays true and the line starts where the
 * data starts, and a seven-day mean never divides three joined days by seven. The two
 * evaluators answer the same numbers on hole-free input, `shift`'s first n positions apart,
 * and tests/widget-formula-test.mjs pins that across every operator and function.
 *
 * Division by zero is still 0 (the project canon): inside a JOINED day the numbers are
 * numbers. The highlight canon is the highlight engine's own and is applied by ANDing this
 * mask with `evaluateHighlightSeries`' output (§2.8), never by changing a rule here.
 */
export function evaluateMaskedSeries(ast, ctx) {
  const n = ctx.length;
  const state = { warned: false };
  const zeros = () => new Array(n).fill(0);
  const all = (p) => new Array(n).fill(p);
  const both = (values, present) => ({ values, present });

  const resolveField = (name) => {
    const col = ctx.get(name);
    if (col == null) return both(zeros(), all(true));
    if (typeof col === 'number') return both(new Array(n).fill(num(col)), all(true));
    if (Array.isArray(col)) {
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = num(col[i]);
      return both(out, all(true));
    }
    // The masked shape. The 0 is forced rather than trusted: a caller that leaves the last
    // read number sitting in a hole must not be able to leak it through an operator that
    // ignores the mask on one side (`if`'s untaken branch, `min`).
    const values = new Array(n);
    const present = new Array(n);
    for (let i = 0; i < n; i++) {
      present[i] = !!(col.present && col.present[i]);
      values[i] = present[i] ? num(col.values && col.values[i]) : 0;
    }
    return both(values, present);
  };

  const ev = (node) => {
    switch (node.t) {
      case 'num': return both(new Array(n).fill(node.v), all(true));
      case 'id': return resolveField(node.name);
      case 'neg': {
        const e = ev(node.e);
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = -e.values[i];
        return both(out, e.present);
      }
      case 'bin': {
        const l = ev(node.l), r = ev(node.r);
        const out = new Array(n);
        const p = new Array(n);
        for (let i = 0; i < n; i++) {
          p[i] = l.present[i] && r.present[i];
          switch (node.op) {
            case '+': out[i] = guard(l.values[i] + r.values[i], state); break;
            case '-': out[i] = guard(l.values[i] - r.values[i], state); break;
            case '*': out[i] = guard(l.values[i] * r.values[i], state); break;
            default: out[i] = r.values[i] === 0 ? 0 : guard(l.values[i] / r.values[i], state);
          }
        }
        return both(out, p);
      }
      case 'cmp': {
        const l = ev(node.l), r = ev(node.r);
        const out = new Array(n);
        const p = new Array(n);
        for (let i = 0; i < n; i++) {
          p[i] = l.present[i] && r.present[i];
          switch (node.op) {
            case '>': out[i] = l.values[i] > r.values[i] ? 1 : 0; break;
            case '<': out[i] = l.values[i] < r.values[i] ? 1 : 0; break;
            case '>=': out[i] = l.values[i] >= r.values[i] ? 1 : 0; break;
            case '<=': out[i] = l.values[i] <= r.values[i] ? 1 : 0; break;
            case '==': out[i] = l.values[i] === r.values[i] ? 1 : 0; break;
            default: out[i] = l.values[i] !== r.values[i] ? 1 : 0;
          }
        }
        return both(out, p);
      }
      case 'call': {
        const a = node.args;
        switch (node.fn) {
          case 'cumsum': {
            const x = ev(a[0]);
            const out = new Array(n);
            const p = new Array(n);
            let run = 0;
            let seen = false;
            for (let i = 0; i < n; i++) {
              if (x.present[i]) { run += x.values[i]; seen = true; }
              out[i] = guard(run, state);
              // Present once ANY day was: after the last joined day the total still stands,
              // because it makes no claim about the days that did not join.
              p[i] = seen;
            }
            return both(out, p);
          }
          case 'rolling': {
            const x = ev(a[0]);
            const win = Math.max(1, Math.round(num(ev(a[1]).values[0])));
            const out = new Array(n);
            const p = new Array(n);
            let run = 0;
            let cnt = 0;
            for (let i = 0; i < n; i++) {
              if (x.present[i]) { run += x.values[i]; cnt += 1; }
              if (i >= win && x.present[i - win]) { run -= x.values[i - win]; cnt -= 1; }
              // The denominator is the joined days in the window, not the window's width —
              // on hole-free input that is min(i + 1, win), which is evaluateSeries' own.
              out[i] = cnt > 0 ? guard(run / cnt, state) : 0;
              p[i] = cnt > 0;
            }
            return both(out, p);
          }
          case 'shift': {
            const x = ev(a[0]);
            const by = Math.max(0, Math.round(num(ev(a[1]).values[0])));
            const out = new Array(n);
            const p = new Array(n);
            for (let i = 0; i < n; i++) {
              const src = i - by;
              out[i] = src >= 0 ? x.values[src] : 0;
              // The one place this evaluator differs from the delivery path even on hole-free
              // input: there the first n positions are a zero, here they are the nothing they
              // describe — no day before the window was ever measured.
              p[i] = src >= 0 ? x.present[src] : false;
            }
            return both(out, p);
          }
          case 'min': case 'max': {
            const l = ev(a[0]), r = ev(a[1]);
            const f = node.fn === 'min' ? Math.min : Math.max;
            const out = new Array(n);
            const p = new Array(n);
            for (let i = 0; i < n; i++) { out[i] = f(l.values[i], r.values[i]); p[i] = l.present[i] && r.present[i]; }
            return both(out, p);
          }
          case 'abs': {
            const x = ev(a[0]);
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = Math.abs(x.values[i]);
            return both(out, x.present);
          }
          case 'round': {
            const x = ev(a[0]);
            const digits = a.length > 1 ? num(ev(a[1]).values[0]) : 0;
            const f = Math.pow(10, Math.max(0, Math.min(6, Math.round(digits))));
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = guard(Math.round(x.values[i] * f) / f, state);
            return both(out, x.present);
          }
          case 'if': {
            const c = ev(a[0]), t = ev(a[1]), e = ev(a[2]);
            const out = new Array(n);
            const p = new Array(n);
            for (let i = 0; i < n; i++) {
              const take = c.values[i] ? t : e;
              out[i] = take.values[i];
              // The condition is read on the same day: a branch chosen from a day nobody
              // measured is not a choice, so an absent condition makes the day absent too.
              p[i] = c.present[i] && take.present[i];
            }
            return both(out, p);
          }
          case 'and': case 'or': {
            // As min / max: a day either operand did not join is not a day the rule read.
            const l = ev(a[0]), r = ev(a[1]);
            const out = new Array(n);
            const p = new Array(n);
            for (let i = 0; i < n; i++) {
              out[i] = (node.fn === 'and' ? l.values[i] && r.values[i] : l.values[i] || r.values[i]) ? 1 : 0;
              p[i] = l.present[i] && r.present[i];
            }
            return both(out, p);
          }
          default:
            // Unreachable: the parser admits no other function name. Nothing was computed,
            // so nothing is claimed — the caller draws a dash rather than a zero.
            state.warned = true;
            return both(zeros(), all(false));
        }
      }
      default: state.warned = true; return both(zeros(), all(false));
    }
  };

  const out = ev(ast);
  const values = out.values;
  for (let i = 0; i < n; i++) values[i] = guard(values[i], state);
  return { values, present: out.present, warned: state.warned };
}
