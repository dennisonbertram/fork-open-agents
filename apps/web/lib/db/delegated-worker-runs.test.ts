import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import {
  buildDelegatedWorkerRunRecordsFromMessage,
  canTransitionDelegatedWorkerRun,
} from "./delegated-worker-runs";

function assistantMessage(
  parts: WebAgentUIMessage["parts"],
): WebAgentUIMessage {
  return {
    id: "message-1",
    role: "assistant",
    parts,
  } as WebAgentUIMessage;
}

describe("delegated worker run records", () => {
  test("extracts redaction-safe worker attribution from task output", () => {
    const now = new Date("2026-06-21T12:00:00.000Z");
    const records = buildDelegatedWorkerRunRecordsFromMessage({
      message: assistantMessage([
        {
          type: "tool-task",
          toolCallId: "task-1",
          state: "output-available",
          input: {
            subagentType: "executor",
            task: "Apply change",
            instructions: "contains private implementation details",
          },
          output: {
            final: [],
            runtime: {
              mode: "managed_runtime",
              label: "Managed runtime worker",
              workerType: "executor",
              profileId: "web-bun-agent-browser",
              profileVersion: "2026-05-23.1",
              profileRunId: "profile-run-1",
              sandboxName: "session_session-1",
            },
            workspacePolicy: {
              requestedPolicy: "shared",
              effectivePolicy: "shared",
              executionMode: "shared",
              label: "shared workspace",
              status: "policy_recorded",
            },
            workspaceResolution: {
              status: "accepted",
              decision: "shared",
              requestedPolicy: "shared",
              effectivePolicy: "shared",
              reasonCode: "explicit_shared_policy",
              reason: "The worker requested the shared parent workspace.",
              parentWorkspaceId: "workspace-1",
              requiredCapabilities: ["workspace:use_shared"],
              createdResourceIds: [],
            },
            sharedWriterLease: {
              status: "acquired",
              leaseId: "lease-1",
              sessionId: "session-1",
              workerId: "worker-1",
              workspaceId: "workspace-1",
              acquiredAt: now.getTime(),
              expiresAt: now.getTime() + 60_000,
              events: [
                {
                  type: "shared_writer_lock_acquired",
                  sessionId: "session-1",
                  workspaceId: "workspace-1",
                  workerId: "worker-1",
                  workspaceMode: "shared",
                  reasonCode: "shared_writer_lock_acquired",
                  expiresAt: now.getTime() + 60_000,
                },
              ],
            },
          },
        },
      ] as WebAgentUIMessage["parts"]),
      workflowRunId: "workflow-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      now,
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "delegated-worker:workflow-1:task-1",
      parentToolCallId: "task-1",
      workerId: "worker-1",
      workerType: "executor",
      taskTitle: "Apply change",
      status: "completed",
      reasonCode: "worker_terminal",
      requestedWorkspacePolicy: "shared",
      effectiveWorkspacePolicy: "shared",
      workspaceMode: "shared",
      workspaceId: "workspace-1",
      sandboxName: "session_session-1",
      managedRuntimeProfileId: "web-bun-agent-browser",
      managedRuntimeProfileRunId: "profile-run-1",
      evidenceRefs: [
        { kind: "task_output", ref: "tool-task.output" },
        { kind: "runtime", ref: "tool-task.output.runtime" },
        { kind: "workspace", ref: "tool-task.output.workspace" },
      ],
    });
    expect(JSON.stringify(records[0])).not.toContain(
      "contains private implementation details",
    );
  });

  test("marks workspace drift output as blocked with the drift reason", () => {
    const records = buildDelegatedWorkerRunRecordsFromMessage({
      message: assistantMessage([
        {
          type: "tool-task",
          toolCallId: "task-1",
          state: "output-available",
          input: {
            subagentType: "executor",
            task: "Apply change",
            instructions: "Do the work.",
          },
          output: {
            workspacePolicy: {
              requestedPolicy: "shared",
              effectivePolicy: "shared",
              executionMode: "shared",
              label: "shared workspace",
              status: "policy_recorded",
            },
            sharedWorkspaceDrift: {
              status: "blocked",
              reasonCode: "protected_workspace_drift",
            },
          },
        },
      ] as WebAgentUIMessage["parts"]),
      workflowRunId: "workflow-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      now: new Date("2026-06-21T12:00:00.000Z"),
    });

    expect(records[0]).toMatchObject({
      status: "blocked",
      reasonCode: "protected_workspace_drift",
      finishedAt: new Date("2026-06-21T12:00:00.000Z"),
    });
  });

  test("extracts isolated workspace provenance from task output", () => {
    const childCreatedAt = Date.UTC(2026, 5, 21, 12, 1, 0);
    const records = buildDelegatedWorkerRunRecordsFromMessage({
      message: assistantMessage([
        {
          type: "tool-task",
          toolCallId: "task-1",
          state: "output-available",
          input: {
            subagentType: "executor",
            task: "Apply isolated change",
            instructions: "Do the work.",
          },
          output: {
            final: [],
            workspacePolicy: {
              requestedPolicy: "isolated",
              effectivePolicy: "isolated",
              executionMode: "isolated",
              label: "isolated workspace",
              status: "policy_recorded",
            },
            workspaceResolution: {
              status: "accepted",
              decision: "isolated",
              requestedPolicy: "isolated",
              effectivePolicy: "isolated",
              reasonCode: "explicit_isolated_policy",
              reason: "The worker requested an isolated workspace.",
              parentWorkspaceId: "parent-workspace",
              requiredCapabilities: ["workspace:create_isolated"],
              createdResourceIds: ["child-workspace"],
            },
            isolatedWorkspace: {
              status: "created",
              reasonCode: "isolated_workspace_creation_succeeded",
              parentWorkspaceId: "parent-workspace",
              childWorkspaceId: "child-workspace",
              sourceRef: "develop",
              sourceCommit: "abc123",
              createdAt: childCreatedAt,
              durationMs: 25,
              events: [
                {
                  type: "isolated_workspace_creation_succeeded",
                  parentWorkspaceId: "parent-workspace",
                  childWorkspaceId: "child-workspace",
                  reasonCode: "isolated_workspace_creation_succeeded",
                  durationMs: 25,
                  createdAt: childCreatedAt,
                },
              ],
            },
          },
        },
      ] as WebAgentUIMessage["parts"]),
      workflowRunId: "workflow-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      now: new Date("2026-06-21T12:00:00.000Z"),
    });

    expect(records[0]).toMatchObject({
      workspaceMode: "isolated",
      workspaceId: "child-workspace",
      sourceWorkspaceId: "parent-workspace",
      sourceRef: "develop",
      sourceCommit: "abc123",
      childWorkspaceId: "child-workspace",
      childWorkspaceCreatedAt: new Date(childCreatedAt),
      evidenceRefs: [
        { kind: "task_output", ref: "tool-task.output" },
        { kind: "workspace", ref: "tool-task.output.workspace" },
        { kind: "workspace", ref: "tool-task.output.isolatedWorkspace" },
      ],
    });
  });

  test("uses deterministic ids so launch retries target the same record", () => {
    const params = {
      message: assistantMessage([
        {
          type: "tool-task",
          toolCallId: "task-1",
          state: "output-available",
          input: {
            subagentType: "explorer",
            task: "Inspect files",
            instructions: "Find relevant files.",
          },
          output: { final: [] },
        },
      ] as WebAgentUIMessage["parts"]),
      workflowRunId: "workflow-1",
      chatId: "chat-1",
      sessionId: "session-1",
      userId: "user-1",
      now: new Date("2026-06-21T12:00:00.000Z"),
    };

    const first = buildDelegatedWorkerRunRecordsFromMessage(params);
    const second = buildDelegatedWorkerRunRecordsFromMessage(params);

    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe("delegated-worker:workflow-1:task-1");
  });

  test("rejects lifecycle jumps out of terminal states", () => {
    expect(canTransitionDelegatedWorkerRun("planned", "running")).toBe(true);
    expect(canTransitionDelegatedWorkerRun("running", "completed")).toBe(true);
    expect(canTransitionDelegatedWorkerRun("completed", "running")).toBe(false);
    expect(canTransitionDelegatedWorkerRun("failed", "completed")).toBe(false);
  });
});
