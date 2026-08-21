import { timingSafeEqual } from "node:crypto";

/**
 * Timing-safe comparison of a candidate value against a secret.
 *
 * `timingSafeEqual` throws when buffer lengths differ, and a caught-length
 * mismatch is itself a timing side channel (branch taken before any
 * comparison happens). Compare against a same-length dummy buffer instead so
 * every call path — matching length or not — does the same amount of work.
 */
function timingSafeEquals(candidate: string, secret: string): boolean {
  const secretBuffer = Buffer.from(secret);
  const candidateBuffer = Buffer.from(candidate);

  if (candidateBuffer.length !== secretBuffer.length) {
    // Compare against a dummy buffer of the same length as the secret so the
    // work performed does not depend on the candidate's length, then return
    // false regardless of the (meaningless) comparison result.
    timingSafeEqual(Buffer.alloc(secretBuffer.length), secretBuffer);
    return false;
  }

  return timingSafeEqual(candidateBuffer, secretBuffer);
}

/**
 * Whether a request carries the configured cron secret, checked with a
 * timing-safe comparison to avoid leaking the secret through response-time
 * differences.
 *
 * Accepts either:
 *   - `Authorization: Bearer <secret>`
 *   - `x-background-agents-cron-secret: <secret>`
 */
export function isAuthorizedCronRequest(req: Request, secret: string): boolean {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length);
    if (timingSafeEquals(token, secret)) {
      return true;
    }
  }

  const headerSecret = req.headers.get("x-background-agents-cron-secret");
  if (headerSecret !== null && timingSafeEquals(headerSecret, secret)) {
    return true;
  }

  return false;
}
