/**
 * The Line Items block, moved from Pacing's `pages/Dashboard/tile-registry.jsx` (the `LineItemsTile`
 * entry, plus the two wrappers it renders inside).
 *
 * Nothing inside a function changed - only the import specifiers, the same rule the rest of this
 * folder follows. What came over with it, and is the reason the block is cheap to mount:
 *
 *   - six cards render by default (`liVisibleLimit`), the rest behind "Show all";
 *   - beyond that the list fills in batches of 40 (`LINE_ITEMS_STEP`) through `requestIdleCallback`,
 *     so a 180-line-item pacing never builds 180 cards in one commit;
 *   - the search box runs under `useDeferredValue`, so typing does not block on the filter;
 *   - `LineItemCard` is memoized on its own props, and the figures it reads come from selectors
 *     cached per filter key - six cards share one computation, they do not each pay for it.
 *
 * In Pacing this was one entry in a registry the dashboard grid placed. Here it is mounted directly
 * by `pacing-dashboard.tsx`, beside Alerts, Breakdown and the Journal, because this app's functional
 * blocks are page-level and only widgets go through the board.
 */
import { Component, useDeferredValue, useEffect, useMemo, useState } from 'react';
import LineItemCard from './LineItemCard.jsx';
import { groupLineItemsByChannel } from '../row-utils.js';
import { useDisplay, useLiPlan, useFilters, useCardLIs } from '../store.js';
import { useDashboardStore } from '../store.js';

const INITIAL_LINE_ITEMS = 40;
const LINE_ITEMS_STEP = 40;

export class SectionBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error(`[SECTION:${this.props.name}]`, error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="text-12" style={{ color: 'var(--error-text)', padding: 8, fontFamily: 'monospace' }}>
          Error in {this.props.name}: {String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}


export function SectionCard({ title, children, flush }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--dash-radius-card, 6px)',
      overflow: 'hidden',
      marginBottom: 16,
      contentVisibility: 'auto',
      containIntrinsicBlockSize: 360,
    }}>
      {title && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid var(--border-soft)',
          gap: 12, flexWrap: 'wrap', background: 'var(--surface)',
        }}>
          <span className="text-12" style={{
            fontFamily: 'var(--font-sans)', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}>
            {title}
          </span>
        </div>
      )}
      <div style={{ padding: flush ? 0 : '20px' }}>
        {children}
      </div>
    </div>
  );
}

