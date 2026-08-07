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

  // REG-003b/REG-003c (resolve-agent.regression.test.ts) already establish that
  // the subagent default carries its own profile and never inherits the main
  // model's. These assert the same at the step-resolution boundary.
  test("resolves the subagent against its OWN profile, not the main model's", async () => {
    const resolve = fakeResolver();
    await resolveStepAgentModels({
      userId: "user-1",
      inferenceProfileId: "profile-a",
      agentOptions: {
        model: { id: "user-profile:profile-a:gpt-oss-120b" },
        subagentModel: { id: "user-profile:profile-b:sub-model" },
      },
      resolve,
    });

    const calls = resolve.mock.calls.map((c) => c[0]);
    const subagentCall = calls.find((c) =>
      c.selection.id.includes("sub-model"),
    );
    // null lets the resolver derive profile-b from the composite itself;
    // passing profile-a would route a profile-b model at profile-a's endpoint.
    expect(subagentCall?.inferenceProfileId).toBeNull();
  });

  test("must stay green: a plain gateway subagent is not pulled onto the main profile", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      userId: "user-1",
      inferenceProfileId: "profile-a",
      agentOptions: {
        model: { id: "user-profile:profile-a:gpt-oss-120b" },
        subagentModel: { id: "anthropic/claude-haiku-4.5" },
      },
      resolve,
    });

    // Untouched: routing it through profile-a would call that custom endpoint
    // with a model it does not serve, breaking delegation that worked before.
    expect(resolved.subagentModel).toEqual({
      id: "anthropic/claude-haiku-4.5",
    });
    expect(
      resolve.mock.calls.some((c) => c[0].selection.id.includes("anthropic/")),
    ).toBe(false);
  });

  // The mirror of the reported bug: a gateway main model with a profile-backed
  // subagent. An early return keyed on the MAIN model's profile would leave the
  // composite unresolved and send it straight to the provider.
  test("resolves a profile-backed subagent even when the main model is on the gateway", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      userId: "user-1",
      inferenceProfileId: null,
      agentOptions: {
        model: { id: "anthropic/claude-haiku-4.5" },
        subagentModel: { id: "user-profile:profile-b:gemma-4-31b" },
      },
      resolve,
    });

    expect((resolved.subagentModel as unknown as { id: string }).id).toBe(
      "gemma-4-31b",
    );
    expect(JSON.stringify(resolved)).not.toContain("user-profile:");
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
