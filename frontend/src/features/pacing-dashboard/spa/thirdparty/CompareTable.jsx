import { Fragment, useMemo, useState } from 'react';

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString();
}

// delta is a RATIO (fraction) or null (delivery 0). Rendered signed % to 1dp with
// a real minus sign (mockup: −2.5% / +0.4%); null → em-dash.
function fmtDelta(delta) {
  if (delta == null) return '—';
  const pct = delta * 100;
  if (pct > 0) return '+' + pct.toFixed(1) + '%';
  return pct.toFixed(1).replace('-', '−') + '%';
}

// Full-cell background tint by |Δ| corridor (never a stripe / left border):
// ≤10% green, ≤25% amber, beyond red; no tint when Δ is null.
function tintClass(delta) {
  if (delta == null) return '';
  const a = Math.abs(delta * 100);
  if (a <= 10) return 'tp-delta-green';
  if (a <= 25) return 'tp-delta-amber';
  return 'tp-delta-red';
}

function keyLabel(key) {
  if (!Array.isArray(key) || key.length === 0) return 'All';
  return key.join(' · ');
}

function anyNonZero(m) {
  return (m.impressions || 0) + (m.clicks || 0) + (m.completions || 0) > 0;
}

// The three metric cells (Delivery | CM360 | Δ) for one entry {delivery,cm360,delta}.
// `side` scopes the render: undefined/'overlap' → both sides + Δ (the only place Δ
// shows); 'delivery' → delivery value only, CM360 and Δ as em-dashes; 'cm360' → the
// mirror. Scoped rows never carry a Δ (v3.1 §10-1: Δ is meaningful only for overlap).
function MetricCells({ entry, metric, keyPrefix, side }) {
  const del = entry?.delivery?.[metric] ?? 0;
  const cm = entry?.cm360?.[metric] ?? 0;
  const delta = entry?.delta ? entry.delta[metric] : null;
  if (side === 'delivery' || side === 'cm360') {
    return (
      <>
        <td key={keyPrefix + 'd'} className={`tp-td tp-td-r tp-num${side === 'delivery' ? '' : ' tp-scope-dash'}`}>
          {side === 'delivery' ? fmtNum(del) : '—'}
        </td>
        <td key={keyPrefix + 'c'} className={`tp-td tp-td-r tp-num${side === 'cm360' ? '' : ' tp-scope-dash'}`}>
          {side === 'cm360' ? fmtNum(cm) : '—'}
        </td>
        <td key={keyPrefix + 'x'} className="tp-td tp-td-r tp-num tp-scope-dash">—</td>
      </>
    );
  }
  return (
    <>
      <td key={keyPrefix + 'd'} className="tp-td tp-td-r tp-num">{fmtNum(del)}</td>
      <td key={keyPrefix + 'c'} className="tp-td tp-td-r tp-num">{fmtNum(cm)}</td>
      <td key={keyPrefix + 'x'} className={`tp-td tp-td-r tp-num tp-delta ${tintClass(delta)}`}>{fmtDelta(delta)}</td>
    </>
  );
}

