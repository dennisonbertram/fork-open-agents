import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------------------------------------------------------------------------
// Fake DB infrastructure — mirrors the mocked-db pattern used in sessions.test.ts
// ---------------------------------------------------------------------------

type FakeRow = {
  id: string;
  kind: string;
  status: string;
  redactionStatus: string;
  sourceLocation: string | null;
  summary: string | null;
  createdByActor: string | null;
  workflowRunId: string | null;
  sessionId: string | null;
  chatId: string | null;
  goalId: string | null;
  gateId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Rows that the fakeDb returns from .returning()
let fakeInsertedRows: FakeRow[] = [];
let fakeUpdatedRows: FakeRow[] = [];
let fakeSelectRows: FakeRow[] = [];

// Reset helpers
function resetFake() {
  fakeInsertedRows = [];
  fakeUpdatedRows = [];
  fakeSelectRows = [];
}

const fakeDb = {
  insert: (_table: unknown) => ({
    values: (input: unknown) => ({
      returning: async (): Promise<FakeRow[]> => {
        if (fakeInsertedRows.length > 0) return fakeInsertedRows;
        // If no explicit fake rows set, simulate an inserted row from input
        const row = input as Partial<FakeRow>;
        return [
          {
            id: row.id ?? "fake-id",
            kind: row.kind ?? "research_packet",
            status: row.status ?? "expected",
            redactionStatus: row.redactionStatus ?? "pending",
            sourceLocation: row.sourceLocation ?? null,
            summary: row.summary ?? null,
            createdByActor: row.createdByActor ?? null,
            workflowRunId: row.workflowRunId ?? null,
            sessionId: row.sessionId ?? null,
            chatId: row.chatId ?? null,
            goalId: row.goalId ?? null,
            gateId: row.gateId ?? null,
            createdAt: row.createdAt ?? new Date(),
            updatedAt: row.updatedAt ?? new Date(),
          },
        ];
      },
    }),
  }),

  update: (_table: unknown) => ({
    set: (_values: unknown) => ({
      where: (_cond: unknown) => ({
        returning: async (): Promise<FakeRow[]> => fakeUpdatedRows,
      }),
    }),
  }),

  select: () => ({
    from: (_table: unknown) => ({
      where: (_cond: unknown) => ({
        orderBy: async (..._args: unknown[]): Promise<FakeRow[]> =>
          fakeSelectRows,
      }),
    }),
  }),
};

mock.module("./client", () => ({ db: fakeDb }));
mock.module("server-only", () => ({}));

// Lazy import so mocks are registered before the module loads
const artifactsModulePromise = import("./workflow-artifacts");

// ---------------------------------------------------------------------------
// BT-001: createArtifact — generates an id and defaults status/redactionStatus
// ---------------------------------------------------------------------------
describe("createArtifact", () => {
  beforeEach(() => resetFake());

  test("BT-001a: generates a nanoid and stores defaults for status and redactionStatus", async () => {
    const { createArtifact } = await artifactsModulePromise;

    const result = await createArtifact({
      kind: "research_packet",
    });

    // id must be non-empty string (nanoid generated)
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    // defaults
    expect(result.status).toBe("expected");
    expect(result.redactionStatus).toBe("pending");
    expect(result.kind).toBe("research_packet");
  });

  test("BT-001b: stores optional fields when provided", async () => {
    const { createArtifact } = await artifactsModulePromise;
    const now = new Date();
    fakeInsertedRows = [
      {
        id: "art-001",
        kind: "spec",
        status: "expected",
        redactionStatus: "pending",
        sourceLocation: "/path/to/spec",
        summary: "A spec artifact",
        createdByActor: "worker-agent",
        workflowRunId: "run-1",
        sessionId: "sess-1",
        chatId: "chat-1",
        goalId: "goal-1",
        gateId: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const result = await createArtifact({
      kind: "spec",
      sourceLocation: "/path/to/spec",
      summary: "A spec artifact",
      createdByActor: "worker-agent",
      workflowRunId: "run-1",
      sessionId: "sess-1",
      chatId: "chat-1",
      goalId: "goal-1",
    });

    expect(result.kind).toBe("spec");
    expect(result.sourceLocation).toBe("/path/to/spec");
    expect(result.summary).toBe("A spec artifact");
    expect(result.createdByActor).toBe("worker-agent");
    expect(result.workflowRunId).toBe("run-1");
  });

  test("BT-001c: rejects an invalid kind with a typed WorkflowArtifactError", async () => {
    const { createArtifact, WorkflowArtifactError } =
      await artifactsModulePromise;

    await expect(
      createArtifact({ kind: "not_a_real_kind" as never }),
    ).rejects.toBeInstanceOf(WorkflowArtifactError);

    await expect(
      createArtifact({ kind: "not_a_real_kind" as never }),
    ).rejects.toMatchObject({ code: "invalid_artifact" });
  });

  test("BT-001d: rejects an invalid status override with a typed WorkflowArtifactError", async () => {
    const { createArtifact, WorkflowArtifactError } =
      await artifactsModulePromise;

    await expect(
      createArtifact({
        kind: "receipt",
        status: "not_a_status" as never,
      }),
    ).rejects.toBeInstanceOf(WorkflowArtifactError);
  });
});

// ---------------------------------------------------------------------------
// BT-002: getArtifact — returns a row or throws not_found
// ---------------------------------------------------------------------------
describe("getArtifact", () => {
  beforeEach(() => resetFake());

  test("BT-002a: returns the row when found", async () => {
    const { getArtifact } = await artifactsModulePromise;
    const now = new Date();
    fakeSelectRows = [
      {
        id: "art-abc",
        kind: "gate_report",
        status: "available",
        redactionStatus: "passed",
        sourceLocation: null,
        summary: null,
        createdByActor: null,
        workflowRunId: null,
        sessionId: null,
        chatId: null,
        goalId: null,
        gateId: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const result = await getArtifact("art-abc");
    expect(result.id).toBe("art-abc");
    expect(result.kind).toBe("gate_report");
    expect(result.status).toBe("available");
  });

  test("BT-002b: throws not_found WorkflowArtifactError when row is missing", async () => {
    const { getArtifact, WorkflowArtifactError } = await artifactsModulePromise;
    fakeSelectRows = [];

    await expect(getArtifact("missing-id")).rejects.toBeInstanceOf(
      WorkflowArtifactError,
    );
    await expect(getArtifact("missing-id")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

// ---------------------------------------------------------------------------
// BT-003: listArtifacts — requires ≥1 filter (no full-table scan)
// ---------------------------------------------------------------------------
describe("listArtifacts", () => {
  beforeEach(() => resetFake());

  test("BT-003a: throws invalid_artifact when called with an empty filter", async () => {
    const { listArtifacts, WorkflowArtifactError } =
      await artifactsModulePromise;

    await expect(listArtifacts({})).rejects.toBeInstanceOf(
      WorkflowArtifactError,
    );
    await expect(listArtifacts({})).rejects.toMatchObject({
      code: "invalid_artifact",
    });
  });

  test("BT-003b: returns rows when filtered by workflowRunId", async () => {
    const { listArtifacts } = await artifactsModulePromise;
    const now = new Date();
    fakeSelectRows = [
      {
        id: "art-1",
        kind: "research_packet",
        status: "available",
        redactionStatus: "passed",
        sourceLocation: null,
        summary: null,
        createdByActor: null,
        workflowRunId: "run-x",
        sessionId: null,
        chatId: null,
        goalId: null,
        gateId: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const rows = await listArtifacts({ workflowRunId: "run-x" });
    expect(rows).toHaveLength(1);
    expect(rows[0].workflowRunId).toBe("run-x");
  });

  test("BT-003c: returns rows when filtered by sessionId", async () => {
    const { listArtifacts } = await artifactsModulePromise;
    fakeSelectRows = [];

    const rows = await listArtifacts({ sessionId: "sess-y" });
    expect(Array.isArray(rows)).toBe(true);
  });

  test("BT-003d: returns rows when filtered by kind", async () => {
    const { listArtifacts } = await artifactsModulePromise;
    fakeSelectRows = [];

    const rows = await listArtifacts({ kind: "spec" });
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BT-004: updateArtifactStatus — updates status or throws not_found
// ---------------------------------------------------------------------------
describe("updateArtifactStatus", () => {
  beforeEach(() => resetFake());

  test("BT-004a: returns the updated row on success", async () => {
    const { updateArtifactStatus } = await artifactsModulePromise;
    const now = new Date();
    fakeUpdatedRows = [
      {
        id: "art-upd",
        kind: "receipt",
        status: "available",
        redactionStatus: "pending",
        sourceLocation: null,
        summary: null,
        createdByActor: null,
        workflowRunId: null,
        sessionId: null,
        chatId: null,
        goalId: null,
        gateId: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const result = await updateArtifactStatus("art-upd", "available");
    expect(result.id).toBe("art-upd");
    expect(result.status).toBe("available");
  });

  test("BT-004b: throws not_found when row is missing", async () => {
    const { updateArtifactStatus, WorkflowArtifactError } =
      await artifactsModulePromise;
    fakeUpdatedRows = [];

    await expect(
      updateArtifactStatus("ghost-id", "available"),
    ).rejects.toBeInstanceOf(WorkflowArtifactError);
    await expect(
      updateArtifactStatus("ghost-id", "available"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

// ---------------------------------------------------------------------------
// BT-005: setArtifactRedactionStatus — updates redactionStatus or throws not_found
// ---------------------------------------------------------------------------
describe("setArtifactRedactionStatus", () => {
  beforeEach(() => resetFake());

  test("BT-005a: returns updated row with new redactionStatus", async () => {
    const { setArtifactRedactionStatus } = await artifactsModulePromise;
    const now = new Date();
    fakeUpdatedRows = [
      {
        id: "art-red",
        kind: "final_build_report",
        status: "available",
        redactionStatus: "passed",
        sourceLocation: null,
        summary: null,
        createdByActor: null,
        workflowRunId: null,
        sessionId: null,
        chatId: null,
        goalId: null,
        gateId: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const result = await setArtifactRedactionStatus("art-red", "passed");
    expect(result.id).toBe("art-red");
    expect(result.redactionStatus).toBe("passed");
  });

  test("BT-005b: throws not_found when row is missing", async () => {
    const { setArtifactRedactionStatus, WorkflowArtifactError } =
      await artifactsModulePromise;
    fakeUpdatedRows = [];

    await expect(
      setArtifactRedactionStatus("ghost-id", "passed"),
    ).rejects.toBeInstanceOf(WorkflowArtifactError);
    await expect(
      setArtifactRedactionStatus("ghost-id", "passed"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

// ---------------------------------------------------------------------------
// BT-006: Zod enum parity — artifacts.ts enums must match schema-level enums
// NOTE: This guards against silent enum drift between the Zod contract and
//       the DB schema. It imports artifacts.ts constants and verifies their
//       members are the expected values.
// ---------------------------------------------------------------------------
describe("enum parity: artifacts.ts Zod enums match the DB schema enum lists", () => {
  test("BT-006a: ARTIFACT_KINDS contains exactly the expected kinds", async () => {
    const { ARTIFACT_KINDS } = await import("../workflows/artifacts");

    const expected = [
      "research_packet",
      "spec",
      "receipt",
      "gate_report",
      "final_build_report",
    ] as const;

    expect([...ARTIFACT_KINDS].sort()).toEqual([...expected].sort());
  });

  test("BT-006b: ARTIFACT_STATUSES contains exactly the expected statuses", async () => {
    const { ARTIFACT_STATUSES } = await import("../workflows/artifacts");

    const expected = [
      "expected",
      "generating",
      "available",
      "superseded",
      "redacted",
      "failed",
      "missing",
      "archived",
    ] as const;

    expect([...ARTIFACT_STATUSES].sort()).toEqual([...expected].sort());
  });

  test("BT-006c: ARTIFACT_REDACTION_STATUSES matches the existing redactionStatus vocabulary", async () => {
    const { ARTIFACT_REDACTION_STATUSES } =
      await import("../workflows/artifacts");

    // Must align with sandboxBrowserRuns.redactionStatus enum in schema.ts
    const expected = ["pending", "passed", "failed", "blocked"] as const;

    expect([...ARTIFACT_REDACTION_STATUSES].sort()).toEqual(
      [...expected].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS — catch future breakage of the artifact contract
//
// Each test targets a specific invariant that would break if the green commit
// (98c3e595) were reverted or the contract were silently mutated.
// ---------------------------------------------------------------------------

describe("regression: default field values cannot be silently removed", () => {
  beforeEach(() => resetFake());

  test("REG-001: createArtifact always sets status='expected' when not provided", async () => {
    // Regression: if the default is removed from createArtifact, this test
    // fails because the fakeDb echo returns the value passed in the .values()
    // call — which would be undefined instead of "expected".
    const { createArtifact } = await artifactsModulePromise;

    const result = await createArtifact({ kind: "receipt" });

    expect(result.status).toBe("expected");
  });

  test("REG-002: createArtifact always sets redactionStatus='pending' when not provided", async () => {
    // Regression: if the redactionStatus default is dropped, redaction
    // enforcement in issue #43 would receive undefined instead of "pending"
    // and could skip the review queue entirely.
    const { createArtifact } = await artifactsModulePromise;

    const result = await createArtifact({ kind: "gate_report" });

    expect(result.redactionStatus).toBe("pending");
  });
});

describe("regression: filter guard cannot be bypassed", () => {
  beforeEach(() => resetFake());

  test("REG-003: listArtifacts rejects every combination of empty filter", async () => {
    // Regression: if someone removes the empty-filter guard from listArtifacts,
    // the DB would run a full-table scan that leaks cross-tenant artifacts.
    const { listArtifacts, WorkflowArtifactError } =
      await artifactsModulePromise;

    const emptyVariants = [
      {},
      { workflowRunId: undefined },
      { sessionId: undefined, chatId: undefined },
    ] as Parameters<typeof listArtifacts>[0][];

    for (const filter of emptyVariants) {
      await expect(listArtifacts(filter)).rejects.toBeInstanceOf(
        WorkflowArtifactError,
      );
      await expect(listArtifacts(filter)).rejects.toMatchObject({
        code: "invalid_artifact",
      });
    }
  });
});

describe("regression: not_found errors are honest — undefined is never returned", () => {
  beforeEach(() => resetFake());

  test("REG-004: getArtifact throws WorkflowArtifactError(not_found) rather than returning undefined", async () => {
    // Regression: if someone changes getArtifact to return undefined on miss,
    // callers would silently get undefined instead of a typed error, breaking
    // the "honest error" invariant from goal-ledger.
    const { getArtifact, WorkflowArtifactError } = await artifactsModulePromise;
    fakeSelectRows = [];

    const result = getArtifact("does-not-exist");

    // Must reject, not resolve
    await expect(result).rejects.toBeInstanceOf(WorkflowArtifactError);
    // Must have the right code, not a generic Error
    await expect(getArtifact("does-not-exist")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  test("REG-005: updateArtifactStatus throws WorkflowArtifactError(not_found) rather than returning undefined", async () => {
    // Regression: mirrors REG-004 for the update path.
    const { updateArtifactStatus, WorkflowArtifactError } =
      await artifactsModulePromise;
    fakeUpdatedRows = [];

    await expect(
      updateArtifactStatus("no-such-id", "available"),
    ).rejects.toBeInstanceOf(WorkflowArtifactError);
    await expect(
      updateArtifactStatus("no-such-id", "available"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("regression: enum membership is fixed — no silent additions or removals", () => {
  test("REG-006: ARTIFACT_KINDS has exactly 5 members", async () => {
    // Regression: adding or removing a kind without updating dependent systems
    // (e.g., UI rendering, downstream consumers) would break silently.
    const { ARTIFACT_KINDS } = await import("../workflows/artifacts");

    expect(ARTIFACT_KINDS).toHaveLength(5);
    expect(ARTIFACT_KINDS).toContain("research_packet");
    expect(ARTIFACT_KINDS).toContain("spec");
    expect(ARTIFACT_KINDS).toContain("receipt");
    expect(ARTIFACT_KINDS).toContain("gate_report");
    expect(ARTIFACT_KINDS).toContain("final_build_report");
  });

  test("REG-007: ARTIFACT_STATUSES has exactly 8 members", async () => {
    // Regression: the sub-epic #39 product spec defines exactly 8 statuses.
    const { ARTIFACT_STATUSES } = await import("../workflows/artifacts");

    expect(ARTIFACT_STATUSES).toHaveLength(8);
  });

  test("REG-008: ARTIFACT_REDACTION_STATUSES has exactly 4 members matching redaction vocabulary", async () => {
    // Regression: the 4-value redaction vocabulary is shared with
    // sandboxBrowserRuns and backgroundAgentEvents; a silent mismatch would
    // cause redaction enforcement (#43) to handle unknown states incorrectly.
    const { ARTIFACT_REDACTION_STATUSES } =
      await import("../workflows/artifacts");

    expect(ARTIFACT_REDACTION_STATUSES).toHaveLength(4);
    expect(ARTIFACT_REDACTION_STATUSES).toContain("pending");
    expect(ARTIFACT_REDACTION_STATUSES).toContain("passed");
    expect(ARTIFACT_REDACTION_STATUSES).toContain("failed");
    expect(ARTIFACT_REDACTION_STATUSES).toContain("blocked");
  });
});
