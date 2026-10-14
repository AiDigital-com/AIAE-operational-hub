// workspace/src/lib/settings/dim-groups-editor.js
//
// Settings → Pacing → Value groups (spec 2026-10-02, kept outside git): the editor's rules,
// with no React in them. A line's draft groups, its draft containers and the pacing's raw
// delivered values go in; what the menu lists, what the editor ticks, which rule a draft
// breaks and what a "Done" writes come out.
//
// The save rules themselves are the shared module's (through the door): this file only
// arranges the draft so that Save is blocked on exactly what the server would refuse.
import {
  foldValue, validateGroupsLine, alignGroupSplits, GROUP_DIM_KEYS, GROUP_DIM_LABELS,
} from './dim-value-groups.js';

export const DIM_LABELS = GROUP_DIM_LABELS;

const list = (v) => (Array.isArray(v) ? v : []);
const count = (n) => `${n} value${n === 1 ? '' : 's'}`;
export const valuesLabel = count;

/**
 * The key a dim split's value is compared by inside one container, the save's rule 7: by
 * fold on a dimension the line has a group on, exact after trim everywhere else (without
 * groups `Promo` and `promo` are two legal values and stay two).
 */
export function splitKey(dimKey, value, groups) {
  const grouped = list(groups).some((g) => g && g.dim_key === dimKey);
  const s = String(value == null ? '' : value).trim();
  return dimKey + ':' + (grouped ? s.toLowerCase() : s);
}

/**
 * What "+ Add dim split" lists for one line: per dimension, the delivered raw values with a
 * group's members shown once as the group, then every draft group not yet listed (a group
 * whose values have not delivered still has to be splittable).
 * -> [{ key, label, items: [{ value, group: null | { count } }] }], empty dimensions dropped.
 */
export function menuItems(rawSplits, liId, groups) {
  const out = [];
  for (const key of GROUP_DIM_KEYS) {
    const mine = list(groups).filter((g) => g && g.dim_key === key);
    const owner = new Map();
    for (const g of mine) {
      for (const v of list(g.values)) if (!owner.has(foldValue(v))) owner.set(foldValue(v), g);
      if (!owner.has(foldValue(g.name))) owner.set(foldValue(g.name), g);
    }
    const items = [];
    const listed = new Set();
    const seen = new Set();
    for (const v of list(rawSplits?.[key]?.[liId])) {
      const f = foldValue(v);
      const g = owner.get(f);
      if (g) {
        if (!listed.has(g)) { listed.add(g); items.push({ value: g.name, group: { count: g.values.length } }); }
        continue;
      }
      // Two spellings are one item only where the save would call them one value.
      const k = splitKey(key, v, mine);
      if (!f || seen.has(k)) continue;
      seen.add(k);
      items.push({ value: v, group: null });
    }
    for (const g of mine) if (!listed.has(g)) items.push({ value: g.name, group: { count: g.values.length } });
    if (items.length) out.push({ key, label: DIM_LABELS[key] || key, items });
  }
  return out;
}

/**
 * The editor's value list for the draft's dimension: the line's delivered raw values, then
 * the draft's own values that have not delivered ("typed"); ticked ones first.
 * -> [{ value, checked, typed, disabled: null | 'in group <name>' | 'has its own split' }]
 * A value is disabled when another draft group of the dimension holds it (or is named like
 * it), or when a dim split of any container of the line is on it. The group's own split (on
 * its name, or on the name it had before this edit) does not count.
 */
export function editorValues(rawSplits, liId, groups, containers, draft, editingIndex) {
  const dim = draft.dim_key;
  const delivered = [];
  const deliveredFolds = new Set();
  for (const v of list(rawSplits?.[dim]?.[liId])) {
    const f = foldValue(v);
    if (!f || deliveredFolds.has(f)) continue;
    deliveredFolds.add(f);
    delivered.push(String(v).trim());
  }
  const ticked = new Set(list(draft.values).map(foldValue));
  const otherOwner = new Map();
  list(groups).forEach((g, i) => {
    if (!g || g.dim_key !== dim || i === editingIndex) return;
    for (const v of list(g.values)) otherOwner.set(foldValue(v), g.name);
    otherOwner.set(foldValue(g.name), g.name);
  });
  const ownNames = new Set([foldValue(draft.name), foldValue(list(groups)[editingIndex]?.name)].filter(Boolean));
  const split = new Set();
  for (const c of list(containers)) {
    for (const x of list(c && c.dim_children)) {
      if (x && x.dim_key === dim && x.dim_value != null) split.add(foldValue(x.dim_value));
    }
  }
  const rows = [];
  const push = (value, typed) => {
    const f = foldValue(value);
    const disabled = otherOwner.has(f) ? `in group ${otherOwner.get(f)}`
      : (split.has(f) && !ownNames.has(f)) ? 'has its own split' : null;
    rows.push({ value, checked: ticked.has(f), typed, disabled });
  };
  for (const v of delivered) push(v, false);
  for (const v of list(draft.values)) {
    const f = foldValue(v);
    if (f && !deliveredFolds.has(f) && !rows.some((r) => foldValue(r.value) === f)) push(String(v).trim(), true);
  }
  return [...rows.filter((r) => r.checked), ...rows.filter((r) => !r.checked)];
}

