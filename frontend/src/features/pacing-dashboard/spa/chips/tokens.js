// workspace/src/lib/dashboard/chips/tokens.js — the token model of the chip field (spec §6.3).
// Plain data: an array of tokens, a caret index into it, one word being typed. Every change is
// a function of (state, action), so a host test needs no DOM and the field needs no selection
// model to fight. Serialisation goes BOTH ways through the real tokenizer and the catalogue's
// legacy map, which is what keeps typed text equal to migrated text (spec §5).
//
// Token shapes: {t:'chip', chip} | {t:'num', v} | {t:'op', v} | {t:'fn', name} (committed with its
// {t:'op', v:'('}; when the bracket is removed the name is written with a space after it, so it
// reads back as a word) | {t:'word', text} (an identifier nobody could resolve; kept, never dropped).
import FormulaChips from '@shared/formula-chips';
import { tokenize, FUNCTIONS, dateAxisRefusal, FIELDS_CM, NO_CM_JOIN } from '../widget-formula.js';
import { TS_FIELDS } from '../widget-data.js';
import { chipFace } from './info.js';

const { CATALOG, SETTING_ORDER, chipForLegacy } = FormulaChips;
const LEGACY_NAMES = [...TS_FIELDS, 'cmIm', 'cmCl', 'cmCo', 'm1', 'm2', 'm3', 'm4', 'vi'];
const REF_WORD_RE = /^_c\d{1,2}$/;
const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)$/;   // the tokenizer's own rule: `1.` and `.5` are numbers
const HISTORY = 50;
// The placement a helper reads a TEXT holder on when its caller names none: the aggregate.
const AGG_PLACEMENT = { grain: 'agg', role: 'row', cm: false };
// The period keys in the order `norm` writes them, so two spellings of one period share a key.
const PERIOD_KEYS = ['kind', 'n', 'days', 'of', 'date', 'from', 'to', 'end'];

function cleanPeriod(p) {
  if (!p || typeof p !== 'object') return p;
  const out = {};
  for (const k of PERIOD_KEYS) if (p[k] !== undefined) out[k] = k === 'of' ? cleanPeriod(p[k]) : p[k];
  for (const k of Object.keys(p)) if (!(k in out) && p[k] !== undefined) out[k] = p[k];
  return out;
}

/** A chip in its stored spelling: SETTING_ORDER, defaults dropped, the widget period dropped. */
export function cleanChip(chip) {
  const base = chip && chip.base;
  const def = CATALOG[base];
  const out = { base };
  if (!def) return out;
  for (const k of SETTING_ORDER) {
    if (k === 'base' || chip[k] === undefined || !(k in def.settings)) continue;
    const st = def.settings[k]; const v = chip[k];
    // The bare widget period is the default and is dropped; a widget period that carries a
    // setting of its own (`end: 'cmLastDay'`) is kept, as norm keeps it.
    if (k === 'period') { const cp = cleanPeriod(v); if (cp && (cp.kind !== 'widget' || Object.keys(cp).length > 1)) out.period = cp; continue; }
    if (st.options && v === st.def) continue;
    out[k] = v;
  }
  return out;
}
export const chipKey = (chip) => JSON.stringify(cleanChip(chip));

// chip → legacy name, per placement: the reverse of chipForLegacy, built once per placement.
// Both sides go through chipKey, so a chip written with a default still finds its name.
const reverse = new Map();
export function legacyNameOf(chip, placement) {
  const p = placement || AGG_PLACEMENT;
  const pk = `${p.grain}|${p.role}|${p.cm ? 1 : 0}`;
  let table = reverse.get(pk);
  if (!table) {
    table = new Map();
    for (const name of LEGACY_NAMES) { const c = chipForLegacy(name, p); if (c) table.set(chipKey(c), name); }
    reverse.set(pk, table);
  }
  return table.get(chipKey(chip)) || null;
}
// A legacy identifier at all (served somewhere), as opposed to a word nobody knows.
const isLegacyName = (word) => LEGACY_NAMES.includes(word);

