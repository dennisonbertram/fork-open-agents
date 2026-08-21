/**
 * #1401 — Unattended runs must never pend a tool approval nobody can answer.
 *
 * Where an approval gate would fire (git force-push via bash, dotenv-shaped
 * read/write/edit), an unattended run gets a typed auto-deny instead of a
 * pending approval that wedges the worker.
 */

import { describe, expect, mock, test } from "bun:test";

const execCalls: string[] = [];
const writeCalls: string[] = [];

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
    workingDirectory: "/repo",
    exec: async (command: string) => {
      execCalls.push(command);
      return {
        success: true,
        exitCode: 1,
        stdout: "",
        stderr: "not a template",
      };
    },
    mkdir: async () => {},
    writeFile: async (_path: string, content: string) => {
      writeCalls.push(content);
    },
    readFile: async () => "content",
    stat: async () => ({ size: 0 }),
  }),
}));

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

function options(experimental_context: unknown) {
  return {
    toolCallId: "tc-unattended",
    messages: [],
    experimental_context,
  };
}

function unattendedContext() {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "sb-unattended" },
      workingDirectory: "/repo",
    },
    model: "test-model",
    unattended: true,
  };
}

describe("unattended approval auto-deny (#1401)", () => {
  test("bash git force-push is auto-denied with typed error, not pended", async () => {
    execCalls.length = 0;
    const { bashTool } = await import("./tools/bash");
    const tool = bashTool();
    const needsApproval = tool.needsApproval as (
      input: unknown,
      opts: { experimental_context: unknown },
    ) => Promise<boolean>;
    expect(
      await needsApproval(
        { command: "git push --force origin main" },
        options(unattendedContext()),
      ),
    ).toBe(false);

    const result = await tool.execute!(
      { command: "git push --force origin main" },
      options(unattendedContext()),
    );
    expect(result).toMatchObject({
      success: false,
      errorKind: "tool_policy_denied",
      reason: "unattended_approval_unavailable",
    });
  });

  test("attended bash force-push still requires approval", async () => {
    const { bashTool } = await import("./tools/bash");
    const tool = bashTool();
    const needsApproval = tool.needsApproval as (
      input: unknown,
      opts: { experimental_context: unknown },
    ) => Promise<boolean>;
    expect(
      await needsApproval(
        { command: "git push --force origin main" },
        options({ sandbox: unattendedContext().sandbox, model: "m" }),
      ),
    ).toBe(true);
  });

  test("unattended dotenv write is auto-denied with typed error", async () => {
    const { writeFileTool } = await import("./tools/write");
    const tool = writeFileTool();
    const input = { filePath: ".env", content: "SECRET=1" };
    const needsApproval = tool.needsApproval as (
      input: unknown,
      opts: { experimental_context: unknown },
    ) => Promise<boolean>;
    expect(await needsApproval(input, options(unattendedContext()))).toBe(
      false,
    );

    const result = await tool.execute!(input, options(unattendedContext()));
    expect(result).toMatchObject({
      success: false,
      errorKind: "tool_policy_denied",
      reason: "unattended_approval_unavailable",
    });
  });

  test("unattended dotenv edit is auto-denied with typed error", async () => {
    const { editFileTool } = await import("./tools/write");
    const tool = editFileTool();
    const input = {
      filePath: ".env.local",
      oldString: "A=1",
      newString: "A=2",
    };
    const needsApproval = tool.needsApproval as (
      input: unknown,
      opts: { experimental_context: unknown },
    ) => Promise<boolean>;
    expect(await needsApproval(input, options(unattendedContext()))).toBe(
      false,
    );

    const result = await tool.execute!(input, options(unattendedContext()));
    expect(result).toMatchObject({
      success: false,
      errorKind: "tool_policy_denied",
      reason: "unattended_approval_unavailable",
    });
    expect(writeCalls).toHaveLength(0);
  });

  test("unattended non-gated writes execute normally", async () => {
    const { writeFileTool } = await import("./tools/write");
    const tool = writeFileTool();
    const result = await tool.execute!(
      { filePath: "src/out.ts", content: "export {};" },
      options(unattendedContext()),
    );
    expect(result).toMatchObject({ success: true });
  });
});
