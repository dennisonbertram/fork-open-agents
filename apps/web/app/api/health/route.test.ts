import { afterEach, describe, expect, mock, test } from "bun:test";

type HealthBody = {
  rateLimitBackend: string;
  redisConfigured: boolean;
  status: string;
};

const rateLimitState: { response: Response | null } = { response: null };
const redisState: { configured: boolean } = { configured: true };

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: mock(async () => rateLimitState.response),
  rateLimitKey: (parts: unknown[]) => parts.join(":"),
}));

mock.module("@/lib/redis", () => ({
  isRedisConfigured: () => redisState.configured,
}));

afterEach(() => {
  rateLimitState.response = null;
  redisState.configured = true;
});

async function readHealth(): Promise<{ body: HealthBody; status: number }> {
  const { GET } = await import("./route");
  const response = await GET();
  return {
    body: (await response.json()) as HealthBody,
    status: response.status,
  };
}

describe("GET /api/health", () => {
  test("reports ok when the rate-limit backend answers", async () => {
    const { body, status } = await readHealth();

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.rateLimitBackend).toBe("ok");
    expect(body.redisConfigured).toBe(true);
  });

  test("reports 503 when Redis is not configured", async () => {
    redisState.configured = false;

    const { body, status } = await readHealth();

    expect(status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.rateLimitBackend).toBe("unavailable");
    expect(body.redisConfigured).toBe(false);
  });

  test("reports 503 when the rate-limit check fails closed", async () => {
    rateLimitState.response = Response.json(
      { error: "Rate limit unavailable", kind: "unknown" },
      { status: 503 },
    );

    const { body, status } = await readHealth();

    expect(status).toBe(503);
    expect(body.rateLimitBackend).toBe("unavailable");
  });

  test("reports degraded when the probe itself is rate limited", async () => {
    rateLimitState.response = Response.json(
      { error: "Too many requests", kind: "rate_limited" },
      { status: 429 },
    );

    const { body, status } = await readHealth();

    expect(status).toBe(503);
    expect(body.rateLimitBackend).toBe("degraded");
  });
});
