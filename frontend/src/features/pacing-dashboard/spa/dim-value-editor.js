// workspace/src/lib/settings/dim-value-editor.js
//
// Every decision the Review values screen makes (spec 2026-08-11 §5.4), as pure
// functions over the stored dictionary. The screen renders; these answer. Same
// arrangement as dim-group-rules.js, and for the same reason: a host test can
// drive the whole editor — merge, split, junk, undo — with no React in the room.
//
// The stored shape is unchanged:
//
//     source.groups[dimKey] = [{ label, members: [raw, …], drop?: true }]
//
// Two rules run through everything below.
//
// ONE VALUE, ONE GROUP — AFTER FOLDING (§6.3b). The reader (`groupValue`)
// resolves a row by its FOLDED value, and so does the server validator now, so a
// dictionary holding `Hulu` in one group and `⎵hulu⎵` in another has no defined
// answer — the reader silently picks whichever the index wrote last. No
// operation here may produce that state, which is why every one of them is
// "detach these folded keys from wherever they are, then attach them to one
// place" rather than "append to the group the user clicked".
//
// `drop` MEANS IGNORE, NEVER DELETE. A dropped value folds into the no-value
// bucket, so the parts still add up to delivery. Nothing here removes a value
// from the dictionary's arithmetic.
//
// Every function is pure and returns a new list. The one deliberate exception:
// an operation that changes nothing returns the INPUT array by identity, so the
// caller can skip the history push — otherwise Undo, pressed after a click that
// did nothing, would appear broken.

import { fold, groupValue } from './dim-groups.js';

/* ── the caps, which are the server's ──────────────────────────────────────
 * Mirrored from dash-gate/lib/dim-sources.mjs (`safeGroups`). They are exported
 * because the screen has to say "at most 50 values" BEFORE the click, and
 * because a save that fails three tabs away from the control that caused it is
 * this project's recurring failure mode.
 */
export const MAX_GROUPS_PER_DIM = 200;
export const MAX_MEMBERS_PER_GROUP = 50;
export const MAX_LABEL_LEN = 120;
export const MAX_VALUE_LEN = 300;
export const MAX_DISMISSED_PER_DIM = 200;

/** A group may not be named after a row the reader takes for a residual. */
export const RESERVED_LABELS = Object.freeze(['No value', 'Not covered', 'Others', 'Unclassified']);
const RESERVED = new Set(RESERVED_LABELS);

/** What a fresh junk bin is called. Not reserved — it is an ordinary group carrying `drop`. */
export const IGNORED_LABEL = 'Junk';

/**
 * dash-gate's `str()`, character for character: the length is checked BEFORE
 * the trim, and the TRIMMED value is what gets stored. Keeping a value with its
 * whitespace here would mean the first save silently rewrote it, leaving the
 * drawer dirty against its own JSON fingerprint with nothing left to save.
 */
function clean(v, max) {
  return typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null;
}

/* ── the result shape ──────────────────────────────────────────────────────
 * Every operation answers `{ list, error }`, and on refusal `list` is the input
 * unchanged. A caller cannot accidentally apply a state the server would
 * reject, because there is no rejected state to apply — the only thing it can
 * do wrong is ignore the message.
 */
const ok = (list) => ({ list, error: null });
const no = (list, error) => ({ list, error });

/** One value or many, always as an array. The screen has both shapes. */
function asValues(values) {
  if (values == null) return [];
  return Array.isArray(values) ? values : [values];
}

/**
 * Clean, deduplicate BY FOLD, keep the first spelling of each.
 * First-spelling-wins because the list arrives in the order the user picked
 * them, and the one they clicked first is the one they were looking at.
 */
