import { beforeEach, describe, expect, mock, test } from "bun:test";

const sandboxRegistry = new Map<string, Record<string, unknown>>();

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async (state: { sandboxId?: string }) => {
    if (!state.sandboxId) {
      throw new Error("Missing sandboxId in test sandbox state.");
    }

    const sandbox = sandboxRegistry.get(state.sandboxId);
    if (!sandbox) {
      throw new Error(`Unknown test sandbox: ${state.sandboxId}`);
    }

    return sandbox;
  },
  tryConnectVercelSandboxDirect: async () => null,
}));

const { grepTool } = await import("./tools/grep");
const { globTool } = await import("./tools/glob");

function createContext(sandbox: Record<string, unknown>) {
  const sandboxId = `sandbox-${sandboxRegistry.size + 1}`;
  sandboxRegistry.set(sandboxId, sandbox);

  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId },
      workingDirectory:
        typeof sandbox.workingDirectory === "string"
          ? sandbox.workingDirectory
          : "/repo",
    },
    approval: {},
    model: "test-model",
  };
}

function executionOptions(experimental_context?: unknown) {
  return {
    toolCallId: "tool-call-1",
    messages: [],
    experimental_context,
  };
}

function makeMockSandbox(options?: {
  realPathOutput?: string;
  realPathSuccess?: boolean;
}) {
  let executedCommand = "";
  const execCalls: string[] = [];
  const sandbox = {
    workingDirectory: "/repo",
    exec: async (command: string) => {
      execCalls.push(command);
      executedCommand = command;
      if (command.startsWith("realpath")) {
        return {
          success: options?.realPathSuccess ?? true,
          exitCode: 0,
          stdout: options?.realPathOutput ?? "",
          stderr: "",
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
  };
  return {
    sandbox,
    getExecutedCommand: () => executedCommand,
    getExecCalls: () => execCalls,
  };
}

function ranSearchCommand(execCalls: string[]): boolean {
  return execCalls.some((command) => !command.startsWith("realpath"));
}

describe("grepTool workspace containment", () => {
  beforeEach(() => {
    sandboxRegistry.clear();
  });

  test("refuses an absolute path outside the workspace", async () => {
    const { sandbox, getExecutedCommand } = makeMockSandbox();

    const result = await grepTool().execute?.(
      { pattern: "root", path: "/etc/passwd" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: "path_outside_workspace",
    });
    expect(getExecutedCommand()).toBe("");
  });

  test("refuses a relative path that escapes the workspace via ..", async () => {
    const { sandbox, getExecutedCommand } = makeMockSandbox();

    const result = await grepTool().execute?.(
      { pattern: "root", path: "../../etc" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: "path_outside_workspace",
    });
    expect(getExecutedCommand()).toBe("");
  });

  test("allows an in-workspace path", async () => {
    const { sandbox, getExecutedCommand } = makeMockSandbox();

    const result = await grepTool().execute?.(
      { pattern: "root", path: "src" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({ success: true });
    expect(getExecutedCommand()).toContain("/repo/src");
  });

  test("refuses an in-workspace symlink whose target is outside the workspace (#1402)", async () => {
    const { sandbox, getExecCalls } = makeMockSandbox({
      realPathOutput: "/etc/passwd",
    });

    const result = await grepTool().execute?.(
      { pattern: "root", path: "link" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: "path_outside_workspace",
    });
    expect(ranSearchCommand(getExecCalls())).toBe(false);
  });

  test("allows an in-workspace symlink whose target stays inside the workspace (#1402)", async () => {
    const { sandbox, getExecCalls, getExecutedCommand } = makeMockSandbox({
      realPathOutput: "/repo/src/real",
    });

    const result = await grepTool().execute?.(
      { pattern: "root", path: "src/link" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({ success: true });
    expect(ranSearchCommand(getExecCalls())).toBe(true);
    expect(getExecutedCommand()).toContain("/repo/src/link");
  });
});

describe("globTool workspace containment", () => {
  beforeEach(() => {
    sandboxRegistry.clear();
  });

  test("refuses an absolute path outside the workspace", async () => {
    const { sandbox, getExecutedCommand } = makeMockSandbox();

    const result = await globTool().execute?.(
      { pattern: "*.conf", path: "/etc" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: "path_outside_workspace",
    });
    expect(getExecutedCommand()).toBe("");
  });

  test("refuses a glob pattern whose literal prefix escapes the workspace", async () => {
    const { sandbox, getExecutedCommand } = makeMockSandbox();

    const result = await globTool().execute?.(
      { pattern: "../../etc/*.conf" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: "path_outside_workspace",
    });
    expect(getExecutedCommand()).toBe("");
  });

  test("allows an in-workspace path", async () => {
    const { sandbox, getExecutedCommand } = makeMockSandbox();

    const result = await globTool().execute?.(
      { pattern: "**/*.ts", path: "src" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({ success: true });
    expect(getExecutedCommand()).toContain("/repo/src");
  });

  test("refuses an in-workspace symlink whose target is outside the workspace (#1402)", async () => {
    const { sandbox, getExecCalls } = makeMockSandbox({
      realPathOutput: "/etc",
    });

    const result = await globTool().execute?.(
      { pattern: "*.conf", path: "link" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: "path_outside_workspace",
    });
    expect(ranSearchCommand(getExecCalls())).toBe(false);
  });

  test("allows an in-workspace symlink whose target stays inside the workspace (#1402)", async () => {
    const { sandbox, getExecCalls, getExecutedCommand } = makeMockSandbox({
      realPathOutput: "/repo/src/real",
    });

    const result = await globTool().execute?.(
      { pattern: "**/*.ts", path: "src/link" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({ success: true });
    expect(ranSearchCommand(getExecCalls())).toBe(true);
    expect(getExecutedCommand()).toContain("/repo/src/link");
  });
});
