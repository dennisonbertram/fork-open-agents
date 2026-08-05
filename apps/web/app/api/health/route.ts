import { checkRateLimit } from "@/lib/rate-limit";
import { isRedisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

// Large enough that the probe never trips the limit it is measuring.
const PROBE_LIMIT = 1_000_000;
const PROBE_WINDOW_MS = 60_000;

type RateLimitBackendStatus = "degraded" | "ok" | "unavailable";

/**
 * Exercises the real rate-limit path so a missing or unreachable Redis is
 * observable from outside the deployment. Without this, the only symptom is a
 * 503 on authenticated routes, which no unauthenticated monitor can see.
 *
 * Outside production `checkRateLimit` fails open and returns null even with no
 * Redis, so the configured check has to come first or local runs would report
 * a backend that is not actually there.
 */
async function probeRateLimitBackend(): Promise<RateLimitBackendStatus> {
  if (!isRedisConfigured()) {
    return "unavailable";
  }

  const probe = await checkRateLimit({
    key: "health:rate-limit-probe",
    limit: PROBE_LIMIT,
    windowMs: PROBE_WINDOW_MS,
  });

  if (probe === null) {
    return "ok";
  }

  return probe.status === 503 ? "unavailable" : "degraded";
}

export async function GET() {
  const rateLimitBackend = await probeRateLimitBackend();
  const healthy = rateLimitBackend === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      rateLimitBackend,
      redisConfigured: isRedisConfigured(),
    },
    { status: healthy ? 200 : 503 },
  );
}