// A function the parser knows (an own key: `toString(` is not a function).
const isFunctionName = (name) => Object.prototype.hasOwnProperty.call(FUNCTIONS, name);

// ── text → tokens ───────────────────────────────────────────────────────────────────────────
const isFnWord = (toks, i) => toks[i].t === 'id' && toks[i + 1] && toks[i + 1].t === 'op' && toks[i + 1].op === '(' && isFunctionName(toks[i].name);
// The three CM360 legacy names, whole words: a text that names one reads its plain delivery
// fields as the matched BQ half, as fromLegacy reads it (`cm` is a fact about the TEXT).
const CM_TEXT_RE = /\bcm(?:Im|Cl|Co)\b/;
function tokensFromText(text, placement, chips = null) {
  const src = text || '';
  const tz = tokenize(src);
  const toks = tz.toks || tokenizeLoosely(src);
  // A legacy text decides its own CM360 reading: `cmIm / im` pasted into a field that holds no
  // CM360 chip yet still reads `im` as Impressions · Matched to CM360, so typed equals migrated
  // (spec §5). A placement that already reads CM360 keeps doing so.
  const p = !chips && placement && !placement.cm && CM_TEXT_RE.test(src) ? { ...placement, cm: true } : placement;
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t === 'num') { out.push({ t: 'num', v: tk.v }); continue; }
    if (tk.t === 'op') { out.push({ t: 'op', v: tk.op }); continue; }
    if (tk.t === 'word') { out.push({ t: 'word', text: tk.text }); continue; }
    if (isFnWord(toks, i)) { out.push({ t: 'fn', name: tk.name }); continue; }
    if (chips && Object.prototype.hasOwnProperty.call(chips, tk.name)) { out.push({ t: 'chip', chip: cleanChip(chips[tk.name]) }); continue; }
    // A typed `_cN` is a word, never a ref: refs exist only through the holder's own map.
    const chip = REF_WORD_RE.test(tk.name) ? null : chipForLegacy(tk.name, p);
    out.push(chip ? { t: 'chip', chip: cleanChip(chip) } : { t: 'word', text: tk.name });
  }
  return out;
}
// The tokenizer refuses a stray character; a draft the person is still typing keeps what it has.
// Numbers are scanned the way the tokenizer scans them; a bad one and a stray character become
// words, so nothing typed is dropped silently (spec §6.3).
function tokenizeLoosely(text) {
  const toks = [];
  const re = /(?:\d|\.\d)[\d.]*|[A-Za-z_][A-Za-z0-9_]*|>=|<=|==|!=|[+\-*/(),<>]|\S/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const s = m[0];
    if (/^[\d.]/.test(s)) { const v = Number(s); toks.push(Number.isFinite(v) ? { t: 'num', v } : { t: 'word', text: s }); }
    else if (/^[A-Za-z_]/.test(s)) toks.push({ t: 'id', name: s });
    else if (/^(>=|<=|==|!=|[+\-*/(),<>])$/.test(s)) toks.push({ t: 'op', op: s });
    else toks.push({ t: 'word', text: s });
  }
  return toks;
}
/** tokensFromHolder(holder, placement) → tokens. A text holder goes through the tokenizer and
 *  chipForLegacy on this placement; a chip holder expands `_cN` to its chips. */
export function tokensFromHolder(holder, placement) {
  if (holder && typeof holder === 'object' && holder.chips && typeof holder.chips === 'object') return tokensFromText(holder.expr, placement, holder.chips);
  const text = typeof holder === 'string' ? holder : holder && typeof holder.expr === 'string' ? holder.expr : '';
  return tokensFromText(text, placement);
}

