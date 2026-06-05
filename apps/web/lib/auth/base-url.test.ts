import { afterEach, describe, expect, test } from "bun:test";
import { getAllowedAuthHosts, getAuthBaseURLFallback } from "./base-url";

const ENV_KEYS = [
  "BETTER_AUTH_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("auth base URL helpers", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("allows loopback hosts for local Vercel OAuth callbacks", () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    expect(getAllowedAuthHosts()).toEqual(
      expect.arrayContaining([
        "localhost:3000",
        "localhost:*",
        "127.0.0.1:3000",
        "127.0.0.1:*",
        "[::1]:3000",
        "[::1]:*",
      ]),
    );
  });

  test("adds configured production and preview hosts", () => {
    process.env.BETTER_AUTH_URL = "https://open-agents.example";
    process.env.VERCEL_URL = "preview-open-agents.vercel.app";

    expect(getAllowedAuthHosts()).toEqual(
      expect.arrayContaining([
        "open-agents.example",
        "*.open-agents.example",
        "preview-open-agents.vercel.app",
        "*.preview-open-agents.vercel.app",
      ]),
    );
  });

  test("uses BETTER_AUTH_URL before VERCEL_URL as the fallback", () => {
    process.env.BETTER_AUTH_URL = "https://open-agents.example";
    process.env.VERCEL_URL = "preview-open-agents.vercel.app";

    expect(getAuthBaseURLFallback()).toBe("https://open-agents.example");
  });

  test("prefers the stable branch alias over the per-deployment URL on preview", () => {
    delete process.env.BETTER_AUTH_URL;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "open-agents-git-feature-x-team.vercel.app";
    process.env.VERCEL_URL = "open-agents-abc123hash-team.vercel.app";

    expect(getAuthBaseURLFallback()).toBe(
      "https://open-agents-git-feature-x-team.vercel.app",
    );
  });

  test("falls back to VERCEL_URL on preview when no branch alias is set", () => {
    delete process.env.BETTER_AUTH_URL;
    delete process.env.VERCEL_BRANCH_URL;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "open-agents-abc123hash-team.vercel.app";

    expect(getAuthBaseURLFallback()).toBe(
      "https://open-agents-abc123hash-team.vercel.app",
    );
  });

  test("does not use the branch alias outside preview (production keeps VERCEL_URL)", () => {
    delete process.env.BETTER_AUTH_URL;
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_BRANCH_URL = "open-agents-git-main-team.vercel.app";
    process.env.VERCEL_URL = "open-agents-abc123hash-team.vercel.app";

    expect(getAuthBaseURLFallback()).toBe(
      "https://open-agents-abc123hash-team.vercel.app",
    );
  });

  test("BETTER_AUTH_URL still wins over the preview branch alias", () => {
    process.env.BETTER_AUTH_URL = "https://open-agents.example";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "open-agents-git-feature-x-team.vercel.app";

    expect(getAuthBaseURLFallback()).toBe("https://open-agents.example");
  });

  test("includes the preview branch alias host in allowed auth hosts", () => {
    process.env.VERCEL_BRANCH_URL = "open-agents-git-feature-x-team.vercel.app";

    expect(getAllowedAuthHosts()).toEqual(
      expect.arrayContaining([
        "open-agents-git-feature-x-team.vercel.app",
        "*.open-agents-git-feature-x-team.vercel.app",
      ]),
    );
  });
});
