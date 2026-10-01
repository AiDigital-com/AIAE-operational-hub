// workspace/src/lib/dashboard/plan-identity.js
// Structural sharing for liPlan maps across settings saves. The memo pyramids
// (metrics.js sumLI/liM/campM, selectors.js chart cache, pacing-calc per-plan
// caches) key on OBJECT IDENTITY — replacing every plan object on each save
// replays the full expected-curve cost even for display-only saves (chart
// mode toggle, KPI visibility). Compare normalized plans by serialized
// content: same content → keep the previous object; nothing changed at all →
// return the previous MAP itself, so even the map-keyed caches stay warm.
// Both sides come from the same normalizePlan code path, so key order is
// deterministic and JSON.stringify comparison is sound.
export function sharePlanIdentities(prevPlan, nextPlan) {
  if (!prevPlan) return nextPlan;
  const nextIds = Object.keys(nextPlan);
  let changed = Object.keys(prevPlan).length !== nextIds.length;
  const shared = {};
  for (const id of nextIds) {
    const prev = prevPlan[id];
    const next = nextPlan[id];
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      shared[id] = prev;
    } else {
      shared[id] = next;
      changed = true;
    }
  }
  return changed ? shared : prevPlan;
}
