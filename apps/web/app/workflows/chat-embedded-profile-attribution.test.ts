import { describe, expect, test } from "bun:test";
import { parseModelOptionSelection } from "@/lib/inference/model-option-id";

/**
 * Attribution for a chat whose `modelId` is still a composite.
 *
 * `resolveChatModelRuntime` derives `inferenceProfileId` to decide whether a
 * run is reported as `inferenceRoute: "gateway"` or `"user"`. It used to read
 * only the chat/session/preference columns. A chat whose `model_id` is still a
 * `user-profile:<profileId>:<modelId>` composite with a NULL
 * `inference_profile_id` therefore resolved to no profile and was attributed to
 * the gateway — while `resolveStepAgentModels` recovered the embedded profile
 * and actually routed the call through the user's own endpoint.
 *
 * The consequence is not a broken run; it is silently wrong cost attribution in
 * message metadata, workflow events, and operator diagnostics: a BYOK call
 * booked as a platform one. This pins the precedence the workflow now uses.
 */
function resolveAttributionProfileId(input: {
  chatModelId: string | null;
  chatInferenceProfileId: string | null;
  sessionInferenceProfileId: string | null;
  preferenceInferenceProfileId: string | null;
}): string | null {
  const embedded = parseModelOptionSelection(
    input.chatModelId ?? "",
  ).inferenceProfileId;
  return (
    input.chatInferenceProfileId ??
    embedded ??
    input.sessionInferenceProfileId ??
    input.preferenceInferenceProfileId ??
    null
  );
}

describe("inference attribution for a composite chat model id", () => {
  test("recovers the profile embedded in the model id when the column is null", () => {
    expect(
      resolveAttributionProfileId({
        chatModelId: "user-profile:profile-1:gemma-4-31b",
        chatInferenceProfileId: null,
        sessionInferenceProfileId: null,
        preferenceInferenceProfileId: null,
      }),
    ).toBe("profile-1");
  });

  test("an explicit column still wins over the embedded profile", () => {
    expect(
      resolveAttributionProfileId({
        chatModelId: "user-profile:profile-embedded:gemma-4-31b",
        chatInferenceProfileId: "profile-column",
        sessionInferenceProfileId: null,
        preferenceInferenceProfileId: null,
      }),
    ).toBe("profile-column");
  });

  test("a plain gateway model id attributes to no profile", () => {
    expect(
      resolveAttributionProfileId({
        chatModelId: "openai/gpt-5.4",
        chatInferenceProfileId: null,
        sessionInferenceProfileId: null,
        preferenceInferenceProfileId: null,
      }),
    ).toBeNull();
  });

  test("falls through to session then preference when nothing is embedded", () => {
    expect(
      resolveAttributionProfileId({
        chatModelId: "openai/gpt-5.4",
        chatInferenceProfileId: null,
        sessionInferenceProfileId: "profile-session",
        preferenceInferenceProfileId: "profile-pref",
      }),
    ).toBe("profile-session");
  });

  test("tolerates a missing model id", () => {
    expect(
      resolveAttributionProfileId({
        chatModelId: null,
        chatInferenceProfileId: null,
        sessionInferenceProfileId: null,
        preferenceInferenceProfileId: "profile-pref",
      }),
    ).toBe("profile-pref");
  });
});
