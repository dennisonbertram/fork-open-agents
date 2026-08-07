import { describe, expect, mock, test } from "bun:test";
import { resolveStepAgentModels } from "./resolve-step-agent-models";

/**
 * Stands in for `resolveInferenceProfileModelSelection`, which strips the
 * internal `user-profile:<profileId>:` prefix so a provider only ever sees a
 * real model id.
 */
function fakeResolver() {
  return mock(
    async (params: {
      userId: string;
      inferenceProfileId: string | null;
      selection: { id: string };
    }) => {
      const id = params.selection.id.startsWith("user-profile:")
        ? params.selection.id.split(":").slice(2).join(":")
        : params.selection.id;
      return { ...params.selection, id };
    },
  );
}

const BASE = {
  userId: "user-1",
  inferenceProfileId: "profile-1",
};

describe("resolveStepAgentModels", () => {
  test("resolves the main model through the inference profile", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      ...BASE,
      agentOptions: { model: { id: "user-profile:profile-1:gpt-oss-120b" } },
      resolve,
    });

    expect((resolved.model as { id: string }).id).toBe("gpt-oss-120b");
  });

  // The reported failure: every delegated worker call died with
  // `Model 'user-profile:mw51n3rR9QQZqf6Boe42i:gemma-4-31b' not found`, because
  // only the main model was resolved and the subagent model reached the
  // provider as the raw internal composite id.
  test("resolves the subagent model through the inference profile too", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      ...BASE,
      agentOptions: {
        model: { id: "user-profile:profile-1:gpt-oss-120b" },
        subagentModel: { id: "user-profile:profile-1:gemma-4-31b" },
      },
      resolve,
    });

    expect((resolved.subagentModel as { id: string }).id).toBe("gemma-4-31b");
  });

  test("never lets an internal composite id reach a provider", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      ...BASE,
      agentOptions: {
        model: { id: "user-profile:profile-1:gpt-oss-120b" },
        subagentModel: { id: "user-profile:profile-1:gemma-4-31b" },
      },
      resolve,
    });

    expect(JSON.stringify(resolved)).not.toContain("user-profile:");
  });

  test("leaves options untouched when there is no inference profile", async () => {
    const resolve = fakeResolver();
    const agentOptions = {
      model: { id: "anthropic/claude-haiku-4.5" },
      subagentModel: { id: "anthropic/claude-haiku-4.5" },
    };
    const resolved = await resolveStepAgentModels({
      ...BASE,
      inferenceProfileId: null,
      agentOptions,
      resolve,
    });

    expect(resolved).toBe(agentOptions);
    expect(resolve).not.toHaveBeenCalled();
  });

  test("leaves a missing subagent model absent rather than inventing one", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      ...BASE,
      agentOptions: { model: { id: "user-profile:profile-1:gpt-oss-120b" } },
      resolve,
    });

    expect("subagentModel" in resolved).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test("accepts a bare string model id", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      ...BASE,
      agentOptions: {
        model: "user-profile:profile-1:gpt-oss-120b",
        subagentModel: "user-profile:profile-1:gemma-4-31b",
      },
      resolve,
    });

    expect((resolved.model as unknown as { id: string }).id).toBe(
      "gpt-oss-120b",
    );
    expect((resolved.subagentModel as unknown as { id: string }).id).toBe(
      "gemma-4-31b",
    );
  });
});
