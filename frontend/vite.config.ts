import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

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
    plugins: [react()],
    define: {
      "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPublishableKey),
      "import.meta.env.VITE_CLERK_JWT_TEMPLATE": JSON.stringify(clerkJwtTemplate),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
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
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: ["localhost", "127.0.0.1"],
    },
  };
});
