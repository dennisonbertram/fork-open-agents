/**
 * Tests for prepareManagedRuntimeDemo (#816 / MR-9).
 *
 * BT-001: the demo seeds runtimeMode: "managed_runtime" (not "classic") on
 * both insert and onConflictDoUpdate, with the default built-in profile id.
 * BT-002: an explicit `profileId` param seeds that profile id instead of the
 * default (supports a user_default profile per the ticket).
 * BT-003: an explicit `runtimeMode: "classic"` param preserves the legacy
 * classic-seeding behavior for any caller that still needs it.
 *
 * All DB and sandbox access is mocked — these tests assert the values passed
 * into the mocked db insert/update calls, matching the pattern used in
 * apps/web/app/workflows/chat-sandbox-runtime.test.ts and
 * apps/web/lib/db/repository-settings.test.ts.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

// ─── Silence server-only guard so module loads in test env ────────────────
mock.module("server-only", () => ({}));

// ─── fake db capturing insert/update payloads ──────────────────────────────

const USERS_TABLE = { __table: "users" };
const SESSIONS_TABLE = {
  __table: "sessions",
  id: "sessions.id",
  lifecycleVersion: "sessions.lifecycle_version",
};
const CHATS_TABLE = { __table: "chats" };

function tableNameFor(table: unknown): string {
  if (table === USERS_TABLE) {
    return "users";
  }
  if (table === SESSIONS_TABLE) {
    return "sessions";
  }
  if (table === CHATS_TABLE) {
    return "chats";
  }
  return "unknown";
}

type InsertCall = { table: string; values: Record<string, unknown> };
type UpdateCall = { table: string; set: Record<string, unknown> };

let insertCalls: InsertCall[] = [];
let updateCalls: UpdateCall[] = [];
let sessionSelectResult: { lifecycleVersion: number } | undefined;

function makeInsert(table: unknown) {
  const tableName = tableNameFor(table);
  return {
    values: (values: Record<string, unknown>) => {
      insertCalls.push({ table: tableName, values });
      return {
        onConflictDoUpdate: (opts: { set: Record<string, unknown> }) => {
          updateCalls.push({ table: tableName, set: opts.set });
          return Promise.resolve(undefined);
        },
      };
    },
  };
}

mock.module("@/lib/db/client", () => ({
  db: {
    insert: (table: unknown) => makeInsert(table),
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: number) =>
            Promise.resolve(
              sessionSelectResult ? [sessionSelectResult] : [],
            ),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updateCalls.push({ table: tableNameFor(table), set });
        return {
          where: (_cond: unknown) => Promise.resolve(undefined),
        };
      },
    }),
  },
}));

mock.module("@/lib/db/schema", () => ({
  users: USERS_TABLE,
  sessions: SESSIONS_TABLE,
  chats: CHATS_TABLE,
}));

mock.module("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ __eq: true }),
}));

// ─── fake sandbox connection ────────────────────────────────────────────────

const writtenFiles: Array<{ path: string; contents: string }> = [];

const fakeSandbox = {
  workingDirectory: "/repo",
  mkdir: async (_dirPath: string, _opts?: unknown) => undefined,
  writeFile: async (filePath: string, contents: string, _encoding: string) => {
    writtenFiles.push({ path: filePath, contents });
  },
  getState: () => ({
    type: "vercel" as const,
    sandboxName: "demo-sandbox",
    expiresAt: Date.now() + 60_000,
  }),
};

const connectSandboxSpy = mock(async (_opts: unknown) => fakeSandbox);

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: connectSandboxSpy,
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  getNextLifecycleVersion: (current: number | null | undefined) =>
    (current ?? 0) + 1,
  buildActiveLifecycleUpdate: (_state: unknown) => ({
    lifecycleState: "active",
    lifecycleError: null,
  }),
}));

mock.module("@/lib/sandbox/config", () => ({
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID: "snapshot-id",
  DEFAULT_SANDBOX_PORTS: [3000],
  DEFAULT_SANDBOX_TIMEOUT_MS: 60_000,
  DEFAULT_SANDBOX_VCPUS: 1,
}));

mock.module("@/lib/sandbox/utils", () => ({
  getSessionSandboxName: (sessionId: string) => `sandbox-${sessionId}`,
}));

mock.module("@/lib/session/test-auth", () => ({
  TEST_AUTH_USER_ID: "dev-managed-runtime-user",
}));

const { prepareManagedRuntimeDemo } = await import("./managed-runtime-demo");

describe("prepareManagedRuntimeDemo (#816)", () => {
  beforeEach(() => {
    insertCalls = [];
    updateCalls = [];
    sessionSelectResult = { lifecycleVersion: 3 };
    connectSandboxSpy.mockClear();
    writtenFiles.length = 0;
  });

  it("BT-001: seeds runtimeMode managed_runtime with the built-in default profile id", async () => {
    await prepareManagedRuntimeDemo();

    const sessionInsert = insertCalls.find(
      (call) => call.table === "sessions",
    );
    const sessionUpdate = updateCalls.find(
      (call) => call.table === "sessions",
    );

    expect(sessionInsert?.values.runtimeMode).toBe("managed_runtime");
    expect(sessionInsert?.values.managedRuntimeProfileId).toBe(
      "web-bun-agent-browser",
    );
    expect(sessionUpdate?.set.runtimeMode).toBe("managed_runtime");
    expect(sessionUpdate?.set.managedRuntimeProfileId).toBe(
      "web-bun-agent-browser",
    );
  });

  it("BT-002: an explicit profileId param seeds that profile id instead of the default", async () => {
    await prepareManagedRuntimeDemo({ profileId: "user-default-profile" });

    const sessionInsert = insertCalls.find(
      (call) => call.table === "sessions",
    );
    const sessionUpdate = updateCalls.find(
      (call) => call.table === "sessions",
    );

    expect(sessionInsert?.values.runtimeMode).toBe("managed_runtime");
    expect(sessionInsert?.values.managedRuntimeProfileId).toBe(
      "user-default-profile",
    );
    expect(sessionUpdate?.set.managedRuntimeProfileId).toBe(
      "user-default-profile",
    );
  });

  it("BT-003: an explicit runtimeMode 'classic' param preserves legacy classic seeding", async () => {
    await prepareManagedRuntimeDemo({ runtimeMode: "classic" });

    const sessionInsert = insertCalls.find(
      (call) => call.table === "sessions",
    );
    const sessionUpdate = updateCalls.find(
      (call) => call.table === "sessions",
    );

    expect(sessionInsert?.values.runtimeMode).toBe("classic");
    expect(sessionUpdate?.set.runtimeMode).toBe("classic");
  });
});
