// workspace/src/pages/Dashboard/tile-registry.jsx — the Hub's version of it.
//
// What the moved Settings and Layout-mode code imports from Pacing's tile registry, and nothing
// else: `DeferredMount` (with the `SectionSkeleton` it draws), moved verbatim, and `FLOW_REGISTRY`,
// the page's four code-rendered sections as `{ id, Component, visible? }` in Pacing's order.
//
// The registry is NOT Pacing's: two of its four components are this app's own. Line Items and the
// Launch Plan are moved code that reads its figures from the state seam (`./store.js`). Alerts and
// the journal are this app's components, fed by the page through props - so the page builds them
// and hands them in on the state seam as `sections` (`usePacingState`), and the registry entry
// draws what it was handed. Pacing's registry components take no props, and Layout mode renders
// them that way (`<C />`), which is why the hand-off goes through the seam and not through props.
//
// Pacing's Alerts entry has no `visible` predicate (its block says "All clear" when there is
// nothing); this app's alerts block draws nothing then, and the board leaves its tile out
// (`../widgets/report-board.tsx`). In Layout mode the tile stays, as Pacing's does, so it can be
// positioned.
import { useEffect, useRef, useState } from 'react';
import LaunchPlanCard from './LaunchPlanCard.jsx';
import LineItemsTile, { SectionBoundary } from './lineitems/LineItemsTile.jsx';
import { launchPlanMode } from './launch-plan.js';
import { useDashboardStore } from './store.js';

export function SectionSkeleton({ minHeight = 220 }) {
  return (
    <div
      style={{
        minHeight,
        border: '1px dashed var(--border-soft)',
        borderRadius: 'var(--rm)',
        background: 'var(--surface-alt)',
      }}
    />
  );
}

export function DeferredMount({ children, minHeight = 320, rootMargin = '700px 0px' }) {
  const [shouldRender, setShouldRender] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (shouldRender) return undefined;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, shouldRender]);

  return (
    <div ref={ref} className="deferred-mount">
      {shouldRender ? children : <SectionSkeleton minHeight={minHeight} />}
    </div>
  );
}


/* ── Flow-tile components ─────────────────────────────────────────────────── */

function LaunchPlanTile() {
  return (
    <SectionBoundary name="LaunchPlanCard"><LaunchPlanCard /></SectionBoundary>
  );
}

/** This app's alerts block, as the page built it (`sections.alerts`). */
function AlertsTile() {
  const node = useDashboardStore((s) => s.sections?.alerts ?? null);
  return <SectionBoundary name="AlertsBlock">{node}</SectionBoundary>;
}

/** This app's journal panel, as the page built it (`sections.journal`). */
function JournalTile() {
  const node = useDashboardStore((s) => s.sections?.journal ?? null);
  return <SectionBoundary name="JournalPanel">{node}</SectionBoundary>;
}

/**
 * Ordered flow-tile registry — array order IS the default (seed) order, Pacing's. `visible`
 * mirrors a component's own data-driven self-hiding (Pacing's predicate, unchanged).
 */
export const FLOW_REGISTRY = [
  {
    id: 'launchPlan',
    Component: LaunchPlanTile,
    visible: (s) => !!launchPlanMode(s.campaign, s.facts?.factsDaily?.length || 0),
  },
  { id: 'alerts', Component: AlertsTile },
  { id: 'lineItems', Component: LineItemsTile },
  { id: 'journal', Component: JournalTile },
];

export const FLOW_IDS = FLOW_REGISTRY.map((e) => e.id);
