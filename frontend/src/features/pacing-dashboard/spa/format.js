// workspace/src/lib/dashboard/format.js
import { parseUTC } from './date-utils.js';

/**
 * `toLocaleDateString(locale, options)` builds a fresh Intl.DateTimeFormat on every
 * call, and that construction \u2014 not the formatting \u2014 is the cost: 20 000 calls take
 * 601 ms through the method and 12 ms through one reused formatter (measured, V8 20).
 * These two run once per table row per render, and the legacy Daily Performance table
 * renders its page ~70 times during one cold open (React discards the mount render
 * whenever the chart entrance animation interrupts it) \u2014 490 ms of a 1.7 s open.
 *
 * The output is identical by construction: the spec defines the method AS
 * `Intl.DateTimeFormat(locales, options).format(this)`. The one place they part is an
 * invalid Date \u2014 the method answers "Invalid Date", the formatter throws \u2014 so garbage
 * takes the original path and keeps the original answer.
 */
const DATE_LONG = { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' };
const DATE_SHORT = { timeZone: 'UTC', month: 'short', day: 'numeric' };
const dtfLong = new Intl.DateTimeFormat('en-US', DATE_LONG);
const dtfShort = new Intl.DateTimeFormat('en-US', DATE_SHORT);
const intFmt = new Intl.NumberFormat('en-US');
const int2Fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const ok = (d) => !Number.isNaN(d.getTime());

/**
 * The two halves of a wall-clock stamp, in the VIEWER's zone — the opposite of the
 * formatters above, which pin UTC because a pacing day is a UTC day. A saved version
 * happened to a person at a time they remember, so it is read on their own clock.
 *
 * hourCycle 'h23' rather than hour12:false: the two agree in current engines, but
 * hour12:false has answered "24:00" for midnight on older ICU builds, and midnight is
 * exactly the hour this list prints in the example the spec gives.
 */
const TIME_LOCAL = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const DAY_LOCAL = { month: 'short', day: 'numeric' };
const dtfTime = new Intl.DateTimeFormat('en-US', TIME_LOCAL);
const dtfDay = new Intl.DateTimeFormat('en-US', DAY_LOCAL);
/** Local midnight of the day an instant falls in, as ms. */
const dayStart = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c.getTime(); };

export const fD = (y) => {
  const d = parseUTC(y);
  return ok(d) ? dtfLong.format(d) : d.toLocaleDateString('en-US', DATE_LONG);
};

export const fDs = (y) => {
  const d = parseUTC(y);
  return ok(d) ? dtfShort.format(d) : d.toLocaleDateString('en-US', DATE_SHORT);
};

/**
 * A timestamp the way a person says it: "Today 00:33", "Yesterday 18:12",
 * "Aug 31, 14:20" (display-history spec 2026-09-03). Local time, 24-hour, so a
 * column of them lines up and nobody has to convert from UTC in their head.
 *
 * "Yesterday" is the previous local DATE, not "24 hours ago": the two disagree for
 * most of every day, and the date is what a person means. Comparing local midnights
 * also keeps a DST day (23 or 25 hours long) on the right side of the boundary.
 *
 * Anything unparseable answers '' rather than "Invalid Date": the caller draws a row
 * whose other columns are still true, and a broken word in it helps nobody.
 */
export function fWhen(iso) {
  if (iso == null || iso === '') return '';
  const d = new Date(iso);
  if (!ok(d)) return '';
  const time = dtfTime.format(d);
  const days = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${dtfDay.format(d)}, ${time}`;
}

export const fI = (n) =>
  n == null ? '\u2014' : intFmt.format(Math.round(Number(n)));

export const f$ = (n) =>
  n == null ? '\u2014' : '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Precise currency: use 4 decimals for very small values (e.g. CPC $0.0005 → "$0.0005")
export const f$precise = (n) => {
  if (n == null) return '\u2014';
  const v = Number(n);
  const decimals = (v !== 0 && Math.abs(v) < 0.01) ? 4 : 2;
  return '$' + v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const fP = (n) =>
  n == null ? '\u2014' : Number(n).toFixed(2) + '%';

export const fPP = (v) => {
  if (v == null || isNaN(v)) return '\u2014';
  return (v > 0 ? '+' : '') + v.toFixed(1) + ' pp';
};

export const fI2 = (n) => {
  const x = Number(n);
  return isNaN(x) || x === 0 ? '' : int2Fmt.format(x);
};

export function stripCommas(s) {
  return String(s).replace(/,/g, '');
}

export const sid = (v) => String(v);

// Channel family colour class — case-insensitive keyword match so variants like
// "AMAZON VIDEO", "CTV/OTT", "Online Video" land on the right colour instead of
// the grey default. Order matters: CTV/OTT is checked before Video.
export const badgeCls = (ch) => {
  const s = String(ch || '').toLowerCase();
  if (s.includes('ctv') || s.includes('ott')) return 'b-CTV';
  if (s.includes('video')) return 'b-Video';
  if (s.includes('native')) return 'b-Native';
  if (s.includes('audio')) return 'b-Audio';
  if (s.includes('display') || s.includes('banner')) return 'b-Display';
  return 'b-def';
};
