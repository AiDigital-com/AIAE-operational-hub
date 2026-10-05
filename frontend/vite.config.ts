import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { pacingVendorUmd } from "./src/features/pacing-dashboard/vendor/umd-plugin";

/**
 * `@shared/*` — the specifier Pacing's own modules under
 * `src/features/pacing-dashboard/spa/` were written against. Those files are moved from Pacing's
 * retired SPA, not re-typed, so they still ask for `@shared/report-v2` the way they did there; this
 * is what points that at our vendored copies instead of at another repository.
 *
 * Mapped one module at a time rather than as a single directory, because the copies live in two
 * places on purpose: `engine/vendor/` holds the six files that are Pacing's CALCULATION ENGINE and
 * carry their own hard "do not edit, nothing compares the copies" rule, and `vendor/` holds the
 * grammar modules that arrived with the widget builder. A directory alias would have forced them
 * into one folder and quietly dissolved that distinction.
 */
const sharedDir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SHARED_MODULES: Record<string, string> = {
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
  };
const sharedAlias = Object.fromEntries(
  Object.entries(SHARED_MODULES).map(([k, v]) => [k, sharedDir(v)])
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.BACKEND_DEV_PORT ?? "5000";
  const backendContextPath = env.VITE_API_CONTEXT_PATH ?? "";
  const clerkPublishableKey =
      env.VITE_CLERK_PUBLISHABLE_KEY ??
      env.CLERK_PUBLISHABLE_KEY ??
      "";

  const clerkJwtTemplate = env.VITE_CLERK_JWT_TEMPLATE ?? "aidigital-api";
  const backendTarget = env.VITE_BACKEND_PROXY_TARGET ?? `http://localhost:${backendPort}${backendContextPath}`;

  return {
    plugins: [pacingVendorUmd(), react()],
    // Pre-bundled for the same reason they are named in `commonjsOptions` below: the dev server
    // has to run the CJS interop over them too, or the page loads with an empty module.
    optimizeDeps: { include: Object.keys(SHARED_MODULES) },
    define: {
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPublishableKey),
      "import.meta.env.VITE_CLERK_JWT_TEMPLATE": JSON.stringify(clerkJwtTemplate),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        ...sharedAlias,
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: [
        "localhost",
        "127.0.0.1",
      ],
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
        },
        "/actuator": {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // Pinned rather than left on Vite's own "modules" default, so the compiled output's browser
      // baseline can't silently drift on a future Vite upgrade.
      target: "es2020",
      // The vendored modules are UMD, not ESM: they end in `module.exports = X` or `root.X = X`.
      // Rollup only runs its commonjs transform over node_modules by default, so without naming
      // them here a production build emits a module with no exports and every importer gets
      // `undefined`. Same list as the alias map above, same reason Pacing's own Vite config carries
      // one.
      commonjsOptions: {
        include: [/node_modules/, /pacing-dashboard\/(engine\/)?vendor\//],
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: ["localhost", "127.0.0.1"],
    },
  };
});
