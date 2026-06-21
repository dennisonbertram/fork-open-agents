import { describe, expect, test } from "bun:test";
import type { ToolRenderState } from "@open-agents/shared/lib/tool-state";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { TaskRenderer } from "./task-renderer";

const baseState: ToolRenderState = {
  running: false,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

describe("TaskRenderer managed runtime attribution", () => {
  test("renders managed runtime workers as workers with sandbox and profile attribution", () => {
    const part = {
      type: "tool-task",
      toolCallId: "task-1",
      state: "output-available",
      preliminary: true,
      input: {
        subagentType: "executor",
        task: "Make a trivial UI change",
        instructions: "Update the component and run checks.",
      },
      output: {
        pending: {
          name: "bash",
          input: { command: "bun --bun run ci" },
        },
        toolCallCount: 2,
        startedAt: 1_775_000_000_000,
        modelId: "test-model",
        runtime: {
          mode: "managed_runtime",
          label: "Managed runtime worker",
          workerType: "executor",
          profileId: "web-bun-agent-browser",
          profileVersion: "2026-05-23.2",
          profileDisplayName: "Web app with Bun and browser checks",
          profileRunId: "mprun_123",
          sandboxName: "sbx_runtime_123",
        },
      },
    } as ToolRendererProps<"tool-task">["part"];

    const html = renderToStaticMarkup(
      <TaskRenderer part={part} state={{ ...baseState, running: true }} />,
    );

    expect(html).toContain("Managed worker");
    expect(html).toContain("Executor");
    expect(html).toContain("Coordinator delegated");
    expect(html).toContain("sbx_runtime_123");
    expect(html).toContain("web-bun-agent-browser@2026-05-23.2");
    expect(html).toContain("Bash");
    expect(html).toContain("bun --bun run ci");
  });

  test("does not claim classic subagents are managed workers", () => {
    const part = {
      type: "tool-task",
      toolCallId: "task-2",
      state: "output-available",
      preliminary: true,
      input: {
        subagentType: "executor",
        task: "Inspect a local file",
        instructions: "Read the file.",
      },
      output: {
        pending: {
          name: "read",
          input: { filePath: "/vercel/sandbox/README.md" },
        },
        toolCallCount: 1,
        startedAt: 1_775_000_000_000,
        modelId: "test-model",
      },
    } as ToolRendererProps<"tool-task">["part"];

    const html = renderToStaticMarkup(
      <TaskRenderer part={part} state={{ ...baseState, running: true }} />,
    );

    expect(html).toContain("Executor Subagent");
    expect(html).not.toContain("Managed worker");
    expect(html).not.toContain("Coordinator delegated");
  });

  test("renders completed isolated worker completion packet evidence", () => {
    const part = {
      type: "tool-task",
      toolCallId: "task-3",
      state: "output-available",
      input: {
        subagentType: "executor",
        task: "Prepare isolated change",
        instructions: "Use an isolated workspace.",
      },
      output: {
        toolCallCount: 1,
        delegatedWorkerLifecycle: {
          eventId: "event-1",
          workerId: "worker-1",
          workerType: "executor",
          workerLabel: "executor",
          parentToolCallId: "task-3",
          status: "completed",
          reasonCode: "worker_terminal",
          workspaceMode: "isolated",
          workspaceId: "child-workspace",
          startedAt: 1,
          updatedAt: 2,
        },
        completionPacket: {
          version: 1,
          status: "completed",
          workerId: "worker-1",
          workerType: "executor",
          workspaceMode: "isolated",
          appliedToParentWorkspace: false,
          summary: "Prepared the change in the child workspace.",
          scope: ["Prepare isolated change"],
          changedFiles: ["apps/web/app/page.tsx", "apps/web/app/page.test.tsx"],
          verification: ["bun test apps/web/app/page.test.tsx"],
          blockers: [],
          integrationInstructions: [
            "Review child workspace artifacts before applying changes.",
          ],
          artifacts: [],
          recoveryInstructions: [],
          createdAt: 1,
        },
        completionPacketValidation: {
          status: "valid",
          reasonCode: "worker_completion_packet_validated",
          reason: "Completion packet validated.",
          createdAt: 1,
        },
      },
    } as ToolRendererProps<"tool-task">["part"];

    const html = renderToStaticMarkup(
      <TaskRenderer part={part} state={baseState} />,
    );

    expect(html).toContain("Worker evidence");
    expect(html).toContain("completed");
    expect(html).toContain("mode isolated");
    expect(html).toContain("packet valid");
    expect(html).toContain("Prepared the change in the child workspace.");
    expect(html).toContain("Changes:");
    expect(html).toContain("Verification:");
    expect(html).toContain("Integration:");
    expect(html).toContain("review child artifacts");
  });

  test("renders blocked worker reason with readable status text", () => {
    const part = {
      type: "tool-task",
      toolCallId: "task-4",
      state: "output-available",
      preliminary: true,
      input: {
        subagentType: "executor",
        task: "Apply shared change",
        instructions: "Use the shared workspace.",
      },
      output: {
        delegatedWorkerLifecycle: {
          eventId: "event-2",
          workerId: "worker-1",
          workerType: "executor",
          workerLabel: "executor",
          parentToolCallId: "task-4",
          status: "blocked",
          reasonCode: "shared_writer_lock_denied",
          workspaceMode: "shared",
          workspaceId: "parent-workspace",
          startedAt: 1,
          updatedAt: 2,
        },
        completionPacket: {
          version: 1,
          status: "blocked",
          workerId: "worker-1",
          workerType: "executor",
          workspaceMode: "shared",
          appliedToParentWorkspace: false,
          summary: "Worker blocked before launch.",
          scope: ["Apply shared change"],
          changedFiles: [],
          verification: [],
          blockers: ["blocked: shared_writer_lock_denied"],
          integrationInstructions: ["Changes were not applied."],
          artifacts: [],
          recoveryInstructions: [
            "Inspect worker lifecycle events and rerun after the blocker is fixed.",
          ],
          createdAt: 1,
        },
        completionPacketValidation: {
          status: "valid",
          reasonCode: "worker_completion_packet_validated",
          reason: "Completion packet validated.",
          createdAt: 1,
        },
      },
    } as ToolRendererProps<"tool-task">["part"];

    const html = renderToStaticMarkup(
      <TaskRenderer part={part} state={{ ...baseState, running: true }} />,
    );

    expect(html).toContain("Worker evidence");
    expect(html).toContain("blocked");
    expect(html).toContain("mode shared");
    expect(html).toContain("blocked: shared_writer_lock_denied");
  });
});
