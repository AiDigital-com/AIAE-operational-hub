import { fI, f$, f$precise, fP, fPP } from '../format.js';
import { formatConversion } from '../conversion-format.js';

/** Shared number formatting for canonical Layout blocks. */
export function fmtKpi(value, format) {
  switch (format) {
    case 'count1': return formatConversion(value);
    case 'money': return f$(value);
    case 'money4': return f$precise(value);
    case 'percent': return fP(value);
    case 'percent2': return fP(value);
    case 'pp': return fPP(value);
    case 'plain2':
    case 'auto':
    case 'number2': return value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    case 'int':
    default: return fI(value);
  }
}
