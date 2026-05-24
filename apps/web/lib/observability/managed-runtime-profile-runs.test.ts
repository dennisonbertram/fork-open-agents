import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  buildManagedRuntimeCommandObservation,
  summarizeManagedRuntimeCommandOutput,
} = await import("./managed-runtime-profile-runs");

describe("managed runtime profile run observability", () => {
  test("summarizes command output without leaking obvious secrets", () => {
    expect(
      summarizeManagedRuntimeCommandOutput({
        success: false,
        exitCode: 1,
        stdout: "OPENAI_API_KEY=sk-12345678901234567890",
        stderr: "Bearer secret-token",
      }),
    ).toBe("[REDACTED]\nOPENAI_API_KEY=[REDACTED]");
  });

  test("builds bounded command observations", () => {
    const startedAt = new Date("2026-05-23T12:00:00.000Z");
    const finishedAt = new Date("2026-05-23T12:00:03.250Z");

    expect(
      buildManagedRuntimeCommandObservation({
        command: {
          id: "verify-tool",
          label: "Verify tool",
          description: "Checks whether the tool is available.",
          command: "tool --version",
          required: false,
        },
        status: "skipped",
        startedAt,
        finishedAt,
        result: {
          success: false,
          exitCode: 127,
          stdout: "",
          stderr: "tool unavailable",
        },
      }),
    ).toEqual({
      commandId: "verify-tool",
      label: "Verify tool",
      status: "skipped",
      required: false,
      exitCode: 127,
      durationMs: 3250,
      summary: "tool unavailable",
      startedAt: "2026-05-23T12:00:00.000Z",
      finishedAt: "2026-05-23T12:00:03.250Z",
    });
  });
});
