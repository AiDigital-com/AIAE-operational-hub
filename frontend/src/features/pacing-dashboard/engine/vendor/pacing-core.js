/**
 * pacing-core.js — Shared pure calculation core
 *
 * Single source of truth for pacing calculations.
 * Used by: dashboard (browser <script>), n8n (require), GAS (copy-adapted).
 *
 * ALL functions are pure: no DOM, no global state, no I/O.
 * Division by zero returns 0 (canonical decision).
 *
 * Browser: exposes global `PacingCore` object.
 * Node.js: `module.exports = PacingCore`.
 *
 * Container model (2026-05): every plan carries `containers: Container[]`.
 * Container = { id, name, fs, fe, target_impressions, target_spend?, margin_percent?,
 *               date_children: DateChild[], dim_children: DimChild[] }.
 * Two-level date-axis proration (LI → Container → DateChild) plus an orthogonal
 * dim-axis (per audience / namebuilder-comment carve-outs). Spec:
 * docs/superpowers/specs/2026-05-14-split-containers.md.
 */
(function (root) {
"use strict";

/* ─── Internal helper (not exported) ───────────────────────────────────────── */

function parseUTC(y) {
    var p = String(y).split('-');
    var a = +p[0], b = +(p[1] || 1), c = +(p[2] || 1);
    return new Date(Date.UTC(a, b - 1, c));
}

/* ─── Date utilities ───────────────────────────────────────────────────────── */

/** Inclusive day count between two YYYY-MM-DD strings. */
function daysBetween(a, b) {
    return Math.floor((parseUTC(b) - parseUTC(a)) / 864e5) + 1;
}

/** True iff `s` is a strict YYYY-MM-DD string — guards date math against malformed input. */
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

/**
 * Pace-to-goal run-rate: per-day delivery still required to hit `target` by
 * flight end given `actual` so far. Generic over the metric — callers feed the
 * matching plan/actual pair (impr → planImpr/actualImpr; clicks; cost; views).
 *
 * SINGLE source of truth for "needed per day", value-identical to the workspace
 * SplitRow `childProgress.neededPerDay` (split-metrics.js) for identical inputs:
 *   remaining = max(0, target − actual)
 *   fd        = max(1, daysBetween(fs, fe))           (inclusive flight days)
 *   daysLeft  = max(0, fd − daysBetween(fs, asOf))    (today counts as elapsed →
 *                                                      today is NOT a remaining day)
 *   → daysLeft > 0 ? remaining / daysLeft : 0
 * with the same inert / edge handling: target ≤ 0 or missing fs/fe → 0; asOf
 * before fs (or falsy) → full window (remaining / fd); asOf after fe → 0.
 * Division by zero → 0 (project canon). Only calls daysBetween (declared above)
 * → no new TDZ in the injected copy.
 *
 * @param {number} target  metric plan total (e.g. planImpr, budget, planClicks)
 * @param {number} actual  metric actual so far (same unit as target)
 * @param {string} fs      flight start YYYY-MM-DD
 * @param {string} fe      flight end YYYY-MM-DD
 * @param {string} asOf    evaluation date YYYY-MM-DD (falsy → full window)
 * @returns {number}
 */
function neededPerDay(target, actual, fs, fe, asOf) {
    var tgt = Number(target) || 0;
    var act = Number(actual) || 0;
    if (!(tgt > 0) || !fs || !fe) return 0;
    var fd = Math.max(1, daysBetween(fs, fe));
    var remaining = Math.max(0, tgt - act);
    if (!asOf || asOf < fs) return remaining / fd;
    if (asOf > fe) return 0;
    var daysLeft = Math.max(0, fd - daysBetween(fs, asOf));
    return daysLeft > 0 ? remaining / daysLeft : 0;
}

/**
 * BACKWARD question: what day `day` itself had to deliver to still hit `planTotal`
 * by `flightEnd`.
 *
 *   remaining = max(0, planTotal - actualBefore)
 *   daysLeft  = day <= flightEnd ? daysBetween(day, flightEnd) : 0   // inclusive: D counts
 *   -> daysLeft > 0 ? remaining / daysLeft : 0
 *
 * `actualBefore` is delivery STRICTLY BEFORE `day`, in the same unit as planTotal.
 *
 * Contrast neededPerDay, the FORWARD question: what the flight must average from the
 * day AFTER its asOf, taking actual INCLUDING it. Both are wanted; what is not wanted
 * is one surface using the other's. Inside the flight they coincide one day apart:
 *   reforecastTarget(P, before(D), D, fe) === neededPerDay(P, incl(D-1), fs, fe, D-1)
 * That identity holds for fs <= D <= fe+1 ONLY — before flight start neededPerDay
 * short-circuits to remaining/flightDays and the two diverge on purpose. This function
 * takes no `fs`, so a `day` BEFORE flight start divides the remainder by a span that
 * includes pre-flight days and yields a diluted number, not 0. A caller that can supply
 * such a day must guard it itself — the Slack personal summary does (its `latestDate` is
 * pacing-wide, so it reaches lines that have not started yet).
 *
 * Pure — pause handling, period scoping and rounding stay with the caller.
 * Only calls daysBetween (declared above) → no new TDZ hazard in the injected copy.
 */
function reforecastTarget(planTotal, actualBefore, day, flightEnd) {
    var tgt = Number(planTotal) || 0;
    if (!(tgt > 0) || !day || !flightEnd || day > flightEnd) return 0;
    var daysLeft = daysBetween(day, flightEnd);
    if (!(daysLeft > 0)) return 0;
    return Math.max(0, tgt - (Number(actualBefore) || 0)) / daysLeft;
}

/** Date range overlap. Returns {start, end} or null. */
function rangeOverlap(a0, a1, b0, b1) {
    var s = a0 > b0 ? a0 : b0;
    var e = a1 < b1 ? a1 : b1;
    return s <= e ? { start: s, end: e } : null;
}

/** Previous calendar day (UTC). */
function datePrev(d) {
    var u = parseUTC(d);
    u.setUTCDate(u.getUTCDate() - 1);
    return u.toISOString().slice(0, 10);
}

/* ─── Range helpers ────────────────────────────────────────────────────────── */

/** Count unique calendar days covered by date ranges, clipped to [clipStart, clipEnd].
 *  Interval-union sweep (sort + merge overlaps, sum lengths) — O(n log n), no
 *  per-day materialization. YYYY-MM-DD string order == chronological order;
 *  disjoint intervals (even adjacent ones) contribute independent day counts,
 *  so only true overlaps need merging. Equivalent to the original Set-of-days
 *  walk — guarded by tests/count-unique-days-test.js (fuzz oracle). */
function countUniqueDays(ranges, clipStart, clipEnd) {
    var ivs = [];
    for (var i = 0; i < ranges.length; i++) {
        var ov = rangeOverlap(clipStart, clipEnd, ranges[i].fs, ranges[i].fe);
        if (ov) ivs.push(ov);
    }
    if (ivs.length === 0) return 0;
    ivs.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
    var total = 0, curS = ivs[0].start, curE = ivs[0].end;
    for (var j = 1; j < ivs.length; j++) {
        if (ivs[j].start <= curE) {
            if (ivs[j].end > curE) curE = ivs[j].end;
        } else {
            total += daysBetween(curS, curE);
            curS = ivs[j].start;
            curE = ivs[j].end;
        }
    }
    return total + daysBetween(curS, curE);
}

/** Days covered by active ranges up to and including date d, within a plan's window. */
function coveredDaysUpTo(plan, active, d) {
    return countUniqueDays(active, plan.fs, d);
}

/* ─── Three-level margin fallback ──────────────────────────────────────────── */

/**
 * Resolve margin_percent with explicit fallback: child → parent → plan.
 * `parent` may be null when checking container vs LI directly.
 * Intermediate levels carry `margin_percent`; LI carries `mTgt`.
 * `0` is a valid override (means no margin); only `null`/empty triggers inheritance.
 */
function effMargin(child, parent, plan) {
    if (child && child.margin_percent != null && child.margin_percent !== '') {
        return Number(child.margin_percent);
    }
    if (parent && parent.margin_percent != null && parent.margin_percent !== '') {
        return Number(parent.margin_percent);
    }
    if (plan && plan.mTgt != null && plan.mTgt !== '') {
        return Number(plan.mTgt);
    }
    return 0;
}

/* ─── Per-row margin resolution (coefficient cost mode, spec 2026-07-15) ───── */

/**
 * Precompute the per-LI margin lookup used by resolveRowMargin.
 * Precedence: dim_child > date_child > container > LI mTgt.
 * Only margin-CARRYING nodes participate (margin_percent != null && !== '').
 * Intra-level ties: declaration order, first match wins (containers in config
 * order; dim_children in their array order). Date compare: inclusive YYYY-MM-DD.
 * NOTE: array order IS the tie-break — any future config migration rebuilding
 * line_items via jsonb_array_elements must keep WITH ORDINALITY ordering, or
 * resolved margins silently change (spec §3.0).
 */
function buildMarginIndex(plan) {
    var idx = { dim: [], dateCh: [], cont: [], mTgt: (plan && plan.mTgt != null && plan.mTgt !== '') ? Number(plan.mTgt) : 0 };
    var containers = (plan && Array.isArray(plan.containers)) ? plan.containers : [];
    for (var i = 0; i < containers.length; i++) {
        var c = containers[i];
        if (!c || !c.fs || !c.fe) continue;
        // Container-existence canon (parseContainers): a container exists only with
        // target_impressions > 0 — a non-existent container carries no margin scope.
        if (!(Number(c.target_impressions) > 0)) continue;
        if (c.margin_percent != null && c.margin_percent !== '') {
            idx.cont.push({ fs: c.fs, fe: c.fe, m: Number(c.margin_percent) });
        }
        var dcs = Array.isArray(c.date_children) ? c.date_children : [];
        for (var j = 0; j < dcs.length; j++) {
            var d = dcs[j];
            if (!d || !d.fs || !d.fe) continue;
            if (d.margin_percent != null && d.margin_percent !== '') {
                idx.dateCh.push({ fs: d.fs, fe: d.fe, m: Number(d.margin_percent) });
            }
        }
        var dxs = Array.isArray(c.dim_children) ? c.dim_children : [];
        for (var k = 0; k < dxs.length; k++) {
            var x = dxs[k];
            if (!x || !x.dim_key || x.dim_value == null) continue;
            if (x.margin_percent != null && x.margin_percent !== '') {
                idx.dim.push({ fs: c.fs, fe: c.fe, key: x.dim_key, val: String(x.dim_value).trim(), m: Number(x.margin_percent) });
            }
        }
    }
    return idx;
}

/** Resolve the effective coefficient margin (%) for one fact row. */
function resolveRowMargin(idx, row) {
    var d = String((row && row.date) || '');
    var i, e, v;
    for (i = 0; i < idx.dim.length; i++) {
        e = idx.dim[i];
        if (d >= e.fs && d <= e.fe) {
            v = row[e.key];
            if (v != null && String(v).trim() === e.val) return e.m;
        }
    }
    for (i = 0; i < idx.dateCh.length; i++) { e = idx.dateCh[i]; if (d >= e.fs && d <= e.fe) return e.m; }
    for (i = 0; i < idx.cont.length; i++)   { e = idx.cont[i];   if (d >= e.fs && d <= e.fe) return e.m; }
    return idx.mTgt;
}

/** Coefficient client cost (USD) for one fact row: spend/(1 - m/100), computed
 *  as spend*100/(100-m) — algebraically identical, avoids an IEEE-754 rounding
 *  step (1 - m/100) that otherwise drifts off exact fractions like m=70.
 *  spend is already USD (never currency-converted). m >= 100 / non-finite -> 0 (canon). */
function coefDcForRow(idx, row) {
    var m = resolveRowMargin(idx, row);
    if (!isFinite(m) || m >= 100) return 0;
    var sp = Number(row && row.spend) || 0;
    return sp * 100 / (100 - m);
}

/** Net cost mode (spec 2026-09-07 §3): net client cost = gross × k, k = net/gross
 *  per line item. Identity for an absent / 1 / out-of-range k — a pacing without
 *  the mode is byte-identical. The caller passes a USD figure (currency already
 *  applied): callers apply currency first, then net. */
function netDc(usd, k) {
    var n = Number(usd) || 0;
    var r = Number(k);
    if (!isFinite(r) || r <= 0 || r >= 1) return n;
    return n * r;
}

/** Validate the coefficient contract on one WIRE line_item (spec §2.1).
 *  Returns [] when valid. Overlap is checked WITHIN each level, globally across
 *  containers (cross-LEVEL nesting is legal — precedence resolves it). */
function validateCoefLi(li) {
    var errors = [];
    if (!li) return errors;
    if (li.cost_coef !== undefined && typeof li.cost_coef !== 'boolean') {
        errors.push({ code: 'coef_not_boolean' });
        return errors;
    }
    if (li.cost_coef !== true) return errors;
    function checkRange(v, where) {
        if (v == null || v === '') return;                      // inherit — fine
        var n = Number(v);
        if (!isFinite(n) || n < 0 || n >= 100) errors.push({ code: 'coef_margin_range', where: where, value: v });
    }
    checkRange(li.margin_percent, 'li');
    var contRanges = [], dateRanges = [];
    var cs = Array.isArray(li.containers) ? li.containers : [];
    for (var i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (!c) continue;
        // Container-existence canon (parseContainers): a non-existent container
        // (no target_impressions > 0) and its children participate in NEITHER ranges
        // NOR range-checks — the whole node is skipped, consistent with the resolver.
        if (!(Number(c.target_impressions) > 0)) continue;
        checkRange(c.margin_percent, 'container:' + (c.name || c.id || i));
        if (c.margin_percent != null && c.margin_percent !== '' && c.fs && c.fe) {
            contRanges.push({ fs: c.fs, fe: c.fe, label: 'container:' + (c.name || c.id || i) });
        }
        var dcs = Array.isArray(c.date_children) ? c.date_children : [];
        for (var j = 0; j < dcs.length; j++) {
            var d = dcs[j];
            if (!d) continue;
            checkRange(d.margin_percent, 'date_child:' + (d.name || d.id || j));
            if (d.margin_percent != null && d.margin_percent !== '' && d.fs && d.fe) {
                dateRanges.push({ fs: d.fs, fe: d.fe, label: 'date_child:' + (d.name || d.id || j) });
            }
        }
        var dxs = Array.isArray(c.dim_children) ? c.dim_children : [];
        for (var k = 0; k < dxs.length; k++) {
            if (dxs[k]) checkRange(dxs[k].margin_percent, 'dim_child:' + (dxs[k].dim_value || k));
        }
    }
    function overlapScan(list) {
        list.sort(function (a, b) { return a.fs < b.fs ? -1 : a.fs > b.fs ? 1 : 0; });
        for (var r = 1; r < list.length; r++) {
            if (list[r].fs <= list[r - 1].fe) {
                errors.push({ code: 'coef_margin_overlap', a: list[r - 1].label, b: list[r].label });
            }
        }
    }
    overlapScan(contRanges);
    overlapScan(dateRanges);
    return errors;
}

/* ─── Container helpers ────────────────────────────────────────────────────── */

/** Effective spend cap (client-side) of a container.
 *  Falls back to a budget-share of the parent LI when target_spend is unset. */
function containerSpendEff(container, plan) {
    var ts = container.target_spend != null && container.target_spend !== ''
                ? Number(container.target_spend) : 0;
    if (ts > 0) return ts;
    var ti = Number(container.target_impressions) || 0;
    if (plan.planImpr > 0 && ti > 0) {
        return plan.budget * ti / plan.planImpr;
    }
    return 0;
}

/** Resolve a dim-child's absolute impressions target (percent → absolute). */
function resolveDimAbs(child, container) {
    var v = Number(child.target_value) || 0;
    if (child.target_mode === 'percent') {
        return (Number(container.target_impressions) || 0) * v / 100;
    }
    return v;
}

/* ─── Container dim scope (2026-08-14) ─────────────────────────────────────────
 * Dim splits say WHAT the container is, date splits say WHEN. When a dim KEY's
 * declared targets cover the container (>= 99.5% of target_impressions), the
 * container is not a carve-out of the delivery but a statement about all of it:
 * "these units are Kilgore". From that point its facts — its own and its date
 * children's — count only rows carrying a declared value.
 *
 * Untagged rows stay in. A row with an EMPTY value on a covering key is a
 * declared unit whose tag was never filled; cutting it would contradict the very
 * statement that turned the filter on. Only a different NON-EMPTY value is cut.
 *
 * Partial coverage changes nothing — that container really is a carve-out.
 * Spec: docs/superpowers/specs/2026-08-14-container-dim-scope.md
 */
var DIM_COVER_RATIO = 0.995;   // 33.33% x3 must still count as covering

/** Declared values per dim_key for one container: { [dim_key]: string[] }.
 *  Includes every positive-target dim child, covering or not. */
function containerDimValues(container) {
    var out = {};
    var children = (container && Array.isArray(container.dim_children)) ? container.dim_children : [];
    for (var i = 0; i < children.length; i++) {
        var ch = children[i];
        if (!ch || ch.dim_key == null || ch.dim_value == null) continue;
        if (!(resolveDimAbs(ch, container) > 0)) continue;
        var v = String(ch.dim_value).trim();
        if (!v) continue;
        if (!out[ch.dim_key]) out[ch.dim_key] = [];
        if (out[ch.dim_key].indexOf(v) < 0) out[ch.dim_key].push(v);
    }
    return out;
}

/** The container's fact filter, or null when no dim key covers it.
 *  @returns {null | { [dim_key]: string[] }} — AND across keys, OR within a key. */
function containerDimFilter(container) {
    var ti = Number(container && container.target_impressions) || 0;
    if (!(ti > 0)) return null;
    var children = (container && Array.isArray(container.dim_children)) ? container.dim_children : [];
    if (!children.length) return null;
    var sums = {};
    for (var i = 0; i < children.length; i++) {
        var ch = children[i];
        if (!ch || ch.dim_key == null || ch.dim_value == null) continue;
        var abs = resolveDimAbs(ch, container);
        if (!(abs > 0)) continue;
        sums[ch.dim_key] = (sums[ch.dim_key] || 0) + abs;
    }
    var declared = containerDimValues(container);
    var filter = null;
    for (var k in sums) {
        if (!Object.prototype.hasOwnProperty.call(sums, k)) continue;
        if (sums[k] < DIM_COVER_RATIO * ti) continue;      // carve-out, not a scope
        if (!declared[k] || !declared[k].length) continue;
        if (!filter) filter = {};
        filter[k] = declared[k];
    }
    return filter;
}

/** A fact row's value on one dim. '' / '-' / missing all read as untagged. */
function factDimValue(row, dimKey) {
    var raw = (row && row[dimKey] != null) ? String(row[dimKey]).trim() : '';
    return (raw && raw !== '-') ? raw : '';
}

/** Does one fact row belong to a container carrying `filter`?
 *  null filter → everything belongs (the no-scope path). */
function factMatchesDimFilter(row, filter) {
    if (!filter) return true;
    for (var k in filter) {
        if (!Object.prototype.hasOwnProperty.call(filter, k)) continue;
        var v = factDimValue(row, k);
        if (v === '') continue;                            // untagged stays in
        var vals = filter[k];
        var hit = false;
        for (var i = 0; i < vals.length; i++) { if (vals[i] === v) { hit = true; break; } }
        if (!hit) return false;
    }
    return true;
}

/**
 * Per-LI index for the Outside-splits bucket. Built ONCE per plan, then queried
 * per fact row (the row test runs over every fact of the line item).
 *   entries[i] = { fs, fe, filter, declared }  — one per container with dates.
 * `any` is false when the LI has no covering container at all; callers use it to
 * skip the whole bucket without walking facts.
 */
function buildDimScopeIndex(plan) {
    var entries = [];
    var any = false;
    var cs = (plan && Array.isArray(plan.containers)) ? plan.containers : [];
    for (var i = 0; i < cs.length; i++) {
        var c = cs[i];
        if (!c || !c.fs || !c.fe) continue;
        var filter = containerDimFilter(c);
        if (filter) any = true;
        entries.push({ fs: c.fs, fe: c.fe, filter: filter, declared: containerDimValues(c) });
    }
    return { entries: entries, any: any };
}

/**
 * Is this fact row OUTSIDE the splits of its line item, on dim `dimKey`?
 * Spec §4.1 — all three must hold:
 *   1. the row's date sits inside at least one COVERING container on that dim;
 *   2. the row carries a non-empty value;
 *   3. no container of the LI containing that date declares the value — covering
 *      or not, so a value the operator did split elsewhere on the same day is
 *      NOT outside (Calvert's `English` sits in a non-covering container).
 */
function factOutsideSplits(idx, dimKey, row) {
    if (!idx || !idx.any || !dimKey) return false;
    var v = factDimValue(row, dimKey);
    if (v === '') return false;
    var d = String((row && row.date) || '');
    if (!d) return false;
    var covered = false;
    for (var i = 0; i < idx.entries.length; i++) {
        var e = idx.entries[i];
        if (d < e.fs || d > e.fe) continue;
        var declared = e.declared[dimKey];
        if (declared) {
            for (var j = 0; j < declared.length; j++) { if (declared[j] === v) return false; }
        }
        if (e.filter && e.filter[dimKey]) covered = true;
    }
    return covered;
}

/**
 * Parse date_children of a container. Container-scope analogue of LI-level parser.
 * Filters out children missing fs/fe or with target_impressions ≤ 0.
 * @returns {{ active: Array, remImpr: number, remCost: number, remDays: number }}
 */
function parseDateChildren(container, plan) {
    var children = container.date_children || [];
    var ts = containerSpendEff(container, plan);
    var cM = effMargin(container, null, plan);
    var cCost = ts * (1 - cM / 100);
    var fd = Math.max(1, daysBetween(container.fs, container.fe));
    var cTi = Number(container.target_impressions) || 0;
    var sumTi = 0, sumCost = 0;
    var active = [];
    for (var i = 0; i < children.length; i++) {
        var ch = children[i];
        var fs = ch.fs, fe = ch.fe;
        var ti = ch.target_impressions ? Number(ch.target_impressions) : 0;
        var tsCh = ch.target_spend != null && ch.target_spend !== '' ? Number(ch.target_spend) : 0;
        if (!fs || !fe || ti <= 0) continue;
        // Mirror parseContainers: a child with NO overlap participates in nothing
        // — not in the pool, not in coverage. Without this the clip below runs
        // cEff (= child fe) below cStart (= container fs) and the child's term
        // goes NEGATIVE. Same rule the LI level pins via container-fully-before-li.
        if (!rangeOverlap(fs, fe, container.fs, container.fe)) continue;
        var chM = effMargin(ch, container, plan);
        var cost = tsCh > 0
            ? tsCh * (1 - chM / 100)
            : (cTi > 0 ? (ti / cTi) * cCost : 0);
        // A child straddling the container window books its FULL target into the
        // pool while the loops below credit only its in-window days — so expected
        // legitimately tops out BELOW the container target; the outside share is
        // NOT re-spread over the uncovered days. Same rule one level up (container
        // hanging outside the LI flight), pinned by fixture container-overflow-li-7d.
        sumTi += ti;
        sumCost += cost;
        active.push({ fs: fs, fe: fe, ti: ti, cost: cost, fd: Math.max(1, daysBetween(fs, fe)) });
    }
    var coveredDays = countUniqueDays(active, container.fs, container.fe);
    return {
        active: active,
        remImpr: Math.max(0, cTi - sumTi),
        remCost: Math.max(0, cCost - sumCost),
        remDays: Math.max(0, fd - coveredDays)
    };
}

/** Expected impressions inside one container, at date d. */
function containerExpUnits(container, plan, d) {
    if (d < container.fs) return 0;
    var eff = d > container.fe ? container.fe : d;
    var dp = daysBetween(container.fs, eff);
    var ps = parseDateChildren(container, plan);
    var covUp = countUniqueDays(ps.active, container.fs, eff);
    var uncovUp = Math.max(0, dp - covUp);
    var total = ps.remDays > 0 ? ps.remImpr * (uncovUp / ps.remDays) : 0;
    for (var i = 0; i < ps.active.length; i++) {
        var c = ps.active[i];
        // Credit only the child's days that fall INSIDE the container. Coverage
        // (countUniqueDays above) is already clipped to container.fs; crediting
        // the child from its own fs double-counted days the container never had,
        // so the two disagreed for a child that pokes outside its parent (a state
        // nothing validates). No-op when the child sits inside — cStart === c.fs.
        var cStart = c.fs < container.fs ? container.fs : c.fs;
        if (eff < cStart) continue;
        var cEff = eff > c.fe ? c.fe : eff;
        total += c.ti * (daysBetween(cStart, cEff) / c.fd);
    }
    return total;
}

/** Expected cost (DSP) inside one container, at date d. */
function containerExpCost(container, plan, d) {
    if (d < container.fs) return 0;
    var eff = d > container.fe ? container.fe : d;
    var dp = daysBetween(container.fs, eff);
    var ps = parseDateChildren(container, plan);
    var covUp = countUniqueDays(ps.active, container.fs, eff);
    var uncovUp = Math.max(0, dp - covUp);
    var total = ps.remDays > 0 ? ps.remCost * (uncovUp / ps.remDays) : 0;
    for (var i = 0; i < ps.active.length; i++) {
        var c = ps.active[i];
        // Same clip as containerExpUnits — units and cost must agree on which
        // days of an out-of-bounds child belong to this container.
        var cStart = c.fs < container.fs ? container.fs : c.fs;
        if (eff < cStart) continue;
        var cEff = eff > c.fe ? c.fe : eff;
        total += c.cost * (daysBetween(cStart, cEff) / c.fd);
    }
    return total;
}

/** Expected units for a dim-child as of date d (rate-native — resolveDimAbs
 *  inherits the planImpr native-unit convention). Linear, ignores date_children. */
function dimChildExpUnits(child, container, d) {
    if (d < container.fs) return 0;
    var eff = d > container.fe ? container.fe : d;
    var fd = Math.max(1, daysBetween(container.fs, container.fe));
    var dp = daysBetween(container.fs, eff);
    return resolveDimAbs(child, container) * (dp / fd);
}

/**
 * Sum rate-native actual units for a dim-child across the container's window
 * up to asOf. `lsd` is the workspace per-LI split-daily aggregate:
 *   lsd['<dim_key>:<dim_value>'][date] = { im, cl, co, sp, dc }
 * `rateType` is the parent LI's rate type (CPM→im, CPC→cl, CPV→co). Dim
 * targets resolve off container.target_impressions, which is native-unit by
 * the planImpr convention — actuals must sum the same unit, otherwise a CPC
 * dim split compares a clicks target against an impressions actual.
 */
function dimChildActualUnits(child, container, asOf, lsd, rateType) {
    if (!lsd) return 0;
    var key = child.dim_key + ':' + child.dim_value;
    var bucket = lsd[key];
    if (!bucket) return 0;
    var f = rateType === 'CPC' ? 'cl' : rateType === 'CPV' ? 'co' : 'im';
    var cap = asOf > container.fe ? container.fe : asOf;
    var sum = 0;
    for (var d in bucket) {
        if (!Object.prototype.hasOwnProperty.call(bucket, d)) continue;
        if (d < container.fs || d > cap) continue;
        sum += Number(bucket[d][f]) || 0;
    }
    return sum;
}

/** Pacing index on the dim-axis, in the parent LI's rate-native unit. */
function dimChildPacingIndex(child, container, asOf, lsd, rateType) {
    var exp = dimChildExpUnits(child, container, asOf);
    var act = dimChildActualUnits(child, container, asOf, lsd, rateType);
    return pacingIndex(act, exp, resolveDimAbs(child, container));
}

/**
 * Parse containers of a plan. LI-scope parser.
 * Containers may overlap each other (Set-based coveredDays handles union).
 * Containers extending beyond plan.fs..plan.fe are clipped via rangeOverlap.
 */
function parseContainers(plan) {
    var containers = plan.containers || [];
    var fd = Math.max(1, daysBetween(plan.fs, plan.fe));
    var liCost = plan.budget * (1 - (plan.mTgt || 0) / 100);
    var sumTi = 0, sumCost = 0;
    var active = [];
    for (var i = 0; i < containers.length; i++) {
        var c = containers[i];
        var ti = c.target_impressions ? Number(c.target_impressions) : 0;
        if (!c.fs || !c.fe || ti <= 0) continue;
        var ov = rangeOverlap(c.fs, c.fe, plan.fs, plan.fe);
        if (!ov) continue;
        var fdC = Math.max(1, daysBetween(c.fs, c.fe));
        var cM = effMargin(c, null, plan);
        var cSpend = containerSpendEff(c, plan);
        var cost = cSpend * (1 - cM / 100);
        sumTi += ti;
        sumCost += cost;
        active.push({ fs: c.fs, fe: c.fe, ti: ti, cost: cost, fd: fdC, container: c });
    }
    var coveredDays = countUniqueDays(active, plan.fs, plan.fe);
    return {
        active: active,
        remImpr: Math.max(0, plan.planImpr - sumTi),
        remCost: Math.max(0, liCost - sumCost),
        remDays: Math.max(0, fd - coveredDays)
    };
}

/**
 * Find the active container for container-scope view.
 * - If range given: pick container with largest overlap.
 * - Else: pick container whose fs..fe contains asOf (newer wins on tie).
 */
function findActiveContainer(plan, asOf, range) {
    var containers = plan.containers || [];
    var temps = [];
    for (var i = 0; i < containers.length; i++) {
        var c = containers[i];
        if (c && c.fs && c.fe && Number(c.target_impressions) > 0) temps.push(c);
    }
    if (temps.length === 0) return null;

    if (range) {
        var best = null, bestDays = 0;
        for (var j = 0; j < temps.length; j++) {
            var ov = rangeOverlap(range.from, range.to, temps[j].fs, temps[j].fe);
            if (ov) {
                var d = daysBetween(ov.start, ov.end);
                if (d > bestDays) { bestDays = d; best = temps[j]; }
            }
        }
        return best;
    }

    if (!asOf) return null;
    var candidates = [];
    for (var k = 0; k < temps.length; k++) {
        if (asOf >= temps[k].fs && asOf <= temps[k].fe) candidates.push(temps[k]);
    }
    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) { return b.fs.localeCompare(a.fs); });
    return candidates[0];
}

