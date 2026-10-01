// workspace/src/lib/dashboard/display-identity.js
// Structural sharing for `display` across settings saves — the same idea
// plan-identity.js applies to liPlan, for the same reason.
//
// Every settings 200 returns the WHOLE display (api-routes.mjs:3152), even for a
// one-key widgetRanges patch, and it arrives as freshly-parsed JSON: every widget
// object, every map, a new identity. The tile pipeline is keyed on those
// identities — useResolvedWidgets memoizes on [widgets, entries], useWidgetData
// on [widget, …, display.liNames, …], and its planMap feeds the WeakMap layers
// under campM — so a period chip re-ran the full data pipeline on every tile on
// the dashboard while computing exactly the same numbers.
//
// Compare by serialized content and keep the previous object when it matches;
// keep the previous MAP/ARRAY when nothing inside it moved. Both sides come from
// the same server JSON, so key order is deterministic and JSON.stringify
// comparison is sound; a false negative (order genuinely differs) costs only the
// recompute that happens today.

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Widget list sharing, keyed by widget id rather than position, so inserting or
 * reordering a tile keeps every OTHER tile's object — and therefore its models.
 * The previous ARRAY comes back only when the ids, their order and their content
 * are all unchanged.
 */
export function shareWidgetIdentities(prevList, nextList) {
  if (!Array.isArray(prevList) || !Array.isArray(nextList)) return nextList;
  const byId = new Map();
  for (const w of prevList) if (w && w.id != null) byId.set(w.id, w);
  let same = prevList.length === nextList.length;
  const out = nextList.map((w, i) => {
    const prev = w && w.id != null ? byId.get(w.id) : undefined;
    if (prev && sameJson(prev, w)) {
      if (prevList[i] !== prev) same = false;   // same widget, different slot
      return prev;
    }
    same = false;
    return w;
  });
  return same ? prevList : out;
}

/**
 * shareDisplayIdentities(prevDisplay, nextDisplay) → a display whose unchanged
 * parts are the PREVIOUS objects. Returns `prevDisplay` itself when the whole
 * thing is unchanged, so even a display-keyed subscription stays quiet.
 */
export function shareDisplayIdentities(prevDisplay, nextDisplay) {
  if (!prevDisplay || !nextDisplay) return nextDisplay;
  const nextKeys = Object.keys(nextDisplay);
  let changed = Object.keys(prevDisplay).length !== nextKeys.length;
  const shared = {};
  for (const key of nextKeys) {
    const next = nextDisplay[key];
    if (!Object.prototype.hasOwnProperty.call(prevDisplay, key)) {
      shared[key] = next;
      changed = true;
      continue;
    }
    const prev = prevDisplay[key];
    if (key === 'widgets') {
      const list = shareWidgetIdentities(prev, next);
      shared[key] = list;
      if (list !== prev) changed = true;
      continue;
    }
    if (prev === next || sameJson(prev, next)) {
      shared[key] = prev;
    } else {
      shared[key] = next;
      changed = true;
    }
  }
  return changed ? shared : prevDisplay;
}

/**
 * The same rule for the campaign object. `saveSettings` merges the response's
 * campaign fields over the one in hand, which minted a fresh object on EVERY
 * save — and `campaign` is a useWidgetData dependency, so that alone re-ran the
 * pipeline the widget sharing above is there to save.
 */
export function shareCampaignIdentity(prevCampaign, nextCampaign) {
  if (!prevCampaign || !nextCampaign) return nextCampaign;
  return sameJson(prevCampaign, nextCampaign) ? prevCampaign : nextCampaign;
}
