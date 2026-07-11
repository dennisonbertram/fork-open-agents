import { describe, expect, test } from "bun:test";
import {
  canaryExitCodeForStatus,
  formatCanaryResult,
  isCanaryConfigRequired,
  readCanaryConfig,
  runCanaryCli,
} from "./ops-authenticated-canary";

describe("ops authenticated canary", () => {
  test("blocks without complete explicit configuration", () => {
    expect(
      readCanaryConfig({ PRODUCTION_URL: "https://example.com" }),
    ).toBeNull();
  });

  test("requires an owner/repo allowlisted target", () => {
    expect(
      readCanaryConfig({
        PRODUCTION_CANARY_URL: "https://example.com",
        PRODUCTION_CANARY_REPO: "not-a-repo",
        PRODUCTION_CANARY_IDENTITY: "test-user",
        PRODUCTION_CANARY_AUTH_COOKIE: "session=secret",
      }),
    ).toBeNull();
  });

  test("rejects malformed target URLs and timeouts as configuration blocks", () => {
    const base = {
      PRODUCTION_CANARY_REPO: "owner/repo",
      PRODUCTION_CANARY_IDENTITY: "test-user",
      PRODUCTION_CANARY_AUTH_COOKIE: "session=secret",
    };
    expect(
      readCanaryConfig({
        ...base,
        PRODUCTION_CANARY_URL: "not-a-url",
      }),
    ).toBeNull();
    expect(
      readCanaryConfig({
        ...base,
        PRODUCTION_CANARY_URL: "https://example.com",
        PRODUCTION_CANARY_TIMEOUT_MS: "-1",
      }),
    ).toBeNull();
  });

  test("returns a normalized config once all four env vars are present", () => {
    const config = readCanaryConfig({
      PRODUCTION_CANARY_URL: "https://example.com",
      PRODUCTION_CANARY_REPO: "Owner/Repo",
      PRODUCTION_CANARY_IDENTITY: "canary-user",
      PRODUCTION_CANARY_AUTH_COOKIE: "session=secret",
    });
    expect(config).not.toBeNull();
    expect(config?.testRepo).toBe("owner/repo");
    expect(config?.targetUrl).toBe("https://example.com");
    expect(config?.testIdentity).toBe("canary-user");
    expect(config?.authCookie).toBe("session=secret");
  });

  test("redacts cookie-like evidence in output", () => {
    const output = formatCanaryResult({
      requestId: "req-1",
      status: "failed",
      targetUrl: "https://example.com",
      repo: "owner/repo",
      steps: [
        {
          name: "auth",
          status: "failed",
          evidence: "cookie: session=secret",
        },
      ],
    });
    expect(output).not.toContain("session=secret");
    expect(output).toContain("[redacted]");
  });

  test("maps passed, executed failure, timeout, and blocked statuses to the shared exit policy", () => {
    expect(canaryExitCodeForStatus("passed", true)).toBe(0);
    expect(canaryExitCodeForStatus("failed", true)).toBe(1);
    expect(canaryExitCodeForStatus("timed_out", true)).toBe(1);
    expect(canaryExitCodeForStatus("blocked_by_configuration", true)).toBe(2);
    expect(canaryExitCodeForStatus("blocked_by_configuration", false)).toBe(0);
  });

  test("requires configuration only when strict mode is explicitly enabled", () => {
    expect(
      isCanaryConfigRequired({ PRODUCTION_CANARY_REQUIRE_CONFIG: "true" }),
    ).toBe(true);
    expect(
      isCanaryConfigRequired({ PRODUCTION_CANARY_REQUIRE_CONFIG: "TRUE" }),
    ).toBe(true);
    expect(
      isCanaryConfigRequired({ PRODUCTION_CANARY_REQUIRE_CONFIG: "false" }),
    ).toBe(false);
    expect(isCanaryConfigRequired({})).toBe(false);
  });

  test("strict missing configuration returns 2 without attempting a journey", async () => {
    const logs: string[] = [];
    const exitCode = await runCanaryCli({
      env: { PRODUCTION_CANARY_REQUIRE_CONFIG: "true" },
      log: (line) => logs.push(line),
    });

    expect(exitCode).toBe(2);
    expect(logs.join("\n")).toContain("Status: blocked_by_configuration");
    expect(logs.join("\n")).toContain("No production proof occurred");
  });

  test("strict malformed repository configuration also returns 2", async () => {
    const exitCode = await runCanaryCli({
      env: {
        PRODUCTION_CANARY_REQUIRE_CONFIG: "true",
        PRODUCTION_CANARY_URL: "https://example.com",
        PRODUCTION_CANARY_REPO: "not-a-repo",
        PRODUCTION_CANARY_IDENTITY: "canary-user",
        PRODUCTION_CANARY_AUTH_COOKIE: "session=secret",
      },
      log: () => undefined,
    });

    expect(exitCode).toBe(2);
  });

  test("non-strict local diagnostics retain exit 0 while denying a proof claim", async () => {
    const logs: string[] = [];
    const exitCode = await runCanaryCli({
      env: {},
      log: (line) => logs.push(line),
    });

    expect(exitCode).toBe(0);
    expect(logs.join("\n")).toContain("Status: blocked_by_configuration");
    expect(logs.join("\n")).toContain("No production proof occurred");
  });
});
