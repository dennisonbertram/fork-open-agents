import type {
  AgentModelSelection,
  OpenAgentCallOptions,
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
}): Promise<TOptions> {
  const { agentOptions, inferenceProfileId, resolve, userId } = params;

  const toSelection = (model: NonNullable<TOptions["model"]>) =>
    typeof model === "string"
      ? ({ id: model } as AgentModelSelection)
      : (model as AgentModelSelection);

  const optionId = (model: NonNullable<TOptions["model"]>) =>
    typeof model === "string"
      ? model
      : ((model as AgentModelSelection).id ?? "");

  const resolveMain = Boolean(inferenceProfileId && agentOptions.model);

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
  if (resolveSubagent && agentOptions.subagentModel) {
    resolved.subagentModel = (await resolve({
      userId,
      inferenceProfileId: null,
      selection: toSelection(
        agentOptions.subagentModel as NonNullable<TOptions["model"]>,
      ),
    })) as TOptions["subagentModel"];
  }

  return resolved;
}