// ── tokens → text ───────────────────────────────────────────────────────────────────────────
const OPEN = new Set(['(']); const CLOSE = new Set([')', ',']);
function join(parts) {
  // A space between tokens, except after an opening bracket, between a function name and ITS
  // bracket (a name whose bracket was removed keeps its space, so `round _c1` reads back as a
  // word and a chip, never as the identifier `round_c1`), before a closing bracket or a comma,
  // and after a unary minus (a minus at the start or right after another operator that is not
  // a closing bracket).
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const [kind, text, raw] = parts[i];
    const prev = parts[i - 1];
    const noSpace = !prev || (prev[0] === 'op' && OPEN.has(prev[2])) || (prev[0] === 'fn' && kind === 'op' && raw === '(') || (kind === 'op' && CLOSE.has(raw))
      || (prev[0] === 'op' && prev[2] === '-' && (i < 2 || (parts[i - 2][0] === 'op' && parts[i - 2][2] !== ')')));
    out += (noSpace ? '' : ' ') + text;
  }
  return out;
}
/** A number in plain decimal digits, never in exponent form: the tokenizer reads digits and a dot
 *  only, so `String(1e-7)` would store `1e-7`, which the parser refuses. 1e-7 → 0.0000001,
 *  1e21 → 1000000000000000000000; the digits are String(v)'s own, shifted, so Number(numText(v))
 *  is v again. The field renders a number with the same text. */
export function numText(v) {
  const s = String(v);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = '', exp] = m;
  const digits = int + frac;
  const point = int.length + Number(exp);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
function parts(tokens, chipText) {
  return tokens.map((tk) => (tk.t === 'chip' ? ['chip', chipText(tk.chip), null] : tk.t === 'num' ? ['num', numText(tk.v), null]
    : tk.t === 'fn' ? ['fn', tk.name, null] : tk.t === 'word' ? ['word', tk.text, null] : ['op', tk.v, tk.v]));
}
/** holderFromTokens(tokens) → { expr, chips } | { expr } | { expr, chips: null, unresolved }.
 *  Chips are numbered `_c1…` by first appearance, equal chips (by chipKey) share one ref, every
 *  chip is written through cleanChip. A typed word spelled like a ref that was minted here
 *  (`_c1` beside a chip written as `_c1`) has no spelling of its own in the text, where it would
 *  read as the chip; the holder then says so in fromLegacy's unresolvable shape, so the gate names
 *  the word the person typed instead of storing it as a second chip. */
export function holderFromTokens(tokens) {
  const refs = new Map(); const chips = {};
  const expr = join(parts(tokens, (chip) => {
    const key = chipKey(chip);
    if (!refs.has(key)) { const ref = `_c${refs.size + 1}`; refs.set(key, ref); chips[ref] = cleanChip(chip); }
    return refs.get(key);
  }));
  const minted = new Set(refs.values());
  const clash = [...new Set(tokens.filter((tk) => tk.t === 'word' && minted.has(tk.text)).map((tk) => tk.text))];
  if (clash.length) return { expr, chips: null, unresolved: clash };
  return refs.size ? { expr, chips } : { expr };
}
/** The legacy spelling of the tokens on this placement, or null when a chip has none. */
export function legacyTextOf(tokens, placement) {
  let bad = false;
  const text = join(parts(tokens, (chip) => { const n = legacyNameOf(chip, placement); if (!n) bad = true; return n || ''; }));
  return bad ? null : text;
}
/** The clipboard text: legacy names where they exist, the chip's face elsewhere (decision o). */
export const textOf = (tokens, placement) => join(parts(tokens, (chip) => legacyNameOf(chip, placement) || chipFace(chip)));

// ── typed equals migrated across the CM360 flip (spec §5) ──────────────────────────────────
/** Whether the tokens name a CM360 field: `cm` is a fact about the text, and these tokens ARE
 *  the text (a `source: 'cm360'` chip is the one a CM legacy name reads to). */
export const namesCm = (tokens) => tokens.some((tk) => tk.t === 'chip' && tk.chip.source === 'cm360');
// The reading the tokens themselves carry, so a word is committed and a paste is read under it
// whatever the host's placement says this render (the host's `cm` follows the draft one step behind).
const ownReading = (placement, tokens) => { const p = placement || AGG_PLACEMENT; const cm = namesCm(tokens); return !!p.cm === cm ? p : { ...p, cm }; };
/** rereadAcrossCm(tokens, wasCm, placement) → tokens. A legacy text reads its plain delivery
 *  names as the matched BQ half only beside a CM360 name, so the tokens change their reading when
 *  the first CM360 chip lands or the last one leaves: every chip with a legacy name under the old
 *  reading is re-read under the new one (`im` beside a new `cmIm` is Impressions · Matched to
 *  CM360, as fromLegacy reads `im / cmIm`; the matched half is plain again once `cmIm` is gone),
 *  and a chip with settings of its own, which has no name, stays as it was. */
