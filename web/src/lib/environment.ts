import { Capacitor } from "@capacitor/core";

// Injected at build time by Vite (`define`) from the Vercel build's VERCEL_ENV.
declare const __DEPLOY_ENV__: string | undefined;

export type DeployEnv = "production" | "staging" | "development";

/**
 * Which deployment this bundle is running in.
 *
 * The build-time VERCEL_ENV is the source of truth, so it is correct no matter
 * which URL opens the app (a preview deployment reached via its *.vercel.app URL
 * is still "staging"; production reached via any alias is still "production").
 * The native app is always a production release, so it is forced to production.
 */
export function deployEnv(): DeployEnv {
  if (Capacitor.isNativePlatform()) return "production";
  const build = typeof __DEPLOY_ENV__ === "string" ? __DEPLOY_ENV__ : "development";
  if (build === "production") return "production";
  if (build === "preview") return "staging";
  // Local build (VERCEL_ENV unset): still treat the real domain as production.
  if (typeof window !== "undefined" && window.location.hostname === "log.airdeck.ch") {
    return "production";
  }
  return build === "development" ? "development" : "staging";
}

export const isProduction = (): boolean => deployEnv() === "production";