/**
 * Build a virtual plan that scopes the dashboard to one container.
 * The virtual plan keeps containers=[container] so containerExpUnits is still
 * exercised inside it (date-children honoured). parseContainers on the virtual
 * plan returns active=[container] with remImpr=0 because virtualPlan.planImpr
 * equals container.target_impressions — no double counting.
 */
function buildVirtualPlanFromContainer(plan, container) {
    return {
        id: plan.id,
        ch: plan.ch,
        dsp: plan.dsp || null,
        rateType: plan.rateType || 'CPM',
        fs: container.fs,
        fe: container.fe,
        budget: containerSpendEff(container, plan),
        planImpr: Number(container.target_impressions) || 0,
        mTgt: container.margin_percent != null && container.margin_percent !== ''
                ? Number(container.margin_percent) : plan.mTgt,
        ctrTgt: plan.ctrTgt,
        vcrTgt: plan.vcrTgt,
        period_scope: false,
        containers: [container],
        pause_intervals: Array.isArray(plan.pause_intervals) ? plan.pause_intervals : [],
        _scopedFromContainer: container.id || null
    };
}

/* ─── Period scope (date_child-aware) ──────────────────────────────────────────
 * Canonical period resolution shared by dashboard, dash-gate health, and n8n.
 * A "period" is one fs..fe window across LIs, sourced from date_children
 * (PRIMARY) or standalone sub-flight containers (SECONDARY). The full-flight
 * "Initial" container is never a period. Mirrors the workspace periods.js /
 * config.js logic exactly so every surface scopes to the same numbers.
 */

