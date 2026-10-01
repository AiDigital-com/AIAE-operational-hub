/** Shared chart formatting and metric-axis defaults. No widget dispatch lives here. */
import { formatConversion } from './conversion-format.js';

export const METRIC_AXIS_FORMAT = {
  ctr: 'percent', vcr: 'percent', acr: 'percent',
  cpm: 'currency', cpc: 'currency', cpv: 'currency',
  im: 'kilo', cl: 'kilo', co: 'kilo', coViews: 'kilo', cv: 'count1', pc: 'count1', pv: 'count1',
  coV: 'kilo', imV: 'kilo',
  st: 'kilo', q1: 'kilo', q2: 'kilo', q3: 'kilo', rc: 'kilo', lc: 'kilo',
  expIm: 'kilo', expCl: 'kilo', expVw: 'kilo', imprExpected: 'kilo',
  planImpr: 'kilo', planClicks: 'kilo', planViews: 'kilo',
  planImprTotal: 'kilo', planClicksTotal: 'kilo', planViewsTotal: 'kilo',
  sp: 'currency', dc: 'currency', expCo: 'currency', budget: 'currency', costBud: 'currency',
  costBudTotal: 'currency', budgetTotal: 'currency', budgetToDate: 'currency', tgtCpm: 'currency',
  mTgt: 'percent', ctrT: 'percent', vcrT: 'percent', acrT: 'percent',
  daysLeft: 'number', daysPassed: 'number',
};

export function formatYTick(format, value) {
  if (value == null) return '';
  switch (format) {
    case 'currency':
      return '$' + Number(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    case 'currency4': {
      const [integer, decimals] = Number(value).toFixed(4).split('.');
      return '$' + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + decimals;
    }
    case 'percent1': return Number(value).toFixed(1) + '%';
    case 'percent2': return Number(value).toFixed(2) + '%';
    case 'kilo': return value >= 1000 ? (value / 1000).toFixed(0) + 'k' : formatConversion(value);
    case 'count1': return formatConversion(value);
    case 'percent': return Number(value).toFixed(1) + '%';
    case 'number': return Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 });
    default:
      return Number.isFinite(Number(value))
        ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
        : String(value);
  }
}

export function formatTooltipValue(format, value) {
  if (value == null) return '';
  switch (format) {
    case 'count1': return formatConversion(value);
    case 'currency':
      return '$' + Number(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    case 'currency4': {
      const [integer, decimals] = Number(value).toFixed(4).split('.');
      return '$' + integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + decimals;
    }
    case 'percent1': return Number(value).toFixed(1) + '%';
    case 'percent2': return Number(value).toFixed(2) + '%';
    case 'kilo': {
      const n = Number(value);
      return Math.abs(n) < 1 && n !== 0
        ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : Math.round(n).toLocaleString();
    }
    case 'percent': return Number(value).toFixed(2) + '%';
    case 'number': return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    default:
      return Number.isFinite(Number(value))
        ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
        : String(value);
  }
}
