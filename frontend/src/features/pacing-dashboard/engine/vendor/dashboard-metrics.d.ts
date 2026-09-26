// Sibling declaration file for `dashboard-metrics.js` - NOT vendored, ours to own (see
// `../vendor-types.d.ts`'s header for why this lives here instead of an ambient module block).
// The default export's real type differs by runtime environment (browser vs Vitest's vite-node -
// see `../engine-loader.ts`), so it is declared `unknown` here and narrowed at the one call site.
declare const value: unknown;
export default value;