function periodKeyOf(period) {
    return period.fs + '|' + period.fe;
}

function isFullFlightContainer_(c, li) {
    return c.fs === li.fs && c.fe === li.fe;
}

function addPeriod_(byKey, fs, fe, ti, label) {
    var key = fs + '|' + fe;
    var existing = byKey[key];
    if (existing) {
        existing.targetImpressions += ti;
        if (existing.label && label && existing.label !== label) {
            existing._nameConflict = true;
        } else if (!existing.label && label) {
            existing.label = label;
        }
        return;
    }
    byKey[key] = { fs: fs, fe: fe, targetImpressions: ti, label: label || '', _nameConflict: false };
}

/** Extract the distinct period windows from an liPlan map. */
function extractPeriods(liPlan) {
    if (!liPlan) return [];
    var byKey = {};
    for (var id in liPlan) {
        if (!Object.prototype.hasOwnProperty.call(liPlan, id)) continue;
        var li = liPlan[id];
        if (!li) continue;
        var containers = Array.isArray(li.containers) ? li.containers : [];
        for (var i = 0; i < containers.length; i++) {
            var c = containers[i];
            if (!c || !c.fs || !c.fe) continue;
            var dateChildren = Array.isArray(c.date_children) ? c.date_children : [];
            var anyChildAdded = false;
            for (var j = 0; j < dateChildren.length; j++) {
                var dc = dateChildren[j];
                if (!dc || !dc.fs || !dc.fe) continue;
                var ti = Number(dc.target_impressions) || 0;
                if (ti <= 0) continue;
                addPeriod_(byKey, dc.fs, dc.fe, ti, dc.name || '');
                anyChildAdded = true;
            }
            if (!anyChildAdded && dateChildren.length === 0) {
                if (isFullFlightContainer_(c, li)) continue;
                var cti = Number(c.target_impressions) || 0;
                if (cti <= 0) continue;
                addPeriod_(byKey, c.fs, c.fe, cti, c.name || '');
            }
        }
    }
    var periods = [];
    for (var k in byKey) {
        if (Object.prototype.hasOwnProperty.call(byKey, k)) periods.push(byKey[k]);
    }
    periods.sort(function (a, b) { return a.fs < b.fs ? -1 : a.fs > b.fs ? 1 : 0; });
    for (var m = 0; m < periods.length; m++) {
        var p = periods[m];
        if (p._nameConflict || !p.label) { p.label = p.fs + ' – ' + p.fe; }
        delete p._nameConflict;
    }
    return periods;
}