export function rereadAcrossCm(tokens, wasCm, placement) {
  const isCm = namesCm(tokens);
  if (isCm === !!wasCm) return tokens;
  const p = placement || AGG_PLACEMENT;
  const from = { ...p, cm: !!wasCm }; const to = { ...p, cm: isCm };
  return tokens.map((tk) => {
    if (tk.t !== 'chip') return tk;
    const name = legacyNameOf(tk.chip, from);
    const chip = name ? chipForLegacy(name, to) : null;
    return chip ? { t: 'chip', chip: cleanChip(chip) } : tk;
  });
}
/** resolvedTokens(holder, placement) → the tokens a holder READS as: a word still being typed in
 *  a chip holder is the chip it commits to (tokensFromHolder), and the CM360 flip is applied
 *  against the holder's own map (its committed chips), so the field's refs and the host's gate
 *  read one and the same draft. A text holder decides its reading from its own words. */
export function resolvedTokens(holder, placement) {
  const map = holder && typeof holder === 'object' && holder.chips && typeof holder.chips === 'object' ? holder.chips : null;
  const tokens = tokensFromHolder(holder, placement);
  return map ? rereadAcrossCm(tokens, Object.keys(map).some((r) => map[r] && map[r].source === 'cm360'), placement) : tokens;
}

// ── suggestions ─────────────────────────────────────────────────────────────────────────────
const lower = (s) => String(s).toLowerCase();   // not locale-aware: an identifier is ASCII, and tr's dotless i would hide «Impressions»
/** suggest(word, placement, env) → ranked entries `{ id, chip | fn, face, alias, reason }`.
 *  Legacy identifiers first (their exact chip on this placement), then catalogue names, then
 *  functions; an entry the slot refuses carries `reason` and is never hidden (spec §6.3).
 *  env = { fieldSet, cm, cmRefusal, cmUnavailable, contextKind, judge(chip) → reason | null }. */
export function suggest(word, placement, env) {
  const e = env || {};
  const typed = String(word == null ? '' : word).trim();
  const q = lower(typed);
  if (!q) return [];
  const out = []; const seen = new Set();
  const push = (entry) => { const key = entry.chip ? chipKey(entry.chip) : `fn:${entry.fn}`; if (seen.has(key)) return; seen.add(key); out.push(entry); };
  const judge = e.judge || (() => null);
  // 1. legacy identifiers typed as such: the exact chip fromLegacy gives here (spec §5 «typed
  //    equals migrated»). A name outside the slot's field set is offered with the reason, never dropped.
  for (const name of LEGACY_NAMES) {
    if (!lower(name).startsWith(q)) continue;
    const chip = chipForLegacy(name, placement);
    if (!chip) continue;
    const cmName = FIELDS_CM.has(name);
    const reason = cmName ? (!e.cm ? (e.cmRefusal || NO_CM_JOIN) : (e.cmUnavailable || null))
      : e.fieldSet && !e.fieldSet.has(name) ? `${name} is not a field on these rows` : judge(cleanChip(chip));
    push({ id: `legacy:${name}`, chip: cleanChip(chip), face: chipFace(cleanChip(chip)), alias: name, reason: reason || null, rank: 0 });
  }
  // 2. catalogue names: the bare chip with its defaults
  for (const base of Object.keys(CATALOG)) {
    const def = CATALOG[base];
    if (!lower(def.name).includes(q) && !lower(base).startsWith(q)) continue;
    const chip = { base };
    // A name the letters START ranks above a function; a name that merely CONTAINS them ranks
    // below it (`ro` offers round() before Projected).
    push({ id: `base:${base}`, chip, face: def.name, alias: legacyNameOf(chip, placement), reason: judge(chip) || null, rank: lower(def.name).startsWith(q) ? 1 : 3 });
  }
  // 3. functions
  for (const fn of Object.keys(FUNCTIONS)) {
    if (!fn.startsWith(q)) continue;
    const off = FUNCTIONS[fn].tsOnly && e.contextKind !== 'ts';
    push({ id: `fn:${fn}`, fn, face: `${fn}()`, alias: null, reason: off ? dateAxisRefusal(fn) : null, rank: 2 });
  }
  // The exact alias (case-sensitive, as the parser reads identifiers) stands first inside its rank.
  return out.sort((a, b) => a.rank - b.rank || (a.alias === typed ? -1 : b.alias === typed ? 1 : 0)).map(({ rank, ...entry }) => entry);
}

