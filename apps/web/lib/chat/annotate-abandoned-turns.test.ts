import { convertToModelMessages } from "ai";
import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import {
  ABANDONED_TURN_MARKER,
  annotateAbandonedTurns,
} from "./annotate-abandoned-turns";

/**
 * Flattens a converted model message's content into plain text so a test can
 * assert on what the model actually sees, regardless of how many parts the
 * content array happens to be split into.
 */
function textOf(
  message: Awaited<ReturnType<typeof convertToModelMessages>>[number],
): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => ("text" in part ? part.text : ""))
    .join("");
}

function userMessage(id: string, text: string): WebAgentUIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function abandonedAssistantMessage(id: string): WebAgentUIMessage {
  return {
    id,
    role: "assistant",
    metadata: { abandoned: true },
    parts: [
      { type: "text", text: "Workspace setup failed. Try again in a moment." },
    ],
  };
}

function normalAssistantMessage(id: string): WebAgentUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: "Here is the answer." }],
  };
}

describe("annotateAbandonedTurns", () => {
  // (b counterpart) A normal turn's history is returned unchanged.
  test("leaves a history with no abandoned turns unchanged", () => {
    const messages: WebAgentUIMessage[] = [
      userMessage("u1", "hello"),
      normalAssistantMessage("a1"),
    ];

    expect(annotateAbandonedTurns(messages)).toBe(messages);
  });

  // (a counterpart, model-facing) An abandoned turn's model-facing content
  // gets an explicit "not completed / do not resume" marker.
  test("marks an abandoned assistant turn with a not-completed marker", async () => {
    const messages: WebAgentUIMessage[] = [
      userMessage("u1", "please read github access tools"),
      abandonedAssistantMessage("a1"),
    ];

    const annotated = annotateAbandonedTurns(messages);
    const modelMessages = await convertToModelMessages(annotated);
    const assistantMessage = modelMessages.find((m) => m.role === "assistant");

    expect(assistantMessage).toBeDefined();
    expect(
      textOf(assistantMessage as NonNullable<typeof assistantMessage>),
    ).toContain(ABANDONED_TURN_MARKER);
  });

  // (c) An abandoned turn followed by an unrelated new user message: the
  // abandoned request must not read as still pending, and the new unrelated
  // message must reach the model exactly as written — this fix only
  // annotates history, it never rewrites new user input.
  test("does not alter a later unrelated user message following an abandoned turn", async () => {
    const messages: WebAgentUIMessage[] = [
      userMessage("u1", "please read github access tools"),
      abandonedAssistantMessage("a1"),
      userMessage("u2", "Hi here is the second turn."),
    ];

    const annotated = annotateAbandonedTurns(messages);
    const modelMessages = await convertToModelMessages(annotated);
    const userMessages = modelMessages.filter((m) => m.role === "user");
    const lastUserMessage = userMessages.at(-1);

    expect(lastUserMessage).toBeDefined();
    expect(textOf(lastUserMessage as NonNullable<typeof lastUserMessage>)).toBe(
      "Hi here is the second turn.",
    );
  });

  // (d) An explicit retry — the user re-sending the same request — is also
  // passed through unchanged; the fix never blocks or rewrites user input,
  // it only marks the abandoned assistant turn so the model does not treat
  // the retry as redundant with something already done.
  test("passes an explicit retry message through unchanged", async () => {
    const retryText = "please read github access tools";
    const messages: WebAgentUIMessage[] = [
      userMessage("u1", retryText),
      abandonedAssistantMessage("a1"),
      userMessage("u2", retryText),
    ];

    const annotated = annotateAbandonedTurns(messages);
    const modelMessages = await convertToModelMessages(annotated);
    const userMessages = modelMessages.filter((m) => m.role === "user");
    const lastUserMessage = userMessages.at(-1);

    expect(lastUserMessage).toBeDefined();
    expect(textOf(lastUserMessage as NonNullable<typeof lastUserMessage>)).toBe(
      retryText,
    );
  });

  test("does not mutate the input array", () => {
    const messages: WebAgentUIMessage[] = [
      userMessage("u1", "hi"),
      abandonedAssistantMessage("a1"),
    ];
    const originalPartsLength = messages[1].parts.length;

    annotateAbandonedTurns(messages);

    expect(messages[1].parts.length).toBe(originalPartsLength);
  });
});
