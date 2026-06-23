import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebAgentMessageMetadata } from "@/app/types";
import type { ModelOption } from "@/lib/model-options";
import { MessageModelPill } from "./message-model-pill";

const modelOptions = [
  {
    id: "fireworks/zai/glm-5.2",
    label: "GLM 5.2",
    shortLabel: "GLM 5.2",
    isVariant: false,
    provider: "fireworks",
    cost: {
      input: 1,
      output: 5,
    },
  },
] satisfies ModelOption[];

describe("MessageModelPill", () => {
  test("renders provider-reported tokens per second and estimated cost next to the model", () => {
    const html = renderToStaticMarkup(
      <MessageModelPill
        metadata={
          {
            selectedModelId: "fireworks/zai/glm-5.2",
            modelId: "fireworks/zai/glm-5.2",
            inferenceRoute: "user",
            inferenceProfileName: "Fireworks",
          } satisfies WebAgentMessageMetadata
        }
        modelOptions={modelOptions}
        responseStats={{
          costSource: "estimate",
          costUsd: 0.0025,
          tokensPerSecond: 42.25,
        }}
      />,
    );

    expect(html).toContain("GLM 5.2");
    expect(html).toContain("42.3 tok/s");
    expect(html).toContain("est. cost $0.0025");
  });

  test("derives tokens per second from message metadata and renders response timeline", () => {
    const html = renderToStaticMarkup(
      <MessageModelPill
        metadata={
          {
            selectedModelId: "fireworks/zai/glm-5.2",
            modelId: "fireworks/zai/glm-5.2",
            totalMessageCost: 0.04,
            totalMessageUsage: {
              inputTokens: 1000,
              inputTokenDetails: {
                cacheReadTokens: undefined,
                cacheWriteTokens: undefined,
                noCacheTokens: undefined,
              },
              outputTokens: 500,
              outputTokenDetails: {
                reasoningTokens: undefined,
                textTokens: undefined,
              },
              totalTokens: 1500,
            },
            responseInferenceDurationMs: 25_000,
            responseTimeline: {
              finishedAt: "2026-06-22T15:10:08.819Z",
              segments: [
                {
                  category: "database",
                  durationMs: 1000,
                  finishedAt: "2026-06-22T15:09:30.471Z",
                  id: "timeline:database",
                  label: "Database",
                  startedAt: "2026-06-22T15:09:29.471Z",
                },
                {
                  category: "inference",
                  durationMs: 25_000,
                  finishedAt: "2026-06-22T15:09:55.471Z",
                  id: "timeline:inference",
                  label: "Model step 1",
                  startedAt: "2026-06-22T15:09:30.471Z",
                },
              ],
              startedAt: "2026-06-22T15:09:29.471Z",
              status: "completed",
              totalDurationMs: 26_000,
              workflowRunId: "run-1",
            },
          } satisfies WebAgentMessageMetadata
        }
        modelOptions={modelOptions}
        responseStats={{
          costSource: "estimate",
          costUsd: 0.04,
          tokensPerSecond: null,
        }}
      />,
    );

    expect(html).toContain("GLM 5.2");
    expect(html).toContain("20 tok/s");
    expect(html).toContain("est. cost $0.04");
    expect(html).toContain("Response timeline");
    expect(html).toContain("h-5 w-28");
    expect(html).toContain("bg-emerald-400/80");
  });

  test("estimates response cost from usage metadata when gateway cost is missing", () => {
    const html = renderToStaticMarkup(
      <MessageModelPill
        metadata={
          {
            selectedModelId: "fireworks/zai/glm-5.2",
            modelId: "fireworks/zai/glm-5.2",
            totalMessageUsage: {
              inputTokens: 1000,
              inputTokenDetails: {
                cacheReadTokens: undefined,
                cacheWriteTokens: undefined,
                noCacheTokens: undefined,
              },
              outputTokens: 500,
              outputTokenDetails: {
                reasoningTokens: undefined,
                textTokens: undefined,
              },
              totalTokens: 1500,
            },
          } satisfies WebAgentMessageMetadata
        }
        modelOptions={modelOptions}
      />,
    );

    expect(html).toContain("GLM 5.2");
    expect(html).toContain("est. cost $0.0035");
  });
});
