"use client";

import { isReasoningUIPart, isToolUIPart } from "ai";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef } from "react";
import type {
  WebAgentUIMessage,
  WebAgentUIToolPart,
  WebAgentWorkspaceStatusData,
} from "@/app/types";
import type { ChatUiStatus } from "@/lib/chat-streaming-state";
import {
  hasRenderableAssistantPart,
  isChatInFlight,
  shouldShowThinkingIndicator,
} from "@/lib/chat-streaming-state";
import { WorkspaceStartupStatus } from "@/app/sessions/[sessionId]/chats/[chatId]/workspace-startup-status";
import { AssistantMessageGroups } from "@/components/assistant-message-groups";
import { ThinkingBlock } from "@/components/thinking-block";
import { ToolCall } from "@/components/tool-call/tool-call";
import {
  hasLikelyCodeBlock,
  useStreamdownPlugins,
} from "@/lib/use-streamdown-plugins";
import { MobileUserBubble } from "./mobile-user-bubble";

// Markdown renderer for assistant text — same package/plugins the desktop chat
// uses, dynamically imported (ssr:false) to keep it out of the server bundle.
const Streamdown = dynamic(
  () => import("streamdown").then((m) => m.Streamdown),
  { ssr: false },
);

function MobileMarkdown({
  children,
  isStreaming,
}: {
  children: string;
  isStreaming: boolean;
}) {
  const streamdownPlugins = useStreamdownPlugins(hasLikelyCodeBlock(children));

  return (
    <Streamdown
      mode={isStreaming ? "streaming" : "static"}
      isAnimating={isStreaming}
      plugins={streamdownPlugins}
    >
      {children}
    </Streamdown>
  );
}

export interface MobileMessageThreadProps {
  messages: WebAgentUIMessage[];
  status: ChatUiStatus;
  /** Workspace setup status shown when agent is initialising the sandbox */
  workspaceStatus: WebAgentWorkspaceStatusData | null;
  /** The currently active approval ID, or null when no approval is pending */
  activeApprovalId: string | null;
  /** Called with the approval ID when the user taps Approve on an inline tool */
  onApprove: (id: string) => void;
  /** Called with the approval ID when the user taps Deny on an inline tool */
  onDeny: (id: string) => void;
}

/**
 * Scrollable message list for the mobile chat screen.
 *
 * - User messages render as right-aligned bubbles via MobileUserBubble.
 * - Assistant messages reuse AssistantMessageGroups + ThinkingBlock + ToolCall
 *   so tool-call state, reasoning, and approval flows behave identically to
 *   the desktop renderer — tap toggles what hover would toggle on desktop.
 * - Auto-scrolls to the bottom whenever new messages arrive or status changes.
 */
export function MobileMessageThread({
  messages,
  status,
  workspaceStatus,
  activeApprovalId,
  onApprove,
  onDeny,
}: MobileMessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const inFlight = isChatInFlight(status);

  // Track whether the user is near the bottom so streaming auto-scroll never
  // fights a deliberate scroll-up.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  // A signature that also changes while the LAST message streams in (text
  // growth, tool-state transitions). messages.length alone is constant during
  // streaming, so depending on it stops the view following a long reply.
  const tail = messages.at(-1);
  const scrollSignature = tail
    ? `${messages.length}:${tail.id}:${tail.parts
        .map(
          (p) =>
            `${p.type}:${"text" in p ? p.text.length : ""}:${"state" in p ? p.state : ""}`,
        )
        .join("|")}`
    : `${messages.length}`;

  // Auto-scroll to bottom as content arrives, unless the user scrolled up.
  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [scrollSignature, status]);

  const lastMessage = messages.at(-1);
  const lastMessageRole = lastMessage?.role as
    | "assistant"
    | "user"
    | "system"
    | undefined;

  const hasAssistantRenderableContent =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.some(hasRenderableAssistantPart)
      : false;

  const showThinking = shouldShowThinkingIndicator({
    status,
    hasAssistantRenderableContent,
    lastMessageRole,
  });

  if (messages.length === 0 && !inFlight) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Start the conversation below.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto py-4"
    >
      {messages.map((message, messageIndex) => {
        if (message.role === "user") {
          return <MobileUserBubble key={message.id} message={message} />;
        }

        if (message.role === "assistant") {
          const isMessageStreaming =
            inFlight && messageIndex === messages.length - 1;

          // UIMessage does not carry a createdAt timestamp — pass null
          // so AssistantMessageGroups falls back to its own internal timer.
          const durationMs: number | null = null;
          const startedAt: string | null = null;

          return (
            <div key={message.id} className="flex flex-col gap-1 px-4 py-1">
              <AssistantMessageGroups
                message={message}
                isStreaming={isMessageStreaming}
                durationMs={durationMs}
                startedAt={startedAt}
              >
                {(isExpanded) =>
                  message.parts.map((part, partIndex) => {
                    // Reasoning (thinking) blocks
                    if (isReasoningUIPart(part)) {
                      if (!isExpanded) return null;
                      return (
                        <div
                          key={`${message.id}-r${partIndex}`}
                          className="pl-[22px]"
                        >
                          <ThinkingBlock
                            text={part.text}
                            isStreaming={
                              isMessageStreaming && part.state === "streaming"
                            }
                          />
                        </div>
                      );
                    }

                    // Tool calls — reuse the full desktop ToolCall renderer
                    if (isToolUIPart(part)) {
                      if (!isExpanded) return null;
                      return (
                        <div
                          key={`${message.id}-t${partIndex}`}
                          className="pl-[22px]"
                        >
                          <ToolCall
                            part={part as WebAgentUIToolPart}
                            activeApprovalId={activeApprovalId}
                            isStreaming={isMessageStreaming}
                            onApprove={onApprove}
                            onDeny={onDeny}
                          />
                        </div>
                      );
                    }

                    // Text parts — render markdown via Streamdown (matches the
                    // desktop renderer) instead of raw text.
                    if (part.type === "text" && part.text.length > 0) {
                      return (
                        <div
                          key={`${message.id}-tx${partIndex}`}
                          className="min-w-0 break-words text-sm leading-relaxed text-foreground"
                        >
                          <MobileMarkdown isStreaming={isMessageStreaming}>
                            {part.text}
                          </MobileMarkdown>
                        </div>
                      );
                    }

                    return null;
                  })
                }
              </AssistantMessageGroups>
            </div>
          );
        }

        return null;
      })}

      {/* Workspace startup status — shown while sandbox is initialising */}
      {workspaceStatus ? (
        <div className="px-4 py-1">
          <WorkspaceStartupStatus status={workspaceStatus} />
        </div>
      ) : null}

      {/* Thinking indicator: shown when in-flight and no assistant content yet */}
      {showThinking ? (
        <div
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Thinking…</span>
        </div>
      ) : null}

      <div ref={bottomRef} className="h-4" aria-hidden="true" />
    </div>
  );
}
