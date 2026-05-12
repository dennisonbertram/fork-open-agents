import { describe, expect, test } from "bun:test";
import { createOpenAgentsSandboxBridge } from "./sandbox-bridge";
import type { Sandbox } from "@open-agents/sandbox";

function createSandbox(): Sandbox {
  return {
    type: "cloud",
    workingDirectory: "/workspace",
    readFile: async () => "",
    readFileBuffer: async () => Buffer.from(""),
    writeFile: async () => {},
    stat: async () => ({
      isDirectory: () => false,
      isFile: () => true,
      size: 0,
      mtimeMs: 0,
    }),
    access: async () => {},
    mkdir: async () => {},
    readdir: async () => [],
    exec: async () => ({
      success: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      truncated: false,
    }),
    stop: async () => {},
    getState: () => ({ type: "vercel" }),
  };
}

describe("Open Agents sandbox bridge", () => {
  test("rejects raw credentials", async () => {
    await expect(
      createOpenAgentsSandboxBridge({
        credentialRef: "secret-token",
        connectSandbox: async () => createSandbox(),
      }),
    ).rejects.toThrow("credential-ref");
  });

  test("returns only the narrow sandbox shape", async () => {
    const bridge = await createOpenAgentsSandboxBridge({
      credentialRef: "credential-ref:open-agents",
      connectSandbox: async () => createSandbox(),
    });

    const connected = await bridge.connect({
      run_id: "run-1",
      request: { sandbox_state: { type: "vercel" }, session_id: "session-1" },
    });

    expect(connected.sandbox_ref).toBe("open-agents:session-1");
    expect(Object.keys(connected.sandbox).sort()).toEqual([
      "exec",
      "getState",
      "stop",
      "workingDirectory",
    ]);
  });
});
