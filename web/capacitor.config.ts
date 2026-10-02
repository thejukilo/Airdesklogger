import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the built web app (web/dist) as a native iOS app. The app
 * loads its UI locally and calls the deployed API over HTTPS (see API_ORIGIN in
 * src/api.ts).
 *
 * CapacitorHttp routes fetch/XHR through the native networking layer. That
 * matters because the WebView serves the app from a local origin
 * (capacitor://localhost), so a plain browser fetch to https://log.airdeck.ch
 * would be blocked by CORS. Going native sidesteps it, so the backend needs no
 * CORS changes.
 */
const config: CapacitorConfig = {
  appId: "ch.airdeck.logger",
  appName: "Airdesk Logger",
  webDir: "dist",
  plugins: {
    CapacitorHttp: { enabled: true },
  },
  ios: {
    // Keep content clear of the status bar / notch.
    contentInset: "always",
  },
};

export default config;
