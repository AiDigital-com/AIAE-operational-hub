// workspace/src/lib/dashboard/scope-text.js — WHAT a widget's scope pins, in words.
//
// One fact, one wording. Two surfaces say it: the TILE's frame badge (WidgetFrame §0.8,
// where the phrase shares one line with the widget's own name) and the BUILDER's Data
// chip (ReportBuilder, where it is the only place that says what this report is pinned
// to). They were the same four lines written twice — two definitions of one sentence,
// and the copy that drifts is always the one nobody is looking at.
//
// Pure and store-free: `scope` is a plain object off the stored widget, and both callers
// hand it straight in.

/**
 * The pinned axes as ONE phrase, or `''` when nothing is pinned.
 *
 * Channels are capped at two with an ellipsis because the row they head is a filter list,
 * not an inventory — the full set is in the hover tip on the tile, and in the scope popover
 * in the builder. `dims` join on a space rather than the separator: `geo=PL utm=spring` is
 * one pin with two axes, and « · » between them would read as two pins.
 */
export function scopeText(scope) {
  const parts = [];
  if (scope?.channels?.length) parts.push(scope.channels.slice(0, 2).join('/') + (scope.channels.length > 2 ? '…' : ''));
  if (scope?.lis?.length) parts.push(`${scope.lis.length} LI${scope.lis.length > 1 ? 's' : ''}`);
  if (scope?.dims?.length) parts.push(scope.dims.map((d) => `${d.key}=${d.value}`).join(' '));
  if (scope?.time === 'absolute') parts.push('always current');
  return parts.join(' · ');
}

/** How long the phrase may be ON A TILE, where it shares the title row with the widget's
 *  name. The one deliberate difference between the two surfaces: the builder's chip sits
 *  in a wrapping row and prints the phrase whole. */
export const SCOPE_BADGE_MAX = 42;

/** The tile's badge: the same phrase, capped so a long pin cannot push a widget's name out
 *  of its own frame. `scopeTip` beside it is where the untruncated list lives. */
export function scopeBadge(scope) {
  const text = scopeText(scope);
  return text.length > SCOPE_BADGE_MAX ? `${text.slice(0, SCOPE_BADGE_MAX - 2)}…` : text;
}
