import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const managedEnvKeys = [
  "BACKGROUND_AGENTS_ENABLED",
  "POSTGRES_URL",
  "BETTER_AUTH_SECRET",
  "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID",
  "VERCEL_APP_CLIENT_SECRET",
  "NEXT_PUBLIC_GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "NEXT_PUBLIC_GITHUB_APP_SLUG",
  "BACKGROUND_AGENTS_CRON_SECRET",
  "CRON_SECRET",
  "BACKGROUND_AGENTS_WEBHOOK_SECRET",
] as const;

const originalEnv = new Map<string, string | undefined>();

const modulePromise = import("./readiness");

describe("background agent readiness", () => {
  beforeEach(() => {
    for (const key of managedEnvKeys) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of managedEnvKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();
  });

  test("reports missing safe env names without secret values", async () => {
    const { getBackgroundAgentReadiness } = await modulePromise;

    const readiness = getBackgroundAgentReadiness();

    expect(readiness.enabled).toBe(false);
    expect(readiness.ready).toBe(false);
    expect(
      readiness.checks.find((check) => check.id === "feature_flag"),
    ).toMatchObject({
      status: "disabled",
      missing: ["BACKGROUND_AGENTS_ENABLED"],
    });
    expect(readiness.missing).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(JSON.stringify(readiness)).not.toContain("secret-value");
  });

  test("accepts CRON_SECRET as the scheduled dispatch secret", async () => {
    const { getBackgroundAgentReadiness } = await modulePromise;
    for (const key of managedEnvKeys) {
      process.env[key] = `${key.toLowerCase()}-value`;
    }
    delete process.env.BACKGROUND_AGENTS_CRON_SECRET;
    process.env.BACKGROUND_AGENTS_ENABLED = "true";
    process.env.CRON_SECRET = "cron-secret-value";

    const readiness = getBackgroundAgentReadiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
    expect(
      readiness.checks.find((check) => check.id === "cron_secret"),
    ).toMatchObject({
      status: "ready",
      missing: [],
    });
  });
});
