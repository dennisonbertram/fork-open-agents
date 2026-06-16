import type { SandboxState } from "@open-agents/sandbox";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import {
  type DirectAnthropicConfig,
  type GatewayModelId,
  gateway,
  type ProviderOptionsByProvider,
} from "./models";

import type { SkillMetadata } from "./skills/types";
import type { SubagentRoster } from "./subagents/roster";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
  skillTool,
  setupManagedRuntimeProfileTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
} from "./tools";
import {
  getProposeTool,
  PROPOSE_TOOL_NAME,
  type ProposeToolAction,
} from "./tools/propose-tool";

export const OPEN_AGENT_RUNTIME_MODES = ["classic", "managed_runtime"] as const;
export type OpenAgentRuntimeMode = (typeof OPEN_AGENT_RUNTIME_MODES)[number];

export type ManagedRuntimeAgentContext = {
  profileId?: string;
  profileVersion?: string;
  profileDisplayName?: string;
  sandboxName?: string;
};

export interface AgentModelSelection {
  id: GatewayModelId;
  directAnthropic?: DirectAnthropicConfig;
  providerOptionsOverrides?: ProviderOptionsByProvider;
  attribution?: {
    inferenceRoute?: "gateway" | "user";
    inferenceProfileId?: string;
    inferenceProfileName?: string;
    provider?: string;
  };
}

export type OpenAgentModelInput = GatewayModelId | AgentModelSelection;

export interface AgentSandboxContext {
  state: SandboxState;
  workingDirectory: string;
  currentBranch?: string;
  environmentDetails?: string;
}

const callOptionsSchema = z.object({
  sandbox: z.custom<AgentSandboxContext>(),
  model: z.custom<OpenAgentModelInput>().optional(),
  subagentModel: z.custom<OpenAgentModelInput>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
  runtimeMode: z.enum(OPEN_AGENT_RUNTIME_MODES).optional(),
  /** When true, the session has no sandbox VM. Tool policy will exclude all sandbox-dependent tools. */
  sandboxFree: z.boolean().optional(),
  managedRuntime: z
    .object({
      profileId: z.string().optional(),
      profileVersion: z.string().optional(),
      profileDisplayName: z.string().optional(),
      profileRunId: z.string().optional(),
      sandboxName: z.string().optional(),
    })
    .optional(),
  /**
   * Per-role subagent configuration resolved from agents rows.
   * Absent = synthetic fallback (today's subagent behavior unchanged).
   */
  subagentRoster: z.custom<SubagentRoster>().optional(),
  /**
   * Phase 6 (#242): when true, the propose_composio_tool is included in the toolset.
   * Absent or false = tool is excluded (off by default, per design doc).
   * The web layer resolves this from the agent's toolAuthoringEnabled flag.
   */
  toolAuthoringEnabled: z.boolean().optional(),
  /**
   * Set by the web layer when typed GitHub tools were injected for this step;
   * steers the prompt to prefer them over shell gh/curl for issue/PR metadata ops.
   * Absent or false = no steer added (zero behavior change when tools are off).
   */
  githubToolsEnabled: z.boolean().optional(),
  /**
   * Set by the web layer when authenticated GitHub tools (native `github_*` or
   * Composio `GITHUB_*`) are in this step's toolset. Steers the prompt and the
   * web_fetch guardrail away from unauthenticated GitHub fetches. Absent or
   * false = no steer and no guardrail (zero behavior change when off).
   */
  githubToolAvailable: z.boolean().optional(),
  /**
   * Phase 6 (#242): web-provided action to record a proposed tool entry.
   * Injected into experimental_context so the tool has no direct DB dependency.
   * Only present when toolAuthoringEnabled=true.
   */
  proposeToolAction: z.custom<ProposeToolAction>().optional(),
  /**
   * True for unattended runs (background agents, agent-loop steps) where no
   * human can approve tool calls. Threaded into experimental_context so tools
   * resolve their approval gates deterministically instead of stalling on a
   * never-answered approval request.
   */
  unattended: z.boolean().optional(),
  /**
   * Allowlist of built-in tool NAMES this run may use. `null`/absent = the
   * role's default policy (no restriction). When provided, built-in tools are
   * intersected with this list; caller-provided external tools (Composio,
   * GitHub) are always kept. This is how an unattended agent pre-approves which
   * built-in tools it may call.
   */
  allowedBuiltinToolNames: z.array(z.string()).nullish(),
});

