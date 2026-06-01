import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Spy state ─────────────────────────────────────────────────────────────────

const createArtifactSpy = mock(async (_input: unknown) => ({
  id: "artifact-test-id",
  kind: "research_packet",
  status: "available",
  redactionStatus: "pending",
  sourceLocation: "workflow-run/wrun_test/research-packet",
  summary: "Test summary",
  createdByActor: "workflow",
  workflowRunId: "wrun_test",
  sessionId: "session-1",
  chatId: "chat-1",
  goalId: null,
  gateId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

mock.module("@/lib/db/workflow-artifacts", () => ({
  createArtifact: createArtifactSpy,
}));

const { recordWorkflowArtifactBestEffort, buildArtifactInputs } =
  await import("./artifact-generator");

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  createArtifactSpy.mockClear();
});

describe("recordWorkflowArtifactBestEffort", () => {
  test("calls createArtifact with the provided input and returns the artifact id", async () => {
    const input = {
      kind: "research_packet" as const,
      status: "available" as const,
      redactionStatus: "pending" as const,
      sourceLocation: "workflow-run/wrun_test/research-packet",
      summary: "Research context for the run",
      createdByActor: "workflow",
      workflowRunId: "wrun_test",
      sessionId: "session-1",
      chatId: "chat-1",
      goalId: null,
      gateId: null,
    };

    const result = await recordWorkflowArtifactBestEffort(input);

    expect(createArtifactSpy).toHaveBeenCalledTimes(1);
    expect(createArtifactSpy).toHaveBeenCalledWith(input);
    expect(result).toBe("artifact-test-id");
  });

  test("returns null and swallows error when createArtifact rejects", async () => {
    createArtifactSpy.mockImplementationOnce(async () => {
      throw new Error("DB connection failed");
    });

    const input = {
      kind: "spec" as const,
      status: "available" as const,
      redactionStatus: "pending" as const,
      sourceLocation: "workflow-run/wrun_test/spec",
      summary: "Spec context for the run",
      createdByActor: "workflow",
      workflowRunId: "wrun_test",
      sessionId: "session-1",
      chatId: "chat-1",
      goalId: null,
      gateId: null,
    };

    // Must NOT throw — defensive wrapper must swallow all errors
    let result: string | null | undefined;
    let threw = false;
    try {
      result = await recordWorkflowArtifactBestEffort(input);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBeNull();
  });

  test("returns null and swallows a non-Error thrown value", async () => {
    createArtifactSpy.mockImplementationOnce(async () => {
      throw "string error value";
    });

    const input = {
      kind: "research_packet" as const,
      status: "available" as const,
      redactionStatus: "pending" as const,
      sourceLocation: null,
      summary: null,
      createdByActor: null,
      workflowRunId: "wrun_test",
      sessionId: "session-1",
      chatId: "chat-1",
      goalId: null,
      gateId: null,
    };

    let result: string | null | undefined;
    let threw = false;
    try {
      result = await recordWorkflowArtifactBestEffort(input);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBeNull();
  });
});

describe("buildArtifactInputs", () => {
  test("returns research_packet and spec inputs with correct kind and status", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText: "Build a feature to add pagination",
    });

    expect(inputs).toHaveLength(2);

    const researchInput = inputs.find((i) => i.kind === "research_packet");
    const specInput = inputs.find((i) => i.kind === "spec");

    expect(researchInput).toBeDefined();
    expect(specInput).toBeDefined();

    expect(researchInput?.status).toBe("available");
    expect(specInput?.status).toBe("available");
  });

  test("sets sourceLocation to the expected logical ref string", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText: "Do something",
    });

    const researchInput = inputs.find((i) => i.kind === "research_packet");
    const specInput = inputs.find((i) => i.kind === "spec");

    expect(researchInput?.sourceLocation).toBe(
      "workflow-run/wrun_abc/research-packet",
    );
    expect(specInput?.sourceLocation).toBe("workflow-run/wrun_abc/spec");
  });

  test("sets workflowRunId, sessionId, chatId on each artifact input", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_xyz",
      sessionId: "session-99",
      chatId: "chat-99",
      userId: "user-99",
      objectiveText: "Deploy the service",
    });

    for (const input of inputs) {
      expect(input.workflowRunId).toBe("wrun_xyz");
      expect(input.sessionId).toBe("session-99");
      expect(input.chatId).toBe("chat-99");
    }
  });

  test("sets goalId and gateId to null (best-effort, no link in this slice)", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText: "Some task",
    });

    for (const input of inputs) {
      expect(input.goalId).toBeNull();
      expect(input.gateId).toBeNull();
    }
  });

  test("includes a non-empty summary derived from the objective text", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText: "Implement the login page with email and password fields",
    });

    for (const input of inputs) {
      expect(typeof input.summary).toBe("string");
      expect((input.summary ?? "").length).toBeGreaterThan(0);
    }
  });

  test("redacts bearer tokens from the summary", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText:
        "Call the API using Authorization: Bearer sk-abcdefghijklmno123456 to fetch data",
    });

    for (const input of inputs) {
      expect(input.summary).not.toContain("sk-abcdefghijklmno123456");
    }
  });

  test("redacts token-shaped values from the summary", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText:
        "Set GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234 in env",
    });

    for (const input of inputs) {
      expect(input.summary).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234");
    }
  });

  test("truncates very long objective text to ~500 chars", () => {
    const longText = "a".repeat(1000);
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText: longText,
    });

    for (const input of inputs) {
      expect((input.summary ?? "").length).toBeLessThanOrEqual(510);
    }
  });

  test("sets redactionStatus to pending", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText: "Some objective",
    });

    for (const input of inputs) {
      expect(input.redactionStatus).toBe("pending");
    }
  });

  test("sets createdByActor to a non-empty string", () => {
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_abc",
      sessionId: "session-1",
      chatId: "chat-1",
      userId: "user-1",
      objectiveText: "Some objective",
    });

    for (const input of inputs) {
      expect(typeof input.createdByActor).toBe("string");
      expect((input.createdByActor ?? "").length).toBeGreaterThan(0);
    }
  });
});

