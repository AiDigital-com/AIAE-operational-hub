import { CardChrome } from '../ui/index.js';
import { brickRenderer, columnBadge } from './brick-registry.jsx';
import { LIMITS } from '../report-v2.js';
import './ReportComposition.css';

/** One composition tree on every surface. Data belongs to the widget; containers
 * arrange children and pass a badge status down to their small blocks. */
export default function ReportComposition({ nodes, renderLeaf, renderPair, nodeProps, ctx, editor = null, depth = 1, direction = 'column', distribution = null }) {
  if (depth > LIMITS.compositionDepth) return null;
  const list = (Array.isArray(nodes) ? nodes : []).slice(0, LIMITS.compositionNodes);
  const renderNode = (node, index, presentation = null) => {
    if (!node || typeof node !== 'object') return null;
    const selected = editor && (editor.selectedIds || [editor.selectedId]).includes(node.id);
    const label = editor?.labelFor?.(node) || node.title || node.brick?.label || node.brick?.type || node.kind;
    const drop = editor?.drag?.targetId === node.id ? editor.drag.placement : null;
    const badge = node.kind === 'container' ? columnBadge(node.badge, ctx || {}) : null;
    const visibleBadge = node.hideBadge ? null : badge?.node;
    const childCtx = badge?.status ? { ...ctx, status: badge.status } : ctx;
    let content;
    if (editor && node.editorHidden) {
      content = <div className="rpt-composition-placeholder"><b>{label}</b><span>{node.editorHidden}</span></div>;
    } else if (node.kind === 'container') {
      const children = Array.isArray(node.children) ? node.children : [];
      const row = node.direction === 'row';
      const contentWidths = row && node.distribution === 'content';
      const defaultGap = !row && children.every((child) => child?.kind === 'atom') ? 10 : ctx?.compact ? 8 : 14;
      const gap = { tight: 5, compact: 8, normal: 14, relaxed: 20 }[node.gap] ?? (contentWidths ? '4px 12px' : defaultGap);
      const subtitle = node.sub && !node.hideSubtitle ? <div className="cmp-signal-s">{node.sub}</div> : null;
      const body = (
        <div className={`rpt-composition-body ${contentWidths ? 'rpt-row' : row ? 'cmp-row' : 'cmp-col'}`} data-cols={row ? children.length : undefined}
          style={{ gap, ...(row && !contentWidths ? { gridTemplateColumns: children.map((child) => `minmax(0, ${child?.span || 1}fr)`).join(' ') } : {}) }}>
          <ReportComposition nodes={children} renderLeaf={renderLeaf} renderPair={renderPair} nodeProps={nodeProps} ctx={childCtx} editor={editor} depth={depth + 1} direction={node.direction} distribution={contentWidths ? 'content' : null} />
          {children.length === 0 && editor && <span className="rpt-state rpt-state--line">Add an element to this container</span>}
        </div>
      );
      if (node.frame === 'card') content = <CardChrome title={node.title} badge={visibleBadge}>{subtitle}{body}</CardChrome>;
      else if (node.frame === 'signal') content = <div className="cmp-signal rpt-composition-signal">
        {visibleBadge ? <div className="kit-card-hd"><span className="cmp-signal-t">{node.title}</span>{visibleBadge}</div>
          : node.title && <div className="cmp-signal-t">{node.title}</div>}
        {subtitle}{body}
      </div>;
      else content = <>{visibleBadge ? <div className="kit-card-hd"><span className="text-11 rpt-view-title">{node.title}</span>{visibleBadge}</div>
        : node.title && <div className="text-11 rpt-view-title">{node.title}</div>}{subtitle}{body}</>;
    } else if (node.kind === 'atom') {
      const Renderer = brickRenderer(node.brick?.type);
      content = Renderer ? <Renderer brick={node.brick} ctx={ctx || {}} /> : null;
    } else content = renderLeaf(node, { previous: direction === 'row' && nodes[index - 1]?.kind !== 'container' ? nodes[index - 1] : null, presentation });
    return <div key={node.id || index} {...nodeProps?.(node)} data-composition-node={node.id}
      data-pie-table={presentation?.role}
      data-composition-drop={editor ? node.id : undefined}
      data-composition-axis={editor ? direction : undefined}
      data-composition-drop-axis={drop ? editor.drag.axis : undefined}
      data-composition-label={editor ? label : undefined}
      className={`rpt-composition-node rpt-composition-${node.kind === 'container' ? 'container' : node.kind === 'atom' ? 'atom' : 'view'}${selected ? ' rpt-composition-node--selected' : ''}${drop ? ` rpt-composition-drop--${drop}` : ''}${editor?.drag?.nodeId === node.id ? ' rpt-composition-node--dragging' : ''}${depth === 1 && ctx?.compact ? ' cmp--compact' : ''}`}
      style={{ minWidth: 0, ...(!presentation && distribution === 'content' ? (node.kind === 'pie' || node.kind === 'kpi'
        ? { flex: '0 1 auto', maxWidth: '100%' } : { flex: '1 1 320px', overflowX: 'auto' }) : {}) }}
      role={editor ? 'group' : undefined}
      aria-label={editor ? label : undefined}
      onClick={editor ? (event) => {
        event.stopPropagation();
        if (globalThis.getSelection?.()?.type === 'Range') return;
        editor.onSelect?.(node.id, { additive: event.ctrlKey || event.metaKey });
      } : undefined}>
      {content}
      {editor && <div className="rpt-composition-empty-placeholder" aria-hidden="true">{label} · No content in this context</div>}
      {drop && <span className="rpt-composition-drop-caption">{`${drop === 'inside' ? 'Inside' : drop === 'before' ? 'Before' : 'After'} ${label}`}</span>}
    </div>;
  };
  const out = [];
  for (let index = 0; index < list.length; index++) {
    const at = index;
    const node = list[index];
    const next = list[index + 1];
    const pair = direction === 'row' && distribution === 'content' && next && renderPair?.(node, next,
      (child, presentation) => renderNode(child, child === node ? at : at + 1, presentation));
    if (pair) { out.push(pair); index++; }
    else out.push(renderNode(node, index));
  }
  return out;
}
