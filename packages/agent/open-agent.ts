import type { SandboxState } from "@open-agents/sandbox";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import {
  type GatewayModelId,
  gateway,
  type ProviderOptionsByProvider,
} from "./models";

import type { SkillMetadata } from "./skills/types";
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
  providerOptionsOverrides?: ProviderOptionsByProvider;
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
  managedRuntime: z
    .object({
      profileId: z.string().optional(),
      profileVersion: z.string().optional(),
      profileDisplayName: z.string().optional(),
      profileRunId: z.string().optional(),
      sandboxName: z.string().optional(),
    })
    .optional(),
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

export function getOpenAgentToolsForRuntimeMode(
  runtimeMode: OpenAgentRuntimeMode = "classic",
): ToolSet {
  if (runtimeMode === "managed_runtime") {
    return pickTools(tools, MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES);
  }

  return tools;
}

export function getRuntimeModeToolPolicy(
  runtimeMode: OpenAgentRuntimeMode = "classic",
  requestedTools?: ToolSet,
): ToolSet {
  const mergedTools = requestedTools ? { ...tools, ...requestedTools } : tools;

  if (runtimeMode !== "managed_runtime") {
    return mergedTools;
  }

  return pickTools(mergedTools, MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES);
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
      providerOptionsOverrides: mainSelection.providerOptionsOverrides,
    });
    const subagentModel = subagentSelection
      ? gateway(subagentSelection.id, {
          providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
        })
      : undefined;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const skills = options.skills ?? [];
    const runtimeMode = options.runtimeMode ?? "classic";
    const managedRuntime =
      runtimeMode === "managed_runtime" ? options.managedRuntime : undefined;

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: mainSelection.id,
      runtimeMode,
    });

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: getRuntimeModeToolPolicy(
          runtimeMode,
          settings.tools,
        ) as typeof tools,
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
      },
    };
  },
});

export type OpenAgent = typeof openAgent;
