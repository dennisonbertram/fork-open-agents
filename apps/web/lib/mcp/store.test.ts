/**
 * Store unit tests:
 *   - header encryption round-trip
 *   - pg 23505 cause-chain detection → McpServerConflictError
 */
import { describe, expect, it, mock } from "bun:test";
import { McpServerConflictError } from "./types";

// Allow server-only imports in test environment
mock.module("server-only", () => ({}));

/**
 * Simulate the drizzle-orm 0.45 wrapped error shape.
 * The outer error has message "Failed query: insert into …"
 * and carries the real pg error on .cause with code "23505".
 */
function makeDrizzleWrappedPgError(): Error {
  const pgErr = Object.assign(
    new Error("duplicate key value violates unique constraint"),
    {
      code: "23505",
    },
  );
  return Object.assign(new Error('Failed query: insert into "mcp_servers" …'), {
    cause: pgErr,
  });
}

// ── pg 23505 cause-chain detection ────────────────────────────────────────────

// Set up mocks for db-dependent modules before importing the store
mock.module("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: async () => {
          throw makeDrizzleWrappedPgError();
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            throw makeDrizzleWrappedPgError();
          },
        }),
      }),
    }),
    query: {
      mcpServers: {
        findFirst: async () => ({ id: "srv-1", userId: "u-1" }),
      },
    },
  },
}));

mock.module("@/lib/db/schema", () => ({
  mcpServers: {},
}));

mock.module("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  desc: () => ({}),
}));

describe("mcp store — pg 23505 cause-chain detection", () => {
  it("createMcpServer throws McpServerConflictError on drizzle-wrapped 23505", async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-for-mcp-store-tests";

    const { createMcpServer } = await import("./store");

    await expect(
      createMcpServer("u-1", {
        name: "dup",
        url: "https://mcp.example.com/mcp",
        transport: "http",
      }),
    ).rejects.toBeInstanceOf(McpServerConflictError);
  });

  it("does NOT swallow unrelated db errors (non-23505)", async () => {
    // Override the mock to throw a non-unique error
    mock.module("@/lib/db/client", () => ({
      db: {
        insert: () => ({
          values: () => ({
            returning: async () => {
              throw new Error("connection reset");
            },
          }),
        }),
        query: {
          mcpServers: { findFirst: async () => null },
        },
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => {
                throw new Error("connection reset");
              },
            }),
          }),
        }),
      },
    }));

    const { createMcpServer: create2 } = await import("./store");

    await expect(
      create2("u-1", {
        name: "other",
        url: "https://mcp.example.com/mcp",
        transport: "http",
      }),
    ).rejects.toThrow("connection reset");
  });
});

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
