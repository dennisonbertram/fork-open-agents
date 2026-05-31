import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare of two strings that may be different lengths.
 * `timingSafeEqual` throws on length mismatch, so guard first (this is the
 * same defensive shape used in the production GitHub route + AgentMail docs).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function hmacHex(
  algorithm: "sha1" | "sha256",
  secret: string,
  payload: string,
): string {
  return createHmac(algorithm, secret).update(payload).digest("hex");
}

/** GitHub / AgentMail style: HMAC-SHA256 of the raw body. */
export function sha256Hex(secret: string, payload: string): string {
  return hmacHex("sha256", secret, payload);
}

/** Vercel style: HMAC-SHA1 of the raw body. */
export function sha1Hex(secret: string, payload: string): string {
  return hmacHex("sha1", secret, payload);
}
