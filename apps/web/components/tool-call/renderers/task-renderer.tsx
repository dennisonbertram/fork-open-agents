"use client";

import type { TaskPendingToolCall } from "@open-agents/agent";
import { formatTokens, toRelativePath } from "@open-agents/shared";
import type { ToolRenderState } from "@open-agents/shared/lib/tool-state";
import {
  AlertTriangle,
  CheckCircle2,
  Bot,
  FileText,
  FilePlus,
  FolderSearch,
  Globe,
  Hammer,
  Paintbrush,
  Pencil,
  Search,
  Telescope,
  Terminal,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo } from "react";
import {
  extractRenderState,
  getToolName,
  type ToolRendererProps,
} from "@/app/lib/render-tool";
import type { WebAgentUIToolPart } from "@/app/types";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { cn } from "@/lib/utils";
import { ToolLayout } from "../tool-layout";
import { BashRenderer } from "./bash-renderer";
import { ReadRenderer } from "./read-renderer";
import { WriteRenderer } from "./write-renderer";
import { EditRenderer } from "./edit-renderer";
import { GlobRenderer } from "./glob-renderer";
import { GrepRenderer } from "./grep-renderer";
import { TodoRenderer } from "./todo-renderer";
import { AskUserQuestionRenderer } from "./ask-user-question-renderer";
import { FetchRenderer } from "./fetch-renderer";
import { SkillRenderer } from "./skill-renderer";

// ---------------------------------------------------------------------------
// Tool name → icon / display name mapping (for pending tool call only)
// ---------------------------------------------------------------------------

type ToolMeta = { displayName: string; icon: ReactNode };

const TOOL_ICON_CLASS = "h-3.5 w-3.5";

function getToolMeta(toolName: string): ToolMeta {
  switch (toolName) {
    case "bash":
      return {
        displayName: "Bash",
        icon: <Terminal className={TOOL_ICON_CLASS} />,
      };
    case "read":
      return {
        displayName: "Read",
        icon: <FileText className={TOOL_ICON_CLASS} />,
      };
    case "write":
      return {
        displayName: "Create",
        icon: <FilePlus className={TOOL_ICON_CLASS} />,
      };
    case "edit":
      return {
        displayName: "Update",
        icon: <Pencil className={TOOL_ICON_CLASS} />,
      };
    case "grep":
      return {
        displayName: "Grep",
        icon: <Search className={TOOL_ICON_CLASS} />,
      };
    case "glob":
      return {
        displayName: "Glob",
        icon: <FolderSearch className={TOOL_ICON_CLASS} />,
      };
    case "web_fetch":
      return {
        displayName: "Fetch",
        icon: <Globe className={TOOL_ICON_CLASS} />,
      };
    case "skill":
      return {
        displayName: "Skill",
        icon: <Zap className={TOOL_ICON_CLASS} />,
      };
    case "task":
      return {
        displayName: "Task",
        icon: <Telescope className={TOOL_ICON_CLASS} />,
      };
    default: {
      const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
      return { displayName: name, icon: undefined };
    }
  }
}

function getToolSummary(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return "";
  switch (name) {
    case "read":
    case "write":
    case "edit": {
      const fp = inp.filePath ?? "";
      return fp ? toRelativePath(String(fp), DEFAULT_WORKING_DIRECTORY) : "";
    }
    case "grep":
    case "glob":
      return inp.pattern ? `'${inp.pattern}'` : "";
    case "bash":
      return inp.command ? String(inp.command) : "";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Extract completed tool calls from final messages and synthesize UI parts
// ---------------------------------------------------------------------------

/** Unwrap AI SDK tool output envelope: { type: "json", value: { ... } } */
function unwrapToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const o = output as Record<string, unknown>;
  if (o.type === "json" && o.value && typeof o.value === "object") {
    return o.value;
  }
  return output;
}

function extractToolParts(messages: unknown): WebAgentUIToolPart[] {
  if (!Array.isArray(messages)) return [];

  // First pass: collect tool-call parts from assistant messages
  type CallInfo = { id: string; name: string; input: unknown };
  const calls: CallInfo[] = [];
  for (const msg of messages) {
    if (
      typeof msg !== "object" ||
      msg === null ||
      (msg as { role?: string }).role !== "assistant"
    )
      continue;

    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "tool-call"
      ) {
        const tc = part as {
          toolCallId?: string;
          toolName?: string;
          input?: unknown;
        };
        if (tc.toolName && tc.toolCallId) {
          calls.push({ id: tc.toolCallId, name: tc.toolName, input: tc.input });
        }
      }
    }
  }

  // Second pass: match tool results from tool-role messages
  const resultMap = new Map<string, unknown>();
  for (const msg of messages) {
    if (
      typeof msg !== "object" ||
      msg === null ||
      (msg as { role?: string }).role !== "tool"
    )
      continue;

    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "tool-result"
      ) {
        const tr = part as { toolCallId?: string; output?: unknown };
        if (tr.toolCallId) {
          resultMap.set(tr.toolCallId, tr.output);
        }
      }
    }
  }

  // Synthesize WebAgentUIToolPart objects
  return calls.map((call) => {
    const rawOutput = resultMap.get(call.id);
    const output = unwrapToolOutput(rawOutput);
    return {
      type: `tool-${call.name}`,
      toolCallId: call.id,
      state: "output-available",
      input: call.input,
      output,
    } as unknown as WebAgentUIToolPart;
  });
}

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { role?: string }).role === "tool",
  ).length;
}

