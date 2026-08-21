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

function makeFakeSandbox(resolution: ExecResult) {
  return {
    workingDirectory: "/repo",
    exec: async (command: string): Promise<ExecResult> => {
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
const { setFetchEventRecorder } = await import("./fetch-events");

type ExecuteFn = (
  input: { url: string },
  options: { experimental_context?: unknown; abortSignal?: AbortSignal },
) => Promise<{ success: boolean; error?: string }>;

const execute = (webFetchTool as unknown as { execute: ExecuteFn }).execute;

const PUBLIC_RESOLUTION = {
  success: true,
  exitCode: 0,
  stdout: "93.184.216.34\n2606:2800:220:1:248:1893:25c8:1946",
  stderr: "",
};

const FAILED_RESOLUTION = {
  success: false,
  exitCode: 2,
  stdout: "",
  stderr: "getent: Cannot parse database",
};

const EMPTY_RESOLUTION = {
  success: true,
  exitCode: 0,
  stdout: "",
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
    sessionId: "sess-1",
  };
}

describe("web_fetch typed block errors + events (#1393)", () => {
  afterEach(() => {
    setFetchEventRecorder(null);
    sandboxResolution = { success: true, exitCode: 0, stdout: "", stderr: "" };
  });

  test("private literal host keeps private message and emits fetch-private-target-blocked", async () => {
    const events: unknown[] = [];
    setFetchEventRecorder((event) => events.push(event));

    const result = await execute(
      { url: "https://169.254.169.254/latest/meta-data" },
      { experimental_context: unattendedContext() },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("private or internal host");
    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    expect(event.service).toBe("agent-fetch-tool");
    expect(event.event).toBe("fetch-private-target-blocked");
    expect(event.level).toBe("warn");
    expect(event.host).toBe("169.254.169.254");
    expect(event.errorKind).toBe("private_target_blocked");
    expect(event.sessionId).toBe("sess-1");
    expect(event.chatId).toBeUndefined();
  });

  test("dns resolution failure gets its own typed message and errorKind", async () => {
    sandboxResolution = FAILED_RESOLUTION;
    const events: unknown[] = [];
    setFetchEventRecorder((event) => events.push(event));

    const result = await execute(
      { url: "https://nx.example.com/" },
      { experimental_context: unattendedContext() },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("DNS resolution failed");
    expect(result.error).not.toContain("private or internal host");
    const event = events[0] as Record<string, unknown>;
    expect(event.event).toBe("fetch-private-target-blocked");
    expect(event.errorKind).toBe("dns-resolution-failed");
    expect(event.host).toBe("nx.example.com");
  });

  test("empty resolution gets its own typed message and errorKind", async () => {
    sandboxResolution = EMPTY_RESOLUTION;
    const events: unknown[] = [];
    setFetchEventRecorder((event) => events.push(event));

    const result = await execute(
      { url: "https://empty.example.com/" },
      { experimental_context: unattendedContext() },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("no addresses");
    expect(result.error).not.toContain("private or internal host");
    const event = events[0] as Record<string, unknown>;
    expect(event.event).toBe("fetch-private-target-blocked");
    expect(event.errorKind).toBe("empty_resolution");
  });

  test("successful public resolution emits fetch-host-resolved with resolvedIps and host only", async () => {
    sandboxResolution = PUBLIC_RESOLUTION;
    const events: unknown[] = [];
    setFetchEventRecorder((event) => events.push(event));

    const result = await execute(
      { url: "https://example.com/path?token=secret" },
      { experimental_context: unattendedContext() },
    );

    expect(result.success).toBe(true);
    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    expect(event.service).toBe("agent-fetch-tool");
    expect(event.event).toBe("fetch-host-resolved");
    expect(event.level).toBe("info");
    expect(event.host).toBe("example.com");
    expect(event.outcome).toBe("allowed");
    expect(event.resolvedIps).toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("/path");
  });
});
