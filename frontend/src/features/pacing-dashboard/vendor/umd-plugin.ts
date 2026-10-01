import type { Plugin } from "vite";

/**
 * Makes the vendored UMD modules importable as ES modules.
 *
 * They end in the two-branch tail every UMD has - `module.exports = X` when something defines
 * `module`, `root.X = X` otherwise - and neither branch produces an ES export. A browser running
 * Vite's dev server loads them as native ES modules, so `import DashBlocks from '@shared/dash-blocks'`
 * fails outright with "does not provide an export named 'default'" and takes the route down with it.
 *
 * WHY A PLUGIN AND NOT `optimizeDeps` / `commonjsOptions`. Both were in place and neither covers
 * this: `optimizeDeps` pre-bundles DEPENDENCIES (node_modules), not first-party source, and
 * `build.commonjsOptions` is a Rollup setting that the dev server never runs. The result was the
 * worst shape of bug - every test green, the production bundle correct, and the dev server white -
 * which is exactly the dev/test divergence `../engine/engine-loader.ts` documents at length. This
 * plugin applies in BOTH, so there is one behaviour to reason about.
 *
 * `.mjs` files are untouched: `layout-materialize.mjs` and `layout-geometry.mjs` are real ES modules
 * with named exports and need nothing.
 */
export function pacingVendorUmd(): Plugin {
  const TARGET = /pacing-dashboard[\\/](engine[\\/])?vendor[\\/][a-z0-9-]+\.js$/;
  return {
    name: "pacing-vendor-umd",
    enforce: "pre",
    transform(code, id) {
      if (!TARGET.test(id.split("?")[0])) return null;
      // The LAST `root.X =` is the UMD tail's own assignment; an earlier one would be ordinary code.
      const names = [...code.matchAll(/root\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
      const name = names[names.length - 1];
      if (!name) {
        this.error(`[pacing-vendor-umd] no UMD global found in ${id} - has its tail changed?`);
      }
      // The original is run inside a function that gives it its OWN `module`, so the UMD takes its
      // CommonJS branch and writes somewhere we can read. Appending an `export default` to the file
      // as-is does not work: that makes it an ES module, and then the `module` vite-node provides is
      // the frozen namespace object - `module.exports = X` throws "Cannot set property default of
      // [object Module]" and eighteen test files stop collecting. Shadowing it is the only form that
      // behaves the same in the browser, in the dev server and under the test runner.
      return {
        code:
          `const __umdModule = { exports: {} };\n` +
          `(function (module, exports) {\n${code}\n})(__umdModule, __umdModule.exports);\n` +
          `const __umd = __umdModule.exports && Object.keys(__umdModule.exports).length\n` +
          `  ? __umdModule.exports\n` +
          `  : globalThis[${JSON.stringify(name)}];\n` +
          `export default __umd;\n`,
        map: null,
      };
    },
  };
}
