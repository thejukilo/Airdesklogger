import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, set VITE_API_PROXY to the URL of a running API (for example a
// Vercel deployment or a local server) and calls to /api are proxied there. In
// production the SPA and the API are served from the same origin, so no proxy
// is needed.
export default defineConfig(() => {
  const proxyTarget = process.env.VITE_API_PROXY;
  return {
    plugins: [react()],
    // VERCEL_ENV ("production" | "preview") is set during the Vercel build; it is
    // baked into the bundle so the app can tell which deployment it is, correctly,
    // regardless of which URL opens it. Falls back to "development" for local builds.
    define: {
      __DEPLOY_ENV__: JSON.stringify(process.env.VERCEL_ENV || "development"),
    },
    server: proxyTarget
      ? { proxy: { "/api": { target: proxyTarget, changeOrigin: true, secure: true } } }
      : {},
  };
});
