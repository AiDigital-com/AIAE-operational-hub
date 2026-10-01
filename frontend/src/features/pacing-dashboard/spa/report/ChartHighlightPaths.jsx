import { useId } from 'react';
import { Curve } from 'recharts';
import { highlightPaint } from '../widget-highlights.js';

// Paint the original complete curve through contiguous clips. Recomputing a curve
// from a shortened run changes its interpolation and moves the data visually.
export function highlightStrokeBands(points, key, base, horizontal = false) {
  const axis = horizontal ? 'y' : 'x';
  const groups = new Map();
  points.forEach((point, index) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const style = point.payload?.highlights?.[key]?.style || {};
    const color = style.color ? highlightPaint(style.color) : base.color;
    const width = style.strokeWidth ?? base.width;
    const signature = `${color}|${width}`;
    if (!groups.has(signature)) groups.set(signature, { color, width, ranges: [] });
    const before = points[index - 1]?.[axis];
    const after = points[index + 1]?.[axis];
    const position = point[axis];
    const from = Number.isFinite(before) ? (before + position) / 2 : position - 16;
    const to = Number.isFinite(after) ? (position + after) / 2 : position + 16;
    const range = [Math.min(from, to), Math.max(from, to)];
    const ranges = groups.get(signature).ranges;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === range[0]) last[1] = range[1];
    else ranges.push(range);
  });
  return [...groups.values()];
}

export default function ChartHighlightPaths({ formattedGraphicalItems, series, horizontal }) {
  const uid = useId().replace(/:/g, '');
  return <g className="rpt-highlight-curves" pointerEvents="none">
    {(formattedGraphicalItems || []).map((entry, index) => {
      const key = entry.item?.props?.dataKey;
      const spec = series.find((item) => item.key === key);
      if (!spec || !spec.highlightStroke) return null;
      const points = entry.props?.points || [];
      if (!points.length) return null;
      const bands = highlightStrokeBands(points, key, spec.highlightStroke, horizontal);
      const xs = points.map((point) => point.x).filter(Number.isFinite);
      const ys = points.map((point) => point.y).filter(Number.isFinite);
      const low = Math.min(...(horizontal ? xs : ys)) - 16;
      const high = Math.max(...(horizontal ? xs : ys)) + 16;
      return <g key={key}>
        {bands.map((band, bandIndex) => {
          const id = `${uid}-${index}-${bandIndex}`;
          return <g key={id}>
            <defs><clipPath id={id}>{band.ranges.map(([from, to], rangeIndex) => (
              <rect key={rangeIndex} x={horizontal ? low : from} y={horizontal ? from : low}
                width={horizontal ? high - low : to - from} height={horizontal ? to - from : high - low} />
            ))}</clipPath></defs>
            <Curve points={points} type={spec.highlightStroke.curve} layout={horizontal ? 'vertical' : 'horizontal'}
              connectNulls={false} fill="none" stroke={band.color} strokeWidth={band.width}
              strokeDasharray={spec.highlightStroke.dash} strokeOpacity={spec.opacity ?? 1}
              clipPath={`url(#${id})`} />
          </g>;
        })}
      </g>;
    })}
  </g>;
}
