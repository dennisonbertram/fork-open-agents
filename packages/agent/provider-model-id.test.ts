import { describe, expect, test } from "bun:test";
import { toProviderModelId } from "./provider-model-id";

/**
 * #1155 finding 1 (P2): toProviderModelId() used to accept every `string`
 * and validate nothing, so it could mint an unresolved internal composite
 * (`user-profile:<profileId>:<modelId>`, see model-option-id.ts) as if it
 * were already provider-bound. That turned the brand into a no-op wrapper —
 * it required call sites to apply it, but never actually rejected the shape
 * it exists to keep out. These tests pin the mint down as a real boundary.
 */
describe("toProviderModelId", () => {
  test("throws when handed an unresolved internal composite id, and names the offending id", () => {
    expect(() => toProviderModelId("user-profile:p:m")).toThrow(
      /user-profile:p:m/,
    );
  });

  test("the thrown error says the id must be parsed first", () => {
    expect(() => toProviderModelId("user-profile:p:m")).toThrow(/parse/i);
  });

  test("returns a real provider model id unchanged", () => {
    expect(toProviderModelId("zai-glm-4.7")).toBe(
      toProviderModelId("zai-glm-4.7"),
    );
    expect(toProviderModelId("zai-glm-4.7") as string).toBe("zai-glm-4.7");
  });

  test("returns a gateway-style provider/model id unchanged", () => {
    expect(toProviderModelId("anthropic/claude-opus-4.6") as string).toBe(
      "anthropic/claude-opus-4.6",
    );
  });
});
