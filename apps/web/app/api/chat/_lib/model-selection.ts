import {
  type AgentModelSelection,
  toProviderModelId,
} from "@open-agents/agent";
import { USER_INFERENCE_OPTION_PREFIX } from "@/lib/inference/model-option-id";
import { resolveAvailableModelId } from "@/lib/model-availability";
import { type ModelVariant, resolveModelSelection } from "@/lib/model-variants";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";

interface ResolveChatModelSelectionParams {
  selectedModelId: string | null | undefined;
  modelVariants: ModelVariant[];
  missingVariantLabel: string;
}

export function resolveChatModelSelection({
  selectedModelId,
  modelVariants,
  missingVariantLabel,
}: ResolveChatModelSelectionParams): AgentModelSelection {
  const requestedModelId = selectedModelId ?? APP_DEFAULT_MODEL_ID;
  const selection = resolveModelSelection(requestedModelId, modelVariants);

  if (selection.isMissingVariant) {
    console.warn(
      `${missingVariantLabel} "${requestedModelId}" was not found. Falling back to default model.`,
    );
    return { id: toProviderModelId(APP_DEFAULT_MODEL_ID) };
  }

  // A "user-profile:<profileId>:<modelId>" composite carries its OWN
  // inference profile and must be resolved on its own terms later by
  // resolveStepAgentModels — passing the session's profile there would route a
  // profile-B model at profile-A's endpoint. So this function must never mint
  // a composite: toProviderModelId() throws UnresolvedCompositeModelIdError on
  // one, and parsing it here just to mint the model half would strip the
  // "user-profile:" prefix that downstream resolution keys on, silently
  // routing a BYOK model through the platform gateway.
  //
  // Keyed on the PREFIX, not on a successful parse: a malformed composite
  // ("user-profile:" with nothing after it) parses back to itself, and keying
  // on the parse would send that straight to the mint to throw again.
  const isComposite = selection.resolvedModelId.startsWith(
    USER_INFERENCE_OPTION_PREFIX,
  );

  // Deliberately NOT applying the availability guard to a composite. That
  // guard encodes which models the PLATFORM GATEWAY refuses to serve; a user's
  // own OpenAI-compatible endpoint may legitimately serve a model whose id
  // happens to match (OpenRouter and LiteLLM both namespace ids as
  // "openai/gpt-...", and user-profile options never go through
  // filterDisabledModels). Substituting the gateway default here would run a
  // BYOK subagent on the platform key while the coordinator ran on the user's
  // — quiet mis-billing in place of the loud failure this fix removed.
  if (isComposite) {
    return {
      // toProviderModelId() has no legal way to mint a still-composite id (by
      // design — see its ABSOLUTE RULE comment), so there is no cast-free way
      // to type this branch while `.id` is still "user-profile:...". This is
      // the same escape hatch the codebase's own tests use to construct a
      // deliberately still-composite selection, and it is safe for the same
      // reason: the value never reaches a provider unresolved.
      // resolveStepAgentModels parses the prefix and mints the real id, and if
      // that were ever skipped, openAgent's prepareCall re-runs
      // toProviderModelId() as a runtime backstop and throws rather than
      // silently calling a provider with it.
      id: selection.resolvedModelId as never,
      ...(selection.providerOptionsByProvider
        ? { providerOptionsOverrides: selection.providerOptionsByProvider }
        : {}),
    };
  }

  const availableModelId = resolveAvailableModelId(selection.resolvedModelId);
  if (availableModelId !== selection.resolvedModelId) {
    console.warn(
      `${missingVariantLabel} "${requestedModelId}" resolves to disabled model "${selection.resolvedModelId}". Falling back to default model.`,
    );
    return { id: toProviderModelId(APP_DEFAULT_MODEL_ID) };
  }

  return {
    id: toProviderModelId(availableModelId),
    ...(selection.providerOptionsByProvider
      ? { providerOptionsOverrides: selection.providerOptionsByProvider }
      : {}),
  };
}
