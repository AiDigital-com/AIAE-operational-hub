// useAutoInventory(spec) → the pacing inventory resolveAutoControls reads, or null when the
// spec carries no auto key. Null is the point: `selectAvailDims` materializes the store's lazy
// breakdown aggregate (selectors.js:122-125 keeps it off the first-paint path), and a tile with
// stored lists must not pay for it. The one tile that does — the Breakdown widget — is mounted
// by DashGrid inside DeferredMount (DashGrid.jsx:101), so the aggregate is built when the tile
// scrolls into view, exactly when the legacy Breakdown section built it; the read is memoized
// on the facts after that. Layout mode and the builder preview mount the tile eagerly, which is
// the cost those two explicit actions already carried for the section.
//
// The gate is SPLIT for the same reason it exists at all: a spec whose only auto key is the
// metric switch's `defaultBy` needs the buy unit and never looks at a dimension, so it must
// not touch the aggregate either. The dimension half is read only when a dimension switch is
// auto (`availDims` stays null and `dimSourceKeys` empty otherwise — resolveAutoControls asks
// `autoDimensionOptions` only inside its dimension branch, so nothing reads them); the buy
// unit's two fields are read whenever either half is auto.
import { useMemo } from 'react';
import { useDashboardStore } from '../store.js';
import { useEffLIs } from '../store.js';
import { selectAvailDims } from '../selectors.js';
import { dimSourceAxisOptions } from '../dim-sources-norm.js';
import { hasAutoDimension, hasAutoMetric, auxRows } from '../auto-controls.js';

export function useAutoInventory(spec) {
  const needsDims = hasAutoDimension(spec);
  const needsMetric = hasAutoMetric(spec);
  const needs = needsDims || needsMetric;
  // Every hook below runs on every render (rules of hooks); what the gate decides is what the
  // SELECTOR reads, which is where the cost is.
  const liPlan = useDashboardStore((s) => (needs ? s.liPlan : null));
  const effLIs = useEffLIs();
  // selectAvailDims is memoized on {facts, liPlan}, so the selector returns a stable Set and
  // zustand's equality check does not re-render the tile on unrelated store changes.
  const availDims = useDashboardStore((s) => (needsDims ? selectAvailDims(s) : null));
  const creatives = useDashboardStore((s) => (needsDims ? s.creatives : null));
  const dimSources = useDashboardStore((s) => (needsDims ? s.dimSources : null));
  const dimSourceConfigs = useDashboardStore((s) => (needsDims ? s.dataConfig?.dim_sources : null));
  return useMemo(() => {
    if (!needs) return null;
    return {
      availDims,
      hasCreatives: needsDims ? auxRows(creatives, liPlan) : false,
      dimSourceKeys: needsDims ? dimSourceAxisOptions(dimSources, dimSourceConfigs).map(([key]) => key) : [],
      liPlan,
      effLIs,
    };
  }, [needs, needsDims, availDims, creatives, dimSources, dimSourceConfigs, liPlan, effLIs]);
}
