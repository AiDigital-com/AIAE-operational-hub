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
