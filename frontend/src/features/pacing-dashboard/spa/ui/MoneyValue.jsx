// workspace/src/components/ui/MoneyValue.jsx
//
// Dual-currency display (Slice 7, C5). Primary value dominant, the other
// currency muted below it. USD / non-converted → a single value, no second line
// (byte-identical to today's f$ output). All shaping comes from the pure,
// host-tested dualMoneyParts helper; this file is presentation only. No vertical
// color stripes / left-rail accents (project ban) — the muted line is a plain
// stacked text row. Sibling of MoneyField.jsx (the Slice 5 input counterpart).
import { dualMoneyParts } from '../dual-money.js';

/**
 * @param {object} props
 * @param {number|null} props.native   native-currency amount
 * @param {number|null} props.usd      USD amount (derived upstream via campaign rate)
 * @param {string|null} props.currency campaign currency
 * @param {"client"|"media"} [props.role] display role (default "media")
 * @param {number|null} [props.gross] gross USD twin on a net pacing — client role
 *   only. Present ⇒ the primary line is the GROSS figure and the muted line says
 *   "net …" (spec 2026-09-07 §7). Absent / equal ⇒ nothing changes.
 * @param {object} [props.primaryStyle]   style overrides for the primary line
 * @param {object} [props.secondaryStyle] style overrides for the muted line
 */
export default function MoneyValue({ native, usd, currency, role = 'media', gross = null, primaryStyle, secondaryStyle }) {
  const { primary, secondary } = dualMoneyParts({ native, usd, currency, role, gross });
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15 }}>
      <span style={{ fontFamily: 'var(--font-mono)', ...primaryStyle }}>{primary}</span>
      {secondary != null && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.72em', fontWeight: 500,
          color: 'var(--text-muted)', marginTop: 1, ...secondaryStyle,
        }}>
          {secondary}
        </span>
      )}
    </span>
  );
}
