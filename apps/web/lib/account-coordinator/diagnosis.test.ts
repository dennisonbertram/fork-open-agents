import { describe, expect, test } from "bun:test";
import {
  buildAccountDiagnosis,
  isAccountDiagnosisSource,
  makeDiagnosticEvidence,
} from "./diagnosis";
import type { AccountWorkItem } from "./types";

const target: AccountWorkItem = {
  id: "run-1",
  source: "background_agent",
  title: "Release watcher",
  status: "failed",
  needsAttention: true,
  attentionReasons: ["failed"],
  updatedAt: "2026-06-20T12:00:00.000Z",
  repo: { owner: "acme", name: "shop", branch: "feature" },
  metadata: {
    prNumber: 42,
  },
};

describe("account diagnosis contract", () => {
  test("validates supported diagnosis sources", () => {
    expect(isAccountDiagnosisSource("session")).toBe(true);
    expect(isAccountDiagnosisSource("background_agent")).toBe(true);
    expect(isAccountDiagnosisSource("scheduled_agents")).toBe(false);
    expect(isAccountDiagnosisSource(null)).toBe(false);
  });

  test("redacts nested evidence metadata, counts evidence, and extracts correlations", () => {
    const evidence = [
      makeDiagnosticEvidence({
        id: "event-2",
        kind: "background_agent_event",
        title: "failed",
        status: "failed",
        level: "error",
        summary: "tool failed",
        occurredAt: "2026-06-20T12:02:00.000Z",
        redactionStatus: "passed",
        correlations: {
          workflowRunId: "workflow-1",
          requestId: "req-1",
          prNumber: 42,
        },
        metadata: {
          payload: {
            authorization: "Bearer abc.def",
            stdout: "raw logs",
            message: "safe failure",
          },
        },
      }),
      makeDiagnosticEvidence({
        id: "event-1",
        kind: "workflow_run",
        title: "workflow",
        status: "failed",
        occurredAt: "2026-06-20T12:01:00.000Z",
        correlations: {
          sessionId: "session-1",
          chatId: "chat-1",
          workflowRunId: "workflow-1",
        },
      }),
      makeDiagnosticEvidence({
        id: "github-pr-42",
        kind: "github_pull_request",
        title: "PR #42: fix the build",
        status: "failing",
        occurredAt: "2026-06-20T12:00:30.000Z",
        correlations: { prNumber: 42 },
      }),
    ];

    const diagnosis = buildAccountDiagnosis({
      source: "background_agent",
      id: "run-1",
      target,
      sourceStatus: [
        { source: "target", status: "ok", itemCount: 1 },
        { source: "background_agent_events", status: "ok", itemCount: 1 },
      ],
      evidence,
      now: new Date("2026-06-20T12:03:00.000Z"),
    });

    expect(diagnosis.diagnosis.summary).toBe(
      "Failed background_agent with 2 failed/error evidence items.",
    );
    expect(diagnosis.diagnosis.evidenceCounts.background_agent_event).toBe(1);
    expect(diagnosis.diagnosis.evidenceCounts.workflow_run).toBe(1);
    expect(diagnosis.diagnosis.evidenceCounts.github_pull_request).toBe(1);
    expect(diagnosis.correlations).toMatchObject({
      sessionIds: ["session-1"],
      chatIds: ["chat-1"],
      workflowRunIds: ["workflow-1"],
      requestIds: ["req-1"],
      prNumbers: [42],
    });
    expect(diagnosis.timeline.map((item) => item.id)).toEqual([
      "github-pr-42",
      "event-1",
      "event-2",
    ]);
    expect(diagnosis.evidence[0]?.metadata).toEqual({
      payload: {
        authorization: "[redacted]",
        stdout: "[redacted]",
        message: "safe failure",
      },
    });
  });
});
