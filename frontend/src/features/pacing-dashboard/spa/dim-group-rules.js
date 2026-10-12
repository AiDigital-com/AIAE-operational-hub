// workspace/src/lib/settings/dim-group-rules.js
//
// The decisions the group editor makes, outside the component so a test can run
// them (spec 2026-08-10 §6). The editor renders; these rules answer.

import { groupValue, fold } from './dim-groups.js';

const RESERVED = new Set(['No value', 'Not covered', 'Others', 'Unclassified']);

/**
 * Distinct values of one dimension, weighted by the source's ranking metric.
 *
 * The order is the whole reason grouping is a job of minutes: on the owner's
 * export sixty values carry 80% of delivery and six thousand carry the rest, so
 * the ones worth merging are the ones a human sees first.
 */
/**
 * `opts.liPlan` restricts the tally to the line items in view and to each one's
 * FLIGHT, which is what every widget on this axis does (widget-data.js
 * dimSourceBuckets). Without it the preview counted the source's whole history
 * — rows from paused lines, rows outside a flight — and then called itself "the
 * rows a widget would show", which was not true of any widget.
 *
 * A period is deliberately NOT applied: the viewer picks that per widget and it
 * changes under the drawer. The preview states the span it used instead of
 * pretending to know which one is meant.
 */
export function valueTally(rows, dimKey, metric, opts = {}) {
  const plan = opts.liPlan || null;
  const acc = new Map();
  let blank = 0;
  let from = null;
  let to = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (plan) {
      const p = plan[String(r && r.line_item_id)];
      if (!p) continue;                                   // not a line item in view
      if (p.fs && p.fe && (r.date < p.fs || r.date > p.fe)) continue;
    }
    if (r && r.date) {
      if (from === null || r.date < from) from = r.date;
      if (to === null || r.date > to) to = r.date;
    }
    const raw = r && r.dims && Object.prototype.hasOwnProperty.call(r.dims, dimKey) ? r.dims[dimKey] : '';
    const v = String(raw == null ? '' : raw).trim();
    const w = Number((r.metrics || {})[metric]) || 0;
    if (!v) { blank += w; continue; }
    acc.set(v, (acc.get(v) || 0) + w);
  }
  const out = [...acc.entries()].map(([value, weight]) => ({ value, weight }))
    .sort((a, b) => b.weight - a.weight);
  // Rows with no value for this dimension are NOT values, but their delivery is
  // real and belongs in the denominator. Dropping it made "top 20 = 100% of
  // delivery" true of a source that named half of it: 50 impressions named and
  // 50 blank came back as one value carrying everything. Carried out of band so
  // the list of values stays a list of values.
  out.blankWeight = blank;
  // The span actually counted, so the screen can say what it is describing
  // rather than implying a window it does not know.
  out.from = from;
  out.to = to;
  return out;
}

/**
 * What the PACING delivered, in the unit a source's coverage is measured in,
 * over the explicitly supplied line items and inside each one's flight.
 *
 * The denominator of both §4.1 figures. It is computed here rather than in the
 * component because the numerator is — `valueTally` above clamps to exactly the
 * same line items and the same flights, and two numbers that must divide have to
 * be measured the same way or the percentage is about nothing.
 */
export function deliveredUnits(liDaily, liPlan, metricKey, liIds) {
  if (!liDaily || !metricKey) return 0;
  const ids = liIds instanceof Set ? liIds : new Set((liIds || []).map(String));
  let total = 0;
  for (const lid of ids) {
    const days = liDaily[lid];
    if (!days) continue;
    const p = (liPlan || {})[lid];
    for (const d of Object.keys(days)) {
      if (p && p.fs && p.fe && (d < p.fs || d > p.fe)) continue;
      total += Number((days[d] || {})[metricKey]) || 0;
    }
  }
  return total;
}

/**
 * The spellings a dictionary still names that the sheet no longer has (§5.8).
 *
 * Group members are stored as exact strings and matched folded, so the moment a
 * partner renames `Hulu - Roku (2285)` that spelling leaves its group and comes
 * back as its own row. Nothing notices, and after a few months of tidying a
 * dictionary is half dead and still looks fine.
 *
 * Never automatic: a spelling missing for one day because a line item paused is
 * not a rename, and dropping it would lose the grouping the moment it returns.
 */
export function staleMembers(values, groups) {
  const present = new Set((Array.isArray(values) ? values : []).map((v) => fold(v.value)));
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const m of (g && g.members) || []) {
      if (!present.has(fold(m))) out.push({ value: m, label: g.label, drop: !!g.drop });
    }
  }
  return out;
}

/**
 * What the server would refuse, said before the save rather than after it. Both
 * rules move numbers in ways a list of labels cannot show: a group named after a
 * residual row lands its delivery where the reader expects "we could not
 * attribute this", and a value in two groups has two possible repairs and no
 * discoverable one.
 */
