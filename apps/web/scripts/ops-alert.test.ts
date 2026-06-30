import { describe, expect, test } from "bun:test";
import { buildAlertKey, renderAlertBody, renderAlertTitle } from "./ops-alert";

describe("ops alert", () => {
  test("uses a stable dedupe key", () => {
    expect(
      buildAlertKey({ source: "Public-Smoke", environment: "Production" }),
    ).toBe("production-ops:public-smoke:production");
  });

  test("renders an incident-style title", () => {
    expect(
      renderAlertTitle({
        source: "public-smoke",
        environment: "production",
        status: "failing",
        summary: "home failed",
      }),
    ).toBe("[production-ops] public-smoke failing in production");
  });

  test("redacts secret-like body text", () => {
    const body = renderAlertBody({
      source: "public-smoke",
      environment: "production",
      status: "failing",
      summary: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz",
    });
    expect(body).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(body).toContain("[redacted]");
  });
});
