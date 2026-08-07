import { describe, expect, test } from "bun:test";
import { detectRepetition } from "@/lib/background-agents/repetition-detector";
import {
  buildFailureSignature,
  REPEATED_TOOL_FAILURE_THRESHOLD,
} from "./repeated-tool-failure";

describe("buildFailureSignature", () => {
  test("returns null for a step with no failures", () => {
    expect(buildFailureSignature([])).toBeNull();
  });

  test("two steps failing the same way in the same tool share a signature", () => {
    const a = buildFailureSignature([
      { toolName: "task", errorText: "No output generated." },
    ]);
    const b = buildFailureSignature([
      { toolName: "task", errorText: "No output generated." },
    ]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test("the same tool failing different ways does not share a signature", () => {
    const a = buildFailureSignature([
      { toolName: "task", errorText: "No output generated." },
    ]);
    const b = buildFailureSignature([
      { toolName: "task", errorText: "workspace_drift_detected" },
    ]);
    expect(a).not.toBe(b);
  });

  test("different tools failing the same way do not share a signature", () => {
    const a = buildFailureSignature([{ toolName: "task", errorText: "boom" }]);
    const b = buildFailureSignature([{ toolName: "bash", errorText: "boom" }]);
    expect(a).not.toBe(b);
  });

  test("feeds detectRepetition so an identical failure trips at the threshold", () => {
    const signature = buildFailureSignature([
      { toolName: "task", errorText: "No output generated." },
    ]);
    if (signature === null) {
      throw new Error("expected a signature");
    }

    const belowThreshold = Array.from(
      { length: REPEATED_TOOL_FAILURE_THRESHOLD - 1 },
      () => signature,
    );
    expect(
      detectRepetition(belowThreshold, {
        repeatThreshold: REPEATED_TOOL_FAILURE_THRESHOLD,
      }).flagged,
    ).toBe(false);

    const atThreshold = Array.from(
      { length: REPEATED_TOOL_FAILURE_THRESHOLD },
      () => signature,
    );
    const verdict = detectRepetition(atThreshold, {
      repeatThreshold: REPEATED_TOOL_FAILURE_THRESHOLD,
    });
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toBe("repeat");
    expect(verdict.repeatCount).toBe(REPEATED_TOOL_FAILURE_THRESHOLD);
  });
});
