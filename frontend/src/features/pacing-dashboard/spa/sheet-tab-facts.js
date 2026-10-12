// workspace/src/lib/settings/sheet-tab-facts.js
//
// What is in a column of a Performance-source tab, from the evidence the probe
// already returns: the first 20 rows of every tab (unformatted values, dates as
// serial numbers, every cell turned into a string and cut at 200 characters),
// two raw sample rows under the header, and the header row it found. data.sheet
// has no per-tab read and no aux file, so this sample IS the evidence, and every
// sentence says how deep it looked.
//
// Two rules keep the sentences honest:
//   - The header row is found the way the refresh finds it: by the mapped
//     column NAMES first (sheet-source.json, headerRowFor), and by the probe's
//     name-blind detector only when the tab has no names yet. The two can
//     disagree on a tab with a title block, and the refresh's answer is the one
//     that counts.
//   - "Reads as a date / a number" reuses the converter's own parsers
//     (shared/sheet-convert.js), so it means the refresh will read it too. The
//     probe turns every cell into a string; a serial that arrives as "46205" is
//     turned back into a number first, which is what the refresh sees, UNLESS
//     the raw sample shows the column holds text, in which case the refresh
//     sees text too.
//
// No React, no DOM: plain ESM so host tests import it directly.

import SheetConvert from '@shared/sheet-convert';
import { findHeaderRowByNames } from './sheet-source-norm.js';

const { parseSheetDate, num, keyOf } = SheetConvert;
const clean = (v) => String(v == null ? '' : v).trim();
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/** How many top values a facts line names. */
export const TOP_VALUES = 3;

/** The probe stringifies its grid; the refresh reads unformatted numbers. Undo the string. */
export function coerceCell(cell) {
  if (typeof cell === 'number') return cell;
  const s = clean(cell);
  return NUMERIC_TEXT.test(s) ? Number(s) : s;
}

/** The date the converter would read from this cell, or null. */
export function dateOf(cell) {
  return parseSheetDate(coerceCell(cell));
}

export function dateReads(cell) {
  return dateOf(cell) !== null;
}

/**
 * True when the converter reads a real number from this cell. A blank reads as
 * 0 on purpose; "1,204" reads as 0 by accident, and that is the case this flags.
 */
export function numberReads(cell) {
  const s = clean(cell);
  return s === '' || Number.isFinite(Number(s));
}

/**
 * The rows the probe returned. A probe answer without a grid (an older shape:
 * headers plus two sample rows) is read as a grid whose header is row 0.
 */
function gridOf(tab) {
  if (Array.isArray(tab?.grid)) return tab.grid;
  if (!Array.isArray(tab?.headers) || !tab.headers.length) return [];
  const rows = Array.isArray(tab.sample) ? tab.sample : [];
  return [tab.headers.map((h) => clean(h)), ...rows.map((r) => (Array.isArray(r) ? r : []).map((x) => (x == null ? '' : String(x))))];
}
function probedHeaderRow(tab) {
  if (Array.isArray(tab?.grid)) return Number.isInteger(tab.header_row) ? tab.header_row : -1;
  return Array.isArray(tab?.headers) && tab.headers.length ? 0 : -1;
}

/**
 * Where the header row is, the way the refresh decides it: the mapped names
 * first, then the date column alone, then the probe's own detector.
 */
export function headerRowFor(tab, { names = [], dateName = '' } = {}) {
  const grid = gridOf(tab);
  const probed = probedHeaderRow(tab);
  const wanted = (Array.isArray(names) ? names : []).map(clean).filter(Boolean);
  if (wanted.length) {
    let hr = findHeaderRowByNames(grid, wanted, probed >= 0 ? probed : null);
    if (hr < 0 && clean(dateName)) hr = findHeaderRowByNames(grid, [clean(dateName)], probed >= 0 ? probed : null);
    if (hr >= 0) return hr;
  }
  return probed;
}

/**
 * One entry per header of a probed tab, measured over the rows under the header.
 *
 *   { sampled: true, header_found, scanned_rows, row_count, header_row,
 *     columns: [{ name, index, distinct, top, blank_rows, duplicate, text_typed,
 *                 date_good, date_bad, date_bad_sample, date_min, date_max,
 *                 number_good, number_bad, number_bad_sample }] }
 *
 * `names` / `dateName` are the tab's stored column names, so the header is the
 * one the refresh will use. Distinct values are counted the way the converter
 * matches them (case and padding folded); the first spelling is the one shown.
 */