export type OpenAgentCallOptions = z.infer<typeof callOptionsSchema>;

export const defaultModelLabel = "anthropic/claude-opus-4.6" as const;
export const defaultModel = gateway(defaultModelLabel);

function normalizeAgentModelSelection(
  selection: OpenAgentModelInput | undefined,
  fallbackId: GatewayModelId,
): AgentModelSelection {
  if (!selection) {
    return { id: fallbackId };
  }

  return typeof selection === "string" ? { id: selection } : selection;
}

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  setup_managed_runtime_profile: setupManagedRuntimeProfileTool,
  skill: skillTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

export const OPEN_AGENT_TOOL_NAMES = Object.keys(tools) as Array<
  keyof typeof tools
>;

export const MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES = [
  "todo_write",
  "task",
  "ask_user_question",
  "setup_managed_runtime_profile",
  "skill",
  "web_fetch",
] as const satisfies ReadonlyArray<keyof typeof tools>;

/**
 * Tool names that are safe to expose when there is no sandbox VM.
 * Excludes every tool that touches the filesystem, spawns a shell,
 * or delegates to a sandbox subagent (bash, read, write, edit, grep,
 * glob, task, setup_managed_runtime_profile).
 */
export const CHAT_ONLY_TOOL_NAMES = [
  "todo_write",
  "ask_user_question",
  "skill",
  "web_fetch",
] as const satisfies ReadonlyArray<keyof typeof tools>;

function pickTools(
  sourceTools: ToolSet,
  allowedToolNames: ReadonlyArray<string>,
): ToolSet {
  const nextTools: ToolSet = {};

  for (const toolName of allowedToolNames) {
    const candidate = sourceTools[toolName];
    if (candidate) {
      nextTools[toolName] = candidate;
    }
  }

  return nextTools;
}

/**
 * Built-in tool names (the native tool registry plus the optional authoring
 * tool). Used to decide which tools the `allowedBuiltinToolNames` allowlist
 * governs — caller-provided external tools (Composio, GitHub) are never in this
 * set and so always pass through.
 */
const BUILTIN_TOOL_NAME_SET: ReadonlySet<string> = new Set<string>([
  ...OPEN_AGENT_TOOL_NAMES,
  PROPOSE_TOOL_NAME,
]);

/**
 * Intersect built-in tools with an explicit allowlist. `null`/`undefined`
 * allowlist = no restriction (today's behavior). External (non-built-in) tools
 * are always preserved regardless of the allowlist.
 */
function applyBuiltinAllowlist(
  toolSet: ToolSet,
  allowedBuiltinToolNames?: ReadonlyArray<string> | null,
): ToolSet {
  if (allowedBuiltinToolNames == null) {
    return toolSet;
  }
  const allowed = new Set(allowedBuiltinToolNames);
  const result: ToolSet = {};
  for (const [name, toolDef] of Object.entries(toolSet)) {
    if (!BUILTIN_TOOL_NAME_SET.has(name) || allowed.has(name)) {
      result[name] = toolDef;
    }
  }
  return result;
}

export function getOpenAgentToolsForRuntimeMode(
  runtimeMode: OpenAgentRuntimeMode = "classic",
): ToolSet {
  if (runtimeMode === "managed_runtime") {
    return pickTools(tools, MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES);
  }

  return tools;
}

/**
 * Returns the subset of tools that are safe without a sandbox VM.
 * Excludes file/shell/task tools that require an active sandbox.
 */
export function getChatOnlyTools(): ToolSet {
  return pickTools(tools, CHAT_ONLY_TOOL_NAMES);
}