export function groupErrors(list) {
  const out = [];
  const seen = new Map();
  for (const g of Array.isArray(list) ? list : []) {
    if (!g) continue;
    if (RESERVED.has(g.label)) out.push(`"${g.label}" is a reserved row name.`);
    for (const m of g.members || []) {
      // FOLDED, exactly as the reader compares (§6.3b). Comparing raw strings
      // here let `Hulu` and `⎵hulu⎵` sit in two different groups, pass this
      // check, pass the server's, and then be resolved to whichever came last —
      // silently, on a value the user believes is in the first one.
      const k = fold(m);
      const prev = seen.get(k);
      if (prev) {
        // Two different spellings of one value need a different sentence from a
        // plain duplicate: told they are "in both", a person looks for a string
        // that is not there and concludes the screen is broken.
        out.push(prev.raw === m
          ? `"${m}" is in both "${prev.label}" and "${g.label}".`
          : `"${prev.raw}" in "${prev.label}" and "${m}" in "${g.label}" are one value once case and spacing are ignored.`);
      }
      seen.set(k, { label: g.label, raw: m });
    }
  }
  return out;
}

/**
 * The rows a widget on this dimension would actually show, and what they cover.
 *
 * The group editor was built inside out: it offered a DICTIONARY — every
 * distinct value, biggest first, with a "Show all 6,196". Nobody groups 6 196
 * things and nobody ever will. What a person does is look at the rows that will
 * be VISIBLE and fix the ones split across spellings, so the screen has to be
 * the output rather than the vocabulary.
 *
 * `coverage` is what the SOURCE holds against what the pacing delivered. It is
 * carried through rather than folded in, because two different percentages live
 * here and printing one for the other makes the headline number a lie: a source
 * covering 38% of delivery whose top-20 holds 60% of itself shows 23% of
 * delivery, not 60% of anything.
 *
 * `splitOf` maps a value to the OTHER ranks its family appears at, so a row that
 * is really one thing wearing two names can say so where it stands.
 */
export function topNPreview(values, groups, n = 20, opts = {}) {
  const list = Array.isArray(values) ? values : [];
  // valueTally hangs the weight of rows with NO value for this dimension off the
  // array. It is part of what the source holds, so it is part of the
  // denominator — and it is what the reader shows as "No value".
  const blank = Number(list.blankWeight) || Number(opts.blankWeight) || 0;
  const total = list.reduce((s, v) => s + (v.weight || 0), 0) + blank;
  const table = Array.isArray(groups) ? groups : [];

  // Fold the raw tally through the dictionary, exactly as the reader does.
  const acc = new Map();
  let junk = blank;   // blanks land in the same residual line the reader uses
  for (const v of list) {
    const g = groupValue(opts.dimKey || '', v.value, table);
    if (g.drop) { junk += v.weight || 0; continue; }
    acc.set(g.label, (acc.get(g.label) || 0) + (v.weight || 0));
  }
  const ranked = [...acc.entries()].map(([label, weight]) => ({ label, weight }))
    .sort((a, b) => b.weight - a.weight);

  const top = ranked.slice(0, Math.max(1, n));
  const rest = ranked.slice(Math.max(1, n));
  const restWeight = rest.reduce((s, r) => s + r.weight, 0);
  const share = (w) => (total > 0 ? (w / total) * 100 : 0);
  const topWeight = top.reduce((s, r) => s + r.weight, 0);

  // Where else this family appears — the reason a merge is worth making.
  const rankOf = new Map(ranked.map((r, i) => [r.label, i + 1]));
  const elsewhere = new Map();
  for (const c of Array.isArray(opts.candidates) ? opts.candidates : []) {
    const present = (c.members || []).filter((m) => rankOf.has(m));
    if (present.length < 2) continue;
    for (const m of present) {
      // The OTHER ranks — a row saying "also at #3" while standing at #3 reads
      // as a bug in the reader rather than a split in the data.
      const others = present.filter((x) => x !== m).map((x) => rankOf.get(x)).sort((a, b) => a - b);
      elsewhere.set(m, { label: c.label, ranks: others, members: present });
    }
  }

  const cov = typeof opts.coverage === 'number' && opts.coverage >= 0 ? opts.coverage : null;
  return {
    rows: top.map((r, i) => ({
      rank: i + 1, label: r.label, weight: r.weight, share: share(r.weight),
      split: elsewhere.get(r.label) || null,
    })),
    others: { count: rest.length, weight: restWeight, share: share(restWeight) },
    junk: { weight: junk, share: share(junk) },
    total,
    distinct: ranked.length,
    // Of the SOURCE.
    topShare: share(topWeight),
    // Of DELIVERY — what the person actually wants to know, and null when the
    // coverage is not known rather than silently equal to the other one.
    topOfDelivery: cov == null ? null : share(topWeight) * cov / 100,
    coverage: cov,
  };
}
