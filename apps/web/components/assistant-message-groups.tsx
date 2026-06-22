"use client";

import { isReasoningUIPart, isToolUIPart } from "ai";
import { useMemo, useState, type ReactNode } from "react";
import type { WebAgentUIMessage } from "@/app/types";
import {
  ToolCallsSummaryBar,
  type ToolCallsSummaryResponseStats,
} from "./tool-calls-summary-bar";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Determines if a message has any tool call or reasoning content
 * that should be collapsible.
 */
function messageHasCollapsibleContent(message: WebAgentUIMessage): boolean {
  return message.parts.some((p) => isToolUIPart(p) || isReasoningUIPart(p));
}

function countToolCalls(message: WebAgentUIMessage): number {
  let count = 0;
  for (const part of message.parts) {
    if (isToolUIPart(part)) count++;
  }
  return count;
}

const FILE_MODIFYING_TOOLS = new Set(["tool-write", "tool-edit"]);

function getChangedFiles(message: WebAgentUIMessage): string[] {
  const files = new Set<string>();
  for (const part of message.parts) {
    if (
      isToolUIPart(part) &&
      FILE_MODIFYING_TOOLS.has(part.type) &&
      (part.input as { filePath?: string } | undefined)?.filePath
    ) {
      files.add((part.input as { filePath: string }).filePath);
    }
  }
  return Array.from(files);
}

/**
 * Checks whether a message has an active approval request, which
 * should force the tool calls to be expanded so the user can respond.
 */
function messageHasActiveApproval(message: WebAgentUIMessage): boolean {
  return message.parts.some(
    (p) => isToolUIPart(p) && p.state === "approval-requested",
  );
}

function formatSubagentType(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? `${value.charAt(0).toUpperCase()}${value.slice(1)}`
    : "Subagent";
}

function truncateStatus(value: string, maxLength = 72): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function basenamePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function formatPendingTaskTool(value: unknown): string | null {
  if (!isRecord(value) || typeof value.name !== "string") {
    return null;
  }

  const input = isRecord(value.input) ? value.input : {};
  const displayName = `${value.name.charAt(0).toUpperCase()}${value.name.slice(1)}`;

  switch (value.name) {
    case "bash": {
      const command =
        typeof input.command === "string" ? truncateStatus(input.command) : "";
      return command ? `${displayName} ${command}` : displayName;
    }
    case "read":
    case "write":
    case "edit": {
      const file = basenamePath(input.filePath);
      return file ? `${displayName} ${file}` : displayName;
    }
    case "grep":
    case "glob": {
      const pattern =
        typeof input.pattern === "string" ? truncateStatus(input.pattern) : "";
      return pattern ? `${displayName} ${pattern}` : displayName;
    }
    default:
      return displayName;
  }
}

function getTaskActivityLabel(
  message: WebAgentUIMessage,
  isStreaming: boolean,
): string | null {
  if (!isStreaming) {
    return null;
  }

  for (const part of message.parts.toReversed()) {
    if (!isToolUIPart(part) || part.type !== "tool-task") {
      continue;
    }

    const isActive =
      part.state === "input-streaming" ||
      part.state === "input-available" ||
      (part.state === "output-available" && part.preliminary === true);

    if (!isActive) {
      continue;
    }

    const output = part.state === "output-available" ? part.output : undefined;
    const runtime = isRecord(output) ? output.runtime : undefined;
    const isManagedWorker =
      isRecord(runtime) && runtime.mode === "managed_runtime";
    const runtimeLabel = isManagedWorker
      ? "Managed worker"
      : `${formatSubagentType(part.input?.subagentType)} worker`;
    const sandboxName =
      isManagedWorker && typeof runtime.sandboxName === "string"
        ? runtime.sandboxName
        : null;
    const pending = isRecord(output)
      ? formatPendingTaskTool(output.pending)
      : null;

    if (pending) {
      return sandboxName
        ? `${runtimeLabel}: ${pending} · ${sandboxName}`
        : `${runtimeLabel}: ${pending}`;
    }

    const task =
      typeof part.input?.task === "string" && part.input.task.length > 0
        ? truncateStatus(part.input.task)
        : "starting";

    return sandboxName
      ? `${runtimeLabel}: ${task} · ${sandboxName}`
      : `${runtimeLabel}: ${task}`;
  }

  return null;
}

export type AssistantMessageGroupsProps = {
  message: WebAgentUIMessage;
  isStreaming: boolean;
  /** Pre-computed generation duration in ms (for completed messages) */
  durationMs: number | null;
  /** ISO timestamp of the preceding user message's createdAt (for live timer while streaming) */
  startedAt: string | null;
  /** Response usage metrics shown when hovering the collapsed summary. */
  responseStats?: ToolCallsSummaryResponseStats | null;
  /**
   * Render function that produces the list of group elements.
   * Called with `isExpanded` so the caller can conditionally
   * skip rendering collapsible groups.
   */
  children: (isExpanded: boolean) => ReactNode;
};

/**
 * Wraps an assistant message's groups with a collapsible summary bar.
 * By default, tool calls and reasoning are hidden behind a single-line
 * summary. Clicking the summary expands to show the full content.
 */
export function AssistantMessageGroups({
  message,
  isStreaming,
  durationMs,
  startedAt,
  responseStats,
  children,
}: AssistantMessageGroupsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasCollapsible = useMemo(
    () => messageHasCollapsibleContent(message),
    [message],
  );

  const toolCallCount = useMemo(() => countToolCalls(message), [message]);

  const changedFiles = useMemo(() => getChangedFiles(message), [message]);

  const activityLabel = useMemo(
    () => getTaskActivityLabel(message, isStreaming),
    [message, isStreaming],
  );

  const hasActiveApproval = useMemo(
    () => messageHasActiveApproval(message),
    [message],
  );

  // Force expand when there's an active approval the user needs to respond to
  const effectiveExpanded = isExpanded || hasActiveApproval;

  // If no collapsible content, just render children directly
  if (!hasCollapsible) {
    return <>{children(true)}</>;
  }

  return (
    <>
      <ToolCallsSummaryBar
        isExpanded={effectiveExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isStreaming={isStreaming}
        toolCallCount={toolCallCount}
        changedFiles={changedFiles}
        activityLabel={activityLabel}
        durationMs={durationMs}
        startedAt={startedAt}
        responseStats={responseStats}
        statusWordSeed={message.id}
      />
      <div className="space-y-1">{children(effectiveExpanded)}</div>
    </>
  );
}