// ── the reducer ─────────────────────────────────────────────────────────────────────────────
export const initialState = (tokens) => { const t = tokens || []; return { tokens: t, caret: t.length, selection: null, word: '', active: 0, history: [], future: [] }; };
const remember = (s) => ({ ...s, history: [...s.history.slice(-(HISTORY - 1)), { tokens: s.tokens, caret: s.caret }], future: [] });
const splice = (s, at, del, add) => ({ ...s, tokens: [...s.tokens.slice(0, at), ...add, ...s.tokens.slice(at + del)], caret: at + add.length, selection: null });
// The token a typed word becomes: a number; the picked suggestion; the EXACT legacy alias even
// when the slot refuses it (the gate then names the reason on the chip, spec §5 «typed equals
// migrated»); a legacy identifier this placement does not serve stays a word, as fromLegacy
// leaves it unresolved; else the first suggestion nothing refuses; else a word.
function tokenForWord(word, pick, placement, env) {
  // Digits too many for a number (Infinity) stay a word, as tokenizeLoosely keeps them.
  if (NUMBER_RE.test(word)) return Number.isFinite(Number(word)) ? { t: 'num', v: Number(word) } : { t: 'word', text: word };
  const list = pick ? [] : suggest(word, placement, env);
  const exact = pick || list.find((s) => s.alias === word) || null;
  if (!exact && isLegacyName(word) && !chipForLegacy(word, placement)) return { t: 'word', text: word };
  const chosen = exact || list.find((s) => !s.reason) || null;
  if (chosen && chosen.fn) return { t: 'fn', name: chosen.fn };
  if (chosen && chosen.chip) return { t: 'chip', chip: cleanChip(chosen.chip) };
  return { t: 'word', text: word };
}
/** reduce(state, action, placement, env) → state. Never mutates: every change mints new objects.
 *  A step that changes the tokens is followed by the CM360 re-read (rereadAcrossCm) against the
 *  tokens the step started from, so a commit, a paste, a chip's new source, a deletion, an undo
 *  all leave a list that reads as its own legacy text would. */
