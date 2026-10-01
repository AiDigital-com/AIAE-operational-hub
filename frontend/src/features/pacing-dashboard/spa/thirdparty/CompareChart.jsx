import { memo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis, YAxis, Tooltip, Legend,
  CartesianGrid,
} from 'recharts';
import { formatYTick } from '../chart-format.js';

// Format a date string 'YYYY-MM-DD' to 'MMM D' for X-axis labels
// Shared formatting keeps these axis labels identical to canonical Widget charts.
function fmtDate(d) {
  if (!d) return '';
  const [, m, day] = d.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[parseInt(m, 10) - 1] + ' ' + parseInt(day, 10);
}

function fmtDelta(delta) {
  if (delta == null) return '—';
  const sign = delta > 0 ? '+' : '';
  return sign + delta.toFixed(1) + '%';
}

// Shared tooltip: both series values + the signed delta% between them. Reuses the
// standard .recharts-tooltip-* classes (index.css) so light/dark match the other charts.
function CompareTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const byKey = {};
  payload.forEach((p) => { byKey[p.dataKey] = p.value; });
  const del = byKey.delivery ?? 0;
  const cm = byKey.cm360 ?? 0;
  const delta = del > 0 ? ((cm - del) / del) * 100 : null;
  return (
    <div className="recharts-tooltip-custom">
      <div className="recharts-tooltip-label">{fmtDate(label)}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="recharts-tooltip-row" style={{ color: entry.color }}>
          <span className="recharts-tooltip-name">{entry.dataKey === 'delivery' ? 'Delivery' : 'CM360'}:</span>
          <span className="recharts-tooltip-value">{Math.round(Number(entry.value) || 0).toLocaleString()}</span>
        </div>
      ))}
      <div className="recharts-tooltip-row mt-1" style={{ color: 'var(--text-muted)' }}>
        <span className="recharts-tooltip-name">Δ:</span>
        <span className="recharts-tooltip-value">{fmtDelta(delta)}</span>
      </div>
    </div>
  );
}

// Delivery-vs-CM360 two-series line chart. `daily` is result.daily[mode] — a sorted
// array of { date, delivery, cm360 }. Series colors reuse the standard actual/expected
// pair (--c-actual / --c-expected) from the chart presets — no new palette.
function CompareChart({ daily }) {
  if (!Array.isArray(daily) || daily.length === 0) return null;

  // The comparison panel keeps its own compact axes; number formatting is shared.
  const xAxisProps = {
    dataKey: 'date',
    tickFormatter: fmtDate,
    tick: { fill: 'var(--chart-tick)', fontSize: 'var(--text-10)' },
    tickLine: false,
    axisLine: { stroke: 'var(--chart-grid)' },
  };

  const yAxisProps = {
    tickFormatter: (v) => formatYTick('kilo', v),
    tick: { fill: 'var(--chart-tick)', fontSize: 'var(--text-10)' },
    tickLine: false,
    axisLine: false,
    width: 56,
  };

  const gridProps = {
    stroke: 'var(--chart-grid)',
    strokeDasharray: '3 3',
    vertical: false,
  };

  const legendProps = {
    wrapperStyle: { fontSize: 'var(--text-11)', color: 'var(--chart-legend)' },
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis {...xAxisProps} />
        <YAxis {...yAxisProps} />
        <Tooltip content={<CompareTooltip />} />
        <Legend {...legendProps} />
        <Line
          type="monotone"
          dataKey="delivery"
          name="Delivery"
          stroke="var(--c-actual)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="cm360"
          name="CM360"
          stroke="var(--c-expected)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default memo(CompareChart);
