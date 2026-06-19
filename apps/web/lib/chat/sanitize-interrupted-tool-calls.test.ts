import { convertToModelMessages } from "ai";
import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import { sanitizeInterruptedToolCalls } from "./sanitize-interrupted-tool-calls";

/**
 * Collect tool-call ids and tool-result ids from converted model messages so a
 * test can assert that every assistant tool-call is paired with a tool-result.
 * An unpaired tool-call is the "No tool output found for function call …"
 * provider error that wedged the production run.
 */
function findOrphanToolCalls(
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>,
): string[] {
  const callIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const message of modelMessages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (typeof part !== "object" || part === null) continue;
      if (part.type === "tool-call") callIds.add(part.toolCallId);
      if (part.type === "tool-result") resultIds.add(part.toolCallId);
    }
  }
  return [...callIds].filter((id) => !resultIds.has(id));
}

/**
 * Reproduces the production wedge: a `web_fetch` tool call that was approved
 * but never executed (state `approval-responded`, no output), followed by a
 * later user message. The conversation has moved past it, so it is abandoned.
 */
function wedgeMessages(): WebAgentUIMessage[] {
  return [
    {
      id: "u1",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Please create an implementation for issue #942",
        },
      ],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Let me check the issues." },
        {
          type: "tool-web_fetch",
          toolCallId: "call_vvUJU",
          state: "approval-responded",
          input: {
            url: "https://api.github.com/repos/dennisonbertram/synthetix/issues",
            method: "GET",
          },
          approval: { id: "appr_1", approved: true },
        },
      ],
    },
    {
      id: "u2",
      role: "user",
      parts: [
        {
          type: "text",
          text: "You seem to be using the Fetch tool to go to GitHub. Why?",
        },
      ],
    },
  ] as unknown as WebAgentUIMessage[];
}

describe("sanitizeInterruptedToolCalls", () => {
  test("unsanitized abandoned approval-responded call produces a provider orphan", async () => {
    // Documents the bug: without sanitizing, the abandoned tool-call has no
    // paired tool-result, which the provider rejects.
    const modelMessages = await convertToModelMessages(wedgeMessages(), {
      ignoreIncompleteToolCalls: true,
    });
    expect(findOrphanToolCalls(modelMessages)).toContain("call_vvUJU");
  });

  test("rewrites an abandoned approval-responded call to a terminal error", () => {
    const sanitized = sanitizeInterruptedToolCalls(wedgeMessages());
    const toolPart = sanitized[1].parts[1] as Record<string, unknown>;
    expect(toolPart.state).toBe("output-error");
    expect(typeof toolPart.errorText).toBe("string");
    expect((toolPart.errorText as string).length).toBeGreaterThan(0);
    // Approval and stale output must be dropped so conversion emits a clean
    // tool-call + tool-result pair (no dangling approval request/response).
    expect(toolPart.approval).toBeUndefined();
    expect(toolPart.output).toBeUndefined();
  });

  test("sanitized wedge has no orphan tool-calls after conversion", async () => {
    const sanitized = sanitizeInterruptedToolCalls(wedgeMessages());
    const modelMessages = await convertToModelMessages(sanitized, {
      ignoreIncompleteToolCalls: true,
    });
    expect(findOrphanToolCalls(modelMessages)).toEqual([]);
  });

  test("preserves a trailing pending approval so HITL resume still works", () => {
    // When the approval-responded call is the LAST message, streamText is about
    // to execute it. Sanitizing here would break the resume, so leave it.
    const resumeMessages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "fetch the changelog" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-web_fetch",
            toolCallId: "call_resume",
            state: "approval-responded",
            input: { url: "https://example.com", method: "GET" },
            approval: { id: "appr_2", approved: true },
          },
        ],
      },
    ] as unknown as WebAgentUIMessage[];

    const out = sanitizeInterruptedToolCalls(resumeMessages);
    expect(out).toBe(resumeMessages);
    const toolPart = out[1].parts[0] as Record<string, unknown>;
    expect(toolPart.state).toBe("approval-responded");
  });

  test("leaves terminal tool calls untouched (referential no-op)", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            toolCallId: "call_done",
            state: "output-available",
            input: { command: "ls" },
            output: { stdout: "file", success: true },
          },
        ],
      },
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "thanks" }],
      },
    ] as unknown as WebAgentUIMessage[];

    expect(sanitizeInterruptedToolCalls(messages)).toBe(messages);
  });
});
