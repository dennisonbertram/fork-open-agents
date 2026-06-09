/**
 * Tests for Phase 3 CRUD functions: getUserDefaultAgent, upsertUserDefaultAgent,
 * deleteUserDefaultAgent.
 *
 * All tests are pure unit tests — DB access is mocked.
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";

// ── Mock server-only so the module can be imported in test env ───────────────
mock.module("server-only", () => ({}));

// ── Shared state for fake DB ─────────────────────────────────────────────────
let fakeSelectRows: unknown[] = [];
let lastInsertValues: unknown = null;
let lastDeleteWhere: unknown = null;
let lastConflictUpdate: unknown = null;

// ── Mock DB client ────────────────────────────────────────────────────────────
mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => fakeSelectRows,
        }),
      }),
    }),
    insert: () => ({
      values: (vals: unknown) => {
        lastInsertValues = vals;
        return {
          onConflictDoUpdate: (opts: unknown) => {
            lastConflictUpdate = opts;
            return Promise.resolve();
          },
        };
      },
    }),
    delete: () => ({
      where: (where: unknown) => {
        lastDeleteWhere = where;
        return Promise.resolve();
      },
    }),
  },
}));

// ── Minimal schema mock ────────────────────────────────────────────────────────
mock.module("@/lib/db/schema", () => ({
  agents: {
    userId: "userId_col",
    role: "role_col",
    scope: "scope_col",
    id: "id_col",
    name: "name_col",
    modelId: "model_id_col",
    composioToolkitSlugs: "composio_toolkit_slugs_col",
    instructions: "instructions_col",
    managedRuntimeProfileId: "managed_runtime_profile_id_col",
    composioProfileId: "composio_profile_id_col",
    updatedAt: "updated_at_col",
  },
}));

// ── Mock nanoid ────────────────────────────────────────────────────────────────
mock.module("nanoid", () => ({ nanoid: () => "test-id-123" }));

// ── Import after mocking ──────────────────────────────────────────────────────
const { getUserDefaultAgent, upsertUserDefaultAgent, deleteUserDefaultAgent } =
  await import("@/lib/db/agents");

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  fakeSelectRows = [];
  lastInsertValues = null;
  lastDeleteWhere = null;
  lastConflictUpdate = null;
});

// BT-A-001: getUserDefaultAgent is exported and callable
describe("getUserDefaultAgent", () => {
  it("BT-A-001: is exported and returns a Promise", () => {
    expect(typeof getUserDefaultAgent).toBe("function");
    const result = getUserDefaultAgent("u1", "main");
    expect(result).toBeInstanceOf(Promise);
  });

  it("BT-A-001b: returns undefined when no row found", async () => {
    fakeSelectRows = [];
    const result = await getUserDefaultAgent("u1", "main");
    expect(result).toBeUndefined();
  });

  it("BT-A-001c: returns the row when found", async () => {
    const fakeRow = { id: "agent-1", userId: "u1", role: "main", scope: "user_default" };
    fakeSelectRows = [fakeRow];
    const result = await getUserDefaultAgent("u1", "main");
    expect(result).toEqual(fakeRow);
  });

  it("BT-A-001d: accepts all four roles", () => {
    for (const role of ["main", "explorer", "executor", "design"] as const) {
      const result = getUserDefaultAgent("u1", role);
      expect(result).toBeInstanceOf(Promise);
    }
  });
});

// BT-A-002: upsertUserDefaultAgent
describe("upsertUserDefaultAgent", () => {
  it("BT-A-002: is exported and returns a Promise", () => {
    expect(typeof upsertUserDefaultAgent).toBe("function");
    const result = upsertUserDefaultAgent("u1", "main", {});
    expect(result).toBeInstanceOf(Promise);
  });

  it("BT-A-002b: accepts patch with modelId", async () => {
    await upsertUserDefaultAgent("u1", "main", {
      modelId: "anthropic/claude-opus-4",
    });
    // Should have called the insert path (lastInsertValues is set)
    expect(lastInsertValues).not.toBeNull();
  });

  it("BT-A-002c: accepts patch with composioToolkitSlugs", async () => {
    await upsertUserDefaultAgent("u1", "main", {
      composioToolkitSlugs: ["github", "linear"],
    });
    expect(lastInsertValues).not.toBeNull();
  });

  it("BT-A-002d: accepts empty patch", async () => {
    await upsertUserDefaultAgent("u1", "main", {});
    expect(lastInsertValues).not.toBeNull();
  });

  it("BT-A-002e: accepts null modelId (reset to inherit)", async () => {
    await upsertUserDefaultAgent("u1", "explorer", { modelId: null });
    expect(lastInsertValues).not.toBeNull();
  });

  it("BT-A-002f: always sets scope=user_default in the row", async () => {
    await upsertUserDefaultAgent("u1", "main", { modelId: "m" });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.scope).toBe("user_default");
  });

  it("BT-A-002g: sets correct role in the row", async () => {
    await upsertUserDefaultAgent("u1", "executor", { modelId: "m" });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.role).toBe("executor");
  });
});

// BT-A-003: deleteUserDefaultAgent
describe("deleteUserDefaultAgent", () => {
  it("BT-A-003: is exported and returns a Promise", () => {
    expect(typeof deleteUserDefaultAgent).toBe("function");
    const result = deleteUserDefaultAgent("u1", "main");
    expect(result).toBeInstanceOf(Promise);
  });

  it("BT-A-003b: resolves without error for all roles", async () => {
    for (const role of ["main", "explorer", "executor", "design"] as const) {
      await expect(deleteUserDefaultAgent("u1", role)).resolves.toBeUndefined();
    }
  });
});
