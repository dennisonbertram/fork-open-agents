import { afterEach, describe, expect, mock, test } from "bun:test";

const checkBotIdMock = mock(() => ({
  isHuman: false,
  isBot: true,
  isVerifiedBot: false,
}));

mock.module("botid/server", () => ({
  checkBotId: checkBotIdMock,
}));

const { checkBotProtection, botIdConfig } = await import("./botid");

const originalNodeEnv = process.env.NODE_ENV;
const originalTestAuth = process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalTestAuthSecret = process.env.TEST_AUTH_SECRET;
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
  if (originalTestAuthSecret === undefined) {
    delete process.env.TEST_AUTH_SECRET;
  } else {
    process.env.TEST_AUTH_SECRET = originalTestAuthSecret;
  }
  checkBotIdMock.mockClear();
}

describe("checkBotProtection", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("bypasses BotID when test auth is explicitly enabled", async () => {
    process.env[nodeEnvKey] = "test";
    process.env.TEST_AUTH_SECRET = "test-secret";
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "preview";

    await expect(checkBotProtection()).resolves.toMatchObject({
      bypassed: true,
      isBot: false,
    });
    expect(checkBotIdMock).not.toHaveBeenCalled();
  });

  test("does not bypass BotID on Vercel production even if the test-auth flag is set", async () => {
    process.env[nodeEnvKey] = "production";
    process.env.TEST_AUTH_SECRET = "test-secret";
    process.env.OPEN_AGENTS_ENABLE_TEST_AUTH = "1";
    process.env.VERCEL_ENV = "production";

    await expect(checkBotProtection()).resolves.toMatchObject({
      isBot: true,
    });
    expect(checkBotIdMock).toHaveBeenCalledTimes(1);
  });

  test("uses BotID in production when test auth is disabled", async () => {
    process.env[nodeEnvKey] = "production";
    delete process.env.OPEN_AGENTS_ENABLE_TEST_AUTH;

    await expect(checkBotProtection()).resolves.toMatchObject({
      isBot: true,
    });
    expect(checkBotIdMock).toHaveBeenCalledTimes(1);
  });

  // Regression: this fork's production + preview deployments are served on
  // *.vercel.app. If that host isn't allowlisted, BotID rejects the frontend
  // origin and protected calls (e.g. POST /api/sessions) 403 for real users.
  test("allowlists *.vercel.app so the fork's deploy domains pass BotID", () => {
    expect(botIdConfig.advancedOptions.extraAllowedHosts).toContain(
      "*.vercel.app",
    );
  });
});