/** Period whose [fs,fe] contains asOf; newer fs wins on overlap. null if none. */
function findPeriodForAsOf(periods, asOf) {
    if (!asOf || !periods || !periods.length) return null;
    var candidates = [];
    for (var i = 0; i < periods.length; i++) {
        if (asOf >= periods[i].fs && asOf <= periods[i].fe) candidates.push(periods[i]);
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return a.fs < b.fs ? 1 : a.fs > b.fs ? -1 : 0; });
    return candidates[0];
}

/** Virtual plan scoped to one date_child (temporal sub-period). */
function buildVirtualPlanFromDateChild(plan, child, container) {
    var ti = Number(child.target_impressions) || 0;
    var liImpr = Number(plan.planImpr) || 0;
    var share = liImpr > 0 ? ti / liImpr : 0;
    var childM;
    if (child.margin_percent != null && child.margin_percent !== '') {
        childM = Number(child.margin_percent);
    } else if (container && container.margin_percent != null && container.margin_percent !== '') {
        childM = Number(container.margin_percent);
    } else {
        childM = plan.mTgt;
    }
    return {
        id: plan.id,
        ch: plan.ch,
        dsp: plan.dsp || null,
        rateType: plan.rateType || 'CPM',
        fs: child.fs,
        fe: child.fe,
        budget: plan.budget * share,
        planImpr: ti,
        mTgt: childM,
        ctrTgt: plan.ctrTgt,
        vcrTgt: plan.vcrTgt,
        labels: plan.labels || [],
        containers: [],
        pause_intervals: Array.isArray(plan.pause_intervals) ? plan.pause_intervals : [],
        period_scope: false,
        _scopedFromChild: child.id || null
    };
}

