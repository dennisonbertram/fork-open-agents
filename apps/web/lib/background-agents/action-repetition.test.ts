import { describe, expect, test } from "bun:test";
import { detectRepetition, hashTurnToolCalls } from "./action-repetition";

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