export function reduce(state, action, placement, env) {
  const next = reduceStep(state, action, placement, env);
  if (next === state || next.tokens === state.tokens) return next;
  const tokens = rereadAcrossCm(next.tokens, namesCm(state.tokens), placement);
  return tokens === next.tokens ? next : { ...next, tokens };
}
function reduceStep(state, action, placement, env) {
  const s = state;
  switch (action.type) {
    case 'word': return { ...s, word: action.text, active: 0, selection: null };
    case 'activeDown': return { ...s, active: s.active + 1 };
    case 'activeUp': return { ...s, active: Math.max(0, s.active - 1) };
    case 'commit': {
      if (!s.word && !action.pick) return s;
      const tk = tokenForWord(s.word, action.pick, ownReading(placement, s.tokens), env);
      const next = splice(remember(s), s.caret, 0, [tk]);
      // A function name opens its bracket at once, so the caret stands inside the call.
      return tk.t === 'fn' ? { ...splice(next, next.caret, 0, [{ t: 'op', v: '(' }]), word: '' } : { ...next, word: '' };
    }
    case 'op': {
      // A function name followed by its bracket is the function, whatever the suggestions rank
      // first (`min(` is min(), not the Min over lines chip; `cumsum(` is cumsum(), the gate
      // then names the date axis it needs).
      const fnPick = action.v === '(' && s.word && isFunctionName(s.word) ? { fn: s.word } : undefined;
      const committed = s.word ? reduce(s, { type: 'commit', pick: fnPick }, placement, env) : s;
      // «(» typed right after a function name: the commit above already placed the bracket
      // (the tokens before the caret are then `fn (`), so the key adds nothing.
      const t = committed.tokens; const c = committed.caret;
      if (action.v === '(' && s.word && t[c - 2] && t[c - 2].t === 'fn' && t[c - 1].t === 'op' && t[c - 1].v === '(') return committed;
      return { ...splice(remember(committed), c, 0, [{ t: 'op', v: action.v }]), word: '' };
    }
    case 'backspace': {
      if (s.word) return { ...s, word: s.word.slice(0, -1) };
      if (s.selection != null) return splice(remember(s), s.selection, 1, []);
      if (s.caret === 0) return s;
      const left = s.tokens[s.caret - 1];
      if (left.t === 'chip') return { ...s, selection: s.caret - 1 };
      return splice(remember(s), s.caret - 1, 1, []);
    }
    case 'delete': {
      if (s.selection != null) return splice(remember(s), s.selection, 1, []);
      if (s.caret >= s.tokens.length) return s;
      return splice(remember(s), s.caret, 1, []);
    }
    case 'left': return { ...s, caret: Math.max(0, s.caret - 1), selection: null };
    case 'right': return { ...s, caret: Math.min(s.tokens.length, s.caret + 1), selection: null };
    case 'home': return { ...s, caret: 0, selection: null };
    case 'end': return { ...s, caret: s.tokens.length, selection: null };
    case 'caret': return { ...s, caret: Math.max(0, Math.min(s.tokens.length, action.index)), selection: null };
    // A click on a chip: the chip is selected and the caret moves past it; while a word is still
    // being typed the caret (and the word riding at it) stays where it is, so opening a chip's
    // settings never moves what the person typed.
    case 'select': return { ...s, selection: action.index, caret: s.word ? s.caret : action.index + 1 };
    case 'setChip': {
      const next = remember(s);
      return { ...next, tokens: next.tokens.map((tk, i) => (i === action.index ? { t: 'chip', chip: cleanChip(action.chip) } : tk)) };
    }
    case 'insert': return { ...splice(remember(s), s.caret, 0, action.tokens), word: '' };
    case 'paste': {
      const committed = s.word ? reduce(s, { type: 'commit' }, placement, env) : s;
      return { ...splice(remember(committed), committed.caret, 0, tokensFromText(action.text, ownReading(placement, committed.tokens))), word: '' };
    }
    case 'undo': {
      // A word still being typed goes first; the next undo reverts the last committed change.
      if (s.word) return { ...s, word: '' };
      if (!s.history.length) return s;
      const prev = s.history[s.history.length - 1];
      return { ...s, ...prev, selection: null, word: '', history: s.history.slice(0, -1), future: [{ tokens: s.tokens, caret: s.caret }, ...s.future] };
    }
    case 'redo': {
      if (!s.future.length) return s;
      const [next, ...rest] = s.future;
      return { ...s, ...next, selection: null, word: '', history: [...s.history, { tokens: s.tokens, caret: s.caret }], future: rest };
    }
    default: return s;
  }
}

// ── holder helpers for the field and the dialog ─────────────────────────────────────────────
/** The chip of the token at `index` (a TOKEN index, as the field reports it), or null. A text
 *  holder resolves its names on `placement` (the aggregate when none is given). */
