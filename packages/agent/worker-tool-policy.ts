import type { ToolSet } from "ai";
import { bashTool } from "./tools/bash";
import { explorerBashTool } from "./tools/explorer-bash";
import { globTool } from "./tools/glob";
import { grepTool } from "./tools/grep";
import { readFileTool } from "./tools/read";
import { editFileTool, writeFileTool } from "./tools/write";
import type { OpenAgentRuntimeMode } from "./open-agent-runtime-mode";

/**
 * Coding tools available to delegated explorer workers.
 * Explorer bash is the read-only policy wrapper.
 */
export const EXPLORER_WORKER_TOOL_NAMES = [
  "read",
  "grep",
  "glob",
  "bash",
] as const;

/**
 * Coding tools available to delegated executor workers.
 */
export const EXECUTOR_WORKER_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "bash",
] as const;

export type DelegatedWorkerRole = "explorer" | "executor";

const explorerWorkerTools = {
  read: readFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: explorerBashTool(),
} satisfies ToolSet;

const executorWorkerTools = {
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
} satisfies ToolSet;

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
 * Agent tool names a delegated worker can hold. Profile tool lists
 * (expectedTools/optionalTools) may also carry toolchain labels such as
 * "bun" or "agent-browser"; those are not agent tools and never restrict
 * or grant worker toolsets here.
 */
const WORKER_AGENT_TOOL_NAME_SET: ReadonlySet<string> = new Set<string>([
  ...EXPLORER_WORKER_TOOL_NAMES,
  ...EXECUTOR_WORKER_TOOL_NAMES,
]);

/**
 * Derive the toolset for a task-delegated worker from runtime mode policy
 * intersected with an optional parent/profile builtin allowlist.
 *
 * Workers keep coding tools that the managed_runtime *coordinator* strips —
 * that is intentional. Instructions-only toolchain guidance is not enough;
 * the toolset itself must be policy-derived here.
 *
 * In managed_runtime, when the profile declares agent tool names via
 * expectedTools/optionalTools, the role toolset is intersected with them so
 * a worker physically cannot use tools outside the profile's declaration.
 * Toolchain labels that name no agent tool are ignored, and an empty or
 * label-only profile leaves the role defaults in place.
 *
 * Lives outside open-agent.ts so subagents can import it without a cycle
 * through taskTool.
 */
export function getDelegatedWorkerToolPolicy(
  role: DelegatedWorkerRole,
  runtimeMode: OpenAgentRuntimeMode = "classic",
  options?: {
    allowedBuiltinToolNames?: ReadonlyArray<string> | null;
    /**
     * Profile toolchain labels (bun, agent-browser, …). Entries that name a
     * worker agent tool restrict the toolset in managed_runtime; the rest
     * are ignored here.
     */
    expectedTools?: ReadonlyArray<string>;
    optionalTools?: ReadonlyArray<string>;
  },
): ToolSet {
  const source =
    role === "explorer" ? explorerWorkerTools : executorWorkerTools;
  const roleNames =
    role === "explorer"
      ? EXPLORER_WORKER_TOOL_NAMES
      : EXECUTOR_WORKER_TOOL_NAMES;

  let allowedNames: ReadonlyArray<string> = roleNames;

  if (runtimeMode === "managed_runtime") {
    const profileDeclared = [
      ...(options?.expectedTools ?? []),
      ...(options?.optionalTools ?? []),
    ].filter((name) => WORKER_AGENT_TOOL_NAME_SET.has(name));
    if (profileDeclared.length > 0) {
      const declared = new Set(profileDeclared);
      allowedNames = allowedNames.filter((name) => declared.has(name));
    }
  }

  if (options?.allowedBuiltinToolNames != null) {
    const allow = new Set(options.allowedBuiltinToolNames);
    allowedNames = allowedNames.filter((name) => allow.has(name));
  }

  return pickTools(source, allowedNames);
}
