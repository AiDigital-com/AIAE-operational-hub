/**
 * currency.js — Pure currency conversion + display module
 *
 * Single source of truth for native↔USD conversion, the `converted`
 * predicate, currency symbols, and dual-currency formatting. Used by:
 *   - workspace (Vite alias @shared/currency),
 *   - dash-gate (import),
 *   - pacing-builder (requires /shared/currency.js directly — the n8n
 *     injection retired with the builder isolation, spec
 *     2026-07-22-pacing-builder).
 *
 * Model (option B, locked): native_budget is the stored money truth;
 * target_spend is the materialized USD cache = currencyToUsd(native, rate).
 * A USD campaign is the degenerate case (rate = 1 => identity).
 *
 * ALL functions are pure: no I/O, no globals.
 *
 * Browser/global: exposes `Currency`.
 * Node.js: `module.exports = Currency`.
 */
(function (root) {
"use strict";

// Treat null/undefined/0/1/non-finite rate as "no conversion" (identity).
function effectiveRate(rate) {
    var r = Number(rate);
    if (!isFinite(r) || r === 0 || r === 1) return null;
    return r;
}

// native (e.g. CAD) -> USD. rate null/0/1/non-finite => native unchanged.
function currencyToUsd(native, rate) {
    var n = Number(native) || 0;
    var r = effectiveRate(rate);
    return r === null ? n : n * r;
}

// USD -> native. rate null/0/1/non-finite => usd unchanged.
function usdToNative(usd, rate) {
    var u = Number(usd) || 0;
    var r = effectiveRate(rate);
    return r === null ? u : u / r;
}

// Converted iff a non-USD currency carries a real (>0, !=1) rate.
function isConverted(currency, rate) {
    if (currency == null) return false;
    var c = String(currency).trim().toUpperCase();
    if (c === "" || c === "USD") return false;
    var r = Number(rate);
    return rate != null && isFinite(r) && r > 0 && r !== 1;
}

var CURRENCY_SYMBOLS = { USD: "$", CAD: "CA$", AUD: "A$", GBP: "GBP ", EUR: "EUR " };

function symbolFor(currency) {
    var c = String(currency == null ? "" : currency).toUpperCase();
    return Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, c)
        ? CURRENCY_SYMBOLS[c]
        : c + " ";
}

// "CA$7,000" — symbol + en-US grouping, 0 decimals.
function formatNative(amount, currency) {
    var n = Math.round(Number(amount) || 0);
    return symbolFor(currency) + n.toLocaleString("en-US");
}

// "$5,021" — 0 decimals. Used ONLY for the muted USD secondary line on
// converted blocks; the USD-campaign display path keeps existing formatting.
function formatUsd(amount) {
    var n = Math.round(Number(amount) || 0);
    return "$" + n.toLocaleString("en-US");
}

var Currency = {
    currencyToUsd: currencyToUsd,
    usdToNative: usdToNative,
    isConverted: isConverted,
    CURRENCY_SYMBOLS: CURRENCY_SYMBOLS,
    formatNative: formatNative,
    formatUsd: formatUsd
};

/* UMD export */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Currency;
} else {
    root.Currency = Currency;
}

})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
