import {
  type AgentModelSelection,
  type OpenAgentCallOptions,
  toProviderModelId,
} from "@open-agents/agent";
import { USER_INFERENCE_OPTION_PREFIX } from "@/lib/inference/model-option-id";

/**
 * Resolves every model selection on a step's agent options through the user's
 * inference profile, so a provider only ever receives a real model id.
 *
 * The internal option id shape is `user-profile:<profileId>:<modelId>`. The
 * main model was resolved here; the subagent model was not, so it reached the
 * provider verbatim and every delegated worker call failed with
 * `Model 'user-profile:<profileId>:gemma-4-31b' not found` while the
 * coordinator on the same profile worked fine.
 *
 * Extracted from the step body so the resolution can be tested directly rather
 * than only through a full workflow run — the gap was invisible precisely
 * because nothing asserted on the shape of what got handed to the provider.
 */
export async function resolveStepAgentModels<
  TOptions extends Pick<OpenAgentCallOptions, "model" | "subagentModel">,
>(params: {
  userId: string;
  inferenceProfileId: string | null;
  agentOptions: TOptions;
  resolve: (input: {
    userId: string;
    inferenceProfileId: string | null;
    selection: AgentModelSelection;
  }) => Promise<AgentModelSelection>;
  /** Called when the subagent model cannot be resolved. See the guard below. */
  onSubagentResolutionFailed?: (error: unknown) => void;
}): Promise<TOptions> {
  const {
    agentOptions,
    inferenceProfileId,
    onSubagentResolutionFailed,
    resolve,
    userId,
  } = params;

  const toSelection = (model: NonNullable<TOptions["model"]>) =>
    typeof model === "string"
      ? { id: toProviderModelId(model) }
      : (model as AgentModelSelection);

  const optionId = (model: NonNullable<TOptions["model"]>) =>
    typeof model === "string"
      ? model
      : ((model as AgentModelSelection).id ?? "");

  // Resolve the main model when there is a session profile OR when the id is
  // itself an internal composite. Gating solely on `inferenceProfileId` meant a
  // user whose `default_model_id` is a `user-profile:` composite, but who has
  // no profile id stored on the chat, session, or preferences, sent that
  // composite straight to the provider — every step failing with
  // `Model 'user-profile:…' not found`.
  //
  // The resolver already recovers the profile from the composite
  // (`params.inferenceProfileId || parsedSelection.inferenceProfileId`, #1123);
  // that defence simply was never reached.
  const resolveMain = Boolean(
    agentOptions.model &&
    (inferenceProfileId ||
      optionId(agentOptions.model).startsWith(USER_INFERENCE_OPTION_PREFIX)),
  );

  // The subagent default is a standalone option id that carries its own profile
  // and must never inherit the main model's (REG-003b / REG-003c in
  // resolve-agent.regression.test.ts). So it is resolved on its own terms:
  //
  // - Composite id -> resolve it, passing `null` for the profile so the resolver
  //   derives the right one from the id itself. Passing the session's profile
  //   would route a profile-B model at profile-A's endpoint.
  // - Plain gateway id -> leave it completely alone. Handing it to the resolver
  //   with the main profile would call a custom endpoint with a model it does
  //   not serve, breaking delegation that previously worked.
  //
  // This is also why the check is not gated on the MAIN model having a profile:
  // a gateway main model with a profile-backed subagent is the same bug in
  // mirror image, and an early return keyed on `inferenceProfileId` would send
  // that composite straight to the provider.
  const resolveSubagent =
    Boolean(agentOptions.subagentModel) &&
    optionId(
      agentOptions.subagentModel as NonNullable<TOptions["model"]>,
    ).startsWith(USER_INFERENCE_OPTION_PREFIX);

  if (!(resolveMain || resolveSubagent)) {
    return agentOptions;
  }

  const resolved = { ...agentOptions };

  if (resolveMain && agentOptions.model) {
    resolved.model = (await resolve({
      userId,
      inferenceProfileId,
      selection: toSelection(agentOptions.model),
    })) as TOptions["model"];
  }

  // Guarded above, so an absent subagent model stays absent — that means
  // "inherit the main model", and materializing the key would turn it into an
  // explicit override.
  //
  // A broken subagent profile must not take the coordinator down with it.
  // `default_subagent_model_id` is plain text with no foreign key
  // (schema.ts:2890) while `default_inference_profile_id` has one, so deleting
  // a profile leaves a stale `user-profile:<deletedId>:…` preference behind and
  // the resolver throws on a missing, disabled, or undecryptable profile.
  // Letting that propagate would kill every step — including coordinator turns
  // that never delegate at all — which is strictly worse than the delegation
  // failure it describes.
  //
  // So: drop the broken override and let subagents inherit the (working) main
  // model, and report it. Dropping rather than passing it through keeps the
  // internal composite id away from the provider. The cost is that a
  // misconfigured subagent model is silently substituted, which is why the
  // failure is reported rather than swallowed.
  if (resolveSubagent && agentOptions.subagentModel) {
    try {
      resolved.subagentModel = (await resolve({
        userId,
        inferenceProfileId: null,
        selection: toSelection(
          agentOptions.subagentModel as NonNullable<TOptions["model"]>,
        ),
      })) as TOptions["subagentModel"];
    } catch (error) {
      resolved.subagentModel = undefined as TOptions["subagentModel"];
      onSubagentResolutionFailed?.(error);
    }
  }

  return resolved;
}
