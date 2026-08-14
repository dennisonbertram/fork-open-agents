import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import {
  buildHeadlessStepToolSignature,
  createHeadlessActivityState,
} from "./headless-activity-signal";

type Parts = WebAgentUIMessage["parts"];

function toolPart(
  toolCallId: string,
  input: unknown,
  toolName = "task",
): Parts[number] {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "output-available",
    preliminary: false,
    input,
    output: { final: [] },
  } as unknown as Parts[number];
}

function dynamicToolPart(
  toolCallId: string,
  toolName: string,
  input: unknown,
): Parts[number] {
  return {
    type: "dynamic-tool",
    toolName,
    toolCallId,
    state: "output-available",
    preliminary: false,
    input,
    output: {},
  } as unknown as Parts[number];
}

describe("buildHeadlessStepToolSignature (#1242)", () => {
  test("returns null for a step with no tool-call parts", () => {
    const state = createHeadlessActivityState();
    const parts: Parts = [{ type: "text", text: "just thinking" }];
    expect(buildHeadlessStepToolSignature(state, parts)).toBeNull();
  });

  test("two steps calling the same tool with the same input share a signature, even with different call ids", () => {
    const stateA = createHeadlessActivityState();
    const a = buildHeadlessStepToolSignature(stateA, [
      toolPart("call-1", { task: "List repository files" }),
    ]);
    const stateB = createHeadlessActivityState();
    const b = buildHeadlessStepToolSignature(stateB, [
      toolPart("call-2", { task: "List repository files" }),
    ]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  test("the same tool called with different input produces a different signature", () => {
    const stateA = createHeadlessActivityState();
    const a = buildHeadlessStepToolSignature(stateA, [
      toolPart("call-1", { task: "Review PR #1" }),
    ]);
    const stateB = createHeadlessActivityState();
    const b = buildHeadlessStepToolSignature(stateB, [
      toolPart("call-2", { task: "Review PR #2" }),
    ]);
    expect(a).not.toBe(b);
  });

  test("key order in the input does not change the signature", () => {
    const stateA = createHeadlessActivityState();
    const a = buildHeadlessStepToolSignature(stateA, [
      toolPart("call-1", { a: 1, b: 2 }),
    ]);
    const stateB = createHeadlessActivityState();
    const b = buildHeadlessStepToolSignature(stateB, [
      toolPart("call-2", { b: 2, a: 1 }),
    ]);
    expect(a).toBe(b);
  });

  test("dynamic-tool parts are keyed by their real tool name, not the generic type", () => {
    const stateA = createHeadlessActivityState();
    const a = buildHeadlessStepToolSignature(stateA, [
      dynamicToolPart("call-1", "COMPOSIO_LINEAR", { query: "x" }),
    ]);
    const stateB = createHeadlessActivityState();
    const b = buildHeadlessStepToolSignature(stateB, [
      dynamicToolPart("call-2", "COMPOSIO_SLACK", { query: "x" }),
    ]);
    expect(a).not.toBe(b);
  });

  test("a tool-call id already counted in a prior step is not re-signed when parts accumulate", () => {
    const state = createHeadlessActivityState();
    const callA = toolPart("call-1", { task: "first" });
    const callB = toolPart("call-2", { task: "second" });

    const first = buildHeadlessStepToolSignature(state, [callA]);
    // Production parts accumulate across steps (see repeated-tool-failure.ts's
    // module doc) — simulate that by passing the growing array on the next
    // call instead of only the new part.
    const second = buildHeadlessStepToolSignature(state, [callA, callB]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // The second step's signature reflects only the NEW call, so it must not
    // equal a signature built from both calls together.
    const both = (() => {
      const freshState = createHeadlessActivityState();
      return buildHeadlessStepToolSignature(freshState, [callA, callB]);
    })();
    expect(second).not.toBe(both);
  });
});
