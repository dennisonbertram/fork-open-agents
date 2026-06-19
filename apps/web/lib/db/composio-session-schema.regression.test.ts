/**
 * Regression tests for the composio_agent_sessions FK removal fix.
 *
 * CONTEXT: The "direct toolkit selection" path calls
 * upsertComposioAgentSession({ ..., profileId: "direct", ... }) — a sentinel
 * string — but composio_agent_sessions.profileId originally had a FK
 * referencing composio_tool_profiles.id.  There is no row with id="direct",
 * so every direct-selection user hit a FK violation FatalError.
 *
 * FIX: Drop the FK constraint on profileId; keep the column NOT NULL.
 *   "direct" is a legitimate lookup-key value, not a relational reference.
 *
 * THESE TESTS MUST STAY RED UNTIL THE SCHEMA CHANGE IS APPLIED.
 */

import { describe, expect, test } from "bun:test";

// REG-COMPOSIO-001 (approach b): schema-level FK absence assertion.
//
// Before the fix: getTableConfig(composioAgentSessions).foreignKeys contains
//   a FK whose name is
//   "composio_agent_sessions_profile_id_composio_tool_profiles_id_fk"
//   → this test is RED.
//
// After the fix:  that FK is gone → the test is GREEN.
//
// The userId and chatId FKs must still be present (those protect referential
// integrity and are NOT touched by the fix).

describe("composioAgentSessions schema — direct-selection FK regression", () => {
  test("REG-COMPOSIO-001: profileId column must NOT have a FK constraint (direct sentinel must be valid)", async () => {
    const { composioAgentSessions } = await import("@/lib/db/schema");
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const config = getTableConfig(composioAgentSessions);

    // Collect all FK names on this table
    const fkNames = config.foreignKeys.map((fk) => fk.getName());

    // The offending FK must NOT exist after the fix
    expect(fkNames).not.toContain(
      "composio_agent_sessions_profile_id_composio_tool_profiles_id_fk",
    );
  });

  test("REG-COMPOSIO-002: userId FK (users) must still exist after the fix", async () => {
    const { composioAgentSessions } = await import("@/lib/db/schema");
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const config = getTableConfig(composioAgentSessions);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());

    // userId → users.id cascade must be preserved
    expect(fkNames).toContain("composio_agent_sessions_user_id_users_id_fk");
  });

  test("REG-COMPOSIO-003: chatId FK (chats) must still exist after the fix", async () => {
    const { composioAgentSessions } = await import("@/lib/db/schema");
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const config = getTableConfig(composioAgentSessions);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());

    // chatId → chats.id cascade must be preserved
    expect(fkNames).toContain("composio_agent_sessions_chat_id_chats_id_fk");
  });
});

// REG-COMPOSIO-004 (approach a): upsertComposioAgentSession passes profileId
// through to the insert values unchanged — including the "direct" sentinel.
//
// This test is a DB-mock unit test verifying the function passes the
// profileId field through correctly.  It stays GREEN before and after the
// schema change (it documents the contract; the FK removal is what makes
// it work in real Postgres).

describe("upsertComposioAgentSession — profileId pass-through contract", () => {
  test("REG-COMPOSIO-004: upsertComposioAgentSession inserts profileId='direct' unchanged", async () => {
    // This module uses server-only; mock it.
    const { mock } = await import("bun:test");
    mock.module("server-only", () => ({}));

    let capturedValues: Record<string, unknown> | null = null;

    mock.module("@/lib/db/client", () => ({
      db: {
        insert: () => ({
          values: (vals: Record<string, unknown>) => {
            capturedValues = vals;
            return {
              onConflictDoUpdate: () => ({
                returning: () =>
                  Promise.resolve([
                    {
                      id: "row-1",
                      userId: "user-1",
                      chatId: "chat-1",
                      agentKey: "main",
                      profileId: "direct",
                      configHash: "abc",
                      composioSessionId: "csess-1",
                      createdAt: new Date(),
                      lastUsedAt: new Date(),
                    },
                  ]),
              }),
            };
          },
        }),
      },
    }));

    mock.module("nanoid", () => ({ nanoid: () => "test-id" }));

    const { upsertComposioAgentSession } = await import("@/lib/db/composio");

    await upsertComposioAgentSession({
      userId: "user-1",
      chatId: "chat-1",
      agentKey: "main",
      profileId: "direct",
      configHash: "abc",
      composioSessionId: "csess-1",
    });

    expect(capturedValues).not.toBeNull();
    const captured = capturedValues as unknown as Record<string, unknown>;
    expect(captured["profileId"]).toBe("direct");
  });
});
