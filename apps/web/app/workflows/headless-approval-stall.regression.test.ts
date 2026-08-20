import { describe, expect, test } from "bun:test";

/**
 * A headless run that stops on a tool approval is dead, not paused: nothing
 * outside a browser click resolves a pending approval. The run must say so.
 *
 * This is a source guard rather than a behaviour test because reaching the
 * branch needs a live provider returning `finishReason: "tool-calls"` with an
 * approval-requested part, which the suite cannot produce. Guarding the source
 * is what this repo does where a line cannot be executed under test.
 */
const chatSource = await Bun.file(
  new URL("chat.ts", import.meta.url).pathname,
).text();

describe("headless approval stall is explained, not silent", () => {
  test("the outcome-message chain handles awaiting_tool_approval", () => {
    expect(chatSource).toContain(
      'workflowRunOutcomeStatus === "awaiting_tool_approval"',
    );
  });

  test("it is gated on the run being headless, so attended runs still prompt", () => {
    const clause = chatSource.slice(
      chatSource.indexOf(
        'workflowRunOutcomeStatus === "awaiting_tool_approval"',
      ),
      chatSource.indexOf("buildHeadlessAwaitingApprovalMessage()"),
    );
    expect(clause).toContain("isHeadlessRun");
  });

  test("the builder is imported, not inlined", () => {
    expect(chatSource).toContain("buildHeadlessAwaitingApprovalMessage,");
  });
});
