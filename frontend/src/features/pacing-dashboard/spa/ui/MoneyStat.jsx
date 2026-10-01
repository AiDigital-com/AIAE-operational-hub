import { highlightTextStyle, highlightTitle } from './highlight-style.js';
// workspace/src/components/kit/MoneyStat.jsx
//
// Lift of OverviewBlock2's FinLabel + FinValue wrapped around ui/MoneyValue (:40-46,
// :149-152): a small label over a big money figure that carries BOTH currencies when
// the pacing is converted. `role` decides which one leads — client-facing figures show
// the client's currency first, media figures show USD first.
//
// The conversion happens here, from the campaign rate, so a brick only ever hands over
// the USD number the metrics carry.
import Currency from '@shared/currency';
import DeltaChip from './DeltaChip.jsx';
import MoneyValue from '../ui/MoneyValue.jsx';

// `gross` is the net-cost twin of `value` (spec 2026-09-07 §7) — the figure the client
// sees, computed over the SAME line items and window by widget-data's grossAgg. It rides
// the main value ONLY: the comparison chip measures a distance from a target, and a
// distance has no gross/net pair to show.
export default function MoneyStat({ label, value, currency, rate, role = 'media', gross = null, comparison = null, highlight }) {
  return (
    <div className="kit-money">
      {label && <div className="kit-money-l">{label}</div>}
      <div className="kit-money-v" style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>
        {value == null
          ? '—'
          : <MoneyValue native={Currency.usdToNative(value, rate)} usd={value} currency={currency} role={role} gross={gross} />}
      </div>
      {comparison && <DeltaChip tone={comparison.good ? 'g' : 'b'} text={<>
        {comparison.value >= 0 ? '+' : '−'}<MoneyValue native={Currency.usdToNative(Math.abs(comparison.value), rate)} usd={Math.abs(comparison.value)} currency={currency} role={role} />{' vs target'}
      </>} />}
    </div>
  );
}
