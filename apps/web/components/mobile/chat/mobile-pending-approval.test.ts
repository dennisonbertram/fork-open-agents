import { describe, expect, it } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import { findPendingApproval } from "./mobile-tool-approval-bar";

/**
 * These tests feed the REAL AI SDK tool-part shapes the runtime produces
 * (`tool-bash`, `dynamic-tool`, …) — NOT a `tool-invocation` type, which the
 * runtime never emits. `findPendingApproval` detects parts via `isToolUIPart`
 * and the shared `extractRenderState`, so the fixtures must match the real
 * shape for the test to be meaningful.
 */
function asMessages(
  messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>,
): WebAgentUIMessage[] {
  return messages as unknown as WebAgentUIMessage[];
}

describe("findPendingApproval", () => {
  it("returns null when messages is empty", () => {
    expect(findPendingApproval([])).toBeNull();
  });

  it("returns null when last assistant message has no tool parts", () => {
    const messages = asMessages([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", parts: [{ type: "text", text: "hello" }] },
    ]);
    expect(findPendingApproval(messages)).toBeNull();
  });

  it("returns null when the tool part is not approval-requested", () => {
    const messages = asMessages([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "c1",
            state: "output-available",
            output: { ok: true },
          },
        ],
      },
    ]);
    expect(findPendingApproval(messages)).toBeNull();
  });

  it("returns null when an approval-requested part has no approval.id", () => {
    const messages = asMessages([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "c1",
            state: "approval-requested",
            approval: {},
          },
        ],
      },
    ]);
    expect(findPendingApproval(messages)).toBeNull();
  });

  it("returns the pending approval from the last assistant message (static tool)", () => {
    const messages = asMessages([
      { role: "user", parts: [{ type: "text", text: "run it" }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "c1",
            state: "approval-requested",
            input: { command: "bun run db:migrate:apply" },
            approval: { id: "approval-123" },
          },
        ],
      },
    ]);
    const result = findPendingApproval(messages);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("approval-123");
    expect(result?.toolName).toBe("bash");
  });

  it("derives the tool name from a dynamic-tool part", () => {
    const messages = asMessages([
      {
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "deploy_preview",
            toolCallId: "c2",
            state: "approval-requested",
            approval: { id: "approval-xyz" },
          },
        ],
      },
    ]);
    const result = findPendingApproval(messages);
    expect(result?.id).toBe("approval-xyz");
    expect(result?.toolName).toBe("deploy_preview");
  });

  it("returns null when the part was already denied", () => {
    const messages = asMessages([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "c1",
            state: "approval-requested",
            approval: { id: "approval-1", approved: false },
          },
        ],
      },
    ]);
    expect(findPendingApproval(messages)).toBeNull();
  });

  it("ignores an approval in an older message when the last assistant message has no tool parts", () => {
    const messages = asMessages([
      {
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "c1",
            state: "approval-requested",
            approval: { id: "old-approval" },
          },
        ],
      },
      { role: "user", parts: [{ type: "text", text: "wait" }] },
      { role: "assistant", parts: [{ type: "text", text: "ok" }] },
    ]);
    expect(findPendingApproval(messages)).toBeNull();
  });
});