/**
 * Per-LI virtual plan scoped to period `fs|fe`:
 *   1. matching date_child   → buildVirtualPlanFromDateChild  (PRIMARY)
 *   2. matching standalone non-full-flight container → buildVirtualPlanFromContainer (SECONDARY)
 *   3. else null (caller falls back to the raw LI plan)
 */
function buildScopedPlanForPeriodKey(plan, periodKey) {
    if (!plan || !periodKey) return null;
    var parts = periodKey.split('|');
    var pfs = parts[0], pfe = parts[1];
    var containers = Array.isArray(plan.containers) ? plan.containers : [];
    var i, c;
    for (i = 0; i < containers.length; i++) {
        c = containers[i];
        var dc = Array.isArray(c.date_children) ? c.date_children : [];
        for (var j = 0; j < dc.length; j++) {
            var child = dc[j];
            if (!child || !child.fs || !child.fe) continue;
            if (Number(child.target_impressions) <= 0) continue;
            if (child.fs === pfs && child.fe === pfe) {
                return buildVirtualPlanFromDateChild(plan, child, c);
            }
        }
    }
    for (i = 0; i < containers.length; i++) {
        c = containers[i];
        if (!c || !c.fs || !c.fe || Number(c.target_impressions) <= 0) continue;
        var hasChildren = Array.isArray(c.date_children) && c.date_children.length > 0;
        if (hasChildren) continue;
        if (c.fs === plan.fs && c.fe === plan.fe) continue;
        if (c.fs === pfs && c.fe === pfe) {
            return buildVirtualPlanFromContainer(plan, c);
        }
    }
    return null;
}

