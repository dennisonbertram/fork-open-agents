import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SandboxState } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

const spies = {
  connectSandbox: mock(async () => ({
    workingDirectory: "/vercel/sandbox",
    exec: mock(async () => ({
      success: true,
      exitCode: 0,
      stdout: "hash-input",
      stderr: "",
      truncated: false,
    })),
  })),
  probeGitFingerprint: mock(async () => "fingerprint-abc"),
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

mock.module("@/lib/sandbox/git-fingerprint", () => ({
  probeGitFingerprint: spies.probeGitFingerprint,
}));

const { probeHeadlessRunGitFingerprint } =
  await import("./headless-progress-fuse");

function fakeSandboxState(): SandboxState {
  return {
    type: "vercel",
    sandboxName: "session_session-1",
    expiresAt: Date.now() + 60_000,
  } as unknown as SandboxState;
}

beforeEach(() => {
  spies.connectSandbox.mockClear();
  spies.probeGitFingerprint.mockClear();
  spies.probeGitFingerprint.mockImplementation(async () => "fingerprint-abc");
});

describe("probeHeadlessRunGitFingerprint (#1231)", () => {
  test("connects the sandbox and returns the shared probe's fingerprint", async () => {
    const result = await probeHeadlessRunGitFingerprint(fakeSandboxState());

    expect(result).toBe("fingerprint-abc");
    expect(spies.connectSandbox).toHaveBeenCalledTimes(1);
    expect(spies.probeGitFingerprint).toHaveBeenCalledTimes(1);
  });

  test("degrades to null instead of throwing when the sandbox cannot be reached", async () => {
    spies.connectSandbox.mockImplementationOnce(() => {
      throw new Error("sandbox unreachable");
    });

    const result = await probeHeadlessRunGitFingerprint(fakeSandboxState());

    expect(result).toBeNull();
  });
});
