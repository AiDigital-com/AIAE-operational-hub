import { fmtInt, fmtMoney, fmtMoneyPrecise, fmtPP, fmtPercent } from "../format";

/** Shared number formatting for widget bricks - one dispatcher, mirroring the retired SPA's
 *  `widget-format.js`, but built on the Hub's own `format.ts` (which already prints "No data" for a
 *  missing value, per the Hub's CLAUDE.md rule against a bare em dash or a raw float). */
export function fmtKpi(value: number | null | undefined, format: string | undefined): string {
  switch (format) {
    case "money":
      return fmtMoney(value);
    case "money4":
      return fmtMoneyPrecise(value);
    case "percent":
    case "percent2":
      return fmtPercent(value);
    case "pp":
      return fmtPP(value);
    case "number2":
      return value == null || Number.isNaN(value)
        ? "No data"
        : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
    case "int":
    default:
      return fmtInt(value);
  }
}
