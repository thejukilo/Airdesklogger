import { Capacitor } from "@capacitor/core";

/**
 * Thin wrapper over the native biometric plugin. Everything is a no-op on the
 * web (returns "not available" / success), and the plugin is loaded lazily so
 * the web bundle never pulls in native code.
 */

export interface BiometryInfo {
  available: boolean;
  /** "Face ID", "Touch ID", or "biometrics". */
  label: string;
}

export async function getBiometry(): Promise<BiometryInfo> {
  if (!Capacitor.isNativePlatform()) return { available: false, label: "" };
  try {
    const mod = await import("@aparajita/capacitor-biometric-auth");
    const info = await mod.BiometricAuth.checkBiometry();
    let label = "biometrics";
    if (info.biometryType === mod.BiometryType.faceId) label = "Face ID";
    else if (info.biometryType === mod.BiometryType.touchId) label = "Touch ID";
    return { available: Boolean(info.isAvailable), label };
  } catch {
    return { available: false, label: "" };
  }
}

/** Prompt for biometric auth. Resolves true on success, false on cancel/failure. */
export async function runBiometric(reason: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const mod = await import("@aparajita/capacitor-biometric-auth");
    await mod.BiometricAuth.authenticate({
      reason,
      cancelTitle: "Use password",
      iosFallbackTitle: "", // hide the device-passcode fallback; we fall back to app password
      allowDeviceCredential: false,
    });
    return true;
  } catch {
    return false;
  }
}