// ---------------------------------------------------------------------------
// Subagent helpers
// ---------------------------------------------------------------------------

function getSubagentIcon(
  subagentType: string | undefined,
  className: string,
): ReactNode {
  switch (subagentType) {
    case "executor":
      return <Hammer className={className} />;
    case "design":
      return <Paintbrush className={className} />;
    case "explorer":
      return <Telescope className={className} />;
    default:
      return <Bot className={className} />;
  }
}

function getSubagentLabel(subagentType: string | undefined): string {
  switch (subagentType) {
    case "executor":
      return "Executor Subagent";
    case "design":
      return "Design Subagent";
    case "explorer":
      return "Explorer Subagent";
    default:
      return subagentType
        ? `${subagentType.charAt(0).toUpperCase() + subagentType.slice(1)} Subagent`
        : "Subagent";
  }
}

function getSubagentShortLabel(subagentType: string | undefined): string {
  switch (subagentType) {
    case "executor":
      return "Executor";
    case "design":
      return "Design";
    case "explorer":
      return "Explorer";
    default:
      return subagentType
        ? subagentType.charAt(0).toUpperCase() + subagentType.slice(1)
        : "Subagent";
  }
}

function getProfileLabel(runtime: {
  profileId?: string;
  profileVersion?: string;
  profileDisplayName?: string;
}) {
  if (runtime.profileId && runtime.profileVersion) {
    return `${runtime.profileId}@${runtime.profileVersion}`;
  }

  return runtime.profileDisplayName ?? runtime.profileId ?? null;
}

