/**
 * Number formatting for the Pacing Dashboard (§6). A missing/`null` value always renders as the em
 * dash "No data" placeholder, never a raw float or a fabricated 0 - see the CLAUDE.md rule against
 * dumping an over-precise number into a display field.
 */
const NO_DATA = "No data";

export function fmtInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NO_DATA;
  return Math.round(value).toLocaleString("en-US");
}

export function fmtMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NO_DATA;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** For small unit prices (CPM/CPC/CPV) where 2 decimals round to $0.00 - 4 decimals below one cent. */
export function fmtMoneyPrecise(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NO_DATA;
  const decimals = Math.abs(value) < 0.01 ? 4 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function fmtPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NO_DATA;
  return `${value.toFixed(2)}%`;
}

/** Signed percentage-point deviation, e.g. "+4.2 pp" / "-1.0 pp". */
export function fmtPP(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NO_DATA;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

export const NO_DATA_LABEL = NO_DATA;