export default function LineItemsTile() {
  const display = useDisplay();
  const liPlan = useLiPlan();
  const { filters, setFilters } = useFilters();

  const [searchQuery, setSearchQuery] = useState('');
  const [liExpanded, setLiExpanded] = useState(false);
  const liVisibleLimit = 6;
  const deferredQuery = useDeferredValue(searchQuery);

  // Card list: channel + label filters only.
  // Selection is a visual highlight on cards, NOT a card visibility filter.
  // Metric surfaces (AlertsBlock, the report tiles, etc.) consume effLIs
  // (which includes selection filtering) via their own useEffLIs() calls.
  const cardLIs = useCardLIs();
  const lineItems = cardLIs;
  const liNames = display?.liNames ?? {};

  // Filter line items by search query
  const visibleLineItems = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return lineItems;
    return lineItems.filter((id) => {
      const p = liPlan?.[id];
      if (!p) return false;
      // Match against LI id
      if (String(id).toLowerCase().includes(q)) return true;
      // Match against custom name
      const customName = liNames[id];
      if (customName && customName.toLowerCase().includes(q)) return true;
      // Match against channel
      if (p.ch && p.ch.toLowerCase().includes(q)) return true;
      // Match against labels
      if (Array.isArray(p.labels) && p.labels.some((l) => l.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [lineItems, deferredQuery, liPlan, liNames]);
  const deferredVisibleLineItems = useDeferredValue(visibleLineItems);
  const [lineItemRenderCount, setLineItemRenderCount] = useState(INITIAL_LINE_ITEMS);

  const visibleCount = deferredVisibleLineItems.length;
  useEffect(() => {
    const total = visibleCount;
    setLineItemRenderCount(Math.min(INITIAL_LINE_ITEMS, total));

    if (total <= INITIAL_LINE_ITEMS) return undefined;

    let timeoutId = null;
    let idleId = null;
    let cancelled = false;

    const scheduleMore = () => {
      const run = () => {
        if (cancelled) return;
        setLineItemRenderCount((prev) => {
          const next = Math.min(prev + LINE_ITEMS_STEP, total);
          if (next < total) scheduleMore();
          return next;
        });
      };

      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(run, { timeout: 120 });
      } else {
        timeoutId = window.setTimeout(run, 32);
      }
    };

    scheduleMore();

    return () => {
      cancelled = true;
      if (idleId != null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [visibleCount]);

  const renderedLineItems = deferredVisibleLineItems.slice(0, lineItemRenderCount);
  // Channel view: grouped, collapsible, ranked by delivery. Offered only when
  // there is more than one channel to separate.
  const [byChannel, setByChannel] = useState(false);
  const [collapsedChannels, setCollapsedChannels] = useState({});
  const liDailyForChannels = useDashboardStore((st) => st.facts?.liDaily);
  const channelGroups = useMemo(
    () => groupLineItemsByChannel(deferredVisibleLineItems, liPlan, liDailyForChannels),
    [deferredVisibleLineItems, liPlan, liDailyForChannels],
  );
  const channelCount = channelGroups.length;
  const liVisible = liExpanded ? renderedLineItems : renderedLineItems.slice(0, liVisibleLimit);
  const liOverflow = liExpanded
    ? false
    : (renderedLineItems.length > liVisibleLimit) || (deferredVisibleLineItems.length > renderedLineItems.length);

  return (
    <SectionCard title="Line Items" flush>
      <SectionBoundary name="LineItems">
        {channelCount > 1 && (
          <div className="lis-view">
            <button type="button" className={byChannel ? 'sp-tp-link' : 'sp-tp-link confirm'}
              onClick={() => setByChannel(false)}>All lines</button>
            <button type="button" className={byChannel ? 'sp-tp-link confirm' : 'sp-tp-link'}
              onClick={() => setByChannel(true)}>By channel</button>
          </div>
        )}
        {/* Search input */}
        <div style={{ padding: '16px 20px 8px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search line items..."
            className={[
              'w-full px-3.5 py-2.5 text-13 font-[var(--font-sans)]',
              'bg-[var(--surface)] text-[var(--text-primary)]',
              'border border-[var(--border-soft)] shadow-[inset_0_1px_0_var(--edge)]',
              'placeholder:text-[var(--text-muted)]',
              'hover:border-[var(--border-hover)] focus:border-[var(--accent)] focus:outline-none',
              'transition-colors',
            ].join(' ')}
            style={{ borderRadius: 'var(--dash-radius-control, 10px)' }}
          />
        </div>
        <div>
          <div style={{
            maxHeight: liExpanded ? 'none' : 920,
            overflowY: liExpanded ? 'visible' : 'auto',
          }}>
            {/* Grouped by channel, biggest first. The list has only ever been
                flat with a search box, though every line item carries `ch` and
                the search already matched on it — so "show me the CTV ones"
                meant typing and hoping. Off by default: a single-channel pacing
                would gain one header and nothing else. */}
            {byChannel && channelGroups.map((g) => (
              <div key={g.channel}>
                <button
                  type="button"
                  className="sp-tp-block-row lis-ch-head"
                  onClick={() => setCollapsedChannels((cur) => ({ ...cur, [g.channel]: !cur[g.channel] }))}
                >
                  <span className="sp-chevron">{collapsedChannels[g.channel] ? '▸' : '▾'}</span>
                  <span className="sp-tp-block-count">{g.channel}</span>
                  <span className="text-11">
                    {g.ids.length} {g.ids.length === 1 ? 'line' : 'lines'}
                    {g.impressions > 0 ? ` · ${g.impressions.toLocaleString('en-US')} impr` : ''}
                  </span>
                </button>
                {!collapsedChannels[g.channel] && g.ids.map((id) => (
                  <LineItemCard key={id} liId={id} filters={filters} setFilters={setFilters} />
                ))}
              </div>
            ))}
            {!byChannel && liVisible.map((id) => (
              <LineItemCard key={id} liId={id} filters={filters} setFilters={setFilters} />
            ))}
            {liOverflow && (
              <div
                style={{
                  position: 'sticky',
                  bottom: 0,
                  zIndex: 1,
                  background: 'var(--surface)',
                  borderTop: '1px solid var(--border-soft)',
                  padding: '10px 20px',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <button
                  type="button"
                  className="text-12"
                  onClick={() => {
                    setLiExpanded(true);
                    if (renderedLineItems.length < deferredVisibleLineItems.length) {
                      setLineItemRenderCount(deferredVisibleLineItems.length);
                    }
                  }}
                  style={{
                    border: '1px solid var(--border-soft)',
                    background: 'var(--surface-alt)',
                    color: 'var(--text-secondary)',
                    borderRadius: 'var(--dash-radius-chip, 4px)',
                    padding: '6px 14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Show all ({deferredVisibleLineItems.length})
                </button>
              </div>
            )}
          </div>
          {liExpanded && deferredVisibleLineItems.length > liVisibleLimit && (
            <div
              style={{
                borderTop: '1px solid var(--border-soft)',
                padding: '10px 20px',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <button
                type="button"
                className="text-12"
                onClick={() => setLiExpanded(false)}
                style={{
                  border: '1px solid var(--border-soft)',
                  background: 'var(--surface-alt)',
                  color: 'var(--text-secondary)',
                  borderRadius: 'var(--dash-radius-chip, 4px)',
                  padding: '6px 14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Collapse to {liVisibleLimit}
              </button>
            </div>
          )}
          {deferredQuery && deferredVisibleLineItems.length === 0 && (
            <div className="text-center text-13 text-[var(--text-muted)] py-6">
              No line items match &ldquo;{deferredQuery}&rdquo;
            </div>
          )}
        </div>
      </SectionBoundary>
    </SectionCard>
  );
}
