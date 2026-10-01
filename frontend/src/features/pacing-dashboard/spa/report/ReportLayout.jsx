import { brickRenderer, columnBadge } from './brick-registry.jsx';
import { CardChrome } from '../ui/index.js';

function LayoutColumn({ column, ctx }) {
  const badge = column.frame === 'none' ? null : columnBadge(column.badge, ctx);
  const columnCtx = badge && badge.status ? { ...ctx, status: badge.status } : ctx;
  const body = (column.bricks || []).map((brick, index) => {
    const Renderer = brickRenderer(brick.type);
    return Renderer ? <Renderer key={index} brick={brick} ctx={columnCtx} /> : null;
  });

  if (column.frame === 'card') {
    return <CardChrome title={column.title} badge={badge && badge.node}>{body}</CardChrome>;
  }
  if (column.frame === 'signal') {
    return (
      <div className="cmp-signal">
        {column.title && <div className="cmp-signal-t">{column.title}</div>}
        {column.sub && <div className="cmp-signal-s">{column.sub}</div>}
        {body}
      </div>
    );
  }
  return <div className="cmp-col">{body}</div>;
}

/** The canonical Layout View. It owns arrangement only; every typed block still resolves
 * through the same registry/value layer as the standard dashboard cards it replaces. */
export default function ReportLayout({ view, ctx, compact = false }) {
  if (!view || !ctx) return null;
  return (
    <div className="rpt-view">
      {view.title ? <div className="text-11 rpt-view-title">{view.title}</div> : null}
      <div className={`cmp${compact ? ' cmp--compact' : ''}`}>
        {(view.rows || []).map((row, rowIndex) => {
          const columns = row && Array.isArray(row.cols) ? row.cols : [];
          return (
            <div
              className="cmp-row"
              key={rowIndex}
              data-cols={columns.length}
              style={{
                gridTemplateColumns: columns.every((column) => column.span == null)
                  ? undefined
                  : columns.map((column) => `${column.span || 1}fr`).join(' '),
              }}
            >
              {columns.map((column, columnIndex) => (
                <LayoutColumn key={columnIndex} column={column} ctx={ctx} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