// Contributing sources for a group in the dashboard's selected date window —
// delivery LIs on the left, CM360 placements on the right.
function ExpansionRow({ members, metric, colSpan }) {
  const del = [...(members.delivery || [])].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  const cm = [...(members.cm360 || [])].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  return (
    <tr className="tp-subrow">
      <td className="tp-exp-cell" colSpan={colSpan}>
        <div className="tp-exp">
          <div className="tp-exp-col">
            <div className="tp-exp-hd">Delivery — {del.length} {del.length === 1 ? 'row' : 'rows'}</div>
            {del.length ? del.map((c) => (
              <div className="tp-exp-item" key={'d' + c.key}>
                <span className="tp-exp-name" title={c.display || c.key}>{c.display || c.key}</span>
                <span className="tp-exp-num">{fmtNum(c[metric])}</span>
              </div>
            )) : <div className="tp-exp-empty">No delivery rows.</div>}
          </div>
          <div className="tp-exp-col">
            <div className="tp-exp-hd">CM360 — {cm.length} {cm.length === 1 ? 'row' : 'rows'}</div>
            {cm.length ? cm.map((c) => (
              <div className="tp-exp-item" key={'c' + c.key}>
                <span className="tp-exp-name" title={c.display || c.key}>{c.display || c.key}</span>
                <span className="tp-exp-num">{fmtNum(c[metric])}</span>
              </div>
            )) : <div className="tp-exp-empty">No CM360 rows.</div>}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function CompareTable({
  rows, unmapped, dims, metric, getMembers, onOpenMapping,
  focusedId, onFocusRow,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  // Non-overlap scope groups (delivery_only / cm360_only) collapse by default,
  // like Unmapped. Separate from `expanded`, which drives per-row contributor drill-in.
  const [openGroups, setOpenGroups] = useState(() => new Set());

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (id) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const dataRows = Array.isArray(rows) ? rows : [];
  const breakdownHeader = Array.isArray(dims) && dims.length ? dims.map((d) => d.name).join(' · ') : 'All';

  // Rows sorted by the current metric's Delivery value (desc), like the mockup.
  const sortedRows = useMemo(() => {
    const copy = dataRows.slice();
    copy.sort((a, b) => {
      const av = a.delivery?.[metric] ?? 0, bv = b.delivery?.[metric] ?? 0;
      if (bv !== av) return bv - av;
      const ac = a.cm360?.[metric] ?? 0, bc = b.cm360?.[metric] ?? 0;
      if (bc !== ac) return bc - ac;
      return keyLabel(a.key) < keyLabel(b.key) ? -1 : 1;
    });
    return copy;
  }, [dataRows, metric]);

  // Split by v3.1 scope (engine-assigned, mode-stable). Overlap rows are the main
  // table (the only place Δ shows); the two one-sided groups collapse below it.
  // Filtering the already-sorted list preserves each group's metric ordering.
  const overlapRows = useMemo(
    () => sortedRows.filter((r) => r.scope !== 'delivery_only' && r.scope !== 'cm360_only'),
    [sortedRows],
  );
  const deliveryOnlyRows = useMemo(
    () => sortedRows.filter((r) => r.scope === 'delivery_only'),
    [sortedRows],
  );
  const cm360OnlyRows = useMemo(
    () => sortedRows.filter((r) => r.scope === 'cm360_only'),
    [sortedRows],
  );

  const totalCols = 4;
  const unmappedActive = unmapped
    && (anyNonZero(unmapped.delivery || {}) || anyNonZero(unmapped.cm360 || {}));

  const renderMetricHead = () => (
    <>
      <th className="tp-th tp-th-r">Delivery</th>
      <th className="tp-th tp-th-r">CM360</th>
      <th className="tp-th tp-th-r">Δ</th>
    </>
  );

  const renderMetricBody = (row, idPrefix, side) => (
    <MetricCells entry={row} metric={metric} keyPrefix={idPrefix} side={side} />
  );

  // One pivot data row + its contributing-sources expansion. `side` scopes the
  // metric cells; undefined = overlap.
  //
  // Interaction split (v3.1 follow-up): on OVERLAP rows the click targets are
  // separated — the chevron (now a real button, aria-expanded) toggles the
  // expansion; the row body (aria-pressed) toggles CHART FOCUS on the tuple.
  // One-sided scoped rows are NOT focusable (nothing to compare), so they keep
  // the original whole-row expansion behaviour with aria-expanded on the row.
  const renderPivotRow = (row, side) => {
    const id = JSON.stringify(row.key);
    const isOpen = expanded.has(id);
    const focusable = side === undefined && typeof onFocusRow === 'function';
    const isFocused = focusable && focusedId === id;
    const activate = focusable ? () => onFocusRow(row.key) : () => toggle(id);
    return (
      <Fragment key={id}>
        <tr
          className={`tp-row${isFocused ? ' tp-row-focused' : ''}`}
          role="button"
          tabIndex={0}
          {...(focusable ? { 'aria-pressed': isFocused } : { 'aria-expanded': isOpen })}
          onClick={activate}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (e.key === ' ') e.preventDefault();
              activate();
            }
          }}
        >
          <td className="tp-td tp-td-l">
            <span className="tp-li">
              {focusable ? (
                <button
                  type="button"
                  className="tp-caret-btn"
                  aria-expanded={isOpen}
                  aria-label={`Contributing sources — ${keyLabel(row.key)}`}
                  onClick={(e) => { e.stopPropagation(); toggle(id); }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <svg className="tp-caret" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
                  </svg>
                </button>
              ) : (
                <svg className="tp-caret" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
              )}
              <span className="tp-li-text">{keyLabel(row.key)}</span>
            </span>
          </td>
          {renderMetricBody(row, id, side)}
        </tr>
        {isOpen && (
          <ExpansionRow members={getMembers(row.key)} metric={metric} colSpan={totalCols} />
        )}
      </Fragment>
    );
  };

  // A collapsed one-sided scope group: chevron header row (count in the header) +,
  // when open, its rows rendered one-sided. Hidden entirely when empty.
  const renderScopeGroup = (scopeKey, label, groupRows, side) => {
    if (groupRows.length === 0) return null;
    const open = openGroups.has(scopeKey);
    return (
      <Fragment key={'grp-' + scopeKey}>
        <tr>
          <td className="tp-unmatched-cell" colSpan={totalCols}>
            <button
              type="button"
              className="tp-unmatched-head"
              aria-expanded={open}
              onClick={() => toggleGroup(scopeKey)}
            >
              <svg className="tp-chevron" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
              <span className="tp-scope-title">{label}</span>
              <span className="tp-scope-count">{groupRows.length}</span>
            </button>
          </td>
        </tr>
        {open && groupRows.map((row) => renderPivotRow(row, side))}
      </Fragment>
    );
  };

  return (
    <div className="tp-table-wrap">
      <table className="tp-table">
        <thead>
          <tr>
            <th className="tp-th tp-th-l">{breakdownHeader}</th>
            {renderMetricHead()}
          </tr>
        </thead>
        <tbody>
          {overlapRows.map((row) => renderPivotRow(row, undefined))}

          {/* Zero overlap but data exists on one/both sides: explain the empty main
              area; the scope groups still render collapsed below. */}
          {overlapRows.length === 0 && (deliveryOnlyRows.length > 0 || cm360OnlyRows.length > 0) && (
            <tr>
              <td className="tp-td tp-nodata-cell" colSpan={totalCols}>
                No overlapping slices yet — check dimension values and aliases cover both sides.
              </td>
            </tr>
          )}

          {/* Truly nothing classified into the breakdown (no overlap, no scoped, no unmapped). */}
          {overlapRows.length === 0 && deliveryOnlyRows.length === 0
            && cm360OnlyRows.length === 0 && !unmappedActive && (
            <tr>
              <td className="tp-td tp-nodata-cell" colSpan={totalCols}>
                Nothing classified into this breakdown.
              </td>
            </tr>
          )}

          {renderScopeGroup('delivery_only', 'Delivery only', deliveryOnlyRows, 'delivery')}
          {renderScopeGroup('cm360_only', 'CM360 only — out of pacing scope', cm360OnlyRows, 'cm360')}

          {unmappedActive && (
            <tr
              className={`tp-unmapped-row${onOpenMapping ? ' tp-clickable' : ''}`}
              {...(onOpenMapping
                ? {
                  role: 'button',
                  tabIndex: 0,
                  onClick: onOpenMapping,
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenMapping(); }
                  },
                }
                : { title: 'Classify in Settings → Mapping' })}
            >
              <td className="tp-td tp-td-l">
                <span className="tp-unmapped-label">
                  Unmapped
                  {onOpenMapping && <span className="tp-unmapped-hint">Classify →</span>}
                </span>
              </td>
              {renderMetricBody(unmapped, 'unmapped')}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
