import { highlightFill } from './highlight-style.js';
// workspace/src/components/kit/RateRows.jsx
//
// The per-rate-type repeats of OverviewBlock2 (:157 Plan rate, :166 the Bid Plan / Bid
// Fact pair with its delta, :214 Earned @ Plan, :217 the dynamic client rates). A
// mixed campaign runs two or three of them, so the SHAPE of these cards changes with
// the campaign — which is why the repeat lives inside the brick and the rows are built
// by brick-data.js.
//
// One row shape covers all four series: a labelled figure, a labelled figure that
// carries two currencies, or a pair with an optional delta chip under it.
import StatRow from './StatRow.jsx';
import DeltaChip from './DeltaChip.jsx';
import KvRow from './KvRow.jsx';
import Currency from '@shared/currency';
import MoneyValue from '../ui/MoneyValue.jsx';

export default function RateRows({ rows, currency, rate }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  return (
    <div className="kit-raterows">
      {list.map((r, i) => {
        // Primary conversions note (spec 2026-09-13 §7): muted text after the rows.
        if (r.kind === 'note') {
          return <div className="kit-note" key={`note-${i}`}>{r.text}</div>;
        }
        if (r.kind === 'pair') {
          return (
            <div className="kit-raterows-p" key={r.unit || i}>
              <StatRow layout="pair" cells={[r.left, r.right]} />
              {r.delta && <DeltaChip text={r.delta.text} tone={r.delta.good ? 'g' : 'b'} />}
            </div>
          );
        }
        // A client rate campM could not answer (spec §6): the "—" glyph on the money row's
        // own box, with the reason as tooltip. MoneyValue stays untouched for real figures.
        if (r.kind === 'money' && r.usd == null) {
          return (
            <KvRow
              key={r.label || i}
              label={r.label}
              value={(
                <span
                  title={r.reason || undefined}
                  style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15,
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-13)', color: 'var(--text-muted)' }}
                >
                  —
                </span>
              )}
            />
          );
        }
        if (r.kind === 'money') {
          return (
            <KvRow
              key={r.label || i}
              label={r.label}
              highlight={r.highlight}
              value={<MoneyValue
                native={Currency.usdToNative(r.usd, rate)}
                usd={r.usd}
                currency={currency}
                role="client"
                gross={r.gross ?? null}
                primaryStyle={{ fontSize: 'var(--text-13)', color: highlightFill(r.highlight) || 'var(--text-secondary)' }}
              />}
            />
          );
        }
        return <KvRow key={r.label || i} label={r.label} value={r.value} highlight={r.highlight} />;
      })}
    </div>
  );
}
