/**
 * Store unit test: header encryption round-trip.
 */
import { describe, expect, it, mock } from "bun:test";

// Allow server-only imports in test environment
mock.module("server-only", () => ({}));

// We test the encryption indirectly through the store module.
// The key guarantee: encrypted column value !== plaintext, decrypt returns it.
describe("mcp store encryption round-trip", () => {
  it("encrypts headers so the stored value differs from plaintext", async () => {
    // Set up a test secret so encryption.ts can operate
    process.env.BETTER_AUTH_SECRET = "test-secret-for-mcp-store-tests";

    const { encryptMcpHeaders, decryptMcpHeaders } = await import("./store");

    const headers = { Authorization: "Bearer s3cret", "X-Api-Key": "key123" };
    const encrypted = encryptMcpHeaders(headers);

    // Encrypted value must not contain the secret
    expect(encrypted).not.toContain("s3cret");
    expect(encrypted).not.toContain("key123");

    // Round-trip must restore exact headers
    const decrypted = decryptMcpHeaders(encrypted);
    expect(decrypted).toEqual(headers);
  });

  it("returns null from decryptMcpHeaders when passed null", async () => {
    const { decryptMcpHeaders } = await import("./store");
    expect(decryptMcpHeaders(null)).toBeNull();
  });
});
