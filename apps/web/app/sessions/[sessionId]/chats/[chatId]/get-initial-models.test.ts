import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AvailableModel } from "@/lib/models";

type FetchImpl = () => Promise<AvailableModel[]>;

let fetchImpl: FetchImpl = () => Promise.resolve([]);

mock.module("@/lib/models-with-context", () => ({
  fetchAvailableLanguageModelsWithContext: () => fetchImpl(),
}));

const { getInitialModels } = await import("./get-initial-models");

describe("getInitialModels", () => {
  const context = {
    sessionId: "session-1",
    chatId: "chat-1",
    surface: "desktop" as const,
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

  test("returns errorKind null with the models when the fetch resolves with data", async () => {
    const models: AvailableModel[] = [{ id: "model-1", name: "Model One" }];
    fetchImpl = () => Promise.resolve(models);

    const result = await getInitialModels(context);

    expect(result).toEqual({ models, errorKind: null });
  });

  test("does not log the raw error when the fetch throws", async () => {
    fetchImpl = () => Promise.reject(new Error("secret gateway token xyz"));

    await getInitialModels(context);

    const warnCalls = (
      console.warn as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const serialized = JSON.stringify(warnCalls);
    expect(serialized).not.toContain("secret gateway token xyz");
    expect(serialized).toContain("fetch_failed");
  });
});
