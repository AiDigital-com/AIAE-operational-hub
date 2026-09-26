/**
 * dashboard-metrics-glue.js — buildMetricBag, extracted verbatim from `dash-gate/lib/merge.mjs`
 * (no behaviour change - same function calls, same order) so there is exactly ONE implementation
 * of "dashboard response -> metrics bag" instead of two: `merge.mjs`'s real one, server-side, and
 * a hand-written TypeScript port of it in the Operational Hub repo that existed only to give its
 * crown test something to compare against (`AIAE-operational-hub/frontend/.../engine/
 * __fixtures__/server-reference.ts`) and could silently drift from what it was meant to verify.
 *
 * `merge.mjs` calls `buildMetricBag(response)` with no filters (Pacing's server has none); this
 * file changes nothing about that call or its result. It is vendored byte-identical into the Hub
 * beside `dashboard-metrics.js`/`pacing-core.js`/`metric-registry.js`/`currency.js` (see that
 * repo's `engine/vendor/SOURCE.md`) purely so the crown test can call the real function on its
 * own fixture instead of re-implementing it.
 *
 * UMD, like its four dependencies: no fs, no network, no wall-clock, no module-level state.
 *
 *   const glue = DashboardMetricsGlue.create({ core, currency, metricRegistry, dashboardMetrics });
 *   const bag = glue.buildMetricBag(dashboardResponse);
 */