/**
 * Resolve which period a pacing is scoped to, plus its state. Shared rule for
 * dashboard / health / n8n. No auto-advance: a valid saved key is honored even
 * when out of the data window; a stale key heals to the current/last period
 * (healed=true).
 *
 * State is direction-aware so each surface can say "ended" vs "not started yet"
 * rather than a generic "out of period":
 *   'in_period' — asOf inside [fs,fe]
 *   'ended'     — asOf after fe (the period is in the past)
 *   'upcoming'  — asOf before fs, or no data yet (the period is in the future)
 *   'no_period' — scope on but the pacing yields no periods
 * @returns {{key:string|null, period:object|null, state:'in_period'|'ended'|'upcoming'|'no_period', healed:boolean}}
 */
function resolvePeriodKey(liPlan, asOf, savedKey) {
    var periods = extractPeriods(liPlan);
    if (!periods.length) {
        return { key: null, period: null, state: 'no_period', healed: false };
    }
    var chosen = null, healed = false, i;
    if (savedKey) {
        for (i = 0; i < periods.length; i++) {
            if (periodKeyOf(periods[i]) === savedKey) { chosen = periods[i]; break; }
        }
        if (!chosen) healed = true;
    }
    if (!chosen) {
        chosen = findPeriodForAsOf(periods, asOf);
        if (!chosen) {
            // No period contains asOf. Prefer the latest period that has STARTED
            // (current-or-last-active, or the one just before a gap); only when
            // none has started (every period is still in the future) fall back to
            // the EARLIEST upcoming — never the furthest-future one.
            var latest = null;
            for (i = 0; i < periods.length; i++) {
                if (asOf && periods[i].fs <= asOf) latest = periods[i];
            }
            chosen = latest || periods[0];
        }
    }
    var st;
    if (asOf && asOf >= chosen.fs && asOf <= chosen.fe) st = 'in_period';
    else if (asOf && asOf > chosen.fe) st = 'ended';
    else st = 'upcoming';
    return {
        key: periodKeyOf(chosen),
        period: chosen,
        state: st,
        healed: healed
    };
}

/* ─── Expected delivery ────────────────────────────────────────────────────── */

/**
 * Expected units as of date d. Container-only path.
 * Empty `plan.containers` reduces to flat LI proration.
 */
function liExpUnitsRaw(plan, d) {
    if (d < plan.fs) return 0;
    var eff = d > plan.fe ? plan.fe : d;
    var dp = daysBetween(plan.fs, eff);
    var ps = parseContainers(plan);
    var covUp = countUniqueDays(ps.active, plan.fs, eff);
    var uncovUp = Math.max(0, dp - covUp);
    var total = ps.remDays > 0 ? ps.remImpr * (uncovUp / ps.remDays) : 0;
    for (var i = 0; i < ps.active.length; i++) {
        var c = ps.active[i];
        if (eff < c.fs) continue;
        var cEff = eff > c.fe ? c.fe : eff;
        // Same clip as containerExpUnits, one level up: coverage above is clipped
        // to plan.fs, so a container starting BEFORE the LI must not credit its
        // pre-flight days here. Its contribution is a nested computation (own
        // children + remainder spread), not a closed-form span, so the exact
        // in-flight part is the cumulative difference — containerExpUnits is
        // monotonic. No-op when the container starts inside the flight.
        total += containerExpUnits(c.container, plan, cEff);
        if (c.fs < plan.fs) total -= containerExpUnits(c.container, plan, datePrev(plan.fs));
    }
    return total;
}

function liExpCostRaw(plan, d) {
    if (d < plan.fs) return 0;
    var eff = d > plan.fe ? plan.fe : d;
    var dp = daysBetween(plan.fs, eff);
    var ps = parseContainers(plan);
    var covUp = countUniqueDays(ps.active, plan.fs, eff);
    var uncovUp = Math.max(0, dp - covUp);
    var total = ps.remDays > 0 ? ps.remCost * (uncovUp / ps.remDays) : 0;
    for (var i = 0; i < ps.active.length; i++) {
        var c = ps.active[i];
        if (eff < c.fs) continue;
        var cEff = eff > c.fe ? c.fe : eff;
        // Same pre-flight clip as liExpUnitsRaw — units and cost must agree on
        // which days of an out-of-flight container belong to this LI.
        total += containerExpCost(c.container, plan, cEff);
        if (c.fs < plan.fs) total -= containerExpCost(c.container, plan, datePrev(plan.fs));
    }
    return total;
}

/* ─── Pause-aware expected (subtract the expected that fell in paused windows) ─
 * Non-overlapping pause_intervals clipped at asOf (open interval → to = d).
 * Cumulative liExp*Raw is monotonic, so E(b)−E(datePrev(a)) is exactly the
 * expected accrued in [a,b]. Empty/absent intervals → returns raw (no-op). */
function pausedExpSubtract(plan, d, rawFn) {
    var base = rawFn(plan, d);
    var iv = plan.pause_intervals;
    if (!iv || !iv.length || !plan.fs) return base;
    var sub = 0;
    for (var i = 0; i < iv.length; i++) {
        var a = iv[i] && iv[i].from;
        if (!isYmd(a) || a > d) continue;                 // skip malformed / future starts
        var b = isYmd(iv[i].to) ? iv[i].to : d;           // open or malformed `to` → clip at asOf
        var bb = b < d ? b : d;
        if (bb < a) continue;
        sub += rawFn(plan, bb) - rawFn(plan, datePrev(a));
    }
    var v = base - sub;
    return v > 0 ? v : 0;
}
function liExpUnits(plan, d) { return pausedExpSubtract(plan, d, liExpUnitsRaw); }
function liExpCost(plan, d)  { return pausedExpSubtract(plan, d, liExpCostRaw); }

/* Shared paused-window subtractor: rawFn(d) → cumulative raw value at date d;
 * returns that value with paused-window contributions removed (same model as
 * the LI freeze). Malformed-date safe: skips bad `from`, treats malformed `to`
 * as open. NEW — does NOT alter the existing pausedExpSubtract. */
