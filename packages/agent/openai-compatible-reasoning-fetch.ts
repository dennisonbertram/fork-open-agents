/**
 * `@ai-sdk/openai-compatible` serializes prior assistant reasoning back onto
 * the request as a `reasoning_content` string field. Most OpenAI-compatible
 * endpoints (DeepSeek among them) accept that. Cerebras rejects it *by name* —
 * it wants the same reasoning under `reasoning` — so every turn after the first
 * one that produced reasoning failed with HTTP 400.
 *
 * Upstream fixed this with an `assistantReasoningSerialization` option, but
 * only in the dedicated `@ai-sdk/cerebras` package (vercel/ai#15416). We build
 * models with the generic `createOpenAICompatible`, which has no such option in
 * 2.0.51, but does accept a custom `fetch` its own typings describe as
 * "middleware to intercept requests".
 *
 * So: keep `reasoning_content` as the default, and when an endpoint complains
 * about it by name, rename the field and send the request again — once. The
 * reasoning text is preserved; nothing is dropped. Which endpoints need the
 * rename is learned from their own error body rather than from a hostname list.
 */

const REASONING_CONTENT = "reasoning_content";
const REASONING = "reasoning";

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

/**
 * Endpoints observed to reject `reasoning_content`, keyed by base URL.
 *
 * ponytail: in-process only. The quirk belongs to the endpoint, not to a user's
 * profile row, so this needs no migration and no per-user state; the cost of a
 * cold process is one extra failed request per endpoint, which is exactly what
 * the retry below already handles. Move it to a column on `inference_profiles`
 * only if that first request per process ever becomes a real problem.
 */
const endpointsRejectingReasoningContent = new Set<string>();

/**
 * Pull the offending property out of the provider's own complaint, e.g.
 * `messages.3.assistant.reasoning_content: property
 * 'messages.3.assistant.reasoning_content' is unsupported` -> `reasoning_content`.
 */
function unsupportedProperty(responseBody: string): string | undefined {
  const match = responseBody.match(/property ['"]([^'"]+)['"] is unsupported/);

  return match?.[1]?.split(".").pop();
}

/**
 * Rewrite assistant `reasoning_content` fields to `reasoning`, preserving the
 * text. Returns undefined when there is nothing to rename, so callers can tell
 * "adapted" from "no reasoning in this request".
 */
function withRenamedReasoning(init: FetchInit): FetchInit | undefined {
  if (typeof init?.body !== "string") {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(init.body);
  } catch {
    return undefined;
  }

  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return undefined;
  }

  let renamed = false;
  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      continue;
    }

    const assistant = message as Record<string, unknown>;
    if (
      assistant.role !== "assistant" ||
      typeof assistant[REASONING_CONTENT] !== "string"
    ) {
      continue;
    }

    assistant[REASONING] = assistant[REASONING_CONTENT];
    delete assistant[REASONING_CONTENT];
    renamed = true;
  }

  return renamed ? { ...init, body: JSON.stringify(payload) } : undefined;
}

export function createReasoningCompatibleFetch(
  baseURL: string,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  const adaptingFetch = async (
    input: FetchInput,
    init?: FetchInit,
  ): Promise<Response> => {
    if (endpointsRejectingReasoningContent.has(baseURL)) {
      // Already learned: adapt up front and never retry, so we cannot loop.
      return baseFetch(input, withRenamedReasoning(init) ?? init);
    }

    const response = await baseFetch(input, init);
    if (response.status !== 400) {
      return response;
    }

    const responseBody = await response.clone().text();
    if (unsupportedProperty(responseBody) !== REASONING_CONTENT) {
      return response;
    }

    const adapted = withRenamedReasoning(init);
    if (!adapted) {
      return response;
    }

    const retried = await baseFetch(input, adapted);
    if (!retried.ok) {
      // The rename was not the answer. Surface the original complaint and do
      // not remember a serialization that did not work.
      return response;
    }

    endpointsRejectingReasoningContent.add(baseURL);
    return retried;
  };

  // Bun's `fetch` type carries a `preconnect` helper. Keep it so the wrapper
  // stays a drop-in replacement for the runtime's own fetch.
  return Object.assign(adaptingFetch, { preconnect: baseFetch.preconnect });
}