// ── Regression tests ────────────────────────────────────────────────────────
// These tests catch future regressions in artifact generation. Each one
// would fail if the corresponding behavior were reverted.

describe("regression: buildArtifactInputs produces exactly two artifacts", () => {
  test("always produces exactly 2 inputs (one per kind)", () => {
    // Regression: if kinds are added/removed without updating this function,
    // exactly-2 guarantee breaks and callers creating per-kind evidence lose artifacts.
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_regression",
      sessionId: "session-r",
      chatId: "chat-r",
      userId: "user-r",
      objectiveText: "regression test",
    });

    expect(inputs).toHaveLength(2);
    const kinds = inputs.map((i) => i.kind).sort();
    expect(kinds).toEqual(["research_packet", "spec"]);
  });
});

describe("regression: summary redaction is always applied", () => {
  test("ENV_ASSIGNMENT_PATTERN secrets are redacted from summary", () => {
    // Regression: if redactHarnessValue is removed from buildRedactedSummary,
    // env-var style secrets would leak into the artifact summary column.
    const inputs = buildArtifactInputs({
      workflowRunId: "wrun_regression",
      sessionId: "session-r",
      chatId: "chat-r",
      userId: "user-r",
      objectiveText: "Please set MY_API_KEY=s3cr3t-value before running",
    });

    for (const input of inputs) {
      expect(input.summary).not.toContain("s3cr3t-value");
    }
  });
});

describe("regression: defensive wrapper never propagates errors", () => {
  test("recordWorkflowArtifactBestEffort does not throw even when createArtifact throws synchronously-ish", async () => {
    // Regression: if try/catch is removed from the wrapper, workflow turns
    // that trigger a DB error would crash the entire managed workflow run.
    createArtifactSpy.mockImplementationOnce(() => {
      throw new TypeError("Unexpected type mismatch");
    });

    let threw = false;
    try {
      await recordWorkflowArtifactBestEffort({
        kind: "spec" as const,
        status: "available" as const,
        workflowRunId: "wrun_r",
        sessionId: "session-r",
        chatId: "chat-r",
        goalId: null,
        gateId: null,
      });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });
});

describe("regression: sourceLocation format is stable", () => {
  test("sourceLocation uses workflow-run/<id>/<kind> slug format", () => {
    // Regression: if the sourceLocation format changes, existing UI/API
    // consumers parsing the path pattern would break.
    const id = "wrun_regression-123";
    const inputs = buildArtifactInputs({
      workflowRunId: id,
      sessionId: "s",
      chatId: "c",
      userId: "u",
      objectiveText: "test",
    });

    const research = inputs.find((i) => i.kind === "research_packet");
    const spec = inputs.find((i) => i.kind === "spec");

    expect(research?.sourceLocation).toBe(`workflow-run/${id}/research-packet`);
    expect(spec?.sourceLocation).toBe(`workflow-run/${id}/spec`);
  });
});
