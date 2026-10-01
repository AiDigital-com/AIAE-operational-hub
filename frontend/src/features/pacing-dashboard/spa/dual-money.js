// dual-money.js — pure shaping for the <MoneyValue> dual-currency display (C5).
//
// Decides primary/secondary strings + whether a value is "converted", from the
// per-value { native, usd, currency } plus a display role. The campaign rate is
// already baked into `usd` upstream (metrics.js / merge — Slice 6), so this helper
// needs only native + usd + currency. Pure, no React.
//
//   role "client" → client-facing block: native (e.g. CAD) primary, USD muted.
//   role "media"  → media/DSP block: USD primary, native muted.
//   USD / degenerate (currency USD, or rate 1 ⇒ native == usd) → a SINGLE value.
//
// NET COST MODE (spec 2026-09-07 §7). Every `dc` the dashboard carries is already
// NET; `gross` is the twin figure the CLIENT sees. A client block therefore leads
// with gross and says the net one quietly underneath — "net $2,000" — because the
// gross figure is the one on the client's invoice. A media block ignores `gross`
// outright: what an LI cost to buy has no client-facing twin. When there is no
// gross, or it equals the net figure, nothing changes at all.
//
// BYTE-IDENTICAL guarantee (acceptance #5): the degenerate primary uses f$ (the
// existing dashboard formatter, 2 decimals) so a USD pacing renders exactly as
// today. formatUsd / formatNative (0 decimals) are used ONLY for the converted
// block's lines — the muted secondary and the rounded native summary. A USD
// pacing's "net …" line uses f$ too, i.e. the primary's own formatter: these rows
// include rates (Dyn CPC/CPV/CPA), where 0 decimals would print a net $0.44 as
// "net $0".
import Currency from '@shared/currency';
import { f$ } from './format.js';

/**
 * showsGrossPair({usd, role, gross}) → does this figure actually DRAW the gross/net
 * pair? A media block, a missing figure and a gross that rounds onto the net one are
 * all the single-value case — the half-cent tolerance keeps a k of exactly 1 (and the
 * float noise of net/k×k) from minting a second line that says the same number. A net
 * figure of 0 has a gross of 0 (gross = net / k), so `usd === 0` with a non-zero gross
 * is not a real reading — and it is the one input the converted branch below could not
 * scale (native × gross/0). It stays the single value.
 *
 * Exported because the CAPTION beside the figure has to agree with it (net cost mode,
 * spec §7, fix round 1): «(gross)» over a lone number names the wrong basis, and
 * `grossAgg` answers a number for every `budget`/`dc` bind — net pacing or not.
 */
export function showsGrossPair({ usd, role, gross }) {
  const g = gross == null ? null : Number(gross);
  return role === 'client' && g != null && Number.isFinite(g) && usd != null &&
    Number(usd) !== 0 && Math.abs(g - Number(usd)) > 0.005;
}

/**
 * @param {object} args
 * @param {number|null} args.native   native-currency amount (CAD on a CAD pacing)
 * @param {number|null} args.usd      USD amount (derived = native × rate, upstream)
 * @param {string|null} args.currency campaign currency ("USD" | "CAD" | …)
 * @param {"client"|"media"} args.role display role
 * @param {number|null} [args.gross] gross (pre-net-ratio) USD twin of `usd`; client role only
 * @returns {{ primary:string, secondary:string|null, converted:boolean, net:boolean }}
 */
export function dualMoneyParts({ native, usd, currency, role, gross }) {
  const usdNull = usd == null;
  const nativeNull = native == null;

  // "converted" = genuine non-USD conversion: a non-USD currency AND native differs
  // from usd (they are equal on a USD pacing or at rate 1). This mirrors
  // Currency.isConverted's intent without re-deriving the rate (rate is baked into
  // usd upstream), and keeps rate==1 / USD as the degenerate single-value case.
  const cur = currency == null ? null : String(currency).toUpperCase();
  const converted =
    cur != null && cur !== 'USD' && !nativeNull && !usdNull &&
    Number(native) !== Number(usd);

  // "net" = this client figure has a DIFFERENT gross twin worth showing.
  const net = showsGrossPair({ usd, role, gross });
  const g = gross == null ? null : Number(gross);

  if (!converted && !net) {
    // Degenerate / USD: a SINGLE value via f$ (2 decimals) — byte-identical to
    // today's dashboard. f$ already returns the em-dash for null.
    return { primary: f$(usdNull ? null : usd), secondary: null, converted: false, net: false };
  }

  if (net && !converted) {
    // USD net pacing: gross leads in f$ (2 decimals, as the single value did), and
    // the net figure follows on the muted line in the SAME formatter. Rates come
    // through here (Dyn CPC/CPV/CPA), so the 0-decimal summary style would round a
    // net $0.44 down to "net $0" underneath a $0.49 primary.
    return { primary: f$(g), secondary: 'net ' + f$(usd), converted: false, net: true };
  }

  // Converted block: 0-decimal summary lines (formatNative / formatUsd).
  const nativeStr = Currency.formatNative(native, currency);
  const usdStr = Currency.formatUsd(usd);
  if (net) {
    // Converted AND net: the primary is gross in the CLIENT's currency, and the
    // muted line carries both halves of the net figure. gross is a USD number, so
    // it takes the same rate `usd` already has baked in — native × gross/usd —
    // rather than a second, independently rounded conversion.
    const grossNative = Number(native) * (g / Number(usd));
    return {
      primary: Currency.formatNative(grossNative, currency),
      secondary: 'net ' + nativeStr + ' · ' + usdStr,
      converted: true, net: true,
    };
  }
  if (role === 'client') {
    return { primary: nativeStr, secondary: usdStr, converted: true, net: false };
  }
  // media (and any other role): USD dominant, native muted.
  return { primary: usdStr, secondary: nativeStr, converted: true, net: false };
}
