import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("drizzle-orm", () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
}));
mock.module("nanoid", () => ({ nanoid: () => "test-id" }));
mock.module("./schema", () => ({
  inferenceProfiles: {},
}));
mock.module("@/lib/db/client", () => ({ db: {} }));

// Control variable for whether decryption succeeds or throws
let shouldDecryptFail = false;
let decryptError: Error | null = null;

class InferenceSecretDecryptionError extends Error {
  override name = "InferenceSecretDecryptionError";
}

mock.module("@/lib/inference/encryption", () => ({
  InferenceSecretDecryptionError,
  encryptInferenceSecret: (s: string) => `encrypted:${s}`,
  decryptInferenceSecret: (payload: string) => {
    if (shouldDecryptFail) {
      throw (
        decryptError ??
        new InferenceSecretDecryptionError(
          "Stored API key could not be decrypted (encryption key mismatch for this environment).",
        )
      );
    }

    return payload.replace(/^encrypted:/, "");
  },
  fingerprintInferenceSecret: () => "fp-1234567890abcdef",
  lastFourSecretChars: (s: string) => s.slice(-4),
}));

mock.module("@/lib/inference/model-routing", () => ({
  normalizeAnthropicBaseUrl: (url: string | null | undefined) => url ?? null,
}));

const { decryptInferenceProfileApiKey } = await import("./inference-profiles");

const fakeProfile = {
  id: "profile-abc123",
  name: "My Personal Anthropic Key",
  encryptedApiKey: "encrypted:sk-ant-real-key-value",
  provider: "anthropic" as const,
};

// BT-004: when decrypt succeeds, returns the decrypted key
describe("decryptInferenceProfileApiKey", () => {
  beforeEach(() => {
    shouldDecryptFail = false;
    decryptError = null;
  });

  test("BT-004: returns decrypted key when decryption succeeds", () => {
    const result = decryptInferenceProfileApiKey(fakeProfile);
    expect(result).toBe("sk-ant-real-key-value");
  });

  // BT-005: when decrypt fails, throws InferenceProfileResolutionError with actionable message
  test("BT-005: throws InferenceProfileResolutionError (not raw crypto error) when decryption fails", () => {
    shouldDecryptFail = true;

    let caughtError: unknown;
    try {
      decryptInferenceProfileApiKey(fakeProfile);
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(Error);
    const err = caughtError as Error;
    // Must be wrapped as InferenceProfileResolutionError so chat.ts maps it
    expect(err.name).toBe("InferenceProfileResolutionError");
  });

  // BT-006: error message must be actionable and reference the profile name
  test("BT-006: InferenceProfileResolutionError message names the profile and guides the user", () => {
    shouldDecryptFail = true;

    let caughtError: unknown;
    try {
      decryptInferenceProfileApiKey(fakeProfile);
    } catch (e) {
      caughtError = e;
    }

    const err = caughtError as Error;
    // Must mention the profile name so the user knows which key to re-enter
    expect(err.message).toContain("My Personal Anthropic Key");
    // Must guide the user to re-enter it in Settings
    expect(err.message.toLowerCase()).toContain("settings");
  });

  // BT-007: error message must NOT contain the encrypted payload or any key material
  test("BT-007: error message is secret-free (no plaintext key, no encrypted payload)", () => {
    shouldDecryptFail = true;

    let caughtError: unknown;
    try {
      decryptInferenceProfileApiKey(fakeProfile);
    } catch (e) {
      caughtError = e;
    }

    const err = caughtError as Error;
    expect(err.message).not.toContain("sk-ant-real-key-value");
    expect(err.message).not.toContain("encrypted:");
  });
});
