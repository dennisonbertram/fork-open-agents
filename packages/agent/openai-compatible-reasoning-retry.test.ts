/**
 * Pins the fix for the wire format that made a whole chat unusable in
 * production (session T-5pWV3Bz4C_QITlSyPFn, model gpt-oss-120b on
 * https://api.cerebras.ai/v1): once any turn produced reasoning, every later
 * turn failed with HTTP 400 because `@ai-sdk/openai-compatible` serializes
 * prior assistant reasoning as `reasoning_content`, and Cerebras rejects that
 * field *by name* — it accepts the same reasoning under `reasoning`.
 *
 * Like the sibling `openai-compatible-reasoning-wire.test.ts`, these tests
 * observe the actual request bodies against a local server rather than reading
 * the provider's source, and they drive the real production entry point
 * (`directOpenAIModel`) so the wiring is proven along with the behavior.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { generateText, type ModelMessage } from "ai";
import { directOpenAIModel } from "./models";

type WireMessage = Record<string, unknown>;
type WireBody = { messages?: WireMessage[] };

const REASONING_TEXT = "internal chain of thought";

// The real 400 body, from vercel/ai#15042, reproduced on gpt-oss-120b.
const CEREBRAS_REJECTION = {
  code: "wrong_api_format",
  message:
    "messages.3.assistant.reasoning_content: property " +
    "'messages.3.assistant.reasoning_content' is unsupported",
};

// The mirror image: an endpoint on the same base URL that wants the default.
const REASONING_REJECTION = {
  code: "wrong_api_format",
  message:
    "messages.3.assistant.reasoning: property " +
    "'messages.3.assistant.reasoning' is unsupported",
};

const HISTORY_WITH_REASONING: ModelMessage[] = [
  { role: "user", content: "hi" },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: REASONING_TEXT },
      { type: "text", text: "hello" },
    ],
  },
  { role: "user", content: "continue" },
];

const HISTORY_WITHOUT_REASONING: ModelMessage[] = [
  { role: "user", content: "hi" },
  { role: "assistant", content: [{ type: "text", text: "hello" }] },
  { role: "user", content: "continue" },
];

function completionResponse(): Response {
  return Response.json({
    id: "cmpl-test",
    object: "chat.completion",
    created: 0,
    model: "mock-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

function startServer(respond: (body: WireBody) => Response) {
  const requests: WireBody[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as WireBody;
      requests.push(body);
      return respond(body);
    },
  });
  servers.push(server);

  return { requests, baseURL: `http://localhost:${server.port}/v1` };
}

/** Stands in for Cerebras: rejects `reasoning_content`, accepts `reasoning`. */
function rejectsReasoningContent(body: WireBody): Response {
  const offends = (body.messages ?? []).some(
    (message) => message.reasoning_content !== undefined,
  );

  return offends
    ? Response.json(CEREBRAS_REJECTION, { status: 400 })
    : completionResponse();
}

async function generate(baseURL: string, messages: ModelMessage[]) {
  return generateText({
    model: directOpenAIModel({
      provider: "openai-compatible",
      modelId: "mock-model",
      apiKey: "test-key",
      baseURL,
    }),
    messages,
    maxRetries: 0,
  });
}

function assistantOf(body: WireBody | undefined): WireMessage {
  const assistant = (body?.messages ?? []).find(
    (message) => message.role === "assistant",
  );
  expect(assistant).toBeDefined();
  return assistant as WireMessage;
}