/**
 * Apply an edited group to the line's draft: replaces groups[editingIndex] (or appends when
 * the index is -1). On a rename every dim split of the line on the old name follows it, and
 * a split spelled like the group takes the group's exact name.
 * -> { groups, containers } (new arrays; untouched containers keep their identity)
 */
export function applyGroup(groups, containers, draft, editingIndex) {
  const values = [];
  const seen = new Set();
  for (const v of list(draft.values)) {
    const s = String(v == null ? '' : v).trim();
    const f = s.toLowerCase();
    if (!s || seen.has(f)) continue;
    seen.add(f);
    values.push(s);
  }
  const clean = { dim_key: draft.dim_key, name: String(draft.name == null ? '' : draft.name).trim(), values };
  const before = list(groups);
  const previous = editingIndex >= 0 ? before[editingIndex] : null;
  const nextGroups = previous ? before.map((g, i) => (i === editingIndex ? clean : g)) : [...before, clean];
  let nextContainers = list(containers);
  if (previous && clean.name && foldValue(previous.name) !== foldValue(clean.name)) {
    const old = foldValue(previous.name);
    nextContainers = nextContainers.map((c) => {
      const kids = list(c && c.dim_children);
      if (!kids.some((x) => x && x.dim_key === clean.dim_key && foldValue(x.dim_value) === old)) return c;
      return { ...c, dim_children: kids.map((x) => (x && x.dim_key === clean.dim_key && foldValue(x.dim_value) === old
        ? { ...x, dim_value: clean.name } : x)) };
    });
  }
  return { groups: nextGroups, containers: alignGroupSplits(nextContainers, nextGroups) };
}

// Stands in for the values of a draft that has none ticked yet, so the rules about the NAME
// are judged as soon as it is typed. It starts with a control character, so no delivered or
// typed value can be spelled like it and no rule about values can fire on it.
const NO_VALUE_YET = '\u0000no value yet';
// The same idea for a name: no group, value or split can be spelled like it.
const NO_NAME_YET = '\u0000no name yet';

/**
 * The rule the NAME breaks, or null: the draft judged with no values of its own, so only the
 * rules about the name can fire (empty, taken, reserved, too long, a value of another group,
 * a rename onto a value already split in a container). The editor marks the Name field by
 * this, never by the words of a sentence.
 */
export function groupNameProblem(groups, containers, draft, editingIndex) {
  const problem = groupProblem(groups, containers, { ...draft, values: [] }, editingIndex);
  if (!problem) return null;
  // A rule the line breaks whatever the name is (two splits of a container that become one
  // value once the dimension has a group) is the dimension's, not the name's: the same draft
  // under a name nothing can collide with tells them apart.
  const neutral = groupProblem(groups, containers, { ...draft, name: NO_NAME_YET, values: [] }, editingIndex);
  return neutral === problem ? null : problem;
}

/**
 * Why a value typed into the editor cannot join the draft, or null. The same reasons a
 * delivered row is disabled for (another group of the dimension holds it or is named like
 * it; a dim split of the line is on it), plus the reserved tokens. Without this a value that
 * has not delivered yet would be added, show up ticked and locked, and block "Done".
 */
export function typedValueProblem(rawSplits, liId, groups, containers, draft, editingIndex, value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  if (s === '-' || s.startsWith('__')) return `"${s}" cannot be used as a group value.`;
  const f = foldValue(s);
  const row = editorValues(rawSplits, liId, groups, containers, { ...draft, values: [...list(draft.values), s] }, editingIndex)
    .find((r) => foldValue(r.value) === f);
  if (!row || !row.disabled) return null;
  return row.disabled === 'has its own split' ? `"${row.value}" has its own split.` : `"${row.value}" is ${row.disabled}.`;
}

/**
 * The editor's rows in a fixed order while it is open: ticked first as the editor opened,
 * then every tick leaves rows where they are (a row must not move under the pointer). A row
 * the order does not know yet (a value just typed in, ticked) joins the ticked rows: right
 * after the last ticked one, or first when none is ticked.
 * `order` is the previous call's answer (null on open) → { rows, order }.
 */
export function keepOrder(rows, order) {
  if (!order) return { rows, order: rows.map((r) => foldValue(r.value)) };
  const pos = new Map(order.map((f, i) => [f, i]));
  const fresh = rows.filter((r) => !pos.has(foldValue(r.value)));
  const known = rows.filter((r) => pos.has(foldValue(r.value)))
    .sort((a, b) => pos.get(foldValue(a.value)) - pos.get(foldValue(b.value)));
  let at = 0;
  known.forEach((r, i) => { if (r.checked) at = i + 1; });
  const next = [...known.slice(0, at), ...fresh, ...known.slice(at)];
  return { rows: next, order: next.map((r) => foldValue(r.value)) };
}

