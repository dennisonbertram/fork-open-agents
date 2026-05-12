import { describe, expect, test } from "bun:test";
import { classifyVerifiedBuildTask } from "./task-classifier";

function messages(text: string) {
  return [{ role: "user", parts: [{ type: "text", text }] }];
}

describe("verified build task classifier", () => {
  test("routes mutating software work to Verified Build", () => {
    expect(
      classifyVerifiedBuildTask(messages("Fix the failing tests")).mode,
    ).toBe("verified_build");
    expect(
      classifyVerifiedBuildTask(messages("Implement auth provider migration"))
        .mode,
    ).toBe("verified_build");
  });

  test("keeps strategy-only prompts in chat", () => {
    expect(
      classifyVerifiedBuildTask(
        messages("Explain the deployment strategy only"),
      ).mode,
    ).toBe("chat");
  });

  test("classifies read-only debugging as investigation", () => {
    expect(
      classifyVerifiedBuildTask(messages("Look into why CI is slow")).mode,
    ).toBe("investigation");
  });
});
