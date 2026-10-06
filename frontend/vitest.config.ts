import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { pacingVendorUmd } from "./src/features/pacing-dashboard/vendor/umd-plugin";

/** Same map as vite.config.ts's, and for the same reason — see its docblock. Duplicated rather than
 *  imported because that file is a function of `mode`, which the test runner has no value for. */
const sharedAlias = Object.fromEntries(
  Object.entries({
    "@shared/pacing-core": "./src/features/pacing-dashboard/engine/vendor/pacing-core.js",
    "@shared/currency": "./src/features/pacing-dashboard/engine/vendor/currency.js",
    "@shared/metric-registry": "./src/features/pacing-dashboard/engine/vendor/metric-registry.js",
    "@shared/report-v2": "./src/features/pacing-dashboard/vendor/report-v2.js",
    "@shared/std-entries": "./src/features/pacing-dashboard/vendor/std-entries.js",
    "@shared/widget-metrics": "./src/features/pacing-dashboard/vendor/widget-metrics.js",
    "@shared/lib-refs": "./src/features/pacing-dashboard/vendor/lib-refs.js",
    "@shared/dash-blocks": "./src/features/pacing-dashboard/vendor/dash-blocks.js",
    "@shared/kpi-band": "./src/features/pacing-dashboard/vendor/kpi-band.js",
    "@shared/value-labels": "./src/features/pacing-dashboard/vendor/value-labels.js",
    "@shared/mapping-dims": "./src/features/pacing-dashboard/vendor/mapping-dims.js",
  "@shared/primary-cv-rule": "./src/features/pacing-dashboard/vendor/primary-cv-rule.js",
  "@shared/dim-value-groups": "./src/features/pacing-dashboard/vendor/dim-value-groups.js",
  "@shared/formula-chips": "./src/features/pacing-dashboard/vendor/formula-chips.js",
  "@shared/line-item-columns": "./src/features/pacing-dashboard/vendor/line-item-columns.js",
  "@shared/refresh-freshness": "./src/features/pacing-dashboard/vendor/refresh-freshness.js",
    "@shared/primary-cv-rule": "./src/features/pacing-dashboard/vendor/primary-cv-rule.js",
    "@shared/dim-value-groups": "./src/features/pacing-dashboard/vendor/dim-value-groups.js",
  "@shared/formula-chips": "./src/features/pacing-dashboard/vendor/formula-chips.js",
  "@shared/line-item-columns": "./src/features/pacing-dashboard/vendor/line-item-columns.js",
  "@shared/refresh-freshness": "./src/features/pacing-dashboard/vendor/refresh-freshness.js",
  }).map(([k, v]) => [k, fileURLToPath(new URL(v, import.meta.url))])
);

export default defineConfig({
  plugins: [pacingVendorUmd(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...sharedAlias,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});