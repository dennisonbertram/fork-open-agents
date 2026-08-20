import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let seedCalls = 0;

mock.module("@/lib/dev/test-auth-seed", () => ({
  seedTestAuthUser: async () => {
    seedCalls += 1;
    return { userId: "dev-managed-runtime-user" };
  },
}));

const routeModulePromise = import("./route");

const originalNodeEnv = process.env.NODE_ENV;
const originalTestAuth = process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
const originalVercelEnv = process.env.VERCEL_ENV;
const nodeEnvKey = "NODE_ENV" as keyof NodeJS.ProcessEnv;

function restoreEnv() {
  process.env[nodeEnvKey] = originalNodeEnv;
  if (originalTestAuth === undefined) {
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
  } else {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = originalTestAuth;
  }
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
}

describe("GET /api/dev/test-auth", () => {
  beforeEach(() => {
    seedCalls = 0;
    process.env[nodeEnvKey] = "test";
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    restoreEnv();
  });

  test("returns 404 and does not seed when test-auth is disabled", async () => {
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost:3000/api/dev/test-auth"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Not found",
      errorKind: "not_found",
    });
    expect(seedCalls).toBe(0);
  });

  test("returns 404 on production even when the opt-in flag is set", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost:3000/api/dev/test-auth"),
    );

    expect(response.status).toBe(404);
    expect(seedCalls).toBe(0);
  });

  test("sets the test-auth cookie and seeds rows without provisioning a sandbox", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost:3000/api/dev/test-auth"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      userId: "dev-managed-runtime-user",
    });
    expect(response.headers.get("Set-Cookie")).toContain(
      "open_agents_test_user_id=dev-managed-runtime-user",
    );
    expect(seedCalls).toBe(1);
  });

  test("redirects to a same-origin relative path after setting the cookie", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost:3000/api/dev/test-auth?next=/sessions"),
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:3000/sessions",
    );
    expect(response.headers.get("Set-Cookie")).toContain(
      "open_agents_test_user_id=dev-managed-runtime-user",
    );
    expect(seedCalls).toBe(1);
  });

  test("ignores an absolute or protocol-relative next and returns JSON instead", async () => {
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request(
        "http://localhost:3000/api/dev/test-auth?next=https://evil.example",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      userId: "dev-managed-runtime-user",
    });
    expect(response.headers.get("Location")).toBeNull();
  });

  test("the route source never imports sandbox or the managed-runtime demo", async () => {
    const source = await Bun.file(new URL("route.ts", import.meta.url)).text();

    expect(source).not.toContain("@open-agents/sandbox");
    expect(source).not.toContain("connectSandbox");
    expect(source).not.toContain("prepareManagedRuntimeDemo");
  });
});
