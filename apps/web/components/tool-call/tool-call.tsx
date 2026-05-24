"use client";

/**
 * Tool call component that renders tool invocations for the web app.
 */
import type { WebAgentUIToolPart } from "@/app/types";
import type { SetupManagedRuntimeProfileOutput } from "@open-agents/agent";
import {
  extractRenderState,
  getToolName,
  type ToolRenderState,
} from "@/app/lib/render-tool";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { ToolLayout } from "./tool-layout";
import { BashRenderer } from "./renderers/bash-renderer";
import { ReadRenderer } from "./renderers/read-renderer";
import { WriteRenderer } from "./renderers/write-renderer";
import { EditRenderer } from "./renderers/edit-renderer";
import { GlobRenderer } from "./renderers/glob-renderer";
import { GrepRenderer } from "./renderers/grep-renderer";
import { TaskRenderer } from "./renderers/task-renderer";
import { TodoRenderer } from "./renderers/todo-renderer";
import { AskUserQuestionRenderer } from "./renderers/ask-user-question-renderer";
import { FetchRenderer } from "./renderers/fetch-renderer";
import { SkillRenderer } from "./renderers/skill-renderer";
import { ManagedRuntimeProfileBuilderRenderer } from "./renderers/managed-runtime-profile-builder-renderer";

export type ToolCallProps = {
  part: WebAgentUIToolPart;
  activeApprovalId?: string | null;
  cwd?: string;
  sessionId?: string;
  chatId?: string;
  isStreaming?: boolean;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
  onManagedRuntimeProfileOutput?: (
    toolCallId: string,
    output: SetupManagedRuntimeProfileOutput,
  ) => void;
};

/**
 * Render a tool call based on its type.
 */
export function ToolCall({
  part,
  activeApprovalId = null,
  cwd = DEFAULT_WORKING_DIRECTORY,
  sessionId,
  chatId,
  isStreaming = false,
  onApprove,
  onDeny,
  onManagedRuntimeProfileOutput,
}: ToolCallProps) {
  const state = extractRenderState(part, activeApprovalId, isStreaming);
  const approvalProps = { onApprove, onDeny };

  switch (part.type) {
    case "tool-bash":
      return <BashRenderer part={part} state={state} {...approvalProps} />;
    case "tool-read":
      return (
        <ReadRenderer part={part} state={state} cwd={cwd} {...approvalProps} />
      );
    case "tool-write":
      return (
        <WriteRenderer part={part} state={state} cwd={cwd} {...approvalProps} />
      );
    case "tool-edit":
      return (
        <EditRenderer part={part} state={state} cwd={cwd} {...approvalProps} />
      );
    case "tool-glob":
      return <GlobRenderer part={part} state={state} {...approvalProps} />;
    case "tool-grep":
      return <GrepRenderer part={part} state={state} {...approvalProps} />;
    case "tool-task":
      return <TaskRenderer part={part} state={state} {...approvalProps} />;
    case "tool-todo_write":
      return <TodoRenderer part={part} state={state} />;
    case "tool-ask_user_question":
      // AskUserQuestion tool doesn't require approval, handled separately
      return <AskUserQuestionRenderer part={part} state={state} />;
    case "tool-setup_managed_runtime_profile":
      return (
        <ManagedRuntimeProfileBuilderRenderer
          part={part}
          state={state}
          sessionId={sessionId}
          chatId={chatId}
          onSubmitOutput={(output) =>
            onManagedRuntimeProfileOutput?.(part.toolCallId, output)
          }
        />
      );
    case "tool-web_fetch":
      return <FetchRenderer part={part} state={state} {...approvalProps} />;
    case "tool-skill":
      return <SkillRenderer part={part} state={state} {...approvalProps} />;
    default:
      return (
        <DefaultRenderer
          part={part}
          state={state}
          toolName={getToolName(part)}
          {...approvalProps}
        />
      );
  }
}

function DefaultRenderer({
  part,
  state,
  toolName,
  onApprove,
  onDeny,
}: {
  part: WebAgentUIToolPart;
  state: ToolRenderState;
  toolName: string;
  onApprove?: (id: string) => void;
  onDeny?: (id: string, reason?: string) => void;
}) {
  const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  const input = part.input as Record<string, unknown> | undefined;
  const summary = input ? JSON.stringify(input).slice(0, 40) : "...";
  const meta = part.state === "output-available" ? "Done" : undefined;

  return (
    <ToolLayout
      name={name}
      summary={summary}
      summaryClassName="font-mono"
      meta={meta}
      state={state}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}

export { ToolLayout } from "./tool-layout";
export type { ToolRenderState } from "@/app/lib/render-tool";
