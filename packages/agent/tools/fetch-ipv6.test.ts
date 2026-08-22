import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("ai", () => ({
  tool: <T extends Record<string, unknown>>(definition: T) => definition,
}));

type ExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

const execCalls: string[] = [];

function makeFakeSandbox(resolution: ExecResult) {
  return {
    workingDirectory: "/repo",
    exec: async (command: string): Promise<ExecResult> => {
      execCalls.push(command);
      if (command.startsWith("getent")) {
        return resolution;
      }
      return {
        success: true,
        exitCode: 0,
        stdout: "response-body\n200",
        stderr: "",
      };
    },
  };
}

let sandboxResolution: ExecResult = {
  success: true,
  exitCode: 0,
  stdout: "",
  stderr: "",
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => makeFakeSandbox(sandboxResolution),
}));

const { webFetchTool } = await import("./fetch");

type ExecuteFn = (
  input: { url: string; method?: string },
  options: { experimental_context?: unknown; abortSignal?: AbortSignal },
) => Promise<{
  success: boolean;
  status?: number | null;
  body?: string;
  error?: string;
}>;

const execute = (webFetchTool as unknown as { execute: ExecuteFn }).execute;

const DUAL_STACK = {
  success: true,
  exitCode: 0,
  stdout: "93.184.216.34\n2606:2800:220:1:248:1893:25c8:1946",
  stderr: "",
};

const IPV6_ONLY = {
  success: true,
  exitCode: 0,
  stdout: "2606:2800:220:1:248:1893:25c8:1946",
  stderr: "",
};

function unattendedContext() {
  return {
    sandbox: {
      state: { type: "vercel" as const, sandboxId: "sb-1" },
      workingDirectory: "/repo",
    },
    model: {},
    unattended: true,
  };
}

describe("web_fetch --resolve IPv6 pinning (#1393)", () => {
  afterEach(() => {
    execCalls.length = 0;
    sandboxResolution = { success: true, exitCode: 0, stdout: "", stderr: "" };
  });

  test("host with both A and AAAA records pins curl to BOTH via --resolve", async () => {
    sandboxResolution = DUAL_STACK;

    const result = await execute(
      { url: "https://example.com/" },
      { experimental_context: unattendedContext() },
    );

    expect(result.success).toBe(true);
    const curlCommand = execCalls.find(
      (command) => !command.startsWith("getent"),
    );
    expect(curlCommand).toBeDefined();
    expect(curlCommand).toContain("--resolve");
    expect(curlCommand).toContain("'example.com:443:93.184.216.34'");
    expect(curlCommand).toContain(
      "'example.com:443:2606:2800:220:1:248:1893:25c8:1946'",
    );
  });

  test("IPv6-only host resolves and pins successfully", async () => {
    sandboxResolution = IPV6_ONLY;

    const result = await execute(
      { url: "https://example.com/" },
      { experimental_context: unattendedContext() },
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    const curlCommand = execCalls.find(
      (command) => !command.startsWith("getent"),
    );
    expect(curlCommand).toContain(
      "'example.com:443:2606:2800:220:1:248:1893:25c8:1946'",
    );
  });
});
