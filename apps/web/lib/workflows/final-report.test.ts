import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Spy state ──────────────────────────────────────────────────────────────────

const createArtifactSpy = mock(async (_input: unknown) => ({
  id: "artifact-final-report-id",
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
  createdAt: new Date(),
  updatedAt: new Date(),
}));

mock.module("@/lib/db/workflow-artifacts", () => ({
  createArtifact: createArtifactSpy,
}));

const {
  buildReceiptInputs,
  buildFinalReportInputs,
  decideFinalReportStatus,
} = await import("./final-report");

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  createArtifactSpy.mockClear();
});

// ---------------------------------------------------------------------------
// decideFinalReportStatus — pure function unit tests
// ---------------------------------------------------------------------------

describe("decideFinalReportStatus", () => {
  // BT-FR-001: completed run with evidence → available
  test("returns 'available' when workflowStatus is completed and hasRequiredEvidence is true", () => {
    const result = decideFinalReportStatus({
      workflowStatus: "completed",
      hasRequiredEvidence: true,
    });
    expect(result).toBe("available");
  });

  // BT-FR-002: completed run WITHOUT evidence → missing (evidence-gated)
  test("returns 'missing' when workflowStatus is completed but hasRequiredEvidence is false", () => {
    const result = decideFinalReportStatus({
      workflowStatus: "completed",
      hasRequiredEvidence: false,
    });
    expect(result).toBe("missing");
  });

  // BT-FR-003: failed run → not 'available' regardless of evidence
  test("returns a non-available status when workflowStatus is failed", () => {
    const result = decideFinalReportStatus({
      workflowStatus: "failed",
      hasRequiredEvidence: true,
    });
    expect(result).not.toBe("available");
  });

  // BT-FR-004: aborted run → not 'available'
  test("returns a non-available status when workflowStatus is aborted", () => {
    const result = decideFinalReportStatus({
      workflowStatus: "aborted",
      hasRequiredEvidence: true,
    });
    expect(result).not.toBe("available");
  });

  // BT-FR-005: failed run without evidence → not 'available'
  test("returns a non-available status when workflowStatus is failed and hasRequiredEvidence is false", () => {
    const result = decideFinalReportStatus({
      workflowStatus: "failed",
      hasRequiredEvidence: false,
    });
    expect(result).not.toBe("available");
  });
});

// ---------------------------------------------------------------------------
// buildReceiptInputs
// ---------------------------------------------------------------------------

describe("buildReceiptInputs", () => {
  const baseCtx = {
    workflowRunId: "wrun_test-42",
    sessionId: "session-42",
    chatId: "chat-42",
    userId: "user-42",
    workflowStatus: "completed" as const,
    objectiveText: "Build a new feature for the app",
  };

  // BT-FR-006: receipt has kind = "receipt"
  test("returns an artifact insert with kind 'receipt'", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(input.kind).toBe("receipt");
  });

  // BT-FR-007: receipt status is always "available"
  test("returns status 'available' for the receipt artifact", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(input.status).toBe("available");
  });

  // BT-FR-008: receipt redactionStatus is "pending"
  test("sets redactionStatus to 'pending'", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(input.redactionStatus).toBe("pending");
  });

  // BT-FR-009: receipt sourceLocation follows pattern
  test("sets sourceLocation to workflow-run/<id>/receipt", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(input.sourceLocation).toBe(
      `workflow-run/${baseCtx.workflowRunId}/receipt`,
    );
  });

  // BT-FR-010: receipt carries correct context fields
  test("sets workflowRunId, sessionId, chatId on the receipt input", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(input.workflowRunId).toBe(baseCtx.workflowRunId);
    expect(input.sessionId).toBe(baseCtx.sessionId);
    expect(input.chatId).toBe(baseCtx.chatId);
  });

  // BT-FR-011: receipt goalId and gateId are null
  test("sets goalId and gateId to null", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(input.goalId).toBeNull();
    expect(input.gateId).toBeNull();
  });

  // BT-FR-012: receipt createdByActor is "workflow"
  test("sets createdByActor to 'workflow'", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(input.createdByActor).toBe("workflow");
  });

  // BT-FR-013: receipt summary includes workflowStatus and is non-empty
  test("summary is non-empty and contains a description of the run outcome", () => {
    const input = buildReceiptInputs(baseCtx);
    expect(typeof input.summary).toBe("string");
    expect((input.summary ?? "").length).toBeGreaterThan(0);
  });

  // BT-FR-014: receipt summary is redacted — bearer token not present
  test("redacts bearer tokens from the summary", () => {
    const ctx = {
      ...baseCtx,
      objectiveText:
        "Authenticate with Bearer sk-supersecrettoken12345 to fetch data",
    };
    const input = buildReceiptInputs(ctx);
    expect(input.summary ?? "").not.toContain("sk-supersecrettoken12345");
  });

  // BT-FR-015: receipt summary is truncated to ~500 chars
  test("truncates very long summary to at most 500 chars", () => {
    const ctx = {
      ...baseCtx,
      objectiveText: "x".repeat(1000),
    };
    const input = buildReceiptInputs(ctx);
    expect((input.summary ?? "").length).toBeLessThanOrEqual(510);
  });
});

// ---------------------------------------------------------------------------
// buildFinalReportInputs
// ---------------------------------------------------------------------------