export function getRuntimeModeToolPolicy(
  runtimeMode: OpenAgentRuntimeMode = "classic",
  requestedTools?: ToolSet,
  policyOptions?: {
    sandboxFree?: boolean;
    toolAuthoringEnabled?: boolean;
    allowedBuiltinToolNames?: ReadonlyArray<string> | null;
  },
): ToolSet {
  const allowlist = policyOptions?.allowedBuiltinToolNames;
  // Sandbox-free mode: keep only chat-safe tools plus any caller-provided
  // non-sandbox tools (e.g. Composio tools that run via their own API).
  // NOTE: the authoring tool is NOT included in sandbox-free mode even when
  // toolAuthoringEnabled=true — it is a config-write action, not a chat tool.
  if (policyOptions?.sandboxFree) {
    const mergedTools = requestedTools
      ? { ...tools, ...requestedTools }
      : tools;
    // Start from the chat-only base, then append caller-provided tools that
    // are not in the base tool set (those are external tools like Composio).
    const chatBase = pickTools(mergedTools, CHAT_ONLY_TOOL_NAMES);
    if (requestedTools) {
      for (const [name, tool] of Object.entries(requestedTools)) {
        if (!(name in tools)) {
          chatBase[name] = tool;
        }
      }
    }
    return applyBuiltinAllowlist(chatBase, allowlist);
  }

  // Always create a new object so we can safely add authoring tool without
  // mutating the module-level `tools` constant (important for test isolation).
  const mergedTools: ToolSet = requestedTools
    ? { ...tools, ...requestedTools }
    : { ...tools };

  // Phase 6 (#242): conditionally add the authoring tool ONLY when enabled.
  // This is gated here rather than in the base tool list so that the default
  // toolset is unaffected and existing agents see no behavior change.
  const proposeTool = getProposeTool({
    toolAuthoringEnabled: policyOptions?.toolAuthoringEnabled,
  });
  if (proposeTool) {
    mergedTools[PROPOSE_TOOL_NAME] = proposeTool;
  }

  if (runtimeMode !== "managed_runtime") {
    return applyBuiltinAllowlist(mergedTools, allowlist);
  }

  return applyBuiltinAllowlist(
    pickTools(mergedTools, MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES),
    allowlist,
  );
}

export const openAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(1),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps: _steps }) => {
    return {
      messages: addCacheControl({
        messages,
        model,
      }),
    };
  },
  prepareCall: ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Open Agent requires call options with sandbox.");
    }

    const mainSelection = normalizeAgentModelSelection(
      options.model,
      defaultModelLabel,
    );
    const subagentSelection = options.subagentModel
      ? normalizeAgentModelSelection(options.subagentModel, defaultModelLabel)
      : undefined;

    const callModel = gateway(mainSelection.id, {
      directAnthropic: mainSelection.directAnthropic,
      providerOptionsOverrides: mainSelection.providerOptionsOverrides,
    });
    const subagentModel = subagentSelection
      ? gateway(subagentSelection.id, {
          directAnthropic: subagentSelection.directAnthropic,
          providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
        })
      : undefined;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const skills = options.skills ?? [];
    const runtimeMode = options.runtimeMode ?? "classic";
    const sandboxFree = options.sandboxFree ?? false;
    const managedRuntime =
      runtimeMode === "managed_runtime" ? options.managedRuntime : undefined;
    const subagentRoster = options.subagentRoster;
    // Phase 6 (#242): optional tool authoring gate + web-injected action
    const toolAuthoringEnabled = options.toolAuthoringEnabled ?? false;
    const proposeToolAction = options.proposeToolAction;
    const githubToolsEnabled = options.githubToolsEnabled ?? false;
    const githubToolAvailable = options.githubToolAvailable ?? false;
    const unattended = options.unattended ?? false;
    const allowedBuiltinToolNames = options.allowedBuiltinToolNames ?? null;

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: mainSelection.id,
      runtimeMode,
      sandboxFree,
      githubToolsEnabled,
      githubToolAvailable,
    });

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: getRuntimeModeToolPolicy(runtimeMode, settings.tools, {
          sandboxFree,
          toolAuthoringEnabled,
          allowedBuiltinToolNames,
        }) as typeof tools,
        model: callModel,
      }),
      instructions,
      experimental_context: {
        sandbox,
        skills,
        model: callModel,
        subagentModel,
        runtimeMode,
        managedRuntime,
        githubToolAvailable,
        unattended,
        ...(subagentRoster ? { subagentRoster } : {}),
        // Phase 6: only inject when enabled; undefined = no authoring in this session
        ...(toolAuthoringEnabled && proposeToolAction
          ? { proposeToolAction }
          : {}),
      },
    };
  },
});

export type OpenAgent = typeof openAgent;
