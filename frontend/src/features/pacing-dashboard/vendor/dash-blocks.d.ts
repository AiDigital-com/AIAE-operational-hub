// Sibling declaration file for `dash-blocks.js`. TypeScript resolves a relative `.js` import's
// types through a same-named sibling declaration file, never through an ambient `declare module`
// for a relative specifier - see `../engine/vendor-types.d.ts`'s header for the long version.
//
// Ours, not vendored: it is not part of what gets re-copied from AIAE-paicing (see SOURCE.md).
// The useful shape lives in `loader.ts`, which is what callers import; this file exists only so
// `import("./dash-blocks.js")` type-checks at all.
declare const value: unknown;
export default value;
