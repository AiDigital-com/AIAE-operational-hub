// workspace/src/pages/Dashboard/components/Settings/Widgets/current-tiles.js
//
// The CURRENT placement as a tiles map — resolveLayout over a display, the same
// derivation DashGrid and LayoutMode build their placement from: the flow
// registry plus the widget instances, kinds read off the INSTANCE. Extracted
// from LibraryScreen in the post-release UX round (2026-08-16) when the Display
// tab's Groups section became its second reader — the block-Add's band row and
// the group share's geometry must be computed from the same placement.
//
// Never `display.layout.tiles`: a seed-null layout (the common case) has no
// tiles object at all, and a maxY over nothing would mint a band at y 0 —
// inside the placement the user is looking at.
import { resolveLayout, widgetGridKind } from '../layout-grid.js';
import { tileSlot } from '../tile-slots.js';
import { isFutureWidget } from '../report-v2.js';
import { switchedOn } from '../display-blocks.js';
import { FLOW_REGISTRY } from '../tile-registry.jsx';

export const GRID_REGISTRY = FLOW_REGISTRY.map((e) => ({ id: e.id, kind: 'flow' }));
const FLOW_BY_ID = Object.fromEntries(FLOW_REGISTRY.map((e) => [e.id, e]));

export function currentTiles(display) {
  const widgets = Array.isArray(display?.widgets) ? display.widgets : [];
  const widgetById = Object.fromEntries(widgets.map((w) => [w.id, w]));
  const liveIds = new Set([...GRID_REGISTRY.map((r) => r.id), ...widgets.map((w) => w.id)]);
  const kindOf = (id) => {
    if (FLOW_BY_ID[id]) return 'flow';
    const instance = widgetById[id];
    return widgetGridKind(instance, { futurePlaceholder: isFutureWidget(instance) });
  };
  return Object.fromEntries(
    // Same switched-off predicate as DashGrid, so a legacy overlapping layout resolves here
    // exactly as the dashboard draws it.
    resolveLayout(display, GRID_REGISTRY, liveIds, kindOf, tileSlot, { isOff: (id) => !switchedOn(display, id) })
      .map(({ id, tile }) => [id, tile]),
  );
}
