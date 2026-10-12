// workspace/src/lib/settings/sheet-source-setup.js
//
// The pure half of the "+ Add source" flow (spec 2026-08-10 §9.3): what a set of
// spreadsheet headers should map to, what a dimension key looks like, and how big
// the resulting file is likely to be. No React, no DOM — host-tested directly.
//
// The key rules here MIRROR dash-gate/lib/dim-sources.mjs, which is the only
// producer of a stored key. tests/sheet-setup-test.mjs drives both and fails on
// disagreement, because a client that proposes a key the server refuses would
// send the user round a loop with nothing to fix.

// What used to live here — the alias table, the key rule and the column
// proposal — moved into sheet-source-norm.js, which already owned all three for
// the delivery-sheet mapper. One header convention, understood in one place.
//
// What stays is the only thing this file was actually adding: the size budget a
// mapping implies, and the wording of its refusal.

/**
 * Rows the loader will write, estimated BEFORE the first read (spec §3.4): the
 * product of days, bound line items and each dimension's distinct-value count.
 *
 * `distinctPerDim` comes from the `values` probe, which returns up to 500
 * combinations — so this is a floor, and it is treated as one: the caller warns
 * when the estimate is close to the ceiling, not only when it passes it.
 */
export function estimateRows({ days = 1, lineItems = 1, distinctPerDim = [] } = {}) {
  const d = Math.max(1, Number(days) || 1);
  const li = Math.max(1, Number(lineItems) || 1);
  let product = 1;
  for (const n of distinctPerDim) product *= Math.max(1, Number(n) || 1);
  // Delivery is sparse: a line does not touch every value every day. Measured on
  // the owner's export — 53 days × 4 lines × 6 176 apps would be 1.3M rows, and
  // the file holds 41 957 — so the raw product overstates by ~30×. Halving it
  // twice keeps the estimate on the safe side of that without pretending to
  // model sparsity we have one sample of.
  return Math.round(d * li * product * 0.25);
}

/**
 * Bytes per row of the file as it is written: PACKED since 2026-09-29
 * (docs/2026-09-29-dim-rows-packed.md), every distinct value once and each row a
 * short list of positions followed by its metric numbers. So the cost of a row is
 * mostly its NUMBERS, and they differ: impressions and clicks are whole numbers,
 * while spend or a revenue column arrives from Sheets at full precision
 * (UNFORMATTED_VALUE) — 17 or 18 characters each.
 *
 *   positions (date, line item, value, name, metric list): 30
 *   impressions, clicks:                                     8 each
 *   any other metric:                                       19 each
 *
 * On the safe side of what was measured that day: the production source that had
 * crossed the ceiling (four count metrics) packs at 36.9 bytes a row and this
 * says 84; eight metrics with two money columns packed at 88–120 and this says
 * 160. Without the metric list it assumes 40, the measured figure rounded up.
 * It was 158 for every row, measured on the old one-object-per-row form (§3.4).
 * Once a read exists the screen shows the file's real size instead (sizeOf).
 */
const POSITION_BYTES = 30;
const WHOLE_METRIC_BYTES = 8;
const DECIMAL_METRIC_BYTES = 19;
const WHOLE_METRICS = new Set(['im', 'cl']);
const DEFAULT_ROW_BYTES = 40;
export const FILE_LIMIT_BYTES = 16 * 1024 * 1024;

export function rowBytesFor(metrics) {
  if (!Array.isArray(metrics) || !metrics.length) return DEFAULT_ROW_BYTES;
  let bytes = POSITION_BYTES;
  for (const m of metrics) bytes += WHOLE_METRICS.has(m) ? WHOLE_METRIC_BYTES : DECIMAL_METRIC_BYTES;
  return bytes;
}

export function estimateBytes(rows, metrics) {
  return Math.max(0, Math.round((Number(rows) || 0) * rowBytesFor(metrics)));
}

/**
 * What the mapping step shows under the dimension list, and whether Save is
 * allowed. Over the limit is a refusal with the two dimensions to blame — the
 * answer there is two sources with one dimension each, not a bigger cap.
 */
export function budgetVerdict(estimatedRows, dims = [], metrics) {
  return budgetVerdictForBytes(estimateBytes(estimatedRows, metrics), dims);
}

/** The same verdict on a size already known — the file on disk after a read. */
export function budgetVerdictForBytes(fileBytes, dims = []) {
  const bytes = Math.max(0, Math.round(Number(fileBytes) || 0));
  const pct = Math.round((bytes / FILE_LIMIT_BYTES) * 100);
  if (bytes > FILE_LIMIT_BYTES) {
    const worst = [...dims].sort((a, b) => (b.distinct || 0) - (a.distinct || 0)).slice(0, 2)
      .map((d) => d.label || d.key);
    return { ok: false, pct, bytes,
      message: worst.length > 1
        ? `Too large: about ${Math.round(bytes / 1048576)} MB. ${worst[0]} × ${worst[1]} is what drives it — split them into two sources.`
        : `Too large: about ${Math.round(bytes / 1048576)} MB.` };
  }
  if (pct >= 70) {
    return { ok: true, pct, bytes, message: `About ${Math.round(bytes / 1048576)} MB — close to the ${FILE_LIMIT_BYTES / 1048576} MB limit.` };
  }
  return { ok: true, pct, bytes, message: `About ${(bytes / 1048576).toFixed(1)} MB.` };
}
