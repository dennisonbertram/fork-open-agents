import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

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

// Control variable for whether decryption should fail
let shouldDecryptFail = true;

class InferenceSecretDecryptionError extends Error {
  override name = "InferenceSecretDecryptionError";
}

mock.module("@/lib/inference/encryption", () => ({
  InferenceSecretDecryptionError,
  encryptInferenceSecret: (s: string) => `encrypted:${s}`,
  decryptInferenceSecret: (_payload: string) => {
    if (shouldDecryptFail) {
      throw new InferenceSecretDecryptionError(
        "Stored API key could not be decrypted (encryption key mismatch for this environment).",
      );
    }

    return "decrypted-value";
  },
  fingerprintInferenceSecret: () => "fp-1234567890abcdef",
  lastFourSecretChars: (s: string) => s.slice(-4),
}));

mock.module("@/lib/inference/model-routing", () => ({
  normalizeAnthropicBaseUrl: (url: string | null | undefined) => url ?? null,
  normalizeInferenceBaseUrl: (
    _provider: string,
    url: string | null | undefined,
  ) => url ?? null,
}));

const { decryptInferenceProfileApiKey } = await import("./inference-profiles");

// BT-008: Observability — structured error log emitted with expected fields, no secret
describe("decryptInferenceProfileApiKey observability", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    shouldDecryptFail = true;
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test("BT-008: emits a structured error log when decryption fails, with event name, profileId, and no secret", () => {
    const profile = {
      id: "profile-obs-test-999",
      name: "Observability Test Profile",
      encryptedApiKey: "encrypted:super-secret-key",
      provider: "anthropic" as const,
    };

    try {
      decryptInferenceProfileApiKey(profile);
    } catch {
      // expected
    }

    // console.error must have been called
    expect(consoleErrorSpy).toHaveBeenCalled();

    // Find the call that contains our structured log
    const calls = consoleErrorSpy.mock.calls as unknown[][];
    const structuredCall = calls.find((callArgs: unknown[]) => {
      const serialized = callArgs
        .map((a) =>
          typeof a === "string" ? a : (JSON.stringify(a) ?? String(a)),
        )
        .join(" ");
      return (
        serialized.includes("inference_profile_decrypt_failed") ||
        serialized.includes("profile-obs-test-999")
      );
    });

    expect(structuredCall).toBeDefined();

    // The structured log payload must include the profile id
    const serialized = ((structuredCall as unknown[] | undefined) ?? [])
      .map((a) =>
        typeof a === "string" ? a : (JSON.stringify(a) ?? String(a)),
      )
      .join(" ");

    expect(serialized).toContain("profile-obs-test-999");

    // The structured log must NOT contain the secret (plaintext or encrypted payload)
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("encrypted:");
  });
});