(function (root) {
'use strict';

function createDashboardMetricsGlue(deps) {
  const PacingCore = (deps && deps.core) || null;
  const Currency = (deps && deps.currency) || null;
  const MetricRegistry = (deps && deps.metricRegistry) || null;
  const DashboardMetrics = (deps && deps.dashboardMetrics) || null;
  if (!PacingCore || !Currency || !MetricRegistry || !DashboardMetrics) {
    throw new Error('DashboardMetricsGlue.create needs { core, currency, metricRegistry, dashboardMetrics }');
  }

  /**
   * Per-container and per-child readings (§10's display half, US-129).
   *
   * A container cuts one line item's plan two independent ways: date children say WHEN
   * its units land, dim children say WHAT they are. Each carries its own target and may
   * override the margin it is measured against, so each needs its own pace and margin -
   * "sub-breakdowns appear nested under the parent with their own pacing and margin".
   *
   * The retired SPA ran exactly these functions in the browser (SplitRow.jsx); they moved
   * into the shared engine rather than being written a second time in TypeScript. That is
   * still the rule: this file is vendored byte-identical into the Operational Hub so both
   * sides run ONE implementation - never re-port it.
   *
   * Two details worth not re-deriving from scratch:
   *  - a dim child's target may be a PERCENT of its parent's units, which is what
   *    PacingCore.resolveDimAbs resolves; a date child's is always absolute.
   *  - progress is measured on the FULL window, never a filtered range - "what is left of
   *    the target" does not depend on what the reader is currently looking at.
   *
   * Returns `{}` when nothing has containers, so a reader can treat absence and emptiness
   * alike.
   */
  function buildContainerReadings(DM, response, LP, LD, asOf) {
    const out = {};
    const rate = response.campaign && response.campaign.rate;
    const withContainers = Object.keys(LP).filter((id) => (LP[id].containers || []).length > 0);
    if (!withContainers.length) return out;

    // Split-level daily facts (keyed `dim_key:dim_value`) are what a dim child's actuals
    // are summed from. Built once here rather than per child.
    const LSD = DM.buildLiSplitDaily(response.factsDaily || [], rate, LP);
    const facts = { factsDaily: response.factsDaily || [], liDaily: LD, liSplitDaily: LSD, asOf, rate };

    // No URL filters server-side: this is the unfiltered reading, the one the plan is
    // judged against. A filtered view is the reader's own business.
    const scopeIdx = DM.buildScopedDaily(facts, LP, rate, {});

    // The amber band for a margin gap, in percentage points. The SPA read it from the
    // pacing's notify config with this same default (SplitRow.jsx:32).
    const notify = response.notify || {};
    const marginWarn = -((notify.alerts && notify.alerts.margin_below_target
      && notify.alerts.margin_below_target.gap_pp) ?? 3);

    for (const liId of withContainers) {
      const plan = LP[liId];
      const rt = plan.rateType || 'CPM';
      // The line item's own rate unit: a CPC line item paces on clicks, a CPV on views.
      // Dim children are always counted in impressions (their targets are unit counts).
      const nativeUnits = (a) => (rt === 'CPC' ? (a.cl || 0) : rt === 'CPV' ? (a.co || 0) : (a.im || 0));

      out[liId] = (plan.containers || []).map((container) => {
        const fs = container.fs || plan.fs;
        const fe = container.fe || plan.fe;
        const dateDaily = DM.dailyForContainer(scopeIdx, liId, container, LD);

        const child = (kind, c) => {
          const act = kind === 'date'
            ? DM.sumDateChild(liId, c, container, null, dateDaily)
            : DM.sumDimChild(liId, c, container, null, LSD);
          const cfs = kind === 'date' ? (c.fs || fs) : fs;
          const cfe = kind === 'date' ? (c.fe || fe) : fe;
          const ti = kind === 'date'
            ? (c.target_impressions ? Number(c.target_impressions) : 0)
            : PacingCore.resolveDimAbs(c, container);
          const units = kind === 'date' ? nativeUnits(act) : (act.im || 0);
          return {
            id: c.id || null,
            kind,
            label: kind === 'date' ? (c.name || null) : (c.dim_key + ': ' + c.dim_value),
            dimKey: kind === 'dim' ? c.dim_key : null,
            dimValue: kind === 'dim' ? c.dim_value : null,
            fs: cfs,
            fe: cfe,
            target: ti,
            actual: units,
            spend: act.sp || 0,
            clientCost: act.dc || 0,
            progress: DM.childProgress({ ti, au: units, fs: cfs, fe: cfe, asOf }),
            margin: DM.splitActualMargin(act, c, container, plan, marginWarn),
          };
        };

        // The container's own line, against which its children are read. Summed from the
        // same scoped facts its date children use, so the parent and its parts agree.
        const own = DM.sumDateChild(liId, { fs, fe }, container, null, dateDaily);
        const ownUnits = nativeUnits(own);
        const ownTarget = Number(container.target_impressions) || 0;
        return {
          id: container.id || null,
          name: container.name || null,
          fs,
          fe,
          target: ownTarget,
          actual: ownUnits,
          spend: own.sp || 0,
          clientCost: own.dc || 0,
          progress: DM.childProgress({ ti: ownTarget, au: ownUnits, fs, fe, asOf }),
          margin: DM.splitActualMargin(own, null, container, plan, marginWarn),
          dateChildren: (container.date_children || []).map((c) => child('date', c)),
          dimChildren: (container.dim_children || []).map((c) => child('dim', c)),
        };
      });
    }
    return out;
  }

  /**
   * What one `source` name resolves to, whichever of the two families owns it.
   *
   * A brick names a source without saying which kind it is, and the engine answers
   * in two places: `detailSource` for the six stacked cards (planUnits, planRate,
   * actualUnits, neededPerDay, latestDay, opRead), `canonicalNote` for the four
   * one-line notes (flightDays, marginTarget, marginDelta, deliverySubtitle).
   * Only the first was called here, so the other four arrived as
   * `{lines: [], sub: null}` — and the hero lost its "Target 71.94%", its
   * "Plan Pace vs Fact Pace" and its "Day 85 of 175 · 90 days left" without any
   * sign that a figure had gone missing.
   *
   * The note rides in `sub` rather than in a field of its own because that is
   * where the reader already looks: a note brick asks for this source and reads
   * `.sub`, exactly as it does for a detail card's subtitle.
   *
   * Tried in that order, and the fallback is keyed on the ANSWER, not on a list of
   * names: an empty detail is a source `detailSource` does not own, and a name
   * neither family owns comes back empty from both, which is what an unknown
   * source should look like.
   *
   * @param {object} DM the engine instance
   * @param {string} name the source a brick named
   * @param {object} ctx the brick context
   * @returns {{lines: object[], sub: string|null}|null} the resolved source
   */
  function detailOrNote(DM, name, ctx) {
    const detail = DM.detailSource(name, ctx);
    if (detail && ((detail.lines && detail.lines.length) || detail.sub)) return detail;
    const note = DM.canonicalNote(name, ctx.cm, ctx.flCM, ctx.effLIs, ctx.facts);
    return note ? { lines: [], sub: note } : detail;
  }

  /**
   * The `series` names the rateRows bricks in this pacing ask for.
   *
   * Its own walk rather than a second key inside {@link collectSources}: `source` and
   * `series` are different grammars answered by different functions, and folding them into
   * one set would have `detailSource` asked for "bidPair".
   *
   * @param display the pacing's display configuration
   * @returns the distinct series names
   */
  function collectRateSeries(display) {
    const found = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (node.type === 'rateRows' && typeof node.series === 'string' && node.series) found.add(node.series);
      for (const value of Object.values(node)) walk(value, depth + 1);
    };
    walk((display && display.widgets) || [], 0);
    return found;
  }

  /** Every distinct `source` string a brick in this pacing's widgets names. */
  function collectSources(display) {
    const found = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (typeof node.source === 'string' && node.source) found.add(node.source);
      for (const value of Object.values(node)) walk(value, depth + 1);
    };
    walk((display && display.widgets) || [], 0);
    return found;
  }

  /**
   * Every binding in this pacing's widgets, already resolved to a number.
   *
   * A brick does not carry its figure; it carries a reference to one, in one of
   * two grammars:
   *
   *   { metric: "margin" }                     a named campaign reading
   *   { expr: "(sp - expCo) / costBud * 100" } an expression over the scalars
   *
   * Both resolvers now live on this side, with the engine they belong to. The
   * named readings are widget-metric-readings.js, which owns each metric's one
   * calculation along with its title, display format and what it compares
   * against; the expressions are widget-formula.js, where division by zero yields
   * 0 and an unknown name reads as 0 — canon, not accident. Resolving here means
   * a front end needs neither table nor parser: it looks the binding up.
   *
   * Keyed by the binding's own JSON, not by widget or brick position. The same
   * binding appears in several widgets and resolves identically in all of them,
   * while a positional key would break the first time someone reordered a layout.
   *
   * A binding that cannot be resolved — an unknown metric, a malformed expression
   * — becomes null rather than 0, because "this widget is misconfigured" and
   * "this figure is zero" must not render as the same thing. Nothing throws: one
   * bad brick cannot cost the other ninety their dashboard.
   */
  function resolveBinds(DM, display, brickCtx, scalars) {
    const ctx = { get: (name) => (name in scalars ? scalars[name] : null) };
    const bound = {};

    const resolve = (binding) => {
      if (!binding || typeof binding !== 'object') return;
      const key = JSON.stringify(binding);
      if (key in bound) return;
      try {
        if (typeof binding.metric === 'string') {
          // The engine's OWN resolver, not a re-implementation of it.
          //
          // What this replaced read every canon metric off one bag. That is not how a canon
          // metric works: each one declares which bag answers it (`from: 'fl'` or the window),
          // whether it goes ABSENT on a unit this campaign has no goal for, and whether it stops
          // applying once the flight ends. The hand-rolled version knew none of that, and the
          // failure was arithmetic rather than an error - the DSP card's delta read
          // "+$954.64 vs target" against the window's cost budget where the original said
          // "-$6,180.61" against the whole flight's. Both subtract a real number from a real
          // number; only one is the comparison the card names.
          //
          // Wrapped in a bare `{ bind }` brick because that is the unit this bag is keyed by: a
          // binding, resolved on its own. A brick's own `target` is combined with it on the other
          // side, which is where the brick is.
          const v = DM.brickValue({ bind: binding }, brickCtx);
          bound[key] = v && (v.value != null || v.absent)
            ? { value: v.value, target: v.target ?? null, invert: !!v.invert, sub: v.sub ?? null }
            : (v ? { value: v.value ?? null, target: v.target ?? null, invert: !!v.invert, sub: v.sub ?? null } : null);
        } else if (typeof binding.expr === 'string' && binding.expr.trim()) {
          // parse() answers {ok, ast, error} — the AST is one level in, and a
          // parse failure is reported rather than thrown. Handing the wrapper
          // straight to evaluateOne is not an error either: it walks a node with
          // no `t`, falls through every case and returns 0, so a real figure
          // silently becomes zero.
          const parsed = DM.parse(binding.expr);
          bound[key] = parsed && parsed.ok
            ? { value: DM.evaluateOne(parsed.ast, ctx).value }
            : null;
        }
      } catch {
        bound[key] = null;
      }
    };

    // Walk the whole spec rather than the nesting §6 happens to use today:
    // bindings turn up in bricks, in chart guides and inside a statRow's cells,
    // and a walker taught the current shape is a walker that silently skips
    // whatever shape comes next.
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      for (const key of ['bind', 'target', 'tick']) resolve(node[key]);
      for (const value of Object.values(node)) walk(value, depth + 1);
    };

    walk((display && display.widgets) || [], 0);
    return bound;
  }

  /**
   * The three things a widget reads, from the one canonical engine.
   *
   *   campaign — campM's ~90 campaign-level figures. What a detailCard's `source`
   *              names ("planUnits", "marginDelta", "neededPerDay", …).
   *   scalars  — the flat bag a widget's `bind` expression is evaluated against
   *              ("(sp - expCo) / costBud * 100"). Plan-side scalars come from
   *              campaignScalars; the delivery-side ones (im, sp, dc, expCo and
   *              the rest of the flow fields) from summing each line item's
   *              window, which is how the SPA's aggregate context built them.
   *   series   — one row per calendar day of the window, each carrying the flow
   *              fields, the expected curve and the rates. What every chart plots.
   *
   * The two halves are computed independently and agree: summing `series[].im`
   * gives campaign.im to the impression. That is not a coincidence to rely on,
   * but it is a useful thing to check when either side is touched.
   *
   * The window is the full flight, clamped at the data edge — the default the SPA
   * opened with, and all Pacing's own server ever needs: it has no URL filters. The
   * Hub's vendored copy passes its own `effLIs`/`range` instead; every function
   * below already takes one.
   *
   * `merge.mjs` assigns the result to `response.metrics` inside a try/catch — failure
   * is NOT fatal, and a null bag means "no figures". Callers keep that fallback.
   *
   * @param {object} response the dashboard response being assembled
   * @returns {object} the metrics bag
   */
  function buildMetricBag(response) {
    const DM = DashboardMetrics.create({
      core: PacingCore,
      currency: Currency,
      metricRegistry: MetricRegistry,
    });
    const { LP, LD, asOf } = DM.normalize(response);
    const effLIs = Object.keys(LP);

    // TWO bags, because the engine answers two different questions and the widgets ask both.
    //
    // `cm` is the WINDOW — the flight so far, ending at the data edge. `flCM` is the WHOLE
    // flight. Most figures are identical in both (delivery is delivery), but the plan side
    // is not, and the split is written into the engine's own canon:
    //
    //     liCostBud = range ? m.costPr : p.budget * (1 - p.mTgt / 100)
    //
    // With one bag doing both jobs the Finance card read its cost budget off the
    // no-range arm and printed the WHOLE flight's budget under a label that means
    // to-date: $14,030 where the retired SPA said $6,894.74, and $50,000 where it said
    // $24,571.43. Both are real numbers; only one answers the question asked.
    //
    // Which bag goes where is not a judgement call - it is what the SPA's selectors did
    // (`selectCampMetrics` ranged, `selectFullFlightMetrics` unranged), and every consumer
    // below takes the same pair those two fed.
    const range = { from: response.campaign.startDate, to: asOf || response.campaign.endDate };
    const cm = DM.campM(LD, LP, asOf, effLIs, range);
    const flCM = DM.campM(LD, LP, asOf, effLIs, null);

    // The PUBLISHED bag stays the full-flight one, and that is deliberate: its only readers
    // on the other side are the Daily Performance table's totals, and those have to add up
    // to the rows beside them - which `buildRows` below builds with no range. A ranged total
    // over unranged rows is a column that does not sum.
    const campaign = flCM;

    // Ranged, because this is what a widget's `expr` is evaluated against, and `costBud` is
    // in it. The scalar bag's own docblock spells out the same rule campM follows.
    const scalars = DM.campaignScalars(
      LP, effLIs, asOf, response.campaign.startDate, response.campaign.endDate, range
    );
    // Flow + expected fields, summed over every line item's own flight window.
    // sumLiWindow applies the per-LI flight guard, so a late-arriving fact dated
    // after its line item ended is excluded here exactly as it is in campM.
    for (const id of effLIs) {
      const plan = LP[id];
      const win = DM.sumLiWindow(LD, plan, id, null, { from: plan.fs, to: asOf });
      for (const [k, v] of Object.entries(win)) scalars[k] = (scalars[k] || 0) + v;
    }

    const series = DM.aggregateDateRows(
      { liDaily: LD, liPlan: LP, effLIs,
        flightStart: response.campaign.startDate,
        flightEnd: response.campaign.endDate,
        asOf },
      null,
      'ts'
    );

    // A detailCard names a `source` instead of a binding — "planUnits",
    // "marginDelta", "opRead". brick-data.js's detailSource owns what each one
    // means, down to the wording of its subtitle, so it answers here too.
    //
    // `data.sources` is what the latest-day card reads, and it is not optional:
    // `latestDayUnits` returns four zeroes the moment it cannot find `liDaily`,
    // and zero is a figure — the card drew "0 impr · 25,436 below daily target"
    // on a pacing that had delivered 24,157 that day. campM's own
    // `latestDayImpr` is right there and right, which is exactly what makes the
    // wrong one so quiet. The shape mirrors what the retired SPA's
    // `useWidgetData` handed the same function.
    const brickCtx = {
      cm,
      flCM,
      facts: { asOf },
      effLIs,
      data: { sources: { liDaily: LD, liPlan: LP, effLIs } },
    };
    const sources = {};
    for (const name of collectSources(response.display)) {
      try {
        sources[name] = detailOrNote(DM, name, brickCtx);
      } catch {
        sources[name] = null;
      }
    }

    // The composite readings a widget shows beside its figures: how far into the
    // flight we are, the one-word verdict and why, whether margin reads well or
    // badly, and the per-unit delivery bars. Each is one function in brick-data.js
    // and each is a judgement — "Above target", "Behind" — that has to be made in
    // one place or two screens will word the same delta differently.
    const readings = {};
    const reading = (name, fn) => {
      try { readings[name] = fn(); } catch { readings[name] = null; }
    };
    reading('flightProgress', () => DM.flightProgress(cm, flCM, effLIs));
    reading('verdict', () => DM.verdictOf(brickCtx));
    reading('marginTone', () => DM.marginTone(cm, flCM, { asOf }));
    reading('deliveryUnits', () => DM.deliveryUnits(cm));
    // The per-rate-type rows a Finance card repeats over - Plan CPC/CPV, the Bid Plan vs
    // Bid Fact 2d pair, Earned @ Plan CPM, the dynamic rates. Keyed by the `series` a brick
    // names, because one card asks for several and each is a different list.
    //
    // This side had them as a stub reading "Rate breakdown not available in this view", on
    // the stated grounds that they need a DSP model nobody ported. They do not: rateTypeRows
    // is in the engine and takes the same two bags everything else here does. What was
    // missing was this call.
    const coefMode = DM.coefModeOf(LP);
    const rateRows = {};
    for (const series of collectRateSeries(response.display)) {
      try {
        rateRows[series] = DM.rateTypeRows(cm, flCM, series, { coefMode });
      } catch {
        rateRows[series] = null;
      }
    }
    readings.rateRows = rateRows;

    // One row per day per line item, for the Daily Performance table (§7).
    //
    // NOT the raw factsDaily a caller could sum for itself: those rows are split by
    // platform, tactic, audience and geo — 2,752 of them here for 230 real day/line
    // item pairs — and, more to the point, they include days outside a line item's
    // own flight. buildRows applies the same guard the charts and campM apply, which
    // is why the table's impressions add up to the figure in the header instead of
    // to a larger one nobody can account for.
    //
    // VCR eligibility is per line item and decided by isVcrEligible: a banner has no
    // completion rate, and dividing its completes by its impressions would produce a
    // number that looks like one.
    const vcrEligible = new Set(effLIs.filter((id) => DM.isVcrEligible(LP[id], LD[id])));
    const daily = DM.buildRows(effLIs, LD, LP, null, false, null, vcrEligible);

    return {
      asOf,
      campaign,
      scalars,
      series,
      daily,
      sources,
      readings,
      containers: buildContainerReadings(DM, response, LP, LD, asOf),
      bound: resolveBinds(DM, response.display, brickCtx, scalars),
    };
  }

  return { buildMetricBag };
}

const DashboardMetricsGlue = { create: createDashboardMetricsGlue };

/* UMD export */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DashboardMetricsGlue;
} else {
  root.DashboardMetricsGlue = DashboardMetricsGlue;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
