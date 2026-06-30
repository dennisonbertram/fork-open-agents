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
