import { cmFeedOf, resolveValue } from '../report-render.js';
import { formulaScopeFor } from '../formula-scope.js';
import { readsOnlyPairs } from '../cm-formula-context.js';
import { NO_CM_JOIN, PIE_NO_CM } from '../widget-formula.js';

/** Auxiliary expressions use the BQ context, which cannot describe the CM adapter's
 * mapped/focused population. Ask the renderer about this value, not its whole widget.
 * A bound value must remain usable in every position of its metric switch. */
export function highlightContextExpressionsAvailable(value, spec, { delta = false } = {}) {
  if (delta) return false;
  const datasetType = spec?.dataset?.type || 'delivery';
  if (value?.kind === 'bound') {
    const control = spec?.controls?.find((entry) => entry?.type === 'metric');
    return !(control?.options || []).some((option) => cmFeedOf(resolveValue(option?.value, spec, null), datasetType));
  }
  return !cmFeedOf(resolveValue(value, spec, null), datasetType);
}

/**
 * Which CM360 join each half of a highlight rule on this owner has (spec 2026-09-16 §2.8),
 * and whether the owner's own value is cm-fed.
 *
 * The editor asks per OWNER because the join is the slot's and not the grain's: a column
 * rule scoped to the total reads the Totals cell's own number, which exists only where the
 * rows beside it join — so a line-item table has neither half. `refusal` is the sentence the
 * field shows for a half with no join, taken from `widget-formula.js` so the editor and the
 * draft validator cannot word it differently.
 *
 * The grain is read RAW, exactly as the cards read it for `formulaScopeFor`: a control-bound
 * grain is a dimension grain whichever option the viewer lands on, so no control state is
 * needed to answer, and this function takes none.
 */
export function highlightCmSlots(view, ownerType, owner, spec, env = {}) {
  // A Δ column is about the mapped population too. `cmOnly` tells the validator to judge every
  // expression on this owner by what the matched pairs can answer: where the slot joins, a
  // delivery expression over im / cl / co is read off the pair's own delivery half and is
  // accepted; one naming anything else, or any on a slot with no join, is still refused.
  const cmOnly = !highlightContextExpressionsAvailable(owner?.value, spec, { delta: owner?.kind === 'delta' });
  if (ownerType === 'pie') return { rows: null, total: null, refusal: PIE_NO_CM, cmOnly };
  const grain = ownerType === 'column' ? (view?.rows || { type: 'date' })
    : ownerType === 'series' ? (view?.x || { type: 'date' })
      : { type: 'agg' };
  const rows = formulaScopeFor(grain, env).cm;
  return { rows, total: ownerType === 'column' ? (rows ? 'total' : null) : null, refusal: NO_CM_JOIN, cmOnly };
}

/**
 * Does this rule need the BQ context? On an owner with a CM360 slot, a rule whose every
 * expression the matched pairs can answer does not (§2.8, widened 2026-09-18): a CM360
 * formula, a delivery expression over im / cl / co and the plan fields, or a constant all read
 * the owner's own mapped population, so Apply must not be blocked on a rule the validator
 * accepts and the renderer reads. An expression naming anything else (spend, a rate) does
 * need it, and a flight reading always does. With no CM360 slot (`cmAvailable` false) the
 * answer is exactly what it has always been.
 */
export function highlightUsesContextExpressions(rule, cmAvailable = false) {
  if (rule?.input?.reading !== undefined) return true;
  const used = [
    rule?.input?.expr,
    rule?.guard === undefined ? undefined : (rule.guard.expr ?? ''),
    rule?.condition?.threshold?.kind === 'formula' ? (rule.condition.threshold.expr ?? '') : undefined,
    rule?.condition?.upper?.kind === 'formula' ? (rule.condition.upper.expr ?? '') : undefined,
  ].filter((expr) => expr !== undefined);
  if (!used.length) return false;
  return !(cmAvailable && used.every((expr) => readsOnlyPairs(expr)));
}
