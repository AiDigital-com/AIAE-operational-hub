// workspace/src/lib/dashboard/kpi-basis.js
//
// WHICH LINE ITEMS a KPI cell is a reading of — the four questions the legacy Targets band
// asks on every render (`KpiPlanFact.jsx`), in one place, so the band and the «Targets»
// widget cannot answer them differently (section-widget parity, 2026-09-04).
//
// The band used to ask them inline inside its `useMemo`, and the widget's preset restated
// them at mint time; the two were held together by a comment and by a source-text pin. Now
// both call this, and the four bases are the grammar's own vocabulary (`KPI_BASES`), so a
// cell whose basis this pacing does not have is a cell neither surface draws.
//
// PURE, and deliberately dependency-light: `isVcrEligible` and `domRateType` are the
// product's existing predicates and nothing else is decided here. No React, no store — the
// widget read path calls it per view and the band calls it once per render.

import { isVcrEligible, domRateType } from './metrics.js';
import { KPI_BASES } from './report-v2.js';

/** Does this line item's daily map hold a completed view anywhere in the flight? The band's
 *  own `hasVideo` is campM's `co > 0` summed over the VCR-eligible lines at FULL flight, and
 *  this is that sum asked one line at a time — a video line with a target but nothing
 *  delivered has no completion rate to rate, and the band draws no VCR cell for it.
 *
 *  Clipped to the plan's flight, because every aggregation in this product is (`sumLI`): a
 *  fact dated outside the line's own window is discarded downstream, so it must not be the
 *  thing that decides a cell exists. */
function hasCompletes(daily, plan) {
  if (!daily) return false;
  const fs = plan && plan.fs;
  const fe = plan && plan.fe;
  for (const [date, day] of Object.entries(daily)) {
    if (fs && fe && (date < fs || date > fe)) continue;
    if (day && (day.co || 0) > 0) return true;
  }
  return false;
}

const isAudio = (plan) => ((plan && plan.ch) || '').toLowerCase() === 'audio';

/**
 * The four bases, each answering with the line items it names or `null` for «this campaign
 * has no such reading». `ctx` is `{effLIs, liPlan, liDaily}` — the EFFECTIVE plans (period
 * and dim scope already applied) and the campaign's own facts.
 *
 * The keys are `KPI_BASES`, and `kpiBasisLines` refuses anything else rather than guessing:
 * a basis the grammar can store with no resolver here would silently hide a cell.
 */
const RESOLVE = {
  // KpiPlanFact.jsx: CTR is pushed before the first gate, so the only thing that can take it
  // away is having no line items at all — which is where the whole band returns null.
  campaign: ({ effLIs }) => (effLIs.length ? effLIs : null),
  // `hasVideo` AND at least one VCR-eligible line. The cell is read over every eligible line,
  // not only the ones carrying completes — that is the band's own subset.
  video: ({ effLIs, liPlan, liDaily }) => {
    const lines = effLIs.filter((id) => isVcrEligible(liPlan[id], liDaily[id]));
    if (!lines.length) return null;
    return lines.some((id) => hasCompletes(liDaily[id], liPlan[id])) ? lines : null;
  },
  // `hasAudio` AND at least one audio line. campM raises that flag for exactly the lines this
  // filter keeps (a plan whose channel is audio), so the band's two conjuncts are one question.
  audio: ({ effLIs, liPlan }) => {
    const lines = effLIs.filter((id) => isAudio(liPlan[id]));
    return lines.length ? lines : null;
  },
  // The whole campaign, while clicks are what it is paced on. `domRateType` answers 'CPC' for
  // an EMPTY set (0 >= 0 on both comparisons), so the emptiness is asked first.
  cpc: ({ effLIs, liPlan }) => (
    effLIs.length && domRateType(liPlan, effLIs) === 'CPC' ? effLIs : null
  ),
};

/**
 * kpiBasisLines(basis, ctx) → the line-item ids this basis names, or `null` when the campaign
 * has none — which is a cell that is not drawn.
 *
 * A view with NO basis is not this function's business: it is drawn always and reads whatever
 * the tile was handed, which is every KPI stored before the key existed.
 */
export function kpiBasisLines(basis, ctx) {
  const resolve = Object.prototype.hasOwnProperty.call(RESOLVE, basis) ? RESOLVE[basis] : null;
  if (!resolve) return null;
  const effLIs = (ctx && ctx.effLIs) || [];
  const liPlan = (ctx && ctx.liPlan) || {};
  const liDaily = (ctx && ctx.liDaily) || {};
  return resolve({ effLIs, liPlan, liDaily });
}

/** The bases this module can answer — the grammar's list, so a mismatch is a test failure
 *  rather than a cell that quietly stops being drawn. */
export const RESOLVED_BASES = Object.freeze(Object.keys(RESOLVE));
export { KPI_BASES };
