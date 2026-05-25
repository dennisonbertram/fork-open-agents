import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  decryptInferenceSecret,
  encryptInferenceSecret,
  fingerprintInferenceSecret,
  lastFourSecretChars,
} = await import("./encryption");

const originalEncryptionKey = process.env.ENCRYPTION_KEY;
const originalBetterAuthSecret = process.env.BETTER_AUTH_SECRET;

function restoreEnv() {
  if (originalEncryptionKey === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  }

  if (originalBetterAuthSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = originalBetterAuthSecret;
  }
}

describe("inference secret encryption", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("round-trips secrets without storing plaintext", () => {
    process.env.ENCRYPTION_KEY = "active-encryption-secret";
    process.env.BETTER_AUTH_SECRET = "auth-secret";

    const encrypted = encryptInferenceSecret("provider-secret-value");

    expect(encrypted).not.toContain("provider-secret-value");
    expect(decryptInferenceSecret(encrypted)).toBe("provider-secret-value");
    expect(lastFourSecretChars("provider-secret-value")).toBe("alue");
    expect(fingerprintInferenceSecret("provider-secret-value")).toHaveLength(
      16,
    );
  });

  test("decrypts profiles created with the legacy Better Auth fallback", () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.BETTER_AUTH_SECRET = "legacy-auth-secret";
    const encrypted = encryptInferenceSecret("legacy-provider-secret");

    process.env.ENCRYPTION_KEY = "new-dedicated-encryption-secret";

    expect(decryptInferenceSecret(encrypted)).toBe("legacy-provider-secret");
  });
});
