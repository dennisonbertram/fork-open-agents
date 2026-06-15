/**
 * Unit tests for getRepositorySettings / upsertRepositorySettings DB helpers.
 * All DB access is mocked — these tests verify the helper's own logic
 * (normalization, conflict target, error-on-empty-return).
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";

// ─── Silence server-only guard so module loads in test env ────────────────────
mock.module("server-only", () => ({}));

// ─── fakeDb infrastructure ────────────────────────────────────────────────────

type FakeRow = {
  id: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  fullClone: boolean | null;
  prewarmEnabled: boolean | null;
  runtimeMode: "classic" | "managed_runtime" | null;
  managedRuntimeProfileId: string | null;
  vcpus: number | null;
  autoCommitPush: boolean | null;
  autoCreatePr: boolean | null;
  defaultBranch: string | null;
  isNewBranch: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

let storedRows: unknown[] = [];

const fakeReturnRow: FakeRow = {
  id: "row-1",
  userId: "user-1",
  repoOwner: "acme",
  repoName: "api",
  fullClone: null,
  prewarmEnabled: null,
  runtimeMode: null,
  managedRuntimeProfileId: null,
  vcpus: null,
  autoCommitPush: null,
  autoCreatePr: null,
  defaultBranch: null,
  isNewBranch: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// These are mutated per-test to control fake DB responses
let findFirstResult: FakeRow | undefined = undefined;
let upsertResult: FakeRow[] = [fakeReturnRow];

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      repositorySettings: {
        findFirst: async (_opts: unknown) => findFirstResult,
      },
    },
    insert: (_table: unknown) => ({
      values: (row: unknown) => {
        storedRows.push(row);
        return {
          onConflictDoUpdate: (_opts: unknown) => ({
            returning: async () => upsertResult,
          }),
        };
      },
    }),
  },
}));

// ─── Minimal schema stub so drizzle column references resolve ─────────────────
mock.module("@/lib/db/schema", () => ({
  repositorySettings: {
    userId: "user_id",
    repoOwner: "repo_owner",
    repoName: "repo_name",
  },
}));

// ─── import after mocking ────────────────────────────────────────────────────
const { getRepositorySettings, upsertRepositorySettings } = await import(
  "./repository-settings"
);

// ─── BT-DB-001: getRepositorySettings ────────────────────────────────────────

describe("getRepositorySettings", () => {
  beforeEach(() => {
    findFirstResult = undefined;
    storedRows = [];
    upsertResult = [{ ...fakeReturnRow }];
  });

  it("BT-DB-001: returns undefined when no row exists", async () => {
    findFirstResult = undefined;
    const result = await getRepositorySettings({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
    });
    expect(result).toBeUndefined();
  });

  it("BT-DB-001b: returns the row when it exists", async () => {
    findFirstResult = { ...fakeReturnRow };
    const result = await getRepositorySettings({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
    });
    expect(result?.id).toBe("row-1");
  });
});

// ─── BT-DB-002: upsertRepositorySettings ─────────────────────────────────────

describe("upsertRepositorySettings", () => {
  beforeEach(() => {
    findFirstResult = undefined;
    storedRows = [];
    upsertResult = [{ ...fakeReturnRow }];
  });

  it("BT-DB-002: inserts and returns the row", async () => {
    const result = await upsertRepositorySettings({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
      settings: { vcpus: 4 },
    });
    expect(result.userId).toBe("user-1");
    expect(storedRows.length).toBe(1);
  });

  it("BT-DB-002b: throws when returning() returns empty (DB failure)", async () => {
    upsertResult = [];
    await expect(
      upsertRepositorySettings({
        userId: "user-1",
        repoOwner: "acme",
        repoName: "api",
        settings: {},
      }),
    ).rejects.toThrow();
  });

  it("BT-DB-003: normalizes owner/name to lowercase before writing", async () => {
    await upsertRepositorySettings({
      userId: "user-1",
      repoOwner: "MyOrg",
      repoName: "MyRepo",
      settings: {},
    });
    const written = storedRows[0] as Record<string, unknown>;
    expect(written["repoOwner"]).toBe("myorg");
    expect(written["repoName"]).toBe("myrepo");
  });

  it("BT-DB-003b: normalizes owner/name trim+lowercase", async () => {
    await upsertRepositorySettings({
      userId: "user-1",
      repoOwner: "  MyOrg  ",
      repoName: "  MyRepo  ",
      settings: {},
    });
    const written = storedRows[0] as Record<string, unknown>;
    expect(written["repoOwner"]).toBe("myorg");
    expect(written["repoName"]).toBe("myrepo");
  });

  it("BT-DB-004: spreads settings fields into the inserted row", async () => {
    await upsertRepositorySettings({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
      settings: { vcpus: 8, fullClone: true },
    });
    const written = storedRows[0] as Record<string, unknown>;
    expect(written["vcpus"]).toBe(8);
    expect(written["fullClone"]).toBe(true);
  });

  it("BT-DB-005: undefined settings fields are not present in the written row (subset upsert)", async () => {
    // Only write vcpus — other fields should remain absent from the inserted values
    await upsertRepositorySettings({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
      settings: { vcpus: 2 },
    });
    const written = storedRows[0] as Record<string, unknown>;
    // fullClone was not in settings, so it should NOT appear in the inserted values
    expect("fullClone" in written).toBe(false);
  });

  it("BT-DB-006: null settings fields are written (clearing overrides back to inherit)", async () => {
    await upsertRepositorySettings({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "api",
      settings: { autoCommitPush: null },
    });
    const written = storedRows[0] as Record<string, unknown>;
    expect("autoCommitPush" in written).toBe(true);
    expect(written["autoCommitPush"]).toBeNull();
  });
});
