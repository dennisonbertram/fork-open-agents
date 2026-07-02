/**
 * Re-exports from the shared agent-spec module.
 *
 * The settings form was the original home of this logic. It has been extracted
 * into apps/web/lib/background-agents/agent-spec.ts so the repo-dashboard
 * creation flow can reuse it. This file re-exports everything so that existing
 * imports from the settings page and its tests continue to work unchanged.
 */
export {
  buildAgentPayload,
  buildFormFromAgent,
  buildRepoScopedDefaultForm,
  conditionFieldLabel,
  defaultForm,
  fieldsForTrigger,
  flowSteps,
  isStepValid,
  triggerLabels,
} from "@/lib/background-agents/agent-spec";

export type {
  BackgroundAgent,
  BackgroundAgentTrigger,
  ConditionField,
  FormState,
  GitHubAccessLevel,
  GithubActions,
  StepId,
  TriggerConditions,
  TriggerKind,
  WriteScope,
} from "@/lib/background-agents/agent-spec";
