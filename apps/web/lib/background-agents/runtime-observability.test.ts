import { describe, expect, test } from "bun:test";
import {
  buildBackgroundCommandObservation,
  compactBackgroundCommandOutput,
} from "./runtime-observability";

describe("background runtime observability", () => {
  test("builds compact command observations for timeline evidence", () => {
    const observation = buildBackgroundCommandObservation({
      command: "bun test --token=private-command-canary",
      commandLabel: "required_check",
      startedAt: new Date("2026-05-27T10:00:00.000Z"),
      finishedAt: new Date("2026-05-27T10:00:01.500Z"),
      result: {
        success: false,
        exitCode: 1,
        stdout: "ok\n",
        stderr: "failed\n",
        truncated: false,
      },
    });

    expect(observation).toEqual({
      commandLabel: "required_check",
      commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      status: "failed",
      exitCode: 1,
      durationMs: 1500,
      stdout: "ok",
      stderr: "failed",
      truncated: false,
    });
    expect(JSON.stringify(observation)).not.toContain("private-command-canary");
  });

  test("keeps the tail of long command output", () => {
    const output = `${"a".repeat(4100)}tail`;

    expect(compactBackgroundCommandOutput(output)).toHaveLength(4000);
    expect(compactBackgroundCommandOutput(output)).toEndWith("tail");
  });
});
