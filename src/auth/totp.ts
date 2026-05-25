/**
 * Time-based one-time passwords (RFC 6238), built on RFC 4226 HOTP.
 *
 * This is implemented directly rather than pulled from a library so that a
 * reviewer can read the whole of it and check it against the standard. The unit
 * tests run the official RFC 6238 test vectors through it.
 *
 * Used for the second factor that an instructor or examiner must present at the
 * moment they sign off an entry.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

const NODE_ALG: Record<TotpAlgorithm, string> = {
  "SHA-1": "sha1",
  "SHA-256": "sha256",
  "SHA-512": "sha512",
};

export interface TotpOptions {
  digits?: number;
  step?: number; // seconds
  algorithm?: TotpAlgorithm;
}

/** HOTP for an explicit counter (RFC 4226). */
export function hotp(secretBase32: string, counter: number, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? 6;
  const key = Buffer.from(base32Decode(secretBase32));

  const buf = Buffer.alloc(8);
  // 8-byte big-endian counter. Use BigInt to stay exact past 2^32.
  buf.writeBigUInt64BE(BigInt(Math.floor(counter)));

  const hmac = createHmac(NODE_ALG[opts.algorithm ?? "SHA-1"], key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/** TOTP for a moment in time (defaults to now). */
export function totp(secretBase32: string, nowMs: number = Date.now(), opts: TotpOptions = {}): string {
  const step = opts.step ?? 30;
  const counter = Math.floor(nowMs / 1000 / step);
  return hotp(secretBase32, counter, opts);
}

/**
 * Verify a submitted code against the secret, allowing a small window of steps
 * on either side to tolerate clock skew. Comparison is constant time.
 */
export function verifyTotp(
  token: string,
  secretBase32: string,
  opts: TotpOptions & { window?: number; nowMs?: number } = {},
): boolean {
  const step = opts.step ?? 30;
  const window = opts.window ?? 1;
  const now = opts.nowMs ?? Date.now();
  const counter = Math.floor(now / 1000 / step);
  const submitted = Buffer.from(token.trim());

  for (let w = -window; w <= window; w++) {
    const candidate = Buffer.from(hotp(secretBase32, counter + w, opts));
    if (candidate.length === submitted.length && timingSafeEqual(candidate, submitted)) {
      return true;
    }
  }
  return false;
}

/** A fresh random base32 secret (160 bits, as recommended by RFC 4226). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth URI for provisioning the secret into an authenticator app. */
export function otpauthUri(secretBase32: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