function subtractPaused(rawFn, asOf, iv) {
    var base = rawFn(asOf);
    if (!iv || !iv.length) return base;
    var sub = 0;
    for (var i = 0; i < iv.length; i++) {
        var a = iv[i] && iv[i].from;
        if (!isYmd(a) || a > asOf) continue;
        var b = isYmd(iv[i].to) ? iv[i].to : asOf;
        var bb = b < asOf ? b : asOf;
        if (bb < a) continue;
        sub += rawFn(bb) - rawFn(datePrev(a));
    }
    var v = base - sub;
    return v > 0 ? v : 0;
}
/* Live time-progress of a window [fs,fe] as of asOf, EXCLUDING paused days.
 * For split rows that prorate a target linearly: expected = target × progress. */
function pausedTimeProgress(fs, fe, asOf, iv) {
    if (!fs || !fe || !asOf) return 0;
    var fd = Math.max(1, daysBetween(fs, fe));
    function rawFrac(d) {
        if (d < fs) return 0;
        var eff = d > fe ? fe : d;
        return daysBetween(fs, eff) / fd;
    }
    return subtractPaused(rawFrac, asOf, iv);
}

/** Expected clicks: CPC uses liExpUnits directly; others use CTR target. */
function liExpClicks(plan, d) {
    if (plan.rateType === 'CPC') return liExpUnits(plan, d);
    var eI = liExpUnits(plan, d);
    return plan.ctrTgt > 0 ? eI * plan.ctrTgt / 100 : 0;
}

/* ─── Proration ────────────────────────────────────────────────────────────── */

function prorate(plan, asOf) {
    // fDays is calendar-only — report it even with no facts, so "days left"
    // reads the full flight instead of 0 ("Flight ended" on a fresh pacing).
    var fd = Math.max(1, daysBetween(plan.fs, plan.fe));
    if (!asOf) return { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'no_data' };
    if (asOf < plan.fs) return { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'not_started' };
    var eff = asOf > plan.fe ? plan.fe : asOf;
    var dp = daysBetween(plan.fs, eff);
    var tp = dp / fd;
    var eI = liExpUnits(plan, asOf);
    var costPr = liExpCost(plan, asOf);
    return { costPr: costPr, tp: tp, eI: eI, fDays: fd, dP: dp, st: asOf > plan.fe ? 'ended' : 'active' };
}

function prorateRange(plan, range, asOf) {
    var fd = Math.max(1, daysBetween(plan.fs, plan.fe));
    if (!range) return prorate(plan, asOf);
    var ovlp = rangeOverlap(range.from, range.to, plan.fs, plan.fe);
    if (!ovlp) return { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'no_overlap' };
    // Expected NEVER runs ahead of asOf: a window that extends into the
    // future (the Flight preset pre-start, any range past the data edge)
    // counts expected only through asOf. Without this clamp a not-yet-started
    // campaign read "Plan 100% · −100 pp · Shortfall · Flight ended"
    // (2026-07-11). Ranges ending at/before asOf are byte-identical to before.
    if (!asOf) return { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'no_data' };
    if (asOf < ovlp.start) return { costPr: 0, tp: 0, eI: 0, fDays: fd, dP: 0, st: 'not_started' };
    var expThrough = asOf < ovlp.end ? asOf : ovlp.end;
    var expEnd = liExpUnits(plan, expThrough);
    var expBefore = ovlp.start > plan.fs ? liExpUnits(plan, datePrev(ovlp.start)) : 0;
    var eI = expEnd - expBefore;
    var costEnd = liExpCost(plan, expThrough);
    var costBefore = ovlp.start > plan.fs ? liExpCost(plan, datePrev(ovlp.start)) : 0;
    var costPr = costEnd - costBefore;
    var dP = daysBetween(plan.fs, expThrough);
    return { costPr: costPr, tp: dP / fd, eI: eI, fDays: fd, dP: dP, st: 'active' };
}

/* ─── Rate-type helpers ────────────────────────────────────────────────────── */

/** Actual units based on rate type: CPC→clicks, CPV→completes, else→impressions. */
function liActualUnits(p, t) {
    return p.rateType === 'CPC' ? t.cl : p.rateType === 'CPV' ? t.co : t.im;
}

/* ─── Derived KPIs (pure) ──────────────────────────────────────────────────── */

function margin(clientPr, spend) {
    return clientPr > 0 ? (clientPr - spend) / clientPr * 100 : 0;
}

function pacingIndex(actual, expected, planned) {
    return planned > 0 ? (actual - expected) / planned * 100 : 0;
}

function marginStatus(actual, target, warnThreshold) {
    return actual - target >= 0 ? 'g' : actual - target >= warnThreshold ? 'w' : 'b';
}

function pacingStatus(index, low, high) {
    return index >= low && index <= high ? 'g' : index < low ? 'b' : 'w';
}

/* ─── Recent daily metrics ─────────────────────────────────────────────────── */

function recentDailyMetrics(plan, facts, asOf, days) {
    if (!asOf || !facts) return [];
    var n = days || 2;
    var result = [];
    var d = asOf;

    var dates = [];
    while (dates.length < n && d >= plan.fs) {
        if (facts[d]) dates.push(d);
        d = datePrev(d);
    }

    for (var di = 0; di < dates.length; di++) {
        var targetDate = dates[di];
        var cumIm = 0, cumCl = 0, cumCo = 0, cumSp = 0, cumDc = 0;

        for (var fd in facts) {
            if (facts.hasOwnProperty(fd) && fd >= plan.fs && fd <= targetDate) {
                var fv = facts[fd];
                cumIm += fv.im || 0;
                cumCl += fv.cl || 0;
                cumCo += fv.co || 0;
                cumSp += fv.sp || 0;
                cumDc += fv.dc || 0;
            }
        }

        var cumActual = liActualUnits(plan, { im: cumIm, cl: cumCl, co: cumCo });
        var expUnits = liExpUnits(plan, targetDate);
        var dayFact = facts[targetDate];

        var expPrev = targetDate > plan.fs ? liExpUnits(plan, datePrev(targetDate)) : 0;
        var dayExpImpr = expUnits - expPrev;

        // Rate-type-native day metrics. planImpr / liExpUnits are already in the
        // rateType's native unit (CPM→impressions, CPC→clicks, CPV→completes),
        // so `units` (actual) and `tgtUnits` (expected) share that unit and are
        // directly comparable. The target rate = net cost / planned native units;
        // for CPC and CPV that planned total is `planImpr` itself (the canonical
        // "planImpr = plan-clicks / plan-views" convention, see metrics.js campM).
        // Legacy impr/cpm/tgtImpr/tgtCpm stay for back-compat (KpiTrend, old payloads);
        // for CPM units===impr & rate===cpm so consumers see no change.
        var rt = plan.rateType || 'CPM';
        var dayUnits = liActualUnits(plan, dayFact);
        var netCost = plan.budget * (1 - plan.mTgt / 100);
        var dayRate, tgtRate;
        if (rt === 'CPC') {
            dayRate = dayFact.cl > 0 ? dayFact.sp / dayFact.cl : 0;
            tgtRate = plan.planImpr > 0 ? netCost / plan.planImpr : 0;
        } else if (rt === 'CPV') {
            dayRate = dayFact.co > 0 ? dayFact.sp / dayFact.co : 0;
            tgtRate = plan.planImpr > 0 ? netCost / plan.planImpr : 0;
        } else {
            dayRate = dayFact.im > 0 ? (dayFact.sp / dayFact.im) * 1000 : 0;
            tgtRate = plan.planImpr > 0 ? (netCost / plan.planImpr) * 1000 : 0;
        }

        // Reforecast (pace-to-goal) target for this day, in native units, so the
        // Overview heatmap can follow the same Plan/Reforecast setting the dashboard
        // charts use. cumActual is already cumulative-through-D (native), so subtract
        // the day to get cumBefore. Delivery (units) only; rate stays a flat target.
        var rfBefore = cumActual - (dayUnits || 0);
        // Per-LI pause: a paused day demands no delivery, so its reforecast target is
        // 0 (the heatmap cell won't read red on a paused day). Non-paused days go
        // through the canonical backward target — the SAME function the widget and the
        // Slack summary use, which is what makes the three agree.
        var tgtUnitsReforecast = isLiPaused(plan, targetDate)
            ? 0
            : Math.round(reforecastTarget(plan.planImpr, rfBefore, targetDate, plan.fe));

        result.push({
            date: targetDate,
            impr: dayFact.im || 0,
            spend: dayFact.sp || 0,
            margin: margin(cumDc, cumSp),
            pacing: pacingIndex(cumActual, expUnits, plan.planImpr),
            cpm: dayFact.im > 0 ? (dayFact.sp / dayFact.im) * 1000 : 0,
            ctr: dayFact.im > 0 ? (dayFact.cl / dayFact.im) * 100 : 0,
            vcr: dayFact.im > 0 ? (dayFact.co / dayFact.im) * 100 : 0,
            clicks: dayFact.cl || 0,
            completes: dayFact.co || 0,
            tgtCpm: plan.planImpr > 0 ? (plan.budget * (1 - plan.mTgt / 100)) / plan.planImpr * 1000 : 0,
            tgtImpr: Math.round(dayExpImpr),
            rateType: rt,
            units: dayUnits || 0,
            tgtUnits: Math.round(dayExpImpr),
            tgtUnitsReforecast: tgtUnitsReforecast,
            rate: dayRate,
            tgtRate: tgtRate
        });
    }

    return result;
}

