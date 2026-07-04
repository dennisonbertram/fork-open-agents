import { describe, expect, test } from "bun:test";
import {
  formatCanaryResult,
  readCanaryConfig,
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
});
