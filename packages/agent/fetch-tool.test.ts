import { afterEach, describe, expect, mock, test } from "bun:test";

/**
 * Regression coverage for #1393 (DNS rebinding via curl `--resolve`).
 *
 * Mirrors the sandbox-mocking convention used in tools/tools.test.ts: a
 * fake `@open-agents/sandbox` module keyed by an in-memory registry, so
 * `webFetchTool.execute` can be exercised end-to-end against a mock sandbox
 * that records the exact curl command it would have run.
 */

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

const { webFetchTool } = await import("./tools/fetch");

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

afterEach(() => {
  sandboxRegistry.clear();
});

describe("web_fetch DNS-rebinding guard (#1393)", () => {
  test("pins curl to the validated public IP via --resolve", async () => {
    let curlCommand = "";

    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        if (command.startsWith("getent ahosts")) {
          return {
            success: true,
            exitCode: 0,
            stdout: "93.184.216.34\n",
            stderr: "",
            truncated: false,
          };
        }

        curlCommand = command;
        return {
          success: true,
          exitCode: 0,
          stdout: "ok\n200",
          stderr: "",
          truncated: false,
        };
      },
    };

    const result = await webFetchTool.execute?.(
      { url: "https://example.com", method: "GET" },
      executionOptions(createContext(sandbox)),
    );

    expect(result).toMatchObject({ success: true, status: 200 });
    expect(curlCommand).toContain("curl");
    expect(curlCommand).toContain("--resolve");
    expect(curlCommand).toContain("example.com:443:93.184.216.34");
  });

  test("defaults to port 80 for plain http URLs", async () => {
    let curlCommand = "";

    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        if (command.startsWith("getent ahosts")) {
          return {
            success: true,
            exitCode: 0,
            stdout: "93.184.216.34\n",
            stderr: "",
            truncated: false,
          };
        }

        curlCommand = command;
        return {
          success: true,
          exitCode: 0,
          stdout: "ok\n200",
          stderr: "",
          truncated: false,
        };
      },
    };

    await webFetchTool.execute?.(
      { url: "http://example.com", method: "GET" },
      executionOptions(createContext(sandbox)),
    );

    expect(curlCommand).toContain("example.com:80:93.184.216.34");
  });

  test("passes one --resolve flag per validated IP for multi-A-record hosts", async () => {
    let curlCommand = "";

    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        if (command.startsWith("getent ahosts")) {
          return {
            success: true,
            exitCode: 0,
            stdout: "93.184.216.34\n93.184.216.35\n",
            stderr: "",
            truncated: false,
          };
        }

        curlCommand = command;
        return {
          success: true,
          exitCode: 0,
          stdout: "ok\n200",
          stderr: "",
          truncated: false,
        };
      },
    };

    await webFetchTool.execute?.(
      { url: "https://example.com", method: "GET" },
      executionOptions(createContext(sandbox)),
    );

    expect(curlCommand.match(/--resolve/g)?.length).toBe(2);
    expect(curlCommand).toContain("example.com:443:93.184.216.34");
    expect(curlCommand).toContain("example.com:443:93.184.216.35");
  });

  test("fails closed and never runs curl when DNS resolves to zero addresses", async () => {
    let curlRan = false;

    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        if (command.startsWith("getent ahosts")) {
          return {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            truncated: false,
          };
        }

        curlRan = true;
        throw new Error("curl should not run when DNS resolves to nothing");
      },
    };

    const result = await webFetchTool.execute?.(
      { url: "https://empty-dns.example", method: "GET" },
      executionOptions(createContext(sandbox)),
    );

    expect(curlRan).toBe(false);
    expect(result).toEqual({
      success: false,
      error: "Fetch failed: URL resolves to a private or internal host",
    });
  });

  test("fails closed when DNS returns a mix of public and private addresses (rebinding shape)", async () => {
    let curlRan = false;

    const sandbox = {
      workingDirectory: "/repo",
      exec: async (command: string) => {
        if (command.startsWith("getent ahosts")) {
          return {
            success: true,
            exitCode: 0,
            stdout: "93.184.216.34\n127.0.0.1\n",
            stderr: "",
            truncated: false,
          };
        }

        curlRan = true;
        throw new Error("curl should not run when any resolved IP is private");
      },
    };

    const result = await webFetchTool.execute?.(
      { url: "https://mixed-dns.example", method: "GET" },
      executionOptions(createContext(sandbox)),
    );

    expect(curlRan).toBe(false);
    expect(result).toEqual({
      success: false,
      error: "Fetch failed: URL resolves to a private or internal host",
    });
  });
});
