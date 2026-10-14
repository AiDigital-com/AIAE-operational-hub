// workspace/src/pages/Dashboard/components/Settings/container-warnings.js
// Rounded-compare guard for container settings warnings.
// Protects against summed-float drift from two sources:
//   - PacingTab.doDistribute (cents rounding, see PacingTab.jsx:696-697).
//   - shared/pacing-core.js:resolveDimAbs (percent-mode returns float).
// Pure JS (no JSX) so host-side tests can import without a build step.

export function cmp(a, b, mult) {
  return Math.round(a * mult) > Math.round(b * mult);
}

export function imprWarning(cTi, dcSumImpr) {
  return cTi > 0 && cmp(dcSumImpr, cTi, 1); // impressions are integer-typed
}

export function spendWarning(cTs, dcSumSpend) {
  return cTs > 0 && cmp(dcSumSpend, cTs, 100); // cents
}

export function dimWarning(cTi, dimResolvedSum) {
  return cTi > 0 && cmp(dimResolvedSum, cTi, 1); // percent-mode resolves to float
}

// Dimension splits along DIFFERENT keys are independent cuts of the SAME units —
// Audience=Retargeting 60% and Geo=NY 60% each classify the whole container, they
// do not add up to 120% of anything. The model already says so: dim-scope.js's
// single-dim rule treats a cross-key combination as a different construct
// entirely. So the over-target check groups by dim_key and compares each key's
// own sum against the container target.

/** Sum resolved dim targets per dim_key. `resolved` = [{ key, abs }]. */
export function dimSumsByKey(resolved) {
  const out = {};
  for (const r of resolved || []) {
    if (!r || !r.key) continue;
    out[r.key] = (out[r.key] || 0) + (Number(r.abs) || 0);
  }
  return out;
}

/**
 * Values delivered inside a covered container that its splits do NOT declare
 * (spec 2026-08-14-container-dim-scope §5.3). Those are the impressions the
 * container's filter drops, and the operator has to see them by name: they are
 * either a value missing from the splits or a spelling that drifted
 * ('Grand RapidsAPP' vs 'Grand Rapids').
 *
 * Deliberately scoped to the CONTAINER WINDOW, not the flight — a dimension can
 * be tagged from May onward and empty in April, and a flight-wide check stays
 * silent exactly where it matters.
 *
 * @param {Object} splitDaily  liSplitDaily[liId]: { '<dim>:<value>': { date: row } }
 * @param {Object} daily       liDaily[liId]: { date: row } — the share denominator
 * @param {Object} container   the container
 * @param {Object|null} filter PacingCore.containerDimFilter(container)
 * @returns {Array<{ dim:string, value:string, im:number, pct:number }>} desc by im
 */
export function uncoveredInWindow(splitDaily, daily, container, filter) {
  if (!filter || !splitDaily || !container?.fs || !container?.fe) return [];
  let total = 0;
  for (const [d, v] of Object.entries(daily || {})) {
    if (d < container.fs || d > container.fe) continue;
    total += v.im || 0;
  }
  const out = [];
  for (const dim of Object.keys(filter)) {
    const declared = new Set(filter[dim]);
    const prefix = dim + ':';
    for (const [sk, dd] of Object.entries(splitDaily)) {
      if (!sk.startsWith(prefix)) continue;
      const value = sk.slice(prefix.length).trim();
      if (!value || value === '-' || declared.has(value)) continue;
      let im = 0;
      for (const [d, v] of Object.entries(dd)) {
        if (d < container.fs || d > container.fe) continue;
        im += v.im || 0;
      }
      if (im > 0) out.push({ dim, value, im, pct: total > 0 ? (im / total) * 100 : 0 });
    }
  }
  out.sort((a, b) => b.im - a.im);
  return out;
}

/** dim_keys whose OWN resolved sum exceeds the container target. */
export function dimOverKeys(cTi, sumsByKey) {
  const keys = [];
  for (const k of Object.keys(sumsByKey || {})) {
    if (dimWarning(cTi, sumsByKey[k])) keys.push(k);
  }
  return keys;
}
