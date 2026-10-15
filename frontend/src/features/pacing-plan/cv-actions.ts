/**
 * Which conversion actions a line item can choose from (Pacing spec 2026-09-13 §2).
 *
 * There is no list of actions anywhere but the delivered conversion rows themselves, so the editor
 * derives it the way the retired SPA's `primary-cv-state.js:actionsByLi` did: group the pacing's rows
 * by line item and action, sum each action's conversions, and rank by that sum so the action a line
 * actually runs on sits at the top.
 *
 * Names are TRIMMED, because every reader downstream matches on the trimmed name - `conversionIndex`
 * in the engine does, and so does the server's `canonNames`. Offering an untrimmed name here would
 * let a user store a choice that matches nothing.
 */

import PrimaryCvRuleUntyped from "@shared/primary-cv-rule";

export interface CvAction {
  name: string;
  conversions: number;
}

/** Line item id -> its actions, biggest first, then by name. */
export function actionsByLi(rows: ReadonlyArray<Record<string, unknown>> | undefined): Map<string, CvAction[]> {
  const sums = new Map<string, Map<string, number>>();
  for (const row of rows ?? []) {
    if (!row) continue;
    const name = String(row.conversion_action ?? "").trim();
    const li = String(row.line_item_id ?? "");
    if (!name || !li) continue;
    let byAction = sums.get(li);
    if (!byAction) { byAction = new Map(); sums.set(li, byAction); }
    byAction.set(name, (byAction.get(name) ?? 0) + (Number(row.conversions) || 0));
  }
  const out = new Map<string, CvAction[]>();
  for (const [li, byAction] of sums) {
    const list = [...byAction].map(([name, conversions]) => ({ name, conversions }));
    list.sort((a, b) => (b.conversions - a.conversions) || a.name.localeCompare(b.name));
    out.set(li, list);
  }
  return out;
}

/**
 * Names in a line item's choice that its delivered rows do not have.
 *
 * Worth saying out loud rather than silently dropping: a choice that matches nothing counts nothing,
 * so the line reads zero conversions and looks broken. It happens legitimately - an action renamed in
 * the platform, or a choice made before the data was fetched.
 */
export function unmatched(choice: ReadonlyArray<string>, actions: ReadonlyArray<CvAction>): string[] {
  const have = new Set(actions.map((a) => a.name));
  return choice.filter((name) => !have.has(name));
}

/** The vendored rule, typed at this one boundary: only the four readers the seed below needs. */
const CvRule = PrimaryCvRuleUntyped as unknown as {
  isEnabled: (data: Record<string, unknown>) => boolean;
  liHasConversionData: (liId: string, data: Record<string, unknown>) => boolean;
  sourceKeyOf: (liId: string, data: Record<string, unknown>) => string;
  canonNames: (list: ReadonlyArray<string>) => string[];
};

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The choice a newly added line item starts with - the reference's `seedSelection`
 * (`primary-cv-state.js`), verbatim in behaviour: the choice most line items on the same source
 * share. A tie, or other line items that chose differently with no majority, seeds nothing and says
 * `differ`; a pacing with the switch off, a line item with no conversion data, or nobody having
 * chosen yet seeds nothing and says `none`.
 *
 * @param plans    the plan's draft line items, by id, before the new one joins them
 * @param data     the pacing's DRAFT `data` namespace (switch, fetches, sheet bindings)
 * @param newLiId  the line item being added
 */
export function seedPrimaryCv(
  plans: Readonly<Record<string, { primaryCv?: ReadonlyArray<string> }>>,
  data: Record<string, unknown>,
  newLiId: string,
): { seed: string[] | null; reason: "seeded" | "differ" | "none" } {
  const none = { seed: null, reason: "none" as const };
  const target = String(newLiId);
  if (!CvRule.isEnabled(data) || !CvRule.liHasConversionData(target, data)) return none;
  const source = CvRule.sourceKeyOf(target, data);
  const tally = new Map<string, { list: string[]; count: number }>();
  let anyChoice = false;
  for (const id of Object.keys(plans)) {
    if (id === target || CvRule.sourceKeyOf(id, data) !== source) continue;
    const list = CvRule.canonNames(plans[id]?.primaryCv ?? []).sort(byName);
    if (list.length > 0) anyChoice = true;
    const key = JSON.stringify(list);
    const entry = tally.get(key);
    if (entry) entry.count += 1;
    else tally.set(key, { list, count: 1 });
  }
  let best: { list: string[]; count: number } | null = null;
  let tie = false;
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count) { best = entry; tie = false; }
    else if (entry.count === best.count) tie = true;
  }
  if (best && !tie && best.list.length > 0) return { seed: best.list.slice(), reason: "seeded" };
  return anyChoice ? { seed: null, reason: "differ" } : none;
}

/** What the reference says when line items it could not agree on leave the new one without a choice. */
export function seedDifferText(count: number): string {
  return count === 1
    ? "The new line item has no primary conversions: line items differ"
    : `${count} new line items have no primary conversions: line items differ`;
}
