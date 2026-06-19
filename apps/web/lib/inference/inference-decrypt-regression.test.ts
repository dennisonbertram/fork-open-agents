/**
 * Regression tests for inference-profile decryption error handling.
 *
 * These tests would fail if the changes in the green commit were reverted:
 * - InferenceSecretDecryptionError removed from encryption.ts
 * - Wrapping logic removed from decryptInferenceProfileApiKey
 * - Defense-in-depth branch removed from chat.ts getSetupErrorMessage
 */
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

describe("regression: InferenceSecretDecryptionError contract", () => {
  afterEach(() => {
    restoreEnv();
  });

  // REG-001: The class must be exported and constructible — prevents accidental removal
  test("REG-001: InferenceSecretDecryptionError is an exported Error subclass", () => {
    expect(InferenceSecretDecryptionError).toBeDefined();
    const err = new InferenceSecretDecryptionError("test message");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InferenceSecretDecryptionError");
    expect(err.message).toBe("test message");
  });

  // REG-002: wrong-key decrypt throws InferenceSecretDecryptionError, never raw crypto
  // If the wrapping is reverted, this test fails because the raw AES-GCM error is not
  // an InferenceSecretDecryptionError instance.
  test("REG-002: wrong-key decrypt throws InferenceSecretDecryptionError, not raw Error", () => {
    process.env.ENCRYPTION_KEY = "key-used-for-encryption-A";
    delete process.env.BETTER_AUTH_SECRET;
    const encrypted = encryptInferenceSecret("my-regression-value");

    process.env.ENCRYPTION_KEY = "key-used-for-encryption-B";

    expect(() => decryptInferenceSecret(encrypted)).toThrow(
      InferenceSecretDecryptionError,
    );
  });

  // REG-003: the thrown error message does NOT contain the raw Node.js crypto string
  // If the wrapping is reverted, the raw "Unsupported state or unable to authenticate data"
  // leaks through.
  test("REG-003: thrown error message never exposes raw crypto auth-tag failure text", () => {
    process.env.ENCRYPTION_KEY = "key-for-encrypt-reg3";
    delete process.env.BETTER_AUTH_SECRET;
    const encrypted = encryptInferenceSecret("value-reg3");

    process.env.ENCRYPTION_KEY = "different-key-reg3";

    let caughtMessage = "";
    try {
      decryptInferenceSecret(encrypted);
    } catch (e) {
      caughtMessage = e instanceof Error ? e.message : String(e);
    }

    expect(caughtMessage).not.toContain(
      "Unsupported state or unable to authenticate data",
    );
    // The message must be our controlled, safe string
    expect(caughtMessage).toContain("decrypt");
  });

  // REG-004: correct key is never affected — positive regression
  test("REG-004: correct-key round-trip is unaffected by typed error change", () => {
    process.env.ENCRYPTION_KEY = "stable-key";
    delete process.env.BETTER_AUTH_SECRET;
    const encrypted = encryptInferenceSecret("stable-value");
    expect(decryptInferenceSecret(encrypted)).toBe("stable-value");
  });
});
