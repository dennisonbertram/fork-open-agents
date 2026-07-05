import { describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "@open-agents/sandbox";

mock.module("server-only", () => ({}));

const { resolveSandboxHomeDirectory } = await import("./home-directory");

describe("resolveSandboxHomeDirectory", () => {
  test("two calls on the same fake sandbox -> exec called exactly once, both calls return same value", async () => {
    const execMock = mock(async () => ({
      success: true,
      exitCode: 0,
      stdout: "/home/vercel-sandbox",
      stderr: "",
      truncated: false,
    }));

    const sandbox = {
      workingDirectory: "/vercel/sandbox",
      exec: execMock,
    } as unknown as Sandbox;

    const result1 = await resolveSandboxHomeDirectory(sandbox);
    const result2 = await resolveSandboxHomeDirectory(sandbox);

    expect(result1).toBe("/home/vercel-sandbox");
    expect(result2).toBe("/home/vercel-sandbox");
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  test("two different fake sandbox objects -> exec called once per sandbox", async () => {
    const execMock1 = mock(async () => ({
      success: true,
      exitCode: 0,
      stdout: "/home/user1",
      stderr: "",
      truncated: false,
    }));

    const execMock2 = mock(async () => ({
      success: true,
      exitCode: 0,
      stdout: "/home/user2",
      stderr: "",
      truncated: false,
    }));

    const sandbox1 = {
      workingDirectory: "/vercel/sandbox1",
      exec: execMock1,
    } as unknown as Sandbox;

    const sandbox2 = {
      workingDirectory: "/vercel/sandbox2",
      exec: execMock2,
    } as unknown as Sandbox;

    const result1 = await resolveSandboxHomeDirectory(sandbox1);
    const result2 = await resolveSandboxHomeDirectory(sandbox2);
    const result1Again = await resolveSandboxHomeDirectory(sandbox1);

    expect(result1).toBe("/home/user1");
    expect(result2).toBe("/home/user2");
    expect(result1Again).toBe("/home/user1");
    expect(execMock1).toHaveBeenCalledTimes(1);
    expect(execMock2).toHaveBeenCalledTimes(1);
  });

  test("failed exec -> returns /root; subsequent successful call attempts exec again and caches result", async () => {
    let callCount = 0;
    const execMock = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "error",
          truncated: false,
        };
      }
      return {
        success: true,
        exitCode: 0,
        stdout: "/home/vercel-sandbox",
        stderr: "",
        truncated: false,
      };
    });

    const sandbox = {
      workingDirectory: "/vercel/sandbox",
      exec: execMock,
    } as unknown as Sandbox;

    const result1 = await resolveSandboxHomeDirectory(sandbox);
    expect(result1).toBe("/root");
    expect(execMock).toHaveBeenCalledTimes(1);

    const result2 = await resolveSandboxHomeDirectory(sandbox);
    expect(result2).toBe("/home/vercel-sandbox");
    expect(execMock).toHaveBeenCalledTimes(2);

    const result3 = await resolveSandboxHomeDirectory(sandbox);
    expect(result3).toBe("/home/vercel-sandbox");
    expect(execMock).toHaveBeenCalledTimes(2);
  });
});