describe("openai-compatible reasoning serialization", () => {
  test("keeps sending reasoning_content by default", async () => {
    const { requests, baseURL } = startServer(() => completionResponse());

    await generate(baseURL, HISTORY_WITH_REASONING);

    expect(requests).toHaveLength(1);
    const assistant = assistantOf(requests[0]);
    expect(assistant.reasoning_content).toBe(REASONING_TEXT);
    expect(assistant).not.toHaveProperty("reasoning");
  });

  test("retries once with `reasoning` when the endpoint rejects reasoning_content", async () => {
    const { requests, baseURL } = startServer(rejectsReasoningContent);

    const result = await generate(baseURL, HISTORY_WITH_REASONING);

    expect(result.text).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(assistantOf(requests[0]).reasoning_content).toBe(REASONING_TEXT);
    expect(assistantOf(requests[1])).not.toHaveProperty("reasoning_content");
  });

  test("preserves the reasoning text on the retried request", async () => {
    const { requests, baseURL } = startServer(rejectsReasoningContent);

    await generate(baseURL, HISTORY_WITH_REASONING);

    const retried = assistantOf(requests[1]);
    expect(retried.reasoning).toBe(REASONING_TEXT);
    expect(retried.content).toBe("hello");
  });

  test("does not retry a 400 that names no unsupported property", async () => {
    const { requests, baseURL } = startServer(() =>
      Response.json(
        {
          error: { message: "model `mock-model` not found", type: "not_found" },
        },
        { status: 400 },
      ),
    );

    await expect(generate(baseURL, HISTORY_WITH_REASONING)).rejects.toThrow();

    expect(requests).toHaveLength(1);
  });

  test("reuses the adapted serialization on the next call to the same endpoint", async () => {
    const { requests, baseURL } = startServer(rejectsReasoningContent);

    await generate(baseURL, HISTORY_WITH_REASONING);
    expect(requests).toHaveLength(2);

    await generate(baseURL, HISTORY_WITH_REASONING);

    expect(requests).toHaveLength(3);
    expect(assistantOf(requests[2]).reasoning).toBe(REASONING_TEXT);
    expect(assistantOf(requests[2])).not.toHaveProperty("reasoning_content");
  });

  test("leaves a request with no reasoning untouched on both paths", async () => {
    const fresh = startServer(rejectsReasoningContent);

    await generate(fresh.baseURL, HISTORY_WITHOUT_REASONING);
    expect(fresh.requests).toHaveLength(1);
    expect(assistantOf(fresh.requests[0])).not.toHaveProperty("reasoning");
    expect(assistantOf(fresh.requests[0])).not.toHaveProperty(
      "reasoning_content",
    );

    // Now teach the endpoint, then send a reasoning-free history again.
    await generate(fresh.baseURL, HISTORY_WITH_REASONING);
    expect(fresh.requests).toHaveLength(3);

    await generate(fresh.baseURL, HISTORY_WITHOUT_REASONING);
    expect(fresh.requests).toHaveLength(4);
    expect(assistantOf(fresh.requests[3])).not.toHaveProperty("reasoning");
    expect(assistantOf(fresh.requests[3])).not.toHaveProperty(
      "reasoning_content",
    );
  });

  test("falls back and unlearns when the adapted serialization is rejected", async () => {
    // One base URL, two models: the first wants `reasoning`, the second wants
    // `reasoning_content` back. Learning from the first must not break the
    // second.
    let rejects: "reasoning_content" | "reasoning" = "reasoning_content";
    const { requests, baseURL } = startServer((body) => {
      const offends = (body.messages ?? []).some(
        (message) => message[rejects] !== undefined,
      );
      if (!offends) {
        return completionResponse();
      }

      return Response.json(
        rejects === "reasoning_content"
          ? CEREBRAS_REJECTION
          : REASONING_REJECTION,
        { status: 400 },
      );
    });

    await generate(baseURL, HISTORY_WITH_REASONING);
    expect(requests).toHaveLength(2);

    rejects = "reasoning";
    const result = await generate(baseURL, HISTORY_WITH_REASONING);

    // Adapted attempt is rejected, then the default serialization succeeds.
    expect(result.text).toBe("ok");
    expect(requests).toHaveLength(4);
    expect(assistantOf(requests[2]).reasoning).toBe(REASONING_TEXT);
    expect(assistantOf(requests[3]).reasoning_content).toBe(REASONING_TEXT);

    // Unlearned: the next call starts from the default again.
    await generate(baseURL, HISTORY_WITH_REASONING);
    expect(requests).toHaveLength(5);
    expect(assistantOf(requests[4]).reasoning_content).toBe(REASONING_TEXT);
  });

  test("surfaces the original error and stops when the retry also fails", async () => {
    let attempts = 0;
    const { requests, baseURL } = startServer(() => {
      attempts += 1;
      return attempts === 1
        ? Response.json(CEREBRAS_REJECTION, { status: 400 })
        : Response.json(
            { error: { message: "second failure", type: "invalid_request" } },
            { status: 400 },
          );
    });

    const error = (await generate(baseURL, HISTORY_WITH_REASONING).catch(
      (caught: unknown) => caught,
    )) as { responseBody?: string };

    // Exactly one retry, and the caller sees the ORIGINAL provider complaint.
    expect(requests).toHaveLength(2);
    expect(error.responseBody).toContain("reasoning_content");
    expect(error.responseBody).not.toContain("second failure");
  });
});
