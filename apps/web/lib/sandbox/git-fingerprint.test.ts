import { describe, expect, mock, test } from "bun:test";
import type { ExecResult, Sandbox } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

const { probeGitFingerprint } = await import("./git-fingerprint");

function fakeSandbox(
  exec: (
    command: string,
    cwd: string,
    timeoutMs?: number,
  ) => Promise<ExecResult>,
): Sandbox {
  return {
    workingDirectory: "/vercel/sandbox",
    exec,
  } as unknown as Sandbox;
}

describe("probeGitFingerprint (#914, #1231)", () => {
  test("hashes successful probe output to a stable sha256 digest", async () => {
    const exec = mock(
      async (): Promise<ExecResult> => ({
        success: true,
        exitCode: 0,
        stdout: "deadbeef\n---OA_PROGRESS_PROBE---\n",
        stderr: "",
        truncated: false,
      }),
    );

    const fingerprint = await probeGitFingerprint(fakeSandbox(exec));

    // sha256 hex digest is always 64 lowercase hex chars.
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test("the same stdout always hashes to the same fingerprint", async () => {
    const exec = mock(
      async (): Promise<ExecResult> => ({
        success: true,
        exitCode: 0,
        stdout: "same-content",
        stderr: "",
        truncated: false,
      }),
    );

    const first = await probeGitFingerprint(fakeSandbox(exec));
    const second = await probeGitFingerprint(fakeSandbox(exec));

    expect(first).toBe(second);
  });

  test("different stdout hashes to a different fingerprint", async () => {
    let call = 0;
    const exec = mock(async (): Promise<ExecResult> => {
      call += 1;
      return {
        success: true,
        exitCode: 0,
        stdout: `content-${call}`,
        stderr: "",
        truncated: false,
      };
    });

    const first = await probeGitFingerprint(fakeSandbox(exec));
    const second = await probeGitFingerprint(fakeSandbox(exec));

    expect(first).not.toBe(second);
  });

  test("returns null when the probe command exits non-zero", async () => {
    const exec = mock(
      async (): Promise<ExecResult> => ({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "fatal: not a git repository",
        truncated: false,
      }),
    );

    const fingerprint = await probeGitFingerprint(fakeSandbox(exec));

    expect(fingerprint).toBeNull();
  });

  test("returns null when sandbox.exec throws", async () => {
    const exec = mock((): Promise<ExecResult> => {
      throw new Error("sandbox connection lost");
    });

    const fingerprint = await probeGitFingerprint(fakeSandbox(exec));

    expect(fingerprint).toBeNull();
  });
});
