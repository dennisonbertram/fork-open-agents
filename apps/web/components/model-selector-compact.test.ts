import { describe, expect, test } from "bun:test";
import type { ModelOption } from "@/lib/model-options";
import { getModelOptionSecondaryText } from "./model-selector-compact";

describe("getModelOptionSecondaryText", () => {
  test("keeps provider visible for user-key models", () => {
    const option = {
      id: "user:fireworks:glm-5.2",
      isVariant: false,
      label: "GLM 5.2",
      provider: "fireworks",
      secondaryLabel: "Fireworks",
      shortLabel: "GLM 5.2",
      source: "user",
    } satisfies ModelOption;

    expect(getModelOptionSecondaryText(option)).toBe("via Fireworks");
  });

  test("keeps catalog provider labels compact", () => {
    const option = {
      id: "openai/gpt-5.5",
      isVariant: false,
      label: "GPT 5.5",
      provider: "openai",
      secondaryLabel: "OpenAI",
      shortLabel: "GPT 5.5",
      source: "catalog",
    } satisfies ModelOption;

    expect(getModelOptionSecondaryText(option)).toBe("OpenAI");
  });
});
