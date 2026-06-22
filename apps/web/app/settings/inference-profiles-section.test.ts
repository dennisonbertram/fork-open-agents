import { describe, expect, test } from "bun:test";

import { CURSOR_OPENAI_COMPATIBLE_BASE_URL } from "@/lib/inference/profile-models";
import { createCursorInferenceProfileDraft } from "./inference-profiles-section";

describe("createCursorInferenceProfileDraft", () => {
  test("fills a new Cursor OpenAI-compatible profile draft", () => {
    expect(createCursorInferenceProfileDraft("")).toEqual({
      provider: "openai-compatible",
      name: "Cursor",
      baseUrl: CURSOR_OPENAI_COMPATIBLE_BASE_URL,
      modelIds: "composer-2.5\ncomposer-2.5-fast",
    });
  });

  test("does not overwrite an existing profile name", () => {
    expect(createCursorInferenceProfileDraft("My Cursor Proxy")).toEqual({
      provider: "openai-compatible",
      name: null,
      baseUrl: CURSOR_OPENAI_COMPATIBLE_BASE_URL,
      modelIds: "composer-2.5\ncomposer-2.5-fast",
    });
  });
});
