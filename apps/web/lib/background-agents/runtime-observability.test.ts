import { describe, expect, test } from "bun:test";
import {
  buildBackgroundCommandObservation,
  compactBackgroundCommandOutput,
} from "./runtime-observability";

describe("background runtime observability", () => {
  test("builds compact command observations for timeline evidence", () => {
    const observation = buildBackgroundCommandObservation({
      command: "bun test",
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
      command: "bun test",
      status: "failed",
      exitCode: 1,
      durationMs: 1500,
      stdout: "ok",
      stderr: "failed",
      truncated: false,
    });
  });

  test("keeps the tail of long command output", () => {
    const output = `${"a".repeat(4100)}tail`;

    expect(compactBackgroundCommandOutput(output)).toHaveLength(4000);
    expect(compactBackgroundCommandOutput(output)).toEndWith("tail");
  });
});