/**
 * The first rule the draft breaks, as the sentence the server would answer with, or null.
 * An empty name says so. An empty value list is not a sentence (the editor disables "Done"
 * until something is ticked), but the name is still judged: a taken or reserved name is
 * said while it is typed, not after the first tick.
 */
export function groupProblem(groups, containers, draft, editingIndex) {
  if (!String(draft.name == null ? '' : draft.name).trim()) return 'A value group needs a name.';
  const empty = !list(draft.values).some((v) => String(v == null ? '' : v).trim());
  const judged = empty ? { ...draft, values: [NO_VALUE_YET] } : draft;
  const applied = applyGroup(groups, containers, judged, editingIndex);
  const result = validateGroupsLine({ line_item_id: '', dim_groups: applied.groups, containers: applied.containers });
  return result.ok ? null : result.reason;
}

/** Rule 6's notice, or null: the name is also a value this line delivers. */
export function sameNameNotice(rawSplits, liId, draft) {
  const name = String(draft.name == null ? '' : draft.name).trim();
  if (!name) return null;
  const f = foldValue(name);
  return list(rawSplits?.[draft.dim_key]?.[liId]).some((v) => foldValue(v) === f)
    ? `${name} is also a delivered value on this line; its delivery will be counted in the group.`
    : null;
}

/**
 * One sentence per value that a widget is pinned to (widget.scope.dims: [{ key, value }]):
 * the ticked values, and on a rename the name the group had. On this line such a widget
 * stops finding the value: its rows read as the group.
 */
export function pinnedNotices(widgets, draft, previous = null) {
  const names = [...list(draft.values)];
  if (previous && previous.name && foldValue(previous.name) !== foldValue(draft.name)) names.push(previous.name);
  const out = [];
  const seen = new Set();
  for (const value of names) {
    const f = foldValue(value);
    if (!f || seen.has(f)) continue;
    seen.add(f);
    const titles = list(widgets)
      .filter((w) => list(w?.scope?.dims).some((d) => d && d.key === draft.dim_key && foldValue(d.value) === f))
      .map((w) => (w.title ? String(w.title) : 'Untitled widget'));
    if (!titles.length) continue;
    const one = titles.length === 1;
    out.push(`${String(value).trim()} is pinned in ${titles.length} widget${one ? '' : 's'}: ${titles.join(', ')}. ${one ? 'It' : 'They'} will stop showing this line.`);
  }
  return out;
}

/** The container whose dim split uses this group (by name), for the chip's × hint, or null. */
export function usedBy(containers, group) {
  const f = foldValue(group && group.name);
  for (const c of list(containers)) {
    if (list(c && c.dim_children).some((x) => x && x.dim_key === group.dim_key && foldValue(x.dim_value) === f)) {
      return c.name ? String(c.name) : 'a container';
    }
  }
  return null;
}

const addDays = (into, days) => {
  for (const [date, row] of Object.entries(days || {})) {
    const cur = (into[date] ||= {});
    for (const [k, v] of Object.entries(row || {})) if (typeof v === 'number') cur[k] = (cur[k] || 0) + v;
  }
};

/**
 * The saved per-value day maps of one line as the DRAFT dictionary would read them, for the
 * "not covered by the splits" warning while editing. The store's aggregate is grouped by the
 * SAVED dictionary, so each saved group's bucket is first un-folded into its members (the
 * member map holds every row of the bucket), then every raw value is folded through the
 * draft groups. No second pass over the fact rows.
 *   splitDaily = facts.liSplitDaily[liId]; members = memberDailyOf(facts.liSplitDaily)?.[liId]
 * Returns splitDaily ITSELF when the line has neither saved members nor draft groups.
 */
export function draftSplitDaily(splitDaily, members, draftGroups) {
  const groups = list(draftGroups);
  const hasMembers = members && Object.keys(members).length > 0;
  if (!splitDaily || (!hasMembers && !groups.length)) return splitDaily;
  const owner = new Map();        // 'dim:foldedValue' → the draft group's name
  for (const g of groups) {
    if (!g || !g.dim_key || !g.name) continue;
    for (const v of list(g.values)) {
      const key = g.dim_key + ':' + foldValue(v);
      if (!owner.has(key)) owner.set(key, g.name);
    }
    const self = g.dim_key + ':' + foldValue(g.name);
    if (!owner.has(self)) owner.set(self, g.name);
  }
  const out = {};
  const land = (dim, value, days) => {
    const name = owner.get(dim + ':' + foldValue(value));
    addDays((out[dim + ':' + (name ?? value)] ||= {}), days);
  };
  for (const [key, days] of Object.entries(splitDaily)) {
    const i = key.indexOf(':');
    const dim = key.slice(0, i);
    const byMember = hasMembers ? members[key] : null;
    if (byMember) for (const [member, memberDays] of Object.entries(byMember)) land(dim, member, memberDays);
    else land(dim, key.slice(i + 1), days);
  }
  return out;
}
