import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebAgentUIMessage } from "@/app/types";
import { AssistantMessageGroups } from "./assistant-message-groups";
import { formatToolCallsSummaryResponseStats } from "./tool-calls-summary-bar";

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
              profileId: "web-bun-agent-browser",
              profileVersion: "2026-05-23.2",
              profileDisplayName: "Web app with Bun and browser checks",
              sandboxName: "sbx_runtime_123",
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

    expect(html).toContain("Managed worker: Bash bun run test:quick");
    expect(html).toContain("sbx_runtime_123");
  });

  test("keeps response metadata out of server markup to avoid hydration drift", () => {
    const message = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "bash-1",
          state: "output-available",
          input: { command: "bun test" },
          output: { exitCode: 0, stdout: "ok", stderr: "" },
        },
      ],
    } as unknown as WebAgentUIMessage;

    const html = renderToStaticMarkup(
      <AssistantMessageGroups
        durationMs={8000}
        isStreaming={false}
        message={message}
        responseStats={{
          costSource: "gateway",
          costUsd: 0.0034,
          tokensPerSecond: 42.25,
        }}
        startedAt={null}
      >
        {() => null}
      </AssistantMessageGroups>,
    );

    expect(html).not.toContain("42.3 tok/s");
    expect(html).not.toContain("cost $0.0034");
  });

  test("formats provider-reported throughput and cost hover metadata", () => {
    expect(
      formatToolCallsSummaryResponseStats({
        costSource: "gateway",
        costUsd: 0.0034,
        tokensPerSecond: 42.25,
      }),
    ).toEqual(["42.3 tok/s", "cost $0.0034"]);
  });
});
