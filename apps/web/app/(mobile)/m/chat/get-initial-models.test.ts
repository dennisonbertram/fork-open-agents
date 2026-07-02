import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AvailableModel } from "@/lib/models";

// The mobile chat page shares the same `getInitialModels` helper as the
// desktop chat page (apps/web/app/sessions/[sessionId]/chats/[chatId]/
// get-initial-models.ts) — there is no behavior divergence between the two
// surfaces, only the `surface` field passed into the context for logging.
// This file mirrors the desktop coverage to guard the mobile call site.

type FetchImpl = () => Promise<AvailableModel[]>;

let fetchImpl: FetchImpl = () => Promise.resolve([]);

mock.module("@/lib/models-with-context", () => ({
  fetchAvailableLanguageModelsWithContext: () => fetchImpl(),
}));

const { getInitialModels } = await import(
  "../../sessions/[sessionId]/chats/[chatId]/get-initial-models"
);

describe("getInitialModels (mobile surface)", () => {
  const context = {
    sessionId: "session-1",
    chatId: "chat-1",
    surface: "mobile" as const,
  };
  let originalWarn: typeof console.warn;
  let originalInfo: typeof console.info;

  beforeEach(() => {
    originalWarn = console.warn;
    originalInfo = console.info;
    console.warn = mock(() => undefined);
    console.info = mock(() => undefined);
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.info = originalInfo;
  });

  test("returns errorKind fetch_failed when the fetch throws", async () => {
    fetchImpl = () => Promise.reject(new Error("gateway 503"));

    const result = await getInitialModels(context);

    expect(result).toEqual({ models: [], errorKind: "fetch_failed" });
  });

  test("returns errorKind null with empty models when the fetch resolves to []", async () => {
    fetchImpl = () => Promise.resolve([]);

    const result = await getInitialModels(context);

    expect(result).toEqual({ models: [], errorKind: null });
  });
});
