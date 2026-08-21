/**
 * #1401 — Explorer read-only bash is enforced by policy, not prompt.
 *
 * Refusal path: filesystem-mutating commands return tool_policy_denied /
 * explorer_readonly before sandbox exec.
 * Allow path: grep/find/cat-class read-only commands still execute.
 */

import { createHash } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

const execCalls: string[] = [];

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
    workingDirectory: "/repo",
    exec: async (command: string) => {
      execCalls.push(command);
      return {
        success: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      };
    },
  }),
}));

function executionOptions(experimental_context?: unknown) {
  return {
    toolCallId: "tc-explorer-policy",
    messages: [],
    experimental_context,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "sb-explorer" },
      workingDirectory: "/repo",
    },
    model: "test-model",
    ...overrides,
  };
}

describe("explorer read-only bash policy (#1401)", () => {
  test("mutating redirect via bash is denied by policy before exec", async () => {
    execCalls.length = 0;
    const { explorerBashTool } = await import("./tools/explorer-bash");
    const tool = explorerBashTool();
    const result = await tool.execute!(
      { command: "echo x > /tmp/f" },
      executionOptions(makeContext()),
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: "tool_policy_denied",
      reason: "explorer_readonly",
    });
    expect(execCalls).toHaveLength(0);
  });

  test("rm / mkdir / touch / cp / mv are denied by policy", async () => {
    execCalls.length = 0;
    const { explorerBashTool } = await import("./tools/explorer-bash");
    const tool = explorerBashTool();
    for (const command of [
      "rm -rf tmp",
      "mkdir -p out",
      "touch newfile",
      "cp a b",
      "mv a b",
    ]) {
      const result = await tool.execute!(
        { command },
        executionOptions(makeContext()),
      );
      expect(result).toMatchObject({
        success: false,
        errorKind: "tool_policy_denied",
        reason: "explorer_readonly",
      });
    }
    expect(execCalls).toHaveLength(0);
  });

  test("allow path: grep / find / cat / ls / git status still execute", async () => {
    execCalls.length = 0;
    const { explorerBashTool } = await import("./tools/explorer-bash");
    const tool = explorerBashTool();
    for (const command of [
      "grep -n foo src",
      "find . -name '*.ts'",
      "cat README.md",
      "ls -la",
      "git status --short",
    ]) {
      const result = await tool.execute!(
        { command },
        executionOptions(makeContext()),
      );
      expect(result).toMatchObject({ success: true });
    }
    expect(execCalls.length).toBe(5);
  });

  test("denial emits tool_policy_denied with commandHash not full command", async () => {
    const events: Array<Record<string, unknown>> = [];
    const { explorerBashTool } = await import("./tools/explorer-bash");
    const { setToolPolicyEventRecorder } =
      await import("./tools/tool-policy-events");
    setToolPolicyEventRecorder((event) => {
      events.push(event as Record<string, unknown>);
    });
    try {
      const tool = explorerBashTool();
      const command = "echo secret-token > /tmp/leak";
      await tool.execute!({ command }, executionOptions(makeContext()));
      expect(events.length).toBeGreaterThan(0);
      const denied = events.find((e) => e.event === "tool_policy_denied");
      expect(denied).toBeDefined();
      expect(denied?.reason).toBe("explorer_readonly");
      expect(denied?.tool).toBe("bash");
      const expectedHash = createHash("sha256")
        .update(command)
        .digest("hex")
        .slice(0, 12);
      expect(denied?.commandHash).toBe(expectedHash);
      expect(JSON.stringify(denied)).not.toContain("secret-token");
    } finally {
      setToolPolicyEventRecorder(null);
    }
  });
});
