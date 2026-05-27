import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

describe("diagnostic bundle tokens", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-diagnostic-secret";
    delete process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (originalBetterAuthSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
    }

    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test("round-trips a session and chat scoped token", async () => {
    const { createDiagnosticBundleToken, verifyDiagnosticBundleToken } =
      await import("./diagnostic-token");
    const token = createDiagnosticBundleToken({
      sessionId: "session-1",
      chatId: "chat-1",
      expiresAt: new Date("2026-05-27T12:30:00.000Z"),
    });

    expect(
      verifyDiagnosticBundleToken({
        token,
        sessionId: "session-1",
        chatId: "chat-1",
        now: new Date("2026-05-27T12:00:00.000Z"),
      }),
    ).toBe(true);
  });

  test("rejects expired or wrong-scope tokens", async () => {
    const { createDiagnosticBundleToken, verifyDiagnosticBundleToken } =
      await import("./diagnostic-token");
    const token = createDiagnosticBundleToken({
      sessionId: "session-1",
      chatId: "chat-1",
      expiresAt: new Date("2026-05-27T12:30:00.000Z"),
    });

    expect(
      verifyDiagnosticBundleToken({
        token,
        sessionId: "session-1",
        chatId: "chat-1",
        now: new Date("2026-05-27T12:31:00.000Z"),
      }),
    ).toBe(false);
    expect(
      verifyDiagnosticBundleToken({
        token,
        sessionId: "session-1",
        chatId: "chat-2",
        now: new Date("2026-05-27T12:00:00.000Z"),
      }),
    ).toBe(false);
  });
});
