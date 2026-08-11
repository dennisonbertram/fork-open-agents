import { toAnthropicDirectModelId } from "@open-agents/agent";
import { parseModelOptionSelection } from "@/lib/inference/model-option-id";

/**
 * Whether a selected model is actually served by an inference profile.
 *
 * Lives here rather than inline in the workflow so it can be exercised
 * directly: this is a refusal guard, and a test that reimplements the
 * comparison locally stays green when the production copy is deleted or fed
 * the wrong value.
 */
export function isModelServedByProfile(params: {
  /**
   * The selected model id. May still be a
   * `user-profile:<profileId>:<modelId>` composite — a legacy chat carries one
   * whenever its `model_id` was never split — so the bare id is compared
   * against the profile's own list, which holds bare ids. Comparing the
   * composite matches nothing and refuses a model the profile does serve.
   */
  selectionId: string;
  profile: {
    provider: string;
    models?: { id: string }[] | null;
  };
}): boolean {
  const bareModelId = parseModelOptionSelection(params.selectionId).modelId;

  if ((params.profile.models ?? []).some((model) => model.id === bareModelId)) {
    return true;
  }

  // Fallback for an Anthropic profile that has not discovered its model list
  // yet: an Anthropic catalog id is served by definition. Gated on the
  // provider — without that gate, any `anthropic/...` id reads as available on
  // an OpenAI-compatible profile that never advertised it, and the
  // unadvertised id is then sent to that endpoint instead of being refused
  // here with the intended availability error.
  return (
    params.profile.provider === "anthropic" &&
    Boolean(toAnthropicDirectModelId(bareModelId))
  );
}
