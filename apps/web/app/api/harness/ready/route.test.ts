import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalFetch = globalThis.fetch;
const previousEnv = {
  HARNESS_ENABLED: process.env.HARNESS_ENABLED,
  HARNESS_BASE_URL: process.env.HARNESS_BASE_URL,
  HARNESS_SERVICE_TOKEN: process.env.HARNESS_SERVICE_TOKEN,
  HARNESS_TENANT_ID: process.env.HARNESS_TENANT_ID,
  HARNESS_DEFAULT_PROJECT_ID: process.env.HARNESS_DEFAULT_PROJECT_ID,
};

let fetchCalls: Request[] = [];

function restoreHarnessEnv() {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const routeModulePromise = import("./route");

describe("/api/harness/ready", () => {
  beforeEach(() => {
    restoreHarnessEnv();
    fetchCalls = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCalls.push(new Request(input, init));
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    restoreHarnessEnv();
    globalThis.fetch = originalFetch;
  });

  test("disabled mode returns false and makes no outbound request", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/harness/ready"),
    );
    const body = (await response.json()) as { enabled: boolean };

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  test("enabled mode checks health, ready, OpenAPI, and UI manifest", async () => {
    Object.assign(process.env, {
      HARNESS_ENABLED: "true",
      HARNESS_BASE_URL: "http://localhost:4318",
      HARNESS_SERVICE_TOKEN: "service-token",
      HARNESS_TENANT_ID: "tenant-1",
      HARNESS_DEFAULT_PROJECT_ID: "project-1",
    });
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request("http://localhost/api/harness/ready", {
        headers: { "X-Request-ID": "request-123" },
      }),
    );
    const body = (await response.json()) as { enabled: boolean };

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(fetchCalls.map((call) => new URL(call.url).pathname)).toEqual([
      "/health",
      "/ready",
      "/openapi.json",
      "/ui-manifest.json",
    ]);
    expect(fetchCalls[0]?.headers.get("authorization")).toBe(
      "Bearer service-token",
    );
    expect(fetchCalls[0]?.headers.get("x-request-id")).toBe("request-123");
  });
});
