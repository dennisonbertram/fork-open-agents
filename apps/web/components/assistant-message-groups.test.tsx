import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebAgentUIMessage } from "@/app/types";
import { AssistantMessageGroups } from "./assistant-message-groups";

describe("AssistantMessageGroups", () => {
  test("surfaces active managed runtime worker activity while collapsed", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-task",
          toolCallId: "task-1",
          state: "output-available",
          preliminary: true,
          input: {
            subagentType: "executor",
            task: "Make a trivial change",
            instructions: "Update one file.",
          },
          output: {
            pending: {
              name: "bash",
              input: { command: "bun run test:quick" },
            },
            toolCallCount: 1,
            startedAt: 1_775_000_000_000,
            modelId: "test-model",
            runtime: {
              mode: "managed_runtime",
              label: "Managed runtime worker",
              workerType: "executor",
              profileDisplayName: "Web app with Bun and browser checks",
            },
          },
        },
      ],
    } as unknown as WebAgentUIMessage;

    const html = renderToStaticMarkup(
      <AssistantMessageGroups
        durationMs={null}
        isStreaming
        message={message}
        startedAt="2026-05-23T00:00:00.000Z"
      >
        {() => null}
      </AssistantMessageGroups>,
    );

    expect(html).toContain("Managed runtime worker: Bash bun run test:quick");
  });
});