export function profileFromTab(tab, { names = [], dateName = '' } = {}) {
  const grid = gridOf(tab);
  const hr = headerRowFor(tab, { names, dateName });
  const rowCount = Number.isFinite(Number(tab?.row_count)) ? Number(tab.row_count) : null;
  if (hr < 0 || hr >= grid.length) {
    return { sampled: true, header_found: false, scanned_rows: 0, row_count: rowCount, header_row: hr, columns: [] };
  }
  // The probe's `headers` are the same row uncut; the grid's copy is cut at 200
  // characters. Take the uncut names whenever the header is the row the probe named.
  const probedHr = probedHeaderRow(tab);
  const headerRow = hr === probedHr && Array.isArray(tab?.headers) ? tab.headers : (grid[hr] || []);
  const body = grid.slice(hr + 1);
  // The raw sample rows sit right under the probe's header, types intact.
  const sample = hr === probedHr && Array.isArray(tab?.sample) ? tab.sample : [];
  const byName = new Map();
  const columns = [];
  headerRow.forEach((raw, index) => {
    const name = clean(raw);
    if (!name) return;
    if (byName.has(name)) { byName.get(name).duplicate = true; return; }
    const textTyped = sample.some((row) => {
      const v = (row || [])[index];
      return typeof v === 'string' && NUMERIC_TEXT.test(v.trim());
    });
    const counts = new Map();
    const spelling = new Map();
    let blank = 0;
    let dateGood = 0; let dateBad = 0; let dateBadSample = null; let dateMin = null; let dateMax = null;
    let numberGood = 0; let numberBad = 0; let numberBadSample = null;
    for (const row of body) {
      const cell = (row || [])[index];
      const s = clean(cell);
      if (s === '') { blank++; continue; }
      const key = keyOf([s]);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!spelling.has(key)) spelling.set(key, s);
      const d = textTyped ? parseSheetDate(s) : dateOf(cell);
      if (d === null) { dateBad++; if (dateBadSample === null) dateBadSample = s; } else {
        dateGood++;
        if (dateMin === null || d < dateMin) dateMin = d;
        if (dateMax === null || d > dateMax) dateMax = d;
      }
      if (numberReads(cell)) numberGood++; else { numberBad++; if (numberBadSample === null) numberBadSample = s; }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_VALUES).map((e) => spelling.get(e[0]));
    const entry = {
      name, index, distinct: counts.size, top, blank_rows: blank, duplicate: false, text_typed: textTyped,
      date_good: dateGood, date_bad: dateBad, date_bad_sample: dateBadSample, date_min: dateMin, date_max: dateMax,
      number_good: numberGood, number_bad: numberBad, number_bad_sample: numberBadSample,
    };
    byName.set(name, entry);
    columns.push(entry);
  });
  return { sampled: true, header_found: true, scanned_rows: body.length, row_count: rowCount, header_row: hr, columns };
}

/** The profile entry for a column, or null. */
export function profileFor(profile, column) {
  const list = profile && Array.isArray(profile.columns) ? profile.columns : [];
  return list.find((c) => c && c.name === clean(column)) || null;
}

const fmtNumber = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};
const rows = (n) => `${n.toLocaleString('en-US')} row${n === 1 ? '' : 's'}`;
const cells = (n) => `${n.toLocaleString('en-US')} cell${n === 1 ? '' : 's'}`;

/**
 * The sentence under a column name: what it CONTAINS, at the depth it was read.
 *
 *   kind: 'date' | 'number' | 'text' · mapped: whether the column holds a role ·
 *   reading: the probe is still in flight
 *
 * Returns { text, detail } plus one of: warn (the refresh would lose the whole
 * column), skips / zeroed (a few cells the refresh will not read as written),
 * missing (mapped, but the tab has no such header), empty, unknown (nothing was
 * read, so nothing is claimed).
 */
export function factsFor({ profile, column, kind, mapped = true, reading = false }) {
  if (reading) return { text: 'Reading the sheet…', detail: '', unknown: true };
  if (!profile) {
    return { text: 'Not read', detail: 'The sheet could not be read; the roles stay editable.', unknown: true };
  }
  if (profile.header_found === false) {
    return { text: 'Header row not found', detail: 'None of the first 20 rows holds the mapped column names.', unknown: true };
  }
  const p = profileFor(profile, column);
  if (!p) return { text: 'Not in the sheet now', detail: 'The tab has no column with this header.', missing: true };
  // The refresh resolves only MAPPED names, so a repeated header stops it only once mapped.
  if (p.duplicate) {
    return mapped
      ? { text: 'Two columns have this name', detail: 'The refresh stops on a repeated header.', warn: true }
      : { text: 'Two columns have this name', detail: 'It cannot be mapped until one is renamed.', warn: true };
  }
  const n = profile.scanned_rows || 0;
  if (!n) return { text: 'No rows under the header yet', detail: '', unknown: true };
  const depth = `in the first ${rows(n)}`;
  if (n - p.blank_rows <= 0) return { text: `Empty ${depth}`, detail: '', empty: true };
  if (kind === 'date') {
    if (!p.date_good) {
      return { text: 'Does not read as a date',
        detail: p.text_typed ? `“${p.date_bad_sample}” is text, not a date cell` : `“${p.date_bad_sample}”`, warn: true };
    }
    const span = `${p.date_min} → ${p.date_max} ${depth}`;
    if (p.date_bad) {
      return { text: 'Reads as dates', detail: `${span} · ${rows(p.date_bad)} the refresh will skip (“${p.date_bad_sample}”)`, skips: p.date_bad };
    }
    return { text: 'Reads as dates', detail: span };
  }
  if (kind === 'number') {
    if (!p.number_good) return { text: 'Does not read as a number', detail: `“${p.number_bad_sample}”`, warn: true };
    const values = `${p.top.map(fmtNumber).join(' · ')} ${depth}`;
    if (p.number_bad) {
      return { text: 'Reads as numbers', detail: `${values} · ${cells(p.number_bad)} read as 0 (“${p.number_bad_sample}”)`, zeroed: p.number_bad };
    }
    return { text: 'Reads as numbers', detail: values };
  }
  return {
    text: `${p.distinct.toLocaleString('en-US')} value${p.distinct === 1 ? '' : 's'} ${depth}`,
    // Grouped digits here too, so a column reads the same before and after it takes a role.
    detail: p.top.map(fmtNumber).join(' · '),
  };
}
