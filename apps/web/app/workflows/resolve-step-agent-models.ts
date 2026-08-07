import type {
  AgentModelSelection,
  OpenAgentCallOptions,
} from "@open-agents/agent";

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

  if (!(inferenceProfileId && agentOptions.model)) {
    return agentOptions;
  }

  const toSelection = (model: NonNullable<TOptions["model"]>) =>
    typeof model === "string"
      ? ({ id: model } as AgentModelSelection)
      : (model as AgentModelSelection);

  const resolved = {
    ...agentOptions,
    model: await resolve({
      userId,
      inferenceProfileId,
      selection: toSelection(agentOptions.model),
    }),
  };

  // Only when the caller actually set one — a subagent model absent from the
  // options means "inherit the main model", and materializing a key here would
  // turn that into an explicit override.
  if (agentOptions.subagentModel) {
    resolved.subagentModel = await resolve({
      userId,
      inferenceProfileId,
      selection: toSelection(agentOptions.subagentModel),
    });
  }

  return resolved;
}