describe("buildFinalReportInputs", () => {
  const baseCtx = {
    workflowRunId: "wrun_test-42",
    sessionId: "session-42",
    chatId: "chat-42",
    userId: "user-42",
    workflowStatus: "completed" as const,
    objectiveText: "Build a new feature for the app",
  };

  // BT-FR-016: final_build_report kind
  test("returns an artifact insert with kind 'final_build_report'", () => {
    const input = buildFinalReportInputs(baseCtx, { hasRequiredEvidence: true });
    expect(input.kind).toBe("final_build_report");
  });

  // BT-FR-017: evidence-gated — completed + evidence → available
  test("sets status 'available' when completed and hasRequiredEvidence is true", () => {
    const input = buildFinalReportInputs(baseCtx, { hasRequiredEvidence: true });
    expect(input.status).toBe("available");
  });

  // BT-FR-018: evidence-gated — completed WITHOUT evidence → missing
  test("sets status 'missing' when completed but hasRequiredEvidence is false", () => {
    const input = buildFinalReportInputs(baseCtx, {
      hasRequiredEvidence: false,
    });
    expect(input.status).toBe("missing");
  });

  // BT-FR-019: failed run → non-available status regardless of evidence
  test("does not set status 'available' for a failed run even with evidence", () => {
    const failedCtx = { ...baseCtx, workflowStatus: "failed" as const };
    const input = buildFinalReportInputs(failedCtx, {
      hasRequiredEvidence: true,
    });
    expect(input.status).not.toBe("available");
  });

  // BT-FR-020: sourceLocation pattern
  test("sets sourceLocation to workflow-run/<id>/final-build-report", () => {
    const input = buildFinalReportInputs(baseCtx, { hasRequiredEvidence: true });
    expect(input.sourceLocation).toBe(
      `workflow-run/${baseCtx.workflowRunId}/final-build-report`,
    );
  });

  // BT-FR-021: context fields
  test("sets workflowRunId, sessionId, chatId on the final report input", () => {
    const input = buildFinalReportInputs(baseCtx, { hasRequiredEvidence: true });
    expect(input.workflowRunId).toBe(baseCtx.workflowRunId);
    expect(input.sessionId).toBe(baseCtx.sessionId);
    expect(input.chatId).toBe(baseCtx.chatId);
  });

  // BT-FR-022: redactionStatus pending
  test("sets redactionStatus to 'pending'", () => {
    const input = buildFinalReportInputs(baseCtx, { hasRequiredEvidence: true });
    expect(input.redactionStatus).toBe("pending");
  });

  // BT-FR-023: goalId and gateId null
  test("sets goalId and gateId to null", () => {
    const input = buildFinalReportInputs(baseCtx, { hasRequiredEvidence: true });
    expect(input.goalId).toBeNull();
    expect(input.gateId).toBeNull();
  });

  // BT-FR-024: missing evidence → summary mentions missing evidence
  test("summary notes missing evidence when hasRequiredEvidence is false", () => {
    const input = buildFinalReportInputs(baseCtx, {
      hasRequiredEvidence: false,
    });
    const summary = input.summary ?? "";
    // Should mention evidence or missing in some form
    expect(summary.toLowerCase()).toMatch(/evidence|missing/);
  });

  // BT-FR-025: redaction applied to final report summary
  test("redacts bearer tokens from final report summary", () => {
    const ctx = {
      ...baseCtx,
      objectiveText:
        "Use Bearer ghp_secrettoken12345678901234567890 to push",
    };
    const input = buildFinalReportInputs(ctx, { hasRequiredEvidence: true });
    expect(input.summary ?? "").not.toContain(
      "ghp_secrettoken12345678901234567890",
    );
  });
});

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe("regression: decideFinalReportStatus is pure and deterministic", () => {
  test("same inputs always produce the same output", () => {
    const r1 = decideFinalReportStatus({
      workflowStatus: "completed",
      hasRequiredEvidence: true,
    });
    const r2 = decideFinalReportStatus({
      workflowStatus: "completed",
      hasRequiredEvidence: true,
    });
    expect(r1).toBe(r2);
  });

  test("evidence gate cannot be bypassed by a failed run", () => {
    // Regression: if the gating logic only checks hasRequiredEvidence and not
    // workflowStatus, a failed run with evidence would incorrectly produce "available".
    const result = decideFinalReportStatus({
      workflowStatus: "failed",
      hasRequiredEvidence: true,
    });
    expect(result).not.toBe("available");
  });
});

describe("regression: buildReceiptInputs sourceLocation format is stable", () => {
  test("sourceLocation for receipt uses workflow-run/<id>/receipt slug", () => {
    const id = "wrun_regression-42";
    const input = buildReceiptInputs({
      workflowRunId: id,
      sessionId: "s",
      chatId: "c",
      userId: "u",
      workflowStatus: "completed",
      objectiveText: "test",
    });
    expect(input.sourceLocation).toBe(`workflow-run/${id}/receipt`);
  });
});

describe("regression: buildFinalReportInputs sourceLocation format is stable", () => {
  test("sourceLocation for final_build_report uses workflow-run/<id>/final-build-report slug", () => {
    const id = "wrun_regression-42";
    const input = buildFinalReportInputs(
      {
        workflowRunId: id,
        sessionId: "s",
        chatId: "c",
        userId: "u",
        workflowStatus: "completed",
        objectiveText: "test",
      },
      { hasRequiredEvidence: true },
    );
    expect(input.sourceLocation).toBe(
      `workflow-run/${id}/final-build-report`,
    );
  });
});
