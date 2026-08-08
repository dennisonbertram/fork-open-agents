import {
  type AgentModelSelection,
  toProviderModelId,
} from "@open-agents/agent";
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
      selection: AgentModelSelection;
    }): Promise<AgentModelSelection> => {
      const id = params.selection.id.startsWith("user-profile:")
        ? params.selection.id.split(":").slice(2).join(":")
        : params.selection.id;
      return { ...params.selection, id: toProviderModelId(id) };
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
      agentOptions: {
        model: { id: toProviderModelId("user-profile:profile-1:gpt-oss-120b") },
      },
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
        model: { id: toProviderModelId("user-profile:profile-1:gpt-oss-120b") },
        subagentModel: {
          id: toProviderModelId("user-profile:profile-1:gemma-4-31b"),
        },
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
        model: { id: toProviderModelId("user-profile:profile-1:gpt-oss-120b") },
        subagentModel: {
          id: toProviderModelId("user-profile:profile-1:gemma-4-31b"),
        },
      },
      resolve,
    });

    expect(JSON.stringify(resolved)).not.toContain("user-profile:");
  });

  // Production: a user whose `default_model_id` is a `user-profile:` composite
  // but who has no profile id on the chat, the session, or their preferences.
  // Every step failed with `Model 'user-profile:…:zai-glm-4.7' not found`,
  // because resolution was gated on a profile id the app did not have — even
  // though the resolver recovers the profile from the composite itself
  // (`params.inferenceProfileId || parsedSelection.inferenceProfileId`, #1123).
  test("resolves a composite MAIN model even with no profile id anywhere", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      userId: "user-1",
      inferenceProfileId: null,
      agentOptions: {
        model: { id: toProviderModelId("user-profile:profile-a:zai-glm-4.7") },
      },
      resolve,
    });

    expect((resolved.model as unknown as { id: string }).id).toBe(
      "zai-glm-4.7",
    );
    expect(JSON.stringify(resolved)).not.toContain("user-profile:");
  });

  test("leaves options untouched when there is no inference profile", async () => {
    const resolve = fakeResolver();
    const agentOptions = {
      model: { id: toProviderModelId("anthropic/claude-haiku-4.5") },
      subagentModel: { id: toProviderModelId("anthropic/claude-haiku-4.5") },
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
      agentOptions: {
        model: { id: toProviderModelId("user-profile:profile-1:gpt-oss-120b") },
      },
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
        model: { id: toProviderModelId("user-profile:profile-a:gpt-oss-120b") },
        subagentModel: {
          id: toProviderModelId("user-profile:profile-b:sub-model"),
        },
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
        model: { id: toProviderModelId("user-profile:profile-a:gpt-oss-120b") },
        subagentModel: { id: toProviderModelId("anthropic/claude-haiku-4.5") },
      },
      resolve,
    });

    // Untouched: routing it through profile-a would call that custom endpoint
    // with a model it does not serve, breaking delegation that worked before.
    expect(resolved.subagentModel).toEqual({
      id: toProviderModelId("anthropic/claude-haiku-4.5"),
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
        model: { id: toProviderModelId("anthropic/claude-haiku-4.5") },
        subagentModel: {
          id: toProviderModelId("user-profile:profile-b:gemma-4-31b"),
        },
      },
      resolve,
    });

    expect((resolved.subagentModel as unknown as { id: string }).id).toBe(
      "gemma-4-31b",
    );
    expect(JSON.stringify(resolved)).not.toContain("user-profile:");
  });

  // A broken subagent profile must not take the coordinator down with it.
  // `default_subagent_model_id` is a plain text column with no foreign key
  // (schema.ts:2890), while `default_inference_profile_id` has one — so
  // deleting a profile leaves a stale `user-profile:<deletedId>:…` preference
  // behind, and the resolver throws on a missing or disabled profile. An eager
  // await would kill every step, including coordinator turns that never
  // delegate at all.
  test("a failing subagent resolution does not break the turn", async () => {
    const resolve = mock(async (params: { selection: { id: string } }) => {
      if (params.selection.id.includes("deleted-profile")) {
        throw new Error("Selected inference profile is unavailable.");
      }
      return { id: params.selection.id.split(":").slice(2).join(":") };
    });

    const resolved = await resolveStepAgentModels({
      userId: "user-1",
      inferenceProfileId: "profile-a",
      agentOptions: {
        model: { id: toProviderModelId("user-profile:profile-a:gpt-oss-120b") },
        subagentModel: {
          id: toProviderModelId("user-profile:deleted-profile:gemma-4-31b"),
        },
      },
      resolve: resolve as never,
    });

    // Main model still resolved, so the coordinator runs.
    expect((resolved.model as unknown as { id: string }).id).toBe(
      "gpt-oss-120b",
    );
    // Broken override dropped rather than passed through: subagents inherit the
    // main model, and no internal composite id escapes to a provider.
    expect(resolved.subagentModel).toBeUndefined();
    expect(JSON.stringify(resolved)).not.toContain("user-profile:");
  });

  test("reports a failed subagent resolution instead of swallowing it", async () => {
    const failure = new Error("Selected inference profile is unavailable.");
    const resolve = mock(async (params: { selection: { id: string } }) => {
      if (params.selection.id.includes("deleted-profile")) {
        throw failure;
      }
      return { id: params.selection.id.split(":").slice(2).join(":") };
    });
    const onSubagentResolutionFailed = mock((_error: unknown) => {
      // noop
    });

    await resolveStepAgentModels({
      userId: "user-1",
      inferenceProfileId: "profile-a",
      agentOptions: {
        model: { id: toProviderModelId("user-profile:profile-a:gpt-oss-120b") },
        subagentModel: {
          id: toProviderModelId("user-profile:deleted-profile:gemma-4-31b"),
        },
      },
      resolve: resolve as never,
      onSubagentResolutionFailed,
    });

    expect(onSubagentResolutionFailed).toHaveBeenCalledTimes(1);
    expect(onSubagentResolutionFailed.mock.calls[0][0]).toBe(failure);
  });

  // Guard against over-correcting: the MAIN model failing means the session
  // genuinely cannot run, and swallowing that would replace a clear error with
  // a confusing downstream one.
  test("must stay green: a failing MAIN model resolution still throws", async () => {
    const resolve = mock(async () => {
      throw new Error("Selected inference profile is unavailable.");
    });

    await expect(
      resolveStepAgentModels({
        userId: "user-1",
        inferenceProfileId: "profile-a",
        agentOptions: {
          model: {
            id: toProviderModelId("user-profile:profile-a:gpt-oss-120b"),
          },
        },
        resolve: resolve as never,
      }),
    ).rejects.toThrow("Selected inference profile is unavailable.");
  });

  // #1155 finding 1 (P2): toProviderModelId() used to be a no-op wrapper, so
  // this string branch could mint a still-composite id directly — it
  // "type-checked" as already resolved without ever being parsed. Prove the
  // opposite directly: resolve() must receive the already-parsed model id,
  // never the raw composite. Under the pre-fix implementation this fails
  // because `call.selection.id` is still the full composite string.
  test("the string branch parses a composite id before resolve() ever sees it", async () => {
    const resolve = fakeResolver();
    const resolved = await resolveStepAgentModels({
      ...BASE,
      agentOptions: {
        model: "user-profile:profile-1:gpt-oss-120b",
      },
      resolve,
    });

    const call = resolve.mock.calls[0]?.[0] as {
      selection: { id: string };
    };
    expect(call.selection.id).toBe("gpt-oss-120b");
    expect((resolved.model as unknown as { id: string }).id).toBe(
      "gpt-oss-120b",
    );
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
