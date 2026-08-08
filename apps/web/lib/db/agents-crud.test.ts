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
let lastOnConflictOpts: unknown = null;

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
            lastOnConflictOpts = opts;
            return Promise.resolve();
          },
        };
      },
    }),
    delete: () => ({
      where: (_where: unknown) => Promise.resolve(),
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
    inferenceProfileId: "inference_profile_id_col",
    composioToolkitSlugs: "composio_toolkit_slugs_col",
    instructions: "instructions_col",
    managedRuntimeProfileId: "managed_runtime_profile_id_col",
    composioProfileId: "composio_profile_id_col",
    githubToolsEnabled: "github_tools_enabled_col",
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
  lastOnConflictOpts = null;
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
    const fakeRow = {
      id: "agent-1",
      userId: "u1",
      role: "main",
      scope: "user_default",
    };
    fakeSelectRows = [fakeRow];
    const result = await getUserDefaultAgent("u1", "main");
    // Verify the key fields are present (the mock returns what we put in)
    expect(result?.id).toBe("agent-1");
    expect(result?.userId).toBe("u1");
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

// BT-A-004: githubToolsEnabled threading
describe("upsertUserDefaultAgent — githubToolsEnabled field (BT-A-004)", () => {
  it("BT-A-004a: patch { githubToolsEnabled: true } inserts a row with githubToolsEnabled===true", async () => {
    await upsertUserDefaultAgent("u1", "main", { githubToolsEnabled: true });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.githubToolsEnabled).toBe(true);
  });

  it("BT-A-004b: patch { githubToolsEnabled: false } inserts a row with githubToolsEnabled===false", async () => {
    await upsertUserDefaultAgent("u1", "main", { githubToolsEnabled: false });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.githubToolsEnabled).toBe(false);
  });

  it("BT-A-004c: empty patch defaults githubToolsEnabled to false in the inserted row", async () => {
    await upsertUserDefaultAgent("u1", "main", {});
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.githubToolsEnabled).toBe(false);
  });

  it("BT-A-004d: onConflictDoUpdate.set includes githubToolsEnabled", async () => {
    await upsertUserDefaultAgent("u1", "main", { githubToolsEnabled: true });
    const opts = lastOnConflictOpts as {
      set?: Record<string, unknown>;
    } | null;
    expect(opts).not.toBeNull();
    expect(opts?.set).toHaveProperty("githubToolsEnabled");
    expect(opts?.set?.githubToolsEnabled).toBe(true);
  });

  it("BT-A-004f: targets the user_default partial unique index", async () => {
    await upsertUserDefaultAgent("u1", "main", {});
    const opts = lastOnConflictOpts as {
      target?: unknown[];
      targetWhere?: unknown;
    } | null;
    expect(opts).not.toBeNull();
    expect(opts?.target).toEqual(["userId_col", "role_col"]);
    expect(opts?.targetWhere).toBeDefined();
  });

  // BT-A-004e: documents the full-row-replace contract. upsertUserDefaultAgent
  // is NOT a partial patch — a save that omits githubToolsEnabled resets the
  // column to false (both the insert row and the onConflict set use
  // `patch.githubToolsEnabled ?? false`). The Main editor's handleSave always
  // includes the field, so this is safe in the shipped UI; this test locks in
  // the contract so a future refactor to partial-patch is a conscious choice,
  // not a silent regression that would clobber an enabled gate.
  it("BT-A-004e: a save omitting githubToolsEnabled resets it to false (full-row-replace contract)", async () => {
    // First: enable the gate.
    await upsertUserDefaultAgent("u1", "main", { githubToolsEnabled: true });
    expect(
      (lastInsertValues as Record<string, unknown>).githubToolsEnabled,
    ).toBe(true);

    // Then: an unrelated save that omits githubToolsEnabled. Under the
    // full-row-replace upsert, both the insert row and the conflict set fall
    // back to false — so the gate would be reset if the UI ever omitted it.
    await upsertUserDefaultAgent("u1", "main", { modelId: "anthropic/x" });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.githubToolsEnabled).toBe(false);
    const opts = lastOnConflictOpts as { set?: Record<string, unknown> } | null;
    expect(opts?.set?.githubToolsEnabled).toBe(false);
  });
});

// BT-A-005 (#1157): inferenceProfileId threading. agents.inference_profile_id
// already has an FK (schema.ts) but upsertUserDefaultAgent never wrote it —
// the Settings -> Agents write path silently dropped a profile-bound roster
// override's profile id.
describe("upsertUserDefaultAgent — inferenceProfileId field (BT-A-005)", () => {
  it("BT-A-005a: patch { inferenceProfileId: 'profile-1' } inserts a row carrying it", async () => {
    await upsertUserDefaultAgent("u1", "executor", {
      modelId: "anthropic/claude-opus-4",
      inferenceProfileId: "profile-1",
    });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.inferenceProfileId).toBe("profile-1");
  });

  it("BT-A-005b: an omitted inferenceProfileId defaults to null in the inserted row", async () => {
    await upsertUserDefaultAgent("u1", "executor", {
      modelId: "openai/gpt-4o",
    });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.inferenceProfileId).toBeNull();
  });

  it("BT-A-005c: onConflictDoUpdate.set includes inferenceProfileId", async () => {
    await upsertUserDefaultAgent("u1", "executor", {
      inferenceProfileId: "profile-2",
    });
    const opts = lastOnConflictOpts as {
      set?: Record<string, unknown>;
    } | null;
    expect(opts?.set).toHaveProperty("inferenceProfileId");
    expect(opts?.set?.inferenceProfileId).toBe("profile-2");
  });

  it("BT-A-005d: a save omitting inferenceProfileId resets it to null (full-row-replace contract, mirrors BT-A-004e)", async () => {
    await upsertUserDefaultAgent("u1", "executor", {
      inferenceProfileId: "profile-3",
    });
    expect(
      (lastInsertValues as Record<string, unknown>).inferenceProfileId,
    ).toBe("profile-3");

    await upsertUserDefaultAgent("u1", "executor", {
      modelId: "anthropic/claude-haiku-4.5",
    });
    const inserted = lastInsertValues as Record<string, unknown>;
    expect(inserted.inferenceProfileId).toBeNull();
    const opts = lastOnConflictOpts as { set?: Record<string, unknown> } | null;
    expect(opts?.set?.inferenceProfileId).toBeNull();
  });
});
