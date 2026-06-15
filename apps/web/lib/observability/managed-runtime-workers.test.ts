import { describe, expect, test } from "bun:test";
import {
  extractManagedRuntimeWorkersFromMessages,
  extractManagedRuntimeWorkersFromParts,
  summarizeManagedRuntimeDirectToolUse,
  summarizeManagedRuntimeDirectToolUseFromMessages,
} from "./managed-runtime-workers";

describe("extractManagedRuntimeWorkersFromMessages", () => {
  test("derives managed worker attribution from persisted task message parts", () => {
    const workers = extractManagedRuntimeWorkersFromMessages([
      {
        id: "assistant-1",
        createdAt: new Date("2026-05-26T20:00:00.000Z"),
        parts: {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-task",
              toolCallId: "task-1",
              state: "output-available",
              preliminary: true,
              input: {
                subagentType: "executor",
                task: "Implement a small UI change",
              },
              output: {
                pending: {
                  name: "bash",
                  input: { command: "bun --bun run ci" },
                },
                toolCallCount: 2,
                runtime: {
                  mode: "managed_runtime",
                  workerType: "executor",
                  sandboxName: "sbx_runtime_123",
                  profileId: "web-bun-agent-browser",
                  profileVersion: "2026-05-23.2",
                  profileDisplayName: "Web app with Bun and browser checks",
                  profileRunId: "mprun_123",
                },
              },
            },
          ],
        },
      },
    ]);

    expect(workers).toEqual([
      {
        id: "task-1",
        source: "message",
        taskToolCallId: "task-1",
        workerType: "executor",
        status: "running",
        sandboxName: "sbx_runtime_123",
        profileId: "web-bun-agent-browser",
        profileVersion: "2026-05-23.2",
        profileDisplayName: "Web app with Bun and browser checks",
        profileRunId: "mprun_123",
        currentToolName: "Bash",
        currentToolSummary: "bun --bun run ci",
        toolCallCount: 2,
        summary: "Implement a small UI change",
        updatedAt: "2026-05-26T20:00:00.000Z",
      },
    ]);
  });

  test("ignores classic task message parts", () => {
    const workers = extractManagedRuntimeWorkersFromMessages([
      {
        id: "assistant-1",
        parts: {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-task",
              toolCallId: "task-1",
              state: "output-available",
              preliminary: true,
              input: { subagentType: "executor", task: "Inspect files" },
              output: {
                pending: {
                  name: "read",
                  input: { filePath: "README.md" },
                },
                toolCallCount: 1,
              },
            },
          ],
        },
      },
    ]);

    expect(workers).toEqual([]);
  });

  test("derives managed worker attribution from a single assistant part list", () => {
    const workers = extractManagedRuntimeWorkersFromParts(
      [
        {
          type: "tool-task",
          toolCallId: "task-1",
          state: "output-available",
          preliminary: false,
          input: {
            subagentType: "executor",
            task: "Implement a small UI change",
          },
          output: {
            final: [],
            toolCallCount: 3,
            runtime: {
              mode: "managed_runtime",
              workerType: "executor",
              sandboxName: "sbx_runtime_123",
              profileId: "web-bun-agent-browser",
              profileVersion: "2026-05-23.2",
              profileDisplayName: "Web app with Bun and browser checks",
              profileRunId: "mprun_123",
            },
          },
        },
      ],
      { updatedAt: "2026-05-26T20:00:00.000Z" },
    );

    expect(workers).toEqual([
      expect.objectContaining({
        id: "task-1",
        workerType: "executor",
        status: "completed",
        toolCallCount: 3,
        updatedAt: "2026-05-26T20:00:00.000Z",
      }),
    ]);
  });

  test("summarizes direct coordinator repo tool use without flagging safe coordinator tools", () => {
    const directToolUse = summarizeManagedRuntimeDirectToolUse([
      {
        type: "tool-todo_write",
        state: "output-available",
      },
      {
        type: "tool-task",
        state: "output-available",
      },
      {
        type: "tool-bash",
        state: "output-available",
        input: { command: "bun --bun run ci" },
      },
      {
        type: "tool-edit",
        state: "output-available",
        input: { filePath: "apps/web/page.tsx" },
      },
      {
        type: "tool-bash",
        state: "output-available",
        input: { command: "bun test" },
      },
    ]);

    expect(directToolUse).toEqual({
      observed: true,
      count: 3,
      toolTypes: ["tool-bash", "tool-edit"],
      toolLabels: ["Bash", "Edit"],
      warning:
        "Coordinator direct repo tool use observed: Bash, Edit. These actions did not run through a managed worker.",
    });
  });

  test("summarizes direct coordinator repo tool use across persisted messages", () => {
    const directToolUse = summarizeManagedRuntimeDirectToolUseFromMessages([
      {
        id: "assistant-1",
        parts: [{ type: "tool-bash" }],
      },
      {
        id: "assistant-2",
        parts: { parts: [{ type: "tool-edit" }, { type: "tool-bash" }] },
      },
    ]);

    expect(directToolUse).toEqual({
      observed: true,
      count: 3,
      toolTypes: ["tool-bash", "tool-edit"],
      toolLabels: ["Bash", "Edit"],
      warning:
        "Coordinator direct repo tool use observed: Bash, Edit. These actions did not run through a managed worker.",
    });
  });

  test("does not count tool-task parts as coordinator direct tool use", () => {
    const directToolUse = summarizeManagedRuntimeDirectToolUse([
      {
        type: "tool-task",
        toolCallId: "task-1",
        state: "output-available",
        input: { subagentType: "executor", task: "Run tests" },
        output: {
          final: [],
          toolCallCount: 1,
          runtime: {
            mode: "managed_runtime",
            workerType: "executor",
            sandboxName: "sbx_123",
          },
        },
      },
    ]);

    expect(directToolUse).toEqual({
      observed: false,
      count: 0,
      toolTypes: [],
      toolLabels: [],
      warning: null,
    });
  });
});
