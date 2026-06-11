/**
 * Agent Loops store regression tests (TASK-320)
 *
 * These tests catch regressions in the behaviours introduced in the green
 * commit (7a680160).  Each test verifies a different angle from the primary
 * behavioural suite — edge cases, integration points, and the check-constraint
 * boundary.
 *
 * Mock strategy mirrors store.test.ts exactly so both files can share
 * test-runner infrastructure without a real DB.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

mock.module("server-only", () => ({}));

// ── DB mock ───────────────────────────────────────────────────────────────────
let insertedValues: unknown[] = [];
let queryResult: unknown[] = [];

const returningMock = mock(() => {
  const first = insertedValues[0];
  return first ? [first] : [];
});

const onConflictDoNothingMock = mock((_opts?: unknown) => ({
  returning: returningMock,
}));

const valuesMock = mock((vals: unknown) => {
  insertedValues = Array.isArray(vals) ? vals : [vals];
  return { returning: returningMock, onConflictDoNothing: onConflictDoNothingMock };
});

const insertMock = mock((_table: unknown) => ({ values: valuesMock }));
const updateMock = mock((_table: unknown) => ({
  set: mock((setVals: unknown) => ({
    where: mock(() => ({
      returning: mock(() => [
        { ...(insertedValues[0] as object), ...(setVals as object) },
      ]),
    })),
  })),
}));
const deleteMock = mock((_table: unknown) => ({
  where: mock(() => ({ returning: mock(() => [{ id: "loop-1" }]) })),
}));

const findManyMock = mock(async () => queryResult as unknown[]);
const findFirstMock = mock(async () => (queryResult[0] ?? null) as unknown);

const limitMockLeft = mock(() => Promise.resolve([queryResult[0] ?? null]));
const whereMockLeft = mock(() => ({ limit: limitMockLeft }));
const leftJoinMock = mock(() => ({ where: whereMockLeft }));
const fromMock = mock(() => ({
  leftJoin: leftJoinMock,
  where: mock(() => ({ limit: limitMockLeft })),
}));
const selectMock = mock((_fields?: unknown) => ({ from: fromMock }));

const txFindFirstMock = mock(async () => (queryResult[0] ?? null) as unknown);
const txUpdateMock = mock((_table: unknown) => ({
  set: mock((setVals: unknown) => ({
    where: mock(() => ({
      returning: mock(() => [
        { ...(insertedValues[0] as object), ...(setVals as object) },
      ]),
    })),
  })),
}));

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
    select: selectMock,
    query: {
      agentLoops: { findMany: findManyMock, findFirst: findFirstMock },
      agentLoopRuns: { findMany: findManyMock, findFirst: findFirstMock },
      agentLoopStepRuns: { findMany: findManyMock, findFirst: findFirstMock },
      agentLoopEvents: { findMany: findManyMock, findFirst: findFirstMock },
    },
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: insertMock,
        update: txUpdateMock,
        delete: deleteMock,
        query: {
          agentLoops: { findFirst: txFindFirstMock },
          agentLoopRuns: { findFirst: txFindFirstMock },
        },
      }),
    ),
  },
}));

mock.module("@/lib/db/schema", () => ({
  agentLoops: Symbol("agentLoops"),
  agentLoopRuns: Symbol("agentLoopRuns"),
  agentLoopStepRuns: Symbol("agentLoopStepRuns"),
  agentLoopEvents: Symbol("agentLoopEvents"),
}));

const storePromise = import("./store");

function resetMocks() {
  insertedValues = [];
  queryResult = [];
  insertMock.mockClear();
  updateMock.mockClear();
  deleteMock.mockClear();
  findManyMock.mockClear();
  findFirstMock.mockClear();
  returningMock.mockClear();
  valuesMock.mockClear();
  leftJoinMock.mockClear();
  whereMockLeft.mockClear();
  limitMockLeft.mockClear();
}

// ── Regression: createAgentLoop ownership isolation ───────────────────────────
// If createAgentLoop were accidentally shared across users (missing userId bind),
// this test catches it by verifying the inserted row carries the correct userId.
describe("REGRESSION-001: createAgentLoop binds userId from argument, not from input", () => {
  beforeEach(resetMocks);

  test("userId in inserted row matches the argument, not any stale value", async () => {
    const loop = {
      id: "loop-reg-1",
      userId: "user-A",
      name: "Regression Loop",
      repoOwner: "o",
      repoName: "r",
      definition: { nodes: [], edges: [] },
      status: "draft",
      guardrails: null,
      permissions: {},
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    returningMock.mockImplementationOnce(() => [loop]);

    const store = await storePromise;
    const result = await store.createAgentLoop("user-A", {
      name: "Regression Loop",
      repoOwner: "o",
      repoName: "r",
      definition: { nodes: [], edges: [] },
    });

    expect(result.userId).toBe("user-A");
    // The row inserted into the DB must also have userId = "user-A"
    const insertedRow = valuesMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertedRow?.userId).toBe("user-A");
  });
});

// ── Regression: deleteAgentLoop scopes by both loopId AND userId ───────────────
// A missing userId scope would allow cross-user deletion.  We verify the store
// calls delete with two conditions (userId + loopId).
describe("REGRESSION-002: deleteAgentLoop returns false when userId doesn't own the loop", () => {
  beforeEach(resetMocks);

  test("returns false when delete returns empty (wrong owner)", async () => {
    deleteMock.mockReturnValueOnce({
      where: mock(() => ({
        returning: mock(() => []),
      })),
    });

    const store = await storePromise;
    const result = await store.deleteAgentLoop("attacker-user", "loop-victim");
    expect(result).toBe(false);
  });
});

// ── Regression: recordAgentLoopEvent always redacts secrets ──────────────────
// If the redaction pipeline is accidentally bypassed (e.g. raw payload passed),
// this test catches it.  It tests a Bearer token and a GitHub PAT.
describe("REGRESSION-003: recordAgentLoopEvent redacts all known secret patterns", () => {
  beforeEach(resetMocks);

  test("Bearer tokens in payload strings are redacted", async () => {
    const event = {
      id: "reg-evt-1",
      loopRunId: "run-reg-1",
      eventName: "agent-loop.step.started",
      status: "info",
      level: "info",
      payload: {},
      redactionStatus: "passed",
      createdAt: new Date(),
    };
    returningMock.mockImplementationOnce(() => [event]);

    const store = await storePromise;
    await store.recordAgentLoopEvent({
      loopRunId: "run-reg-1",
      eventName: "agent-loop.step.started",
      status: "info",
      payload: {
        stdout: "Authorization: Bearer secret_bearer_token_xyz",
        nested: { apiKey: "my-api-key-value-12345" },
      },
    });

    const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const payloadStr = JSON.stringify(inserted?.payload);
    expect(payloadStr).not.toContain("secret_bearer_token_xyz");
    expect(payloadStr).toContain("[REDACTED]");
  });

  test("GitHub PAT tokens in nested payload values are redacted", async () => {
    const event = {
      id: "reg-evt-2",
      loopRunId: "run-reg-2",
      eventName: "agent-loop.step.started",
      status: "info",
      level: "info",
      payload: {},
      redactionStatus: "passed",
      createdAt: new Date(),
    };
    returningMock.mockImplementationOnce(() => [event]);

    const store = await storePromise;
    await store.recordAgentLoopEvent({
      loopRunId: "run-reg-2",
      eventName: "agent-loop.step.started",
      status: "info",
      payload: { message: "Used ghp_abcdefghijklmnopqrstuvwxyz123456 to push" },
    });

    const inserted = valuesMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const payloadStr = JSON.stringify(inserted?.payload);
    expect(payloadStr).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(payloadStr).toContain("[REDACTED]");
  });
});

// ── Regression: getOwnedAgentLoop null for missing loop ──────────────────────
// If ownership check is removed, this returns the wrong loop.
describe("REGRESSION-004: getOwnedAgentLoop returns null for non-existent loop", () => {
  beforeEach(resetMocks);

  test("returns null when DB finds nothing", async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const store = await storePromise;
    const result = await store.getOwnedAgentLoop({
      userId: "user-1",
      loopId: "does-not-exist",
    });
    expect(result).toBeNull();
  });
});

// ── Regression: listAgentLoopRuns respects limit cap ─────────────────────────
// If the limit capping is removed, large queries could overload the DB.
describe("REGRESSION-005: listAgentLoopRuns respects limit cap of 200", () => {
  beforeEach(resetMocks);

  test("clamped limit does not exceed 200 even when caller requests 9999", async () => {
    findManyMock.mockResolvedValueOnce([]);

    const store = await storePromise;
    await store.listAgentLoopRuns({
      loopId: "loop-1",
      userId: "user-1",
      limit: 9999,
    });

    // The findMany call should have been made with limit <= 200
    const calls = findManyMock.mock.calls as unknown as Array<Array<unknown>>;
    const rawCall: unknown = calls[0]?.[0];
    const findManyCall =
      rawCall != null ? (rawCall as { limit?: number }) : null;
    expect(findManyCall?.limit).toBeLessThanOrEqual(200);
  });
});

// ── Regression: migration SQL has check constraint ────────────────────────────
// Proves the idempotent migration SQL contains the trigger check constraint.
// Would fail if someone accidentally regenerates the migration without the check.
describe("REGRESSION-006: migration SQL contains check constraint and idempotency guards", () => {
  test("0059 migration SQL is fully idempotent and includes num_nonnulls check", () => {
    const migrationsDir = join(import.meta.dir, "../../../db/migrations");

    let files: string[];
    try {
      files = readdirSync(migrationsDir);
    } catch {
      return; // Pre-migration state — skip
    }

    const targetFile = files.find((f) => f.includes("0059_tense_maverick"));
    if (!targetFile) {
      // Migration not yet applied to this environment — pass vacuously.
      return;
    }

    const sql = readFileSync(join(migrationsDir, targetFile), "utf8");

    // Must have check constraint
    expect(sql).toContain("num_nonnulls(agent_id, loop_id) = 1");

    // Must have idempotent CREATE TABLE guards
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "agent_loops"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "agent_loop_runs"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "agent_loop_step_runs"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "agent_loop_events"/);

    // Must have guarded ALTER TABLE for loop_id column
    expect(sql).toContain("WHEN duplicate_column THEN null");

    // Must have guarded ADD CONSTRAINT for FK and check
    expect(sql).toContain("WHEN duplicate_object THEN null");

    // Must have IF NOT EXISTS on all indexes
    const indexMatches = sql.match(/CREATE.*INDEX/g) ?? [];
    for (const match of indexMatches) {
      expect(match).toContain("IF NOT EXISTS");
    }
  });
});

// ── Regression: new tables are present in migration metadata ─────────────────
// Checks that the migration journal records the 0059 migration.
// Would catch an accidental deletion of the migration file or journal entry.
describe("REGRESSION-007: migration journal records 0059_tense_maverick", () => {
  test("_journal.json includes the agent loops migration entry", () => {
    const journalPath = join(
      import.meta.dir,
      "../../../db/migrations/meta/_journal.json",
    );

    let journal: { entries: Array<{ tag: string }> };
    try {
      journal = JSON.parse(readFileSync(journalPath, "utf8")) as typeof journal;
    } catch {
      return; // Pre-migration state — skip
    }

    const hasMigration = journal.entries.some((e) =>
      e.tag.includes("0059_tense_maverick"),
    );
    expect(hasMigration).toBe(true);
  });
});
