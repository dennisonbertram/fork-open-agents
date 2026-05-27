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
});