/* ─── Per-LI pause state (manual intervals ∪ auto out-of-schedule) ─────────── */
function isLiPaused(plan, asOf) {
    if (!plan || !asOf) return false;
    var iv = plan.pause_intervals;
    if (iv && iv.length) {
        for (var i = 0; i < iv.length; i++) {
            var a = iv[i] && iv[i].from, b = iv[i] && iv[i].to;
            if (isYmd(a) && a <= asOf && (b == null || !isYmd(b) || asOf <= b)) return true;   // manual pause covers asOf
        }
    }
    // Auto-pause ONLY WITHIN the flight window: a fully-containerized LI on a day
    // no container covers ("dark between containers"). Out-of-flight days
    // (ended / not-yet-started) are deliberately NOT treated as paused — an ended
    // LI is not "paused", and excluding them keeps byte-identical behavior for
    // existing pacings that carry no pause_intervals.
    if (plan.fs && plan.fe && asOf >= plan.fs && asOf <= plan.fe) {
        var ps = parseContainers(plan);
        if (ps && ps.remImpr <= 0.0001 && !findActiveContainer(plan, asOf)) return true;   // auto: uncovered gap day
    }
    return false;
}

/* "Currently paused" for DISPLAY (marker + demand Tgt + badge): an OPEN manual
 * pause interval (to == null) means paused NOW regardless of the data date — so a
 * pause set after the last data day still shows as paused in a day-old summary.
 * Otherwise falls back to isLiPaused(asOf). NOT for the freeze or the leak
 * detector — those stay on the data date so past expected isn't rewritten and
 * no false "delivering while paused" fires on pre-pause delivery. */
function isLiPausedNow(plan, asOf) {
    var iv = plan && plan.pause_intervals;
    if (iv && iv.length) {
        for (var i = 0; i < iv.length; i++) {
            if (iv[i] && iv[i].to == null && isYmd(iv[i].from)) return true;   // open manual pause = paused now
        }
    }
    return isLiPaused(plan, asOf);
}

/* ─── Public API ───────────────────────────────────────────────────────────── */

var PacingCore = {
    /* Internal — exposed for dashboard alias layer only */
    _parseUTC: parseUTC,

    /* Date utilities */
    daysBetween: daysBetween,
    dI: daysBetween,                          /* legacy alias kept for callers */
    rangeOverlap: rangeOverlap,
    datePrev: datePrev,
    countUniqueDays: countUniqueDays,
    coveredDaysUpTo: coveredDaysUpTo,

    /* Container API */
    effMargin: effMargin,
    buildMarginIndex: buildMarginIndex,
    resolveRowMargin: resolveRowMargin,
    coefDcForRow: coefDcForRow,
    netDc: netDc,
    validateCoefLi: validateCoefLi,
    containerSpendEff: containerSpendEff,
    resolveDimAbs: resolveDimAbs,
    containerDimValues: containerDimValues,
    containerDimFilter: containerDimFilter,
    factDimValue: factDimValue,
    factMatchesDimFilter: factMatchesDimFilter,
    buildDimScopeIndex: buildDimScopeIndex,
    factOutsideSplits: factOutsideSplits,
    parseDateChildren: parseDateChildren,
    containerExpUnits: containerExpUnits,
    containerExpCost: containerExpCost,
    dimChildExpUnits: dimChildExpUnits,
    dimChildActualUnits: dimChildActualUnits,
    dimChildPacingIndex: dimChildPacingIndex,
    parseContainers: parseContainers,
    findActiveContainer: findActiveContainer,
    buildVirtualPlanFromContainer: buildVirtualPlanFromContainer,

    /* Period scope (date_child-aware) */
    periodKeyOf: periodKeyOf,
    extractPeriods: extractPeriods,
    findPeriodForAsOf: findPeriodForAsOf,
    buildVirtualPlanFromDateChild: buildVirtualPlanFromDateChild,
    buildScopedPlanForPeriodKey: buildScopedPlanForPeriodKey,
    resolvePeriodKey: resolvePeriodKey,

    /* Expected delivery */
    liExpUnits: liExpUnits,
    liExpImpr: liExpUnits,                    /* legacy alias kept for callers */
    liExpCost: liExpCost,
    liExpUnitsRaw: liExpUnitsRaw,
    liExpCostRaw: liExpCostRaw,
    liExpClicks: liExpClicks,

    /* Proration */
    prorate: prorate,
    prorateRange: prorateRange,
    recentDailyMetrics: recentDailyMetrics,

    /* Rate-type */
    liActualUnits: liActualUnits,

    /* Derived KPIs */
    margin: margin,
    pacingIndex: pacingIndex,
    marginStatus: marginStatus,
    pacingStatus: pacingStatus,

    /* Per-LI pause state (manual intervals ∪ auto out-of-schedule) */
    isLiPaused: isLiPaused,
    isLiPausedNow: isLiPausedNow,

    /* Paused-window subtractor + linear time-progress (split-row / dim freeze) */
    subtractPaused: subtractPaused,
    pausedTimeProgress: pausedTimeProgress,

    /* Pace-to-goal. neededPerDay = FORWARD (from tomorrow); reforecastTarget = BACKWARD (this day). */
    neededPerDay: neededPerDay,
    reforecastTarget: reforecastTarget
};

/* UMD export */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PacingCore;
} else {
    root.PacingCore = PacingCore;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
