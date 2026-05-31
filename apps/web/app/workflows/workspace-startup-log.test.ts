import { describe, expect, test } from "bun:test";
import {
  appendWorkspaceStartupLogLines,
  buildWorkspaceStatusData,
  getCommandOutputLogLines,
} from "./workspace-startup-log";

describe("workspace startup log helpers", () => {
  test("redacts sensitive values and keeps the newest bounded lines", () => {
    const lines = appendWorkspaceStartupLogLines(
      [],
      ["token=super-secret-value", "Bearer abcdefghijklmnopqrstuvwxyz123456"],
    );

    expect(lines).toEqual(["[REDACTED]", "[REDACTED]"]);
  });

  test("builds transient workspace status with logs", () => {
    const status = buildWorkspaceStatusData({
      message: "Setting up the workspace...",
      title: "Preparing sandbox workspace",
      logLines: ["Sandbox ready"],
    });

    expect(status.status).toBe("setting-up");
    expect(status.title).toBe("Preparing sandbox workspace");
    expect(status.logLines).toEqual(["Sandbox ready"]);
    expect(typeof status.logUpdatedAt).toBe("string");
  });

  test("summarizes command output with exit status", () => {
    expect(
      getCommandOutputLogLines({
        command: "bun install",
        exitCode: 0,
        stdout: "Packages: +10",
        stderr: "",
      }),
    ).toEqual(["exit 0: bun install", "Packages: +10"]);
  });
});
