import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import {
  buildDelegatedWorkerRunRecordsFromMessage,
  buildDelegatedWorkerStaleRecoveryUpdate,
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
            sharedWriterLeaseRelease: {
              status: "released",
              events: [
                {
                  type: "shared_writer_lock_released",
                  sessionId: "session-1",
                  workspaceId: "workspace-1",
                  workerId: "worker-1",
                  workspaceMode: "shared",
                  reasonCode: "worker_terminal",
                  releasedByWorkerId: "worker-1",
                },
              ],
            },
            completionPacket: {
              version: 1,
              status: "completed",
              workerId: "worker-1",
              workerType: "executor",
              workspaceMode: "shared",
              appliedToParentWorkspace: true,
              summary: "Implemented the change.",
              scope: ["Apply change"],
              changedFiles: [],
              verification: ["Worker reached terminal completed state."],
              blockers: [],
              integrationInstructions: ["Changes applied to parent."],
              artifacts: [
                { kind: "task_output", ref: "tool-task.output" },
                {
                  kind: "completion_packet",
                  ref: "tool-task.output.completionPacket",
                },
              ],
              recoveryInstructions: [],
              createdAt: now.getTime(),
            },
            completionPacketValidation: {
              status: "valid",
              reasonCode: "worker_completion_packet_validated",
              reason: "Completion packet validated.",
              createdAt: now.getTime(),
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
        {
          kind: "completion_packet",
          ref: "tool-task.output.completionPacket",
        },
        { kind: "cleanup", ref: "delegated-worker.cleanup" },
      ],
      completionPacketValidationStatus: "valid",
      completionPacketValidationReasonCode:
        "worker_completion_packet_validated",
    });
    expect(records[0].completionPacket).toMatchObject({
      version: 1,
      status: "completed",
      summary: "Implemented the change.",
    });
    expect(records[0]).toMatchObject({
      cleanupStatus: "succeeded",
      cleanupReasonCode: "shared_writer_lock_released",
      cleanupResourceId: "workspace-1",
      cleanupAttemptCount: 1,
      cleanupAttemptedAt: now,
      cleanupCompletedAt: now,
    });
    expect(JSON.stringify(records[0])).not.toContain(
      "contains private implementation details",
    );
  });

  test("records invalid completion packets without treating them as evidence", () => {
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
            final: [],
            completionPacket: {
              version: 1,
              status: "completed",
              workerId: "worker-1",
              workerType: "executor",
              workspaceMode: "isolated",
              appliedToParentWorkspace: false,
              summary: "Prepared change.",
              scope: ["Apply change"],
              changedFiles: [],
              verification: [],
              blockers: [],
              integrationInstructions: [],
              artifacts: [],
              recoveryInstructions: [],
              createdAt: 1,
            },
            completionPacketValidation: {
              status: "invalid",
              reasonCode: "worker_completion_packet_invalid",
              reason: "completed packets require verification evidence",
              createdAt: 1,
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
      status: "completed",
      reasonCode: "worker_completion_packet_invalid",
      completionPacketValidationStatus: "invalid",
      completionPacketValidationReasonCode: "worker_completion_packet_invalid",
      completionPacketValidationReason:
        "completed packets require verification evidence",
      evidenceRefs: [
        { kind: "task_output", ref: "tool-task.output" },
        {
          kind: "completion_packet",
          ref: "tool-task.output.completionPacket",
        },
      ],
    });
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
        { kind: "cleanup", ref: "delegated-worker.cleanup" },
      ],
      cleanupStatus: "cleanup_required",
      cleanupReasonCode: "isolated_workspace_cleanup_unsupported",
      cleanupReason:
        "Isolated child workspace cleanup is not supported by the active sandbox backend.",
      cleanupResourceId: "child-workspace",
      cleanupAttemptCount: 1,
      cleanupAttemptedAt: new Date("2026-06-21T12:00:00.000Z"),
    });
  });

  test("builds an idempotent stale recovery update for timed-out running workers", () => {
    const now = new Date("2026-06-21T12:10:00.000Z");
    const update = buildDelegatedWorkerStaleRecoveryUpdate({
      run: {
        id: "delegated-worker:workflow-1:task-1",
        status: "running",
        reasonCode: "worker_running",
        workspaceMode: "isolated",
        workspaceId: "child-workspace",
        childWorkspaceId: "child-workspace",
        cleanupStatus: "pending",
        cleanupAttemptCount: 0,
        updatedAt: new Date("2026-06-21T12:00:00.000Z"),
        lifecycleEvents: [
          {
            status: "running",
            reasonCode: "worker_running",
            createdAt: "2026-06-21T12:00:00.000Z",
          },
        ],
      },
      now,
      staleAfterMs: 5 * 60 * 1000,
    });

    expect(update).toMatchObject({
      status: "stale",
      reasonCode: "worker_timed_out",
      cleanupStatus: "cleanup_required",
      cleanupReasonCode: "stale_isolated_workspace_cleanup_required",
      cleanupResourceId: "child-workspace",
      cleanupAttemptCount: 1,
      cleanupAttemptedAt: now,
      finishedAt: now,
      updatedAt: now,
      lifecycleEvents: [
        {
          status: "running",
          reasonCode: "worker_running",
          createdAt: "2026-06-21T12:00:00.000Z",
        },
        {
          status: "stale",
          reasonCode: "worker_timed_out",
          createdAt: "2026-06-21T12:10:00.000Z",
        },
      ],
    });

    if (!update) {
      throw new Error("expected stale recovery update");
    }

    expect(
      buildDelegatedWorkerStaleRecoveryUpdate({
        run: {
          id: "delegated-worker:workflow-1:task-1",
          status: "stale",
          reasonCode: "worker_timed_out",
          workspaceMode: "isolated",
          workspaceId: "child-workspace",
          childWorkspaceId: "child-workspace",
          cleanupStatus: "cleanup_required",
          cleanupAttemptCount: update.cleanupAttemptCount ?? 1,
          updatedAt: update.updatedAt ?? now,
          lifecycleEvents: update.lifecycleEvents ?? [],
        },
        now: new Date("2026-06-21T12:11:00.000Z"),
        staleAfterMs: 5 * 60 * 1000,
      }),
    ).toBeNull();
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
