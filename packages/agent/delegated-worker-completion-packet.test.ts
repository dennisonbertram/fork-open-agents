import { describe, expect, test } from "bun:test";
import {
  buildDelegatedWorkerCompletionPacket,
  validateDelegatedWorkerCompletionPacket,
} from "./delegated-worker-completion-packet";

describe("delegated worker completion packets", () => {
  test("accepts a complete shared successful packet", () => {
    const result = buildDelegatedWorkerCompletionPacket({
      status: "completed",
      reasonCode: "worker_terminal",
      workerId: "worker-1",
      workerType: "executor",
      workspaceMode: "shared",
      taskTitle: "Apply change",
      finalMessages: [
        {
          role: "assistant",
          content: "Implemented the requested change and ran tests.",
        },
      ],
      toolCallCount: 2,
      evidenceRefs: [{ kind: "task_output", ref: "tool-task.output" }],
      createdAt: 1,
    });

    expect(result.validation).toEqual({
      status: "valid",
      reasonCode: "worker_completion_packet_validated",
      reason: "Completion packet validated.",
      createdAt: 1,
    });
    expect(result.packet).toMatchObject({
      version: 1,
      status: "completed",
      workerId: "worker-1",
      workspaceMode: "shared",
      appliedToParentWorkspace: true,
      summary: "Implemented the requested change and ran tests.",
      verification: [
        "Worker reached terminal completed state: worker_terminal.",
        "Observed 2 delegated tool calls.",
      ],
    });
  });

  test("rejects completed isolated packets without integration instructions", () => {
    const result = validateDelegatedWorkerCompletionPacket(
      {
        version: 1,
        status: "completed",
        workerId: "worker-1",
        workerType: "executor",
        workspaceMode: "isolated",
        appliedToParentWorkspace: false,
        summary: "Prepared change.",
        scope: ["Apply change"],
        changedFiles: [],
        verification: ["Tests passed."],
        blockers: [],
        integrationInstructions: [],
        artifacts: [],
        recoveryInstructions: [],
        createdAt: 1,
      },
      1,
    );

    expect(result.packet).toBeUndefined();
    expect(result.validation).toMatchObject({
      status: "invalid",
      reasonCode: "worker_completion_packet_invalid",
    });
  });

  test("builds blocked packets with recovery instructions", () => {
    const result = buildDelegatedWorkerCompletionPacket({
      status: "blocked",
      reasonCode: "shared_writer_lock_denied",
      workerId: "worker-1",
      workerType: "executor",
      workspaceMode: "shared",
      taskTitle: "Apply change",
      toolCallCount: 0,
      createdAt: 1,
    });

    expect(result.validation.status).toBe("valid");
    expect(result.packet).toMatchObject({
      status: "blocked",
      blockers: ["blocked: shared_writer_lock_denied"],
      recoveryInstructions: [
        "Inspect worker lifecycle events and rerun after the blocker is fixed.",
      ],
    });
  });

  test("rejects token-shaped secrets in display fields", () => {
    const result = validateDelegatedWorkerCompletionPacket(
      {
        version: 1,
        status: "completed",
        workerId: "worker-1",
        workerType: "executor",
        workspaceMode: "shared",
        appliedToParentWorkspace: true,
        summary: "Used token=secret-value during setup.",
        scope: ["Apply change"],
        changedFiles: [],
        verification: ["Tests passed."],
        blockers: [],
        integrationInstructions: ["Changes applied to parent."],
        artifacts: [],
        recoveryInstructions: [],
        createdAt: 1,
      },
      1,
    );

    expect(result.validation).toMatchObject({
      status: "invalid",
      reasonCode: "worker_completion_packet_invalid",
    });
  });
});
