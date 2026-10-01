// workspace/src/lib/dashboard/date-utils.js
import PacingCore from './pacing-core.js';

export const parseUTC = PacingCore._parseUTC;
export const daysBetween = PacingCore.daysBetween;
export const dI = PacingCore.daysBetween;
export const rangeOverlap = PacingCore.rangeOverlap;
export const datePrev = PacingCore.datePrev;

export const ymdAm = (y) => {
  if (!y) return '';
  const [a, b, c] = y.split('-');
  return `${b}/${c}/${a}`;
};

export const amYmd = (s) => {
  if (!s || !s.includes('/')) return null;
  const p = s.split('/');
  if (p.length !== 3) return null;
  const [m, d, y] = p;
  return m && d && y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
};
