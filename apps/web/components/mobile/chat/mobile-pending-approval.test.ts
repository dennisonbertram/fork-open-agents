import { describe, expect, it } from "bun:test";
import { findPendingApproval } from "./mobile-tool-approval-bar";

// Minimal message shape compatible with what findPendingApproval reads
type TestMessage = {
  role: string;
  parts: Array<{
    type: string;
    toolName?: string;
    state?: string;
    approval?: { id?: string };
  }>;
};

describe("findPendingApproval", () => {
  it("returns null when messages is empty", () => {
    expect(findPendingApproval([])).toBeNull();
  });

  it("returns null when last assistant message has no tool parts", () => {
    const messages: TestMessage[] = [
      { role: "user", parts: [{ type: "text" }] },
      { role: "assistant", parts: [{ type: "text" }] },
    ];
    expect(findPendingApproval(messages)).toBeNull();
  });

  it("returns null when tool part is not approval-requested", () => {
    const messages: TestMessage[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolName: "bash",
            state: "output-available",
            approval: { id: "x" },
          },
        ],
      },
    ];
    expect(findPendingApproval(messages)).toBeNull();
  });

  it("returns null when approval-requested part has no approval.id", () => {
    const messages: TestMessage[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolName: "bash",
            state: "approval-requested",
          },
        ],
      },
    ];
    expect(findPendingApproval(messages)).toBeNull();
  });

  it("returns the pending approval from the last assistant message", () => {
    const messages: TestMessage[] = [
      { role: "user", parts: [{ type: "text" }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolName: "bash",
            state: "approval-requested",
            approval: { id: "approval-123" },
          },
        ],
      },
    ];
    const result = findPendingApproval(messages);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("approval-123");
    expect(result?.toolName).toBe("bash");
  });

  it("uses 'tool' as fallback toolName when toolName is missing", () => {
    const messages: TestMessage[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            state: "approval-requested",
            approval: { id: "abc" },
          },
        ],
      },
    ];
    const result = findPendingApproval(messages);
    expect(result?.toolName).toBe("tool");
  });

  it("returns null if the approval-requested part is in an older message, not the last", () => {
    const messages: TestMessage[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolName: "bash",
            state: "approval-requested",
            approval: { id: "old-approval" },
          },
        ],
      },
      { role: "user", parts: [{ type: "text" }] },
      {
        role: "assistant",
        parts: [{ type: "text" }],
      },
    ];
    // The last assistant message has no tool parts, so the older approval should not fire
    expect(findPendingApproval(messages)).toBeNull();
  });
});
