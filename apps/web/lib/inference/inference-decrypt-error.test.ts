import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  encryptInferenceSecret,
  decryptInferenceSecret,
  InferenceSecretDecryptionError,
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

// BT-001: decrypting with the wrong key throws the typed error, not raw crypto error
describe("InferenceSecretDecryptionError", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("BT-001: throws InferenceSecretDecryptionError (not raw crypto error) when decrypting with wrong key", () => {
    process.env.ENCRYPTION_KEY = "original-key-used-for-encryption";
    delete process.env.BETTER_AUTH_SECRET;
    const encrypted = encryptInferenceSecret("my-api-key-value");

    // Change the key so decryption will fail
    process.env.ENCRYPTION_KEY = "completely-different-key-for-this-env";

    let caughtError: unknown;
    try {
      decryptInferenceSecret(encrypted);
    } catch (e) {
      caughtError = e;
    }

    // Must throw the typed error — not raw crypto "Unsupported state or unable to authenticate data"
    expect(caughtError).toBeInstanceOf(InferenceSecretDecryptionError);
    expect(caughtError).toBeInstanceOf(Error);
    const err = caughtError as InstanceType<
      typeof InferenceSecretDecryptionError
    >;
    expect(err.name).toBe("InferenceSecretDecryptionError");
    // Message must be safe — no key material, no plaintext
    expect(err.message).not.toContain("my-api-key-value");
    expect(err.message).not.toContain("original-key-used-for-encryption");
    expect(err.message).not.toContain("completely-different-key-for-this-env");
    // Message must reference decryption failure
    expect(err.message.toLowerCase()).toContain("decrypt");
  });

  // BT-002: correct key still round-trips correctly
  test("BT-002: correct round-trip still works after typed error class added", () => {
    process.env.ENCRYPTION_KEY = "correct-key-for-roundtrip";
    delete process.env.BETTER_AUTH_SECRET;
    const encrypted = encryptInferenceSecret("api-key-correct-roundtrip");
    expect(decryptInferenceSecret(encrypted)).toBe("api-key-correct-roundtrip");
  });

  // BT-003: multi-key fallback still works when secondary key matches original encryption key
  test("BT-003: multi-key fallback succeeds when BETTER_AUTH_SECRET still matches encryption secret", () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.BETTER_AUTH_SECRET = "fallback-secret-used-for-encrypt";
    const encrypted = encryptInferenceSecret("api-key-for-fallback");

    // Now set a new ENCRYPTION_KEY; fallback should still try BETTER_AUTH_SECRET
    process.env.ENCRYPTION_KEY = "new-active-secret-that-differs";
    // BETTER_AUTH_SECRET stays as the original fallback secret

    expect(decryptInferenceSecret(encrypted)).toBe("api-key-for-fallback");
  });
});
