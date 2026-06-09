/**
 * agents-roster.ts — pure builder for the Settings → Agents roster.
 *
 * Stub: no implementation yet. Tests drive the shape.
 */
import type { ComposioAgentDefaults } from "@/lib/composio/types";
import type {
  ComposioToolProfileSummary,
} from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

export type AgentRosterRow = {
  key: "main" | "explorer" | "executor" | "design";
  name: string;
  description: string;
  model: string | null;
  modelInherited: boolean;
  toolsLabel: string;
  runtimeLabel: string;
};

export type BuildAgentRosterInput = {
  preferences: {
    defaultModelId: string;
    defaultSubagentModelId: string | null;
    defaultManagedRuntimeProfileId: string;
  };
  composioDefaults: ComposioAgentDefaults;
  runtimeProfiles: ManagedRuntimeProfile[];
  profileSummaries?: ComposioToolProfileSummary[];
};

export function buildAgentRoster(_input: BuildAgentRosterInput): AgentRosterRow[] {
  // Stub — tests should fail against this
  return [];
}
