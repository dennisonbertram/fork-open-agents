import { describe, expect, test } from "bun:test";
import {
  detectRepetition,
  hashTurnToolCalls,
  hashTurnToolFailures,
} from "./action-repetition";

describe("hashTurnToolFailures", () => {
  test("returns null for a turn with no failed tool parts", () => {
    expect(hashTurnToolFailures([])).toBeNull();
    expect(
      hashTurnToolFailures([{ toolName: "task", errorText: undefined }]),
    ).toBeNull();
  });

  test("two turns failing the same way in the same tool hash identically", () => {
    const a = hashTurnToolFailures([
      { toolName: "task", errorText: "No output generated." },
    ]);
    const b = hashTurnToolFailures([
      { toolName: "task", errorText: "No output generated." },
    ]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test("the same tool failing with different errors hashes differently", () => {
    const a = hashTurnToolFailures([
      { toolName: "task", errorText: "No output generated." },
    ]);
    const b = hashTurnToolFailures([
      { toolName: "task", errorText: "workspace_drift_detected" },
    ]);
    expect(a).not.toBe(b);
  });

  test("different tools failing with the same error hash differently", () => {
    const a = hashTurnToolFailures([
      { toolName: "task", errorText: "boom" },
    ]);
    const b = hashTurnToolFailures([
      { toolName: "bash", errorText: "boom" },
    ]);
    expect(a).not.toBe(b);
  });

  test("the returned hash is hex and never contains the raw error text", () => {
    const secret = "Bearer sk-super-secret-token-value-12345";
    const hash = hashTurnToolFailures([
      { toolName: "task", errorText: secret },
    ]);
    expect(hash).not.toBeNull();
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).not.toContain(secret);
  });

  test("feeds detectRepetition so an identical failure trips at the threshold", () => {
    const signature = hashTurnToolFailures([
      { toolName: "task", errorText: "No output generated." },
    ]);
    if (signature === null) {
      throw new Error("expected a signature");
    }
    expect(
      detectRepetition([signature, signature], { repeatThreshold: 3 }).flagged,
    ).toBe(false);
    const verdict = detectRepetition([signature, signature, signature], {
      repeatThreshold: 3,
    });
    expect(verdict.flagged).toBe(true);
    expect(verdict.reason).toBe("repeat");
    expect(verdict.repeatCount).toBe(3);
  });
});

describe("hashTurnToolCalls", () => {
  test("returns null for an empty tool-call array", () => {
    expect(hashTurnToolCalls([])).toBeNull();
  });

  test("normalizes key order in input objects to the same hash", () => {
    const a = hashTurnToolCalls([{ toolName: "bash", input: { a: 1, b: 2 } }]);
    const b = hashTurnToolCalls([{ toolName: "bash", input: { b: 2, a: 1 } }]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test("different input values produce different hashes", () => {
    const a = hashTurnToolCalls([
      { toolName: "bash", input: { command: "bun test" } },
    ]);
    const b = hashTurnToolCalls([
      { toolName: "bash", input: { command: "bun run build" } },
    ]);
    expect(a).not.toBe(b);
  });

  test("the returned hash is a hex string that never contains a raw arg value", () => {
    const secretToken = "sk-super-secret-token-value-12345";
    const hash = hashTurnToolCalls([
      { toolName: "bash", input: { command: secretToken } },
    ]);
    expect(hash).not.toBeNull();
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash).not.toContain(secretToken);
  });
});

describe("detectRepetition", () => {
  test("flags when the same signature repeats K times", () => {
    const K = 4;
    const signatures = Array.from({ length: K }, () => "sig-A");
    const result = detectRepetition(signatures, { repeatThreshold: K });
    expect(result).toMatchObject({
      flagged: true,
      reason: "repeat",
      repeatCount: K,
    });
  });

  test("does not flag with one fewer than K identical signatures", () => {
    const K = 4;
    const signatures = Array.from({ length: K - 1 }, () => "sig-A");
    const result = detectRepetition(signatures, { repeatThreshold: K });
    expect(result.flagged).toBe(false);
  });

  test("flags an A,B,A,B cycle with cycleLength 2", () => {
    const result = detectRepetition(["A", "B", "A", "B"], {
      repeatThreshold: 10,
    });
    expect(result).toMatchObject({
      flagged: true,
      reason: "cycle",
      cycleLength: 2,
    });
  });

  test("flags an A,B,C,A,B,C cycle with cycleLength 3", () => {
    const result = detectRepetition(["A", "B", "C", "A", "B", "C"], {
      repeatThreshold: 10,
    });
    expect(result).toMatchObject({
      flagged: true,
      reason: "cycle",
      cycleLength: 3,
    });
  });

  test("does not flag an incomplete cycle", () => {
    const result = detectRepetition(["A", "B", "A"], { repeatThreshold: 10 });
    expect(result.flagged).toBe(false);
  });

  test("does not flag a varied, productive sequence", () => {
    const result = detectRepetition(["A", "B", "C", "D", "E"], {
      repeatThreshold: 10,
    });
    expect(result.flagged).toBe(false);
  });

  test("false-positive guard: distinct whole-turn signatures with a shared inner check call stay unflagged", () => {
    // Each turn's signature differs because the EDIT call's args differ,
    // even though a "bash bun test" call repeats inside every turn.
    const turnA = hashTurnToolCalls([
      { toolName: "edit_file", input: { path: "a.ts", content: "x" } },
      { toolName: "bash", input: { command: "bun test" } },
    ]) as string;
    const turnB = hashTurnToolCalls([
      { toolName: "edit_file", input: { path: "b.ts", content: "y" } },
      { toolName: "bash", input: { command: "bun test" } },
    ]) as string;
    const turnC = hashTurnToolCalls([
      { toolName: "edit_file", input: { path: "c.ts", content: "z" } },
      { toolName: "bash", input: { command: "bun test" } },
    ]) as string;

    const result = detectRepetition([turnA, turnB, turnC], {
      repeatThreshold: 3,
    });
    expect(result.flagged).toBe(false);
  });
});