function placeable(values) {
  const out = [];
  const seen = new Set();
  for (const raw of asValues(values)) {
    const v = clean(raw, MAX_VALUE_LEN);
    if (v === null) continue;
    const k = fold(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return { values: out, keys: seen };
}

/**
 * Entries the server would refuse outright — no label, or no member array — are
 * dropped on the way in. They cannot be edited, they cannot be rendered, and
 * while one is present EVERY save from the drawer fails. Repairing on first
 * touch is the only outcome that leaves the user able to work.
 */
function normalise(list) {
  const arr = Array.isArray(list) ? list : [];
  const good = arr.filter((g) => g && typeof g === 'object' && !Array.isArray(g)
    && typeof g.label === 'string' && g.label.trim() !== '' && Array.isArray(g.members));
  return good.length === arr.length ? arr : good;
}

/* ── where a value already is ─────────────────────────────────────────────── */

// Built once per list and cached BY REFERENCE: the array comes from the store
// and is stable between renders, so the index is built once per edit rather
// than once per row — and 6 196 rows each asking "where does this live?" is the
// normal case, not the edge (§5.4). WeakMap, so an edited-away list is
// collectable; the editor makes a new array on every operation.
const INDEX = new WeakMap();

function indexOf(list) {
  const hit = INDEX.get(list);
  if (hit) return hit;
  const byKey = new Map();
  for (const g of list) {
    for (const m of g.members) {
      const k = fold(m);
      // First writer wins, matching nothing in particular — a dictionary with
      // two claims on one folded key is refused by validateGroups and by the
      // server, so this branch only decides what a BROKEN dictionary reports
      // while the user is looking at the error that names it.
      if (!byKey.has(k)) byKey.set(k, { label: g.label, drop: g.drop === true, member: m });
    }
  }
  INDEX.set(list, byKey);
  return byKey;
}

/**
 * Which group claims this value, folded — or null when nothing does.
 *
 * §6.3b: the search list must SAY where a value already is rather than offering
 * a click that produces a second claim. This is that query. It answers about
 * the DICTIONARY, not about the reader: a member whose spelling no longer
 * appears in the sheet still has a home, and the screen needs to show it to let
 * the user take it out.
 *
 * @returns {{label:string, drop:boolean, member:string}|null}
 *   `member` is the spelling stored in the group, which may differ in case and
 *   spacing from the value asked about. That difference is exactly what a user
 *   staring at "why can't I group this?" needs to see.
 */
export function homeOf(list, value) {
  const cur = normalise(list);
  const k = fold(value);
  if (!k) return null;
  return indexOf(cur).get(k) || null;
}

/**
 * What the server would refuse, said before the save.
 *
 * A superset of `groupErrors` (dim-group-rules.js), which answers the two rules
 * that move numbers — a reserved label, one value in two groups. This adds the
 * CAPS, and they are the ones that produce the failure this project keeps
 * hitting: a save refused three tabs away from the control that caused it, with
 * nothing on the screen that made it. Two checkers is one too many — the screen
 * should call this one and `groupErrors` should go.
 */
export function validateGroups(list) {
  const cur = normalise(list);
  const out = [];
  if (cur.length > MAX_GROUPS_PER_DIM) {
    out.push(`This breakdown holds ${cur.length} groups; at most ${MAX_GROUPS_PER_DIM}.`);
  }
  const seenLabel = new Set();
  const seenMember = new Map();
  for (const g of cur) {
    const label = clean(g.label, MAX_LABEL_LEN);
    if (!label) { out.push('A group has no usable name.'); continue; }
    if (RESERVED.has(label)) out.push(`“${label}” is a reserved row name.`);
    if (seenLabel.has(label)) out.push(`Two groups are called “${label}”.`);
    seenLabel.add(label);
    if (g.members.length === 0) out.push(`“${label}” has no values.`);
    if (g.members.length > MAX_MEMBERS_PER_GROUP) {
      out.push(`“${label}” holds ${g.members.length} values; at most ${MAX_MEMBERS_PER_GROUP}.`);
    }
    for (const m of g.members) {
      const v = clean(m, MAX_VALUE_LEN);
      if (v === null) { out.push(`“${label}” holds a value that is empty or longer than ${MAX_VALUE_LEN} characters.`); continue; }
      const k = fold(v);
      const prev = seenMember.get(k);
      if (prev) {
        // Folded, because that is what the reader compares. Raw-string
        // comparison let `Hulu` and `⎵hulu⎵` through and the reader then
        // answered with the second one for both, silently.
        out.push(prev.raw === v
          ? `“${v}” is in both “${prev.label}” and “${label}”.`
          : `“${prev.raw}” in “${prev.label}” and “${v}” in “${label}” are one value once case and spacing are ignored.`);
        continue;
      }
      seenMember.set(k, { label, raw: v });
    }
  }
  return out;
}

/* ── the placement primitive every operation is made of ────────────────────── */

/**
 * Take these folded keys out of every group except `keepLabel`, and let any
 * group emptied by that disappear — the server refuses `members: []`, and a
 * group with nothing in it is not something the reader can draw.
 *
 * That last part is a real consequence, not a detail: moving the last member of
 * "CNN" into "News" removes "CNN". It is the outcome the user asked for, and
 * Undo is one press away.
 */
function detach(list, keys, keepLabel) {
  let changed = false;
  const out = [];
  for (const g of list) {
    if (g.label === keepLabel) { out.push(g); continue; }
    const kept = g.members.filter((m) => !keys.has(fold(m)));
    if (kept.length === g.members.length) { out.push(g); continue; }
    changed = true;
    if (kept.length) out.push({ ...g, members: kept });
  }
  return changed ? out : list;
}

/** The group carrying this exact label, or null. Labels are unique per dimension. */
function find(list, label) {
  return list.find((g) => g.label === label) || null;
}

/** A label the user typed, checked the way the server checks it. */
function labelError(label, taken) {
  const clean_ = clean(label, MAX_LABEL_LEN);
  if (!clean_) {
    return typeof label === 'string' && label.trim() !== ''
      ? `A group name may be at most ${MAX_LABEL_LEN} characters.`
      : 'A group needs a name.';
  }
  if (RESERVED.has(clean_)) return `“${clean_}” is a reserved row name; the reader uses it for values it could not attribute.`;
  if (taken && taken.has(clean_)) return `A group called “${clean_}” already exists.`;
  return null;
}

/* ── the operations ────────────────────────────────────────────────────────── */

/**
 * A new group out of a set of values.
 *
 * Values already living somewhere else MOVE. That is how two groups are merged
 * into one, and it is the only behaviour that keeps one-value-one-group true
 * without asking the user to unpick the old group first.
 *
 * The duplicate-label check runs AFTER the move, deliberately: if the group
 * being replaced is emptied by it, its name is free, and refusing there would
 * block "select all of Hulu's members, regroup them as Hulu" for no reason a
 * user could see.
 */
export function createGroup(list, label, values, opts = {}) {
  const cur = normalise(list);
  const { values: members, keys } = placeable(values);
  if (!members.length) return no(cur, 'Pick at least one value.');
  if (members.length > MAX_MEMBERS_PER_GROUP) {
    return no(cur, `A group holds at most ${MAX_MEMBERS_PER_GROUP} values; ${members.length} were picked.`);
  }
  const moved = detach(cur, keys, null);
  const err = labelError(label, new Set(moved.map((g) => g.label)));
  if (err) return no(cur, err);
  if (moved.length >= MAX_GROUPS_PER_DIM) {
    return no(cur, `This breakdown already holds ${MAX_GROUPS_PER_DIM} groups.`);
  }
  const group = { label: clean(label, MAX_LABEL_LEN), members };
  if (opts.drop === true) group.drop = true;
  return ok([...moved, group]);
}

/** Rename in place: the position and the `drop` flag are properties of the group, not of its name. */
export function renameGroup(list, label, nextLabel) {
  const cur = normalise(list);
  const target = find(cur, label);
  if (!target) return no(cur, `There is no group called “${label}”.`);
  const next = clean(nextLabel, MAX_LABEL_LEN);
  if (next !== null && next === target.label) return ok(cur);   // nothing to do, and nothing to undo
  const err = labelError(nextLabel, new Set(cur.filter((g) => g !== target).map((g) => g.label)));
  if (err) return no(cur, err);
  return ok(cur.map((g) => (g === target ? { ...g, label: next } : g)));
}

/**
 * Put values into an existing group. This IS the move operation: a value has
 * exactly one home, so adding it here takes it out of wherever it was. There is
 * no second function for moving because there is no second behaviour — see
 * `moveValues` below, which is this one with the arguments in the order a
 * "Move to…" menu reads.
 *
 * A value already in the target is left alone rather than rewritten: the sheet
 * owns its capitalisation, and silently restyling a stored member would change
 * what the dictionary shows a human for no gain.
 */
export function addToGroup(list, label, values) {
  const cur = normalise(list);
  const target = find(cur, label);
  if (!target) return no(cur, `There is no group called “${label}”.`);
  const { values: picked, keys } = placeable(values);
  if (!picked.length) return no(cur, 'Pick at least one value.');

  const held = new Set(target.members.map(fold));
  const fresh = picked.filter((v) => !held.has(fold(v)));
  if (!fresh.length) return ok(cur);                       // every one of them is already here
  if (target.members.length + fresh.length > MAX_MEMBERS_PER_GROUP) {
    return no(cur, `“${target.label}” would hold ${target.members.length + fresh.length} values; at most ${MAX_MEMBERS_PER_GROUP}.`);
  }
  const moved = detach(cur, keys, target.label);
  return ok(moved.map((g) => (g.label === target.label ? { ...g, members: [...g.members, ...fresh] } : g)));
}

/** `addToGroup` with the arguments in the order a "Move to…" control reads. */
export function moveValues(list, values, toLabel) {
  return addToGroup(list, toLabel, values);
}

/**
 * Take members out of a group — into a new one, or back to ungrouped.
 *
 * `newLabel` null/empty means ungrouped: they leave the dictionary and appear
 * in "All values" on their own again. Splitting out every member removes the
 * group, by the same emptying rule as everything else.
 */
export function splitGroup(list, label, values, newLabel = null) {
  const cur = normalise(list);
  const target = find(cur, label);
  if (!target) return no(cur, `There is no group called “${label}”.`);
  const held = new Set(target.members.map(fold));
  const { values: picked, keys } = placeable(values);
  const taken = picked.filter((v) => held.has(fold(v)));
  if (!taken.length) return no(cur, `None of those values are in “${target.label}”.`);

  const wanted = clean(newLabel, MAX_LABEL_LEN);
  if (newLabel != null && String(newLabel).trim() !== '' && wanted === null) {
    return no(cur, `A group name may be at most ${MAX_LABEL_LEN} characters.`);
  }
  if (wanted === null) {
    // Back to ungrouped. `detach` with no kept label does exactly this.
    return ok(detach(cur, keys, null));
  }
  // Into a group of their own. The new group carries the source's `drop` flag:
  // splitting three spellings out of the junk bin means "these three are still
  // junk, but they are their own thing" — un-ignoring is `unignoreGroup`.
  return createGroup(cur, wanted, taken, { drop: target.drop === true });
}

/** Forget the group. Its members go back to being ordinary ungrouped values. */
export function ungroup(list, label) {
  const cur = normalise(list);
  const target = find(cur, label);
  if (!target) return no(cur, `There is no group called “${label}”.`);
  return ok(cur.filter((g) => g !== target));
}

/**
 * Ignore values: into the junk bin, which folds into the reader's no-value row.
 *
 * There is ONE bin for loose values — the first group carrying `drop`, or a new
 * one called Junk. Several are legal in the stored shape and the reader treats
 * them identically, but §5.4's applied-groups list shows the bin as one row, and
 * a second anonymous pile appearing on its own is a state the user did not ask
 * for.
 *
 * The 50-value cap therefore binds here, and it REFUSES rather than spilling
 * into "Junk 2". Junk is `Unknown`, `-1`, `n/a` — a handful. A long tail of real
 * values belongs in a group or nowhere, not hidden behind an invented label.
 */
export function ignoreValues(list, values) {
  const cur = normalise(list);
  const bin = cur.find((g) => g.drop === true) || null;
  if (bin) return addToGroup(cur, bin.label, values);
  const r = createGroup(cur, IGNORED_LABEL, values, { drop: true });
  if (r.error && find(cur, IGNORED_LABEL)) {
    // A non-drop group already holds the name. Say so rather than repeating a
    // generic "already exists" the user cannot act on.
    return no(cur, `“${IGNORED_LABEL}” is already the name of a group. Rename it, or move these values into it.`);
  }
  return r;
}

/**
 * Stop ignoring values: they leave the bin and go back to ungrouped, not to
 * whatever group they were in before it. Nothing stores that, and guessing
 * would be worse than the one press of Undo that does know.
 */
export function unignoreValues(list, values) {
  const cur = normalise(list);
  const { keys } = placeable(values);
  const inBin = [...keys].filter((k) => {
    const home = indexOf(cur).get(k);
    return home && home.drop;
  });
  if (!inBin.length) return no(cur, 'None of those values are ignored.');
  const only = new Set(inBin);
  return ok(detach(cur, only, null));
}

/**
 * Ignore a whole group — the flag goes ON THE GROUP, its label and members
 * untouched.
 *
 * The alternative (tip its members into the shared bin) loses the grouping and
 * can hit the bin's cap on an operation that moved nothing new. Flagging is
 * exactly reversible, costs nothing, and the reader already folds every `drop`
 * group into the same no-value row, so nothing downstream can tell the
 * difference.
 */
export function ignoreGroup(list, label) {
  const cur = normalise(list);
  const target = find(cur, label);
  if (!target) return no(cur, `There is no group called “${label}”.`);
  if (target.drop === true) return ok(cur);
  return ok(cur.map((g) => (g === target ? { ...g, drop: true } : g)));
}

/** The inverse: the group stops being ignored and its values return to the breakdown. */
export function unignoreGroup(list, label) {
  const cur = normalise(list);
  const target = find(cur, label);
  if (!target) return no(cur, `There is no group called “${label}”.`);
  if (target.drop !== true) return ok(cur);
  // Rebuilt from the two keys the shape has, rather than setting `drop: false`:
  // the stored shape is `drop?: true`, and a stored false is a third state the
  // server rebuilds away — which would leave the drawer dirty against its own
  // JSON fingerprint with nothing left to save.
  return ok(cur.map((g) => (g === target ? { label: g.label, members: g.members } : g)));
}

/* ── undo ──────────────────────────────────────────────────────────────────
 * Merging twelve spellings is one click and unpicking it by hand is twelve
 * (§5.4), so undo is not optional.
 *
 * A bounded stack of PREVIOUS snapshots. The snapshot is whatever the screen
 * edits — pass `{groups, dismissed}` together, not the group list alone, or
 * undoing a dismissal would be the one operation with no way back.
 *
 * No redo. It needs a forward stack that must be invalidated on every new edit,
 * which is a classic source of "undo restored something I had already changed";
 * and the whole screen is a draft until the drawer's Save, so an undo too many
 * is one operation to repeat by hand. §5.4 asks for undo and does not ask for
 * this.
 */
export const HISTORY_LIMIT = 20;

/** Record the state as it was BEFORE an operation. `label` is what Undo will say it undoes. */
export function pushHistory(history, snapshot, label = '') {
  const h = Array.isArray(history) ? history : [];
  const next = [...h, { snapshot, label: typeof label === 'string' ? label : '' }];
  // Oldest out first: past the cap the earliest edits become unreachable, which
  // is what "bounded undo" means everywhere else a person has used one.
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export function canUndo(history) {
  return Array.isArray(history) && history.length > 0;
}

/** What the Undo control should name, or null when there is nothing to undo. */
export function undoLabel(history) {
  return canUndo(history) ? history[history.length - 1].label : null;
}

/** @returns {{history:Array, snapshot:*, label:string}|null} */
export function undo(history) {
  if (!canUndo(history)) return null;
  const last = history[history.length - 1];
  return { history: history.slice(0, -1), snapshot: last.snapshot, label: last.label };
}

/* ── dismissed suggestions ─────────────────────────────────────────────────
 * "I looked, do not merge these" has to survive a reload or the advice becomes
 * noise that trains people to ignore it (§5.2) — and it is stored with the
 * mapping, in config_json beside the groups, because it is a judgement about the
 * DATA and the groups are shared by the team (§11).
 *
 * STORED SHAPE, for the validator:
 *
 *     source.dismissed = { [dimKey]: ['3f21a4c90b7e1d55', …] }
 *
 * — same keying as `groups`, so the same "names a dimension this source does not
 * carry" rule applies; each entry 16 lowercase hex characters; at most 200 per
 * dimension. Nothing else: no label, no timestamp, no author. A dismissal that
 * carried the suggestion's label would need re-checking whenever the label
 * generator changed, and the label is not what was judged — the values were.
 *
 * The key is a hash of the suggestion's own FOLDED member set, sorted, so it is
 * stable against member order and against a respelling the reader would not
 * distinguish, and it CHANGES when the sheet's vocabulary changes — which is
 * precisely when a dismissed suggestion should come back.
 */
export const DISMISS_KEY_RE = /^[0-9a-f]{16}$/;

/**
 * FNV-1a, 32 bits, over UTF-16 code units byte by byte so non-ASCII values hash
 * as deterministically as ASCII ones.
 *
 * There is no crypto on this bundle path and none is needed. This is a
 * de-duplication key: a collision would keep one suggestion hidden, which is
 * indistinguishable from the user having dismissed it, and at 64 bits over the
 * handful of suggestions one breakdown produces it will not happen.
 */
function fnv1a(s, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 0x01000193) >>> 0;
    h = Math.imul(h ^ ((c >>> 8) & 0xff), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n) => n.toString(16).padStart(8, '0');

/**
 * The fingerprint of a suggestion: 16 hex characters over its folded, sorted,
 * de-duplicated member set.
 *
 * Two 32-bit passes from different starting values, concatenated. They are not
 * independent in a cryptographic sense and do not need to be; see fnv1a.
 * The members are joined with NUL for the same reason the loader's fold key is
 * (§6.3a): it is the one character an ad-server value will not contain, where
 * `|` is ordinary in one — `Hulu | Roku`. Joined on a printable separator,
 * {"a|b", "c"} and {"a", "b|c"} would be one fingerprint.
 */
export function suggestionKey(members) {
  const keys = [...new Set(asValues(members).map(fold).filter(Boolean))].sort();
  const payload = keys.join('\u0000');
  return hex8(fnv1a(payload, 0x811c9dc5)) + hex8(fnv1a(payload, 0x01000193));
}

/** Has this exact suggestion been dismissed? `dismissed` is the array for ONE dimension. */
export function isDismissed(dismissed, members) {
  const keys = asValues(members);
  if (!keys.length) return false;
  const k = suggestionKey(members);
  return (Array.isArray(dismissed) ? dismissed : []).includes(k);
}

/**
 * Anything not of the stored shape is dropped on the way in, the same way a
 * malformed group is — and the array is returned BY IDENTITY when there was
 * nothing to drop, so a dismiss that changes nothing does not put an entry on
 * the undo stack that appears to do nothing when pressed.
 */
function cleanDismissed(dismissed) {
  const arr = Array.isArray(dismissed) ? dismissed : [];
  const good = arr.filter((k) => typeof k === 'string' && DISMISS_KEY_RE.test(k));
  return good.length === arr.length ? arr : good;
}

/**
 * @param {string[]} dismissed  the array for one dimension
 * @param {string[]} members    the suggestion's members, as proposed
 */
export function dismissSuggestion(dismissed, members) {
  const cur = cleanDismissed(dismissed);
  if (asValues(members).length < 2) return no(cur, 'A suggestion is a merge of two or more values.');
  const k = suggestionKey(members);
  if (cur.includes(k)) return ok(cur);
  if (cur.length >= MAX_DISMISSED_PER_DIM) {
    return no(cur, `This breakdown already holds ${MAX_DISMISSED_PER_DIM} dismissed suggestions.`);
  }
  // Sorted, so the stored array has one form for one set of dismissals and the
  // drawer's JSON fingerprint does not read as dirty because two people
  // dismissed the same two suggestions in a different order.
  return ok([...cur, k].sort());
}

export function undismissSuggestion(dismissed, members) {
  const cur = cleanDismissed(dismissed);
  const k = suggestionKey(members);
  if (!cur.includes(k)) return ok(cur);
  return ok(cur.filter((x) => x !== k));
}

/* ── the screen, as data ───────────────────────────────────────────────────── */

/**
 * Everything §5.4's three sections need, in one pass over the tally.
 *
 * @param {Array<{value:string, weight:number}>} values  `valueTally(...)` — its
 *   `blankWeight`, `from` and `to` ride on the array and are carried through.
 * @param {Array} list  this dimension's stored groups.
 * @param {{dimKey?:string, candidates?:Array, dismissed?:string[]}} opts
 *   `candidates` is `groupCandidates(ungrouped)` — proposals are NOT recomputed
 *   here, they are annotated.
 *
 * THE DENOMINATOR. §5.4 says percentages are of the breakdown's own NAMED total,
 * so `share` divides by `named` — the delivery whose cell was not blank. `total`
 * (named + blank) is carried alongside because the header says how much of the
 * source this breakdown names, and the two numbers must never be swapped: that
 * confusion is what §4.3 exists to record.
 */
export function reviewModel(values, list, opts = {}) {
  const cur = normalise(list);
  const rows = Array.isArray(values) ? values : [];
  const dimKey = opts.dimKey || '';
  const dismissed = Array.isArray(opts.dismissed) ? opts.dismissed : [];

  const blankWeight = Number(rows.blankWeight) || 0;
  let named = 0;
  // Two raw spellings in the SHEET can fold to one key — `Hulu` and `hulu ` are
  // two rows of the tally and one value to the reader — so weights are summed
  // per folded key, not assigned.
  const weightOf = new Map();
  for (const v of rows) {
    const w = Number(v.weight) || 0;
    named += w;
    const k = fold(v.value);
    weightOf.set(k, (weightOf.get(k) || 0) + w);
  }
  const share = (w) => (named > 0 ? (w / named) * 100 : 0);

  // Rows a widget would show: distinct labels after grouping, blanks and
  // ignored values excluded. Same definition as dimSourceCardinality
  // (dim-coverage.js), which is what routes the §5.6 handoff — resolved through
  // `groupValue`, the reader itself, so the two cannot drift.
  const labels = new Set();
  const claims = indexOf(cur);
  const valueRows = rows.map((v) => {
    const g = groupValue(dimKey, v.value, cur);
    if (!g.drop) labels.add(g.label);
    return {
      value: v.value,
      weight: Number(v.weight) || 0,
      share: share(Number(v.weight) || 0),
      // Where it already is — the query that replaces a click producing a second
      // claim (§6.3b). null means "loose", which is the only state from which
      // Group is offered without qualification.
      home: claims.get(fold(v.value)) || null,
    };
  });

  let ignoredWeight = 0;
  const groups = cur.map((g) => {
    let weight = 0;
    const missing = [];
    for (const m of g.members) {
      const k = fold(m);
      if (weightOf.has(k)) weight += weightOf.get(k);
      // A member the sheet no longer produces. Not an error — a campaign ends,
      // a DSP renames an app — but it is the "3 spellings no longer in the
      // sheet" line of §5.2's advice, and it is only knowable here.
      //
      // The same comparison `staleMembers` (dim-group-rules.js) makes for the
      // breakdown-level advice line: folded, against this same tally. Kept here
      // because it falls out of the loop that is already summing the group's
      // weight, and because the group ROW is where a dead spelling is acted on.
      else missing.push(m);
    }
    if (g.drop === true) ignoredWeight += weight;
    return {
      label: g.label,
      drop: g.drop === true,
      members: g.members,
      count: g.members.length,
      weight,
      share: share(weight),
      missing,
    };
  }).sort((a, b) => b.weight - a.weight);

  const suggestions = [];
  for (const c of Array.isArray(opts.candidates) ? opts.candidates : []) {
    if (!c || !Array.isArray(c.members)) continue;
    // The key is over the members AS PROPOSED. Hashing the free ones instead
    // would make a dismissal expire the moment an unrelated member of the same
    // family was grouped by hand, which is not a change in the sheet.
    const key = suggestionKey(c.members);
    const free = c.members.filter((m) => !claims.has(fold(m)));
    if (free.length < 2) continue;      // already merged; there is nothing left to propose
    const weight = free.reduce((s, m) => s + (weightOf.get(fold(m)) || 0), 0);
    suggestions.push({
      key,
      label: c.label,
      members: c.members,
      free,
      weight,
      share: share(weight),
      layer: c.layer,
      dismissed: dismissed.includes(key),
    });
  }
  suggestions.sort((a, b) => b.weight - a.weight);

  return {
    named,
    blankWeight,
    total: named + blankWeight,
    distinct: rows.length,
    rowCount: labels.size,
    from: rows.from ?? null,
    to: rows.to ?? null,
    suggestions,
    // The count in §5.4's `Suggestions  2` — what is OFFERED, not what exists.
    suggestionCount: suggestions.filter((s) => !s.dismissed).length,
    groups,
    values: valueRows,
    ignored: { count: groups.filter((g) => g.drop).length, weight: ignoredWeight, share: share(ignoredWeight) },
    errors: validateGroups(cur),
  };
}

/**
 * The search box, which §5.4 makes the primary way in rather than a fallback.
 *
 * Matched on the FOLDED forms, so typing `hulu` finds `Hulu - Roku (2285)` and
 * `HULU_IOS` alike — the same blindness the grouping itself has, because a user
 * who cannot find the second spelling cannot merge it.
 *
 * @param {Array} valueRows  `reviewModel(...).values`
 * @param {number} limit  how many to return; the list is virtualised, but the
 *   caller still decides how much to hold. 0 or absent means all.
 */
export function searchValues(valueRows, query, limit = 0) {
  const rows = Array.isArray(valueRows) ? valueRows : [];
  const q = fold(query);
  if (!q) return limit > 0 ? rows.slice(0, limit) : rows;
  const out = [];
  for (const r of rows) {
    if (!fold(r.value).includes(q)) continue;
    out.push(r);
    if (limit > 0 && out.length >= limit) break;
  }
  return out;
}
