// workspace/src/pages/Dashboard/components/Widgets/WidgetFrame.jsx
//
// Shared chrome for canonical Widget tiles: the chart-panel visual skeleton, a badge,
// an optional scope chip, tile actions and an error boundary. Viewer controls belong
// to ReportWidget; the frame never reads or writes Widget state.

import { Component } from 'react';
// Compact badge text: WHAT is pinned, readable in a client screenshot (UX round — a bare
// "scoped" said nothing outside its hover tooltip). Shared with the report builder's Data
// chip, which says the same fact about the same widget and must say it in the same words.
import { scopeBadge } from '../scope-text.js';
// The forward-compat sentence, from the door that owns the v2 vocabulary — the same
// words the gallery miniature and the editor say for a row a newer build stored.
import { FUTURE_VERSION } from '../report-v2.js';

function scopeTip(scope) {
  const parts = [];
  if (scope?.channels?.length) parts.push(`Channels: ${scope.channels.join(', ')}`);
  if (scope?.lis?.length) parts.push(`Line items: ${scope.lis.join(', ')}`);
  if (scope?.dims?.length) parts.push(`Dims: ${scope.dims.map((d) => `${d.key}=${d.value}`).join(', ')}`);
  // The time pin ignores the PERIOD SCOPE only — the global date-range filter still
  // applies (round 9: the blanket "override global" heading overstated it).
  if (scope?.time === 'absolute') parts.push('Time: always current — ignores the selected period; the global date range still applies');
  return `Pinned filters (override global): ${parts.join(' · ')}`;
}

export class WidgetErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error(`[WIDGET:${this.props.widgetId}]`, error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="text-12" style={{ color: 'var(--error-text)', padding: '14px 12px', fontFamily: 'var(--font-mono)' }}>
          Widget error: {String(this.state.error?.message || this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

/** Formula-error body: shown when a STORED config fails validation (never crashes). */
export function WidgetErrorState({ message }) {
  return (
    <div className="text-12" style={{ padding: '14px 12px', color: 'var(--error-text)' }}>
      Formula error: <span style={{ fontFamily: 'var(--font-mono)' }}>{message}</span>
      <div className="text-11" style={{ color: 'var(--text-muted)', marginTop: 4 }}>
        Fix it in Settings → Display → the widget&rsquo;s editor.
      </div>
    </div>
  );
}

/**
 * A tile whose LIBRARY ENTRY cannot be resolved (widget-library spec §3.3).
 * Its own body, deliberately NOT WidgetErrorState: that one opens with
 * "Formula error:" and sends the reader to the widget's editor. Neither is true
 * here — there is no formula, and a linked instance has no editor until it is
 * detached. The actions that can end this state live in the tile's ⋯ menu, so
 * that is where it points.
 */
export function WidgetMissingEntry() {
  return (
    <div className="wgf-gone">
      This tile follows a library entry that is no longer available.
      <div className="wgf-gone-h">
        Delete it from this tile&rsquo;s &#8943; menu, or from Settings &rarr; Display.
      </div>
    </div>
  );
}

/**
 * A widget a NEWER build stored (widget-builder v2 spec §15; P2 Task 11). Its own body
 * for the same reason the two above have one: it is not a formula error and not a broken
 * link, and there is nothing to fix in an editor — this build simply does not speak the
 * version. Framed like any other tile, so the dashboard reads as a dashboard with one
 * tile that cannot draw, never as a rendering bug.
 *
 * The sentence is the door's (`FUTURE_VERSION`) — the same words the gallery miniature
 * and the editor say for the same row.
 */
export function WidgetNeedsNewerApp() {
  return (
    <div className="wgf-gone">
      {FUTURE_VERSION}
      <div className="wgf-gone-h">
        Reload the page to pick up the latest version of the app.
      </div>
    </div>
  );
}

/** `preview` keeps tile actions off editor/gallery/Layout preview surfaces. */
/**
 * `note` — one muted line under the body, for something true about the whole tile
 * that its own numbers cannot say. Today that is dimension-source coverage: a
 * device widget totals what the source reported, which is a fraction of delivery,
 * and beside a delivery KPI on the same dashboard it otherwise reads as broken.
 * Rendered only when a caller passes one, so every other tile is untouched.
 */
/**
 * `menu` — an optional actions element (TileMenu) rendered as the LAST item of the
 * title row. Default null, so every preview surface — the gallery thumbnail, the
 * editor's live preview, Layout mode's inert content — stays exactly as it is: only
 * DashGrid passes one (spec 2026-07-22 §3.1).
 *
 * The menu sits in the right-aligned `.wgf-actions` group on the live dashboard.
 */
/**
 * `subtitle` — one line under the tile's name, for what the tile's own numbers cannot say
 * about themselves: today that is the window a date table covers and how many line items are
 * in it (section-widget parity, 2026-09-04). Rendered only when a caller passes one, so every
 * other tile keeps exactly the title row it had.
 */
export default function WidgetFrame({ widget, children, flush = false, badge = 'custom', preview = false, note = null, menu = null, subtitle = null }) {
  const scoped = !!(widget.scope && (widget.scope.channels?.length || widget.scope.lis?.length
    || widget.scope.dims?.length || widget.scope.time === 'absolute'));
  return (
    <div className="chart-panel">
      {/* .chart-panel__title owns the frame structure; .wgf-title adds the canonical
          Widget title's wrap rule. */}
      <div className="chart-panel__title wgf-title">
        <span>{widget.title || 'Untitled widget'}</span>
        <span className="text-9" style={{
          fontFamily: 'var(--font-barlow)', fontWeight: 700, letterSpacing: '0.07em',
          textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--rxs)',
          background: 'var(--surface-tertiary)', color: 'var(--text-muted)',
        }}>
          {badge}
        </span>
        {scoped && (
          <span
            className="text-9 ui-tip"
            data-tip={scopeTip(widget.scope)}
            style={{
              fontFamily: 'var(--font-barlow)', fontWeight: 700, letterSpacing: '0.07em',
              textTransform: 'uppercase', padding: '2px 6px', borderRadius: 'var(--rxs)',
              background: 'var(--status-amber-dim)', color: 'var(--status-amber)', cursor: 'help',
            }}
          >
            {scopeBadge(widget.scope) || 'scoped'}
          </span>
        )}
        {!preview && menu && (
          <span className="wgf-actions">
            {menu}
          </span>
        )}
        {/* LAST in the row, and full-width by its own class: the title row already wraps, so
            the subtitle lands on its own line under the name without re-nesting the row. */}
        {subtitle && <span className="text-11 wgf-sub">{subtitle}</span>}
      </div>
      <div className={flush ? 'chart-panel__flush' : 'chart-panel__body'}>
        <WidgetErrorBoundary widgetId={widget.id}>{children}</WidgetErrorBoundary>
      </div>
      {note && (
        <div
          className="text-10"
          style={{
            padding: flush ? '7px 12px 9px' : '0 12px 9px',
            borderTop: flush ? '1px solid var(--border-soft)' : 'none',
            color: 'var(--text-muted)',
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}