function statusClassName(status: string | undefined): string {
  switch (status) {
    case "completed":
    case "valid":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "running":
    case "launching":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "blocked":
    case "failed":
    case "invalid":
      return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
    case "cancelled":
    case "stale":
    case "missing":
    case "partial":
      return "border-muted bg-muted/50 text-muted-foreground";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function StatusBadge({
  label,
  status,
}: {
  label?: string;
  status: string | undefined;
}) {
  if (!status) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium",
        statusClassName(status),
      )}
    >
      {label ? `${label} ` : ""}
      {status.replaceAll("_", " ")}
    </span>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getCompletionPacket(output: unknown) {
  return asRecord(asRecord(output)?.completionPacket);
}

function getCompletionPacketValidation(output: unknown) {
  return asRecord(asRecord(output)?.completionPacketValidation);
}

function getLifecycle(output: unknown) {
  return asRecord(asRecord(output)?.delegatedWorkerLifecycle);
}

function getWorkspaceMode(output: unknown): string | null {
  const packetMode = asString(getCompletionPacket(output)?.workspaceMode);
  if (packetMode) {
    return packetMode;
  }
  const lifecycleMode = asString(getLifecycle(output)?.workspaceMode);
  if (lifecycleMode) {
    return lifecycleMode;
  }
  const policy = asRecord(asRecord(output)?.workspacePolicy);
  return asString(policy?.executionMode);
}

function getWorkerStatus(output: unknown): string | null {
  const lifecycleStatus = asString(getLifecycle(output)?.status);
  if (lifecycleStatus) {
    return lifecycleStatus;
  }
  return asString(getCompletionPacket(output)?.status);
}

function getReasonCode(output: unknown): string | null {
  return (
    asString(getLifecycle(output)?.reasonCode) ??
    asString(getCompletionPacketValidation(output)?.reasonCode)
  );
}

function WorkerEvidencePanel({ output }: { output: unknown }) {
  const packet = getCompletionPacket(output);
  const validation = getCompletionPacketValidation(output);
  const workerStatus = getWorkerStatus(output);
  const workspaceMode = getWorkspaceMode(output);
  const reasonCode = getReasonCode(output);
  const summary = asString(packet?.summary);
  const changedFiles = asStringArray(packet?.changedFiles);
  const verification = asStringArray(packet?.verification);
  const blockers = asStringArray(packet?.blockers);
  const integration = asStringArray(packet?.integrationInstructions);
  const validationStatus = asString(validation?.status);
  const showPanel =
    workerStatus ||
    workspaceMode ||
    summary ||
    validationStatus ||
    blockers.length > 0 ||
    integration.length > 0;

  if (!showPanel) {
    return null;
  }

  const statusIcon =
    workerStatus === "completed" ? (
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
    ) : workerStatus === "failed" || workerStatus === "blocked" ? (
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
    ) : (
      <Telescope className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    );

  return (
    <div className="mt-2 ml-6 overflow-hidden rounded-md border border-border/70 bg-muted/20">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
        {statusIcon}
        <span className="mr-1 text-[11px] font-medium text-foreground">
          Worker evidence
        </span>
        <StatusBadge status={workerStatus ?? undefined} />
        <StatusBadge label="mode" status={workspaceMode ?? undefined} />
        <StatusBadge label="packet" status={validationStatus ?? undefined} />
      </div>
      <div className="space-y-1.5 px-2 py-2 text-[11px] text-muted-foreground">
        {summary && (
          <p className="line-clamp-2 text-foreground" title={summary}>
            {summary}
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span>
            Changes:{" "}
            <span className="font-medium text-foreground">
              {changedFiles.length}
            </span>
          </span>
          <span>
            Verification:{" "}
            <span className="font-medium text-foreground">
              {verification.length}
            </span>
          </span>
          {workspaceMode === "isolated" && (
            <span>
              Integration:{" "}
              <span className="font-medium text-foreground">
                {integration.length > 0 ? "review child artifacts" : "pending"}
              </span>
            </span>
          )}
        </div>
        {changedFiles.length > 0 && (
          <p className="truncate font-mono text-[10px]">
            {changedFiles.slice(0, 4).join(", ")}
            {changedFiles.length > 4 ? ` +${changedFiles.length - 4}` : ""}
          </p>
        )}
        {blockers.length > 0 ? (
          <p className="line-clamp-2 text-red-700 dark:text-red-300">
            {blockers[0]}
          </p>
        ) : reasonCode ? (
          <p className="truncate font-mono text-[10px]">reason {reasonCode}</p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending tool call (streaming only — no output yet)
// ---------------------------------------------------------------------------

const IDLE_STATE: ToolRenderState = {
  running: false,
  interrupted: false,
  denied: false,
  approvalRequested: false,
  isActiveApproval: false,
};

/**
 * Render a completed subagent tool call using the real renderers.
 * This is a local dispatch to avoid circular imports with tool-call.tsx.
 */
function SubagentToolCall({ part }: { part: WebAgentUIToolPart }) {
  const state = extractRenderState(part, null, false);
  const cwd = DEFAULT_WORKING_DIRECTORY;

  switch (part.type) {
    case "tool-bash":
      return <BashRenderer part={part} state={state} />;
    case "tool-read":
      return <ReadRenderer part={part} state={state} cwd={cwd} />;
    case "tool-write":
      return <WriteRenderer part={part} state={state} cwd={cwd} />;
    case "tool-edit":
      return <EditRenderer part={part} state={state} cwd={cwd} />;
    case "tool-glob":
      return <GlobRenderer part={part} state={state} />;
    case "tool-grep":
      return <GrepRenderer part={part} state={state} />;
    case "tool-todo_write":
      return <TodoRenderer part={part} state={state} />;
    case "tool-ask_user_question":
      return <AskUserQuestionRenderer part={part} state={state} />;
    case "tool-web_fetch":
      return <FetchRenderer part={part} state={state} />;
    case "tool-skill":
      return <SkillRenderer part={part} state={state} />;
    default: {
      const toolName = getToolName(part);
      const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
      const input = part.input as Record<string, unknown> | undefined;
      const summary = input ? JSON.stringify(input).slice(0, 40) : "...";
      return (
        <ToolLayout
          name={name}
          summary={summary}
          summaryClassName="font-mono"
          meta={part.state === "output-available" ? "Done" : undefined}
          state={state}
        />
      );
    }
  }
}

function PendingMiniToolCall({
  name,
  input,
}: {
  name: string;
  input: unknown;
}) {
  const meta = getToolMeta(name);
  const summary = getToolSummary(name, input);

  return (
    <ToolLayout
      name={meta.displayName}
      icon={meta.icon}
      summary={summary}
      summaryClassName="font-mono"
      state={IDLE_STATE}
    />
  );
}

// ---------------------------------------------------------------------------
// TaskRenderer
// ---------------------------------------------------------------------------

export const TaskRenderer = memo(function TaskRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-task">) {
  const input = part.input;
  const desc = input?.task ?? "Spawning subagent";
  const subagentType = input?.subagentType;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";

  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const isComplete = hasOutput && !isPreliminary;
  const output = hasOutput ? part.output : undefined;

  const pendingToolCall: TaskPendingToolCall | null = output?.pending ?? null;
  const toolCount =
    output?.toolCallCount ?? (isComplete ? countToolCalls(output?.final) : 0);
  const tokenCount = output?.usage?.inputTokens ?? null;
  const managedRuntime =
    output?.runtime?.mode === "managed_runtime" ? output.runtime : null;
  const profileLabel = managedRuntime ? getProfileLabel(managedRuntime) : null;
  const workerType = managedRuntime?.workerType ?? subagentType;
  const workerLabel = getSubagentShortLabel(workerType);

  // Build mono stats for right-aligned meta
  const statParts: string[] = [];
  if (toolCount > 0) {
    statParts.push(`${toolCount} tool${toolCount !== 1 ? "s" : ""}`);
  }
  if (tokenCount !== null) {
    statParts.push(`${formatTokens(tokenCount)} tokens`);
  }

  const meta =
    statParts.length > 0 ? (
      <span className="font-mono text-xs text-muted-foreground/60">
        {statParts.join(" · ")}
      </span>
    ) : null;

  // --- Expanded content ---
  // While running: show the current pending tool call
  // When complete: show all tool calls using the real ToolCall component
  const completedParts = isComplete ? extractToolParts(output?.final) : [];

  const hasExpandableContent =
    pendingToolCall !== null || completedParts.length > 0;

  const expandedContent = hasExpandableContent ? (
    <div
      className={cn(
        "space-y-0.5 pl-6",
        managedRuntime && "border-cyan-500/30 border-l pl-3",
      )}
    >
      {managedRuntime && (
        <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-cyan-600 dark:text-cyan-300">
            Managed worker tool calls
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span>{workerLabel}</span>
        </div>
      )}
      {/* Live: show current pending tool call with slide-up animation */}
      {pendingToolCall && !isComplete && (
        <div
          key={`pending-${toolCount}-${pendingToolCall.name}`}
          style={{ animation: "slide-up-fade 150ms ease-out both" }}
        >
          <PendingMiniToolCall
            name={pendingToolCall.name}
            input={pendingToolCall.input}
          />
        </div>
      )}
      {/* Complete: render real tool call components */}
      {isComplete &&
        completedParts.map((toolPart) => (
          <SubagentToolCall key={toolPart.toolCallId} part={toolPart} />
        ))}
    </div>
  ) : undefined;

  const runtimeDetails = managedRuntime ? (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 pl-6 text-[11px] text-muted-foreground">
      <span className="font-medium text-cyan-600 dark:text-cyan-300">
        Coordinator delegated
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span>{workerLabel}</span>
      {managedRuntime.sandboxName && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="min-w-0 truncate">
            Sandbox {managedRuntime.sandboxName}
          </span>
        </>
      )}
      {profileLabel && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="min-w-0 truncate">Profile {profileLabel}</span>
        </>
      )}
      {managedRuntime.profileRunId && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="min-w-0 truncate">
            Profile run {managedRuntime.profileRunId}
          </span>
        </>
      )}
    </div>
  ) : null;

  const approvalWarning =
    taskApprovalRequested && subagentType === "executor" ? (
      <div className="mt-2 pl-5 text-sm text-yellow-500">
        This executor has full write access and can create, modify, and delete
        files.
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name={managedRuntime ? "Managed worker" : getSubagentLabel(subagentType)}
      summary={desc}
      summaryClassName="font-sans"
      meta={meta}
      rightAlignMeta
      state={state}
      icon={getSubagentIcon(subagentType, "h-3.5 w-3.5")}
      nameClassName={taskDenied ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
      defaultExpanded={!isComplete}
    >
      {runtimeDetails}
      <WorkerEvidencePanel output={output} />
      {approvalWarning}
    </ToolLayout>
  );
});