export function chipAt(holder, index, placement) {
  const tk = tokensFromHolder(holder, placement || AGG_PLACEMENT)[index];
  return tk && tk.t === 'chip' ? tk.chip : null;
}
/** A NEW holder with the chip at `index` replaced; the original is never touched. */
export function withChipAt(holder, index, chip, placement) {
  const s = reduce(initialState(tokensFromHolder(holder, placement || AGG_PLACEMENT)), { type: 'setChip', index, chip }, placement, {});
  return holderFromTokens(s.tokens);
}
// A period re-spelled for another family (plan decision e: one reading has one stored form):
// a rate counts days with data (`lastDataDays`), a sum spells them `lastDays` with skipEmpty;
// own days ride only on the data-day kinds; the CM360 last day belongs to a CM360 chip alone.
function respellPeriod(p, family, cm) {
  const out = { ...p };
  if (family === 'sum' && out.kind === 'lastDataDays') { out.kind = 'lastDays'; delete out.days; }
  if (family === 'rate' && out.kind === 'lastDays') out.kind = 'lastDataDays';
  if (out.kind !== 'lastDataDays' && out.kind !== 'lastDay') delete out.days;
  if (out.kind === 'previous' && out.of && typeof out.of === 'object') out.of = respellPeriod(out.of, family, cm);
  if (!cm) delete out.end;
  return out;
}
/** rebase(chip, base) → the chip on another catalogue entry («Change to…», spec §6.3): every
 *  setting the new entry also has is kept (an option it does not offer is dropped), the period
 *  is re-spelled across families (a rate's N days with data become a sum's N days with
 *  skipEmpty and the other way round; the last day with data stays), and skipEmpty is dropped
 *  where the new chip has none, so norm accepts every result. Never mutates `chip`. */
export function rebase(chip, base) {
  const def = CATALOG[base];
  if (!def) return { base };
  const src = chip && typeof chip === 'object' ? chip : {};
  const from = CATALOG[src.base];
  const out = { base };
  for (const k of SETTING_ORDER) {
    if (k === 'base' || k === 'period' || k === 'skipEmpty' || src[k] === undefined || !(k in def.settings)) continue;
    const st = def.settings[k];
    // A nested holder or the where rows belong to the chip they were written on.
    if (st.holder || st.where) continue;
    // Expected's click-paced unit is still clicks to a chip that has no such gate.
    if (k === 'unit' && src[k] === 'clickPaced' && st.options && !st.options.includes('clickPaced') && st.options.includes('clicks')) { out[k] = 'clicks'; continue; }
    if (st.options && !st.options.includes(src[k])) continue;
    out[k] = src[k];
  }
  const cm = FormulaChips.chipIsCm(out);
  if (src.period && typeof src.period === 'object' && 'period' in def.settings) {
    out.period = respellPeriod(src.period, def.family, cm);
    // A rate's days WITH data are a sum's days with skipEmpty: the reading travels with the kind,
    // on the period itself and on the period a `previous` is of.
    const of = src.period.kind === 'previous' && src.period.of && typeof src.period.of === 'object' ? src.period.of : src.period;
    if (def.family === 'sum' && of.kind === 'lastDataDays' && 'skipEmpty' in def.settings) out.skipEmpty = true;
  }
  if (src.skipEmpty && 'skipEmpty' in def.settings && (!from || from.family !== 'rate')) out.skipEmpty = true;
  return cleanChip(out);
}
const UNIT_FAMILY = { count: 'count', money: 'money', percent: 'percent', number: 'number' };
/** The unit family every chip of the holder agrees on (CATALOG[base].unit) when the holder is a
 *  single chip or chips joined by + and -, else null: a ratio or a product (`cpm / tgtCpm * 100`
 *  is a percent of two money chips), a function or a number has a unit no chip carries, and so do
 *  chips that disagree or a holder with none (decision l: proposed, never forced). */
export function unitOf(holder, placement) {
  let unit = null;
  for (const tk of tokensFromHolder(holder, placement || AGG_PLACEMENT)) {
    if (tk.t === 'op' && (tk.v === '+' || tk.v === '-')) continue;
    if (tk.t !== 'chip') return null;
    const def = CATALOG[tk.chip.base];
    const u = def ? UNIT_FAMILY[def.unit] || null : null;
    if (!u || (unit && unit !== u)) return null;
    unit = u;
  }
  return unit;
}
