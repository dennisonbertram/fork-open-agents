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
  defaultForm,
  flowSteps,
  supportedOutputModes,
  triggerLabels,
} from "@/lib/background-agents/agent-spec";

export type {
  BackgroundAgent,
  BackgroundAgentTrigger,
  FormState,
  OutputMode,
  TriggerConditions,
  TriggerKind,
} from "@/lib/background-agents/agent-spec";
