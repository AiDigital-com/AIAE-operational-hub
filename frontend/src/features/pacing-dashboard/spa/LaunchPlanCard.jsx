// workspace/src/pages/Dashboard/components/LaunchPlanCard.jsx
//
// "Launch recommendations" (F5): shown ONLY while the campaign has not started
// (campaign-TZ day before flight start). Indicative starting daily volumes —
// an even split of each LI's plan across its flight days (owner decision),
// with per-container sub-rows where containers carry targets. Disappears at
// flight start. No vertical stripes; dash-token styling.

import { useMemo } from 'react';
import { useCampaign, useLiPlan, useDisplay } from './store.js';
import { useDashboardStore } from './store.js';
import { rateLabel } from './metrics.js';
import { fI, f$, fDs } from './format.js';
import { buildLaunchPlan, launchPlanMode, todayInTz } from './launch-plan.js';

// CPI is ours (the reference has no such rate type): an install-paced line's units are installs.
const UNIT_SHORT = { CPM: 'impr', CPC: 'clicks', CPV: 'views', CPI: 'installs' };

export default function LaunchPlanCard() {
  const campaign = useCampaign();
  const liPlan = useLiPlan();
  const display = useDisplay();
  const rowCount = useDashboardStore((s) => s.facts?.factsDaily?.length || 0);
  const liNames = display?.liNames || {};

  // 'launch' = pre-start, plan / full flight. 'catchup' = flight running with
  // ZERO delivery — the same plan spread over the REMAINING days. First
  // delivered row retires the card either way.
  const mode = launchPlanMode(campaign, rowCount);
  const today = todayInTz(campaign?.timezone);
  const plan = useMemo(
    () => buildLaunchPlan(liPlan || {}, mode === 'catchup' ? today : null),
    [liPlan, mode, today],
  );

  if (!mode || plan.rows.length === 0) return null;

  const cell = { padding: '8px 12px', whiteSpace: 'nowrap' };
  const head = {
    ...cell, fontFamily: 'var(--font-sans)', fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left',
  };
  const num = { ...cell, textAlign: 'right', fontFamily: 'var(--font-mono)' };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--dash-radius-card, 6px)',
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
        padding: '16px 20px', borderBottom: '1px solid var(--border-soft)', background: 'var(--surface-alt)',
      }}>
        <span className="text-12" style={{
          fontFamily: 'var(--font-sans)', fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)',
        }}>
          Launch recommendations
        </span>
        <span className="text-11" style={{ color: 'var(--text-muted)' }}>
          {mode === 'catchup'
            ? `No delivery yet — the full plan spread over the remaining days (through ${fDs(campaign.endDate)}). Disappears at the first delivered day.`
            : `Starting daily volumes — even split of the plan across flight days. Disappears once the flight begins (${fDs(campaign.startDate)}).`}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="text-12" style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-primary)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-soft)' }}>
              <th className="text-10" style={head}>Line item</th>
              <th className="text-10" style={head}>Flight</th>
              <th className="text-10" style={{ ...head, textAlign: 'right' }}>Days</th>
              <th className="text-10" style={{ ...head, textAlign: 'right' }}>Units / day</th>
              <th className="text-10" style={{ ...head, textAlign: 'right' }}>Spend / day</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r) => (
              <RowGroup key={r.liId} row={r} name={liNames[r.liId] || ''} cell={cell} num={num} />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--border-soft)', background: 'var(--surface-alt)' }}>
              <td style={{ ...cell, fontWeight: 600 }} colSpan={3}>All line items</td>
              <td style={{ ...num, fontWeight: 600 }}>
                {Object.entries(plan.totals.unitsPerDayByRt)
                  .map(([rt, u]) => `${fI(Math.round(u))} ${UNIT_SHORT[rt] || 'units'}`)
                  .join(' + ')}
              </td>
              <td style={{ ...num, fontWeight: 600 }}>{f$(plan.totals.spendPerDay)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function RowGroup({ row, name, cell, num }) {
  return (
    <>
      <tr style={{ borderBottom: row.containers.length ? 'none' : '1px solid var(--border-softer)' }}>
        <td style={cell}>
          <span className="font-mono text-12" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>LI {row.liId}</span>
          {name && (
            <span className="text-11" style={{ marginLeft: 8, color: 'var(--text-primary)' }}>{name}</span>
          )}
          <span className="text-10" style={{ marginLeft: 8, color: 'var(--text-muted)' }}>{row.ch}</span>
        </td>
        <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {fDs(row.fs)} – {fDs(row.fe)}
        </td>
        <td style={num}>{row.days}</td>
        <td style={num}>
          {fI(Math.round(row.dailyUnits))}
          <span className="text-10" style={{ marginLeft: 4, color: 'var(--text-muted)' }}>{rateLabel(row.rt).toLowerCase()}</span>
        </td>
        <td style={num}>{f$(row.dailySpend)}</td>
      </tr>
      {row.containers.map((c, i) => (
        <tr key={c.name + i} style={{ borderBottom: i === row.containers.length - 1 ? '1px solid var(--border-softer)' : 'none' }}>
          <td style={{ ...cell, paddingLeft: 32 }}>
            <span className="text-11" style={{ color: 'var(--text-muted)' }}>{c.name}</span>
          </td>
          <td style={{ ...cell, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }} className="text-11">
            {fDs(c.fs)} – {fDs(c.fe)}
          </td>
          <td style={{ ...num, color: 'var(--text-muted)' }} className="text-11">{c.days}</td>
          <td style={{ ...num, color: 'var(--text-muted)' }} className="text-11">{fI(Math.round(c.dailyUnits))}</td>
          <td style={{ ...num, color: 'var(--text-muted)' }} className="text-11">{c.dailySpend > 0 ? f$(c.dailySpend) : '—'}</td>
        </tr>
      ))}
    </>
  );
}
