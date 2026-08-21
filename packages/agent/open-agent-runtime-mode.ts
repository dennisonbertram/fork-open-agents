export const OPEN_AGENT_RUNTIME_MODES = ["classic", "managed_runtime"] as const;
export type OpenAgentRuntimeMode = (typeof OPEN_AGENT_RUNTIME_MODES)[number];

export type ManagedRuntimeAgentContext = {
  profileId?: string;
  profileVersion?: string;
  profileDisplayName?: string;
  profileRunId?: string;
  sandboxName?: string;
  expectedTools?: string[];
  optionalTools?: string[];
};
