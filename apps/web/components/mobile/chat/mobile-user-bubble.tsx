"use client";

import type { FileUIPart } from "ai";
import type { WebAgentUIMessage } from "@/app/types";
import { BubbleContent, BubbleGroup } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";

export interface MobileUserBubbleProps {
  /** The user-role message whose parts to render */
  message: WebAgentUIMessage;
}

/**
 * Right-aligned chat bubble for user messages.
 *
 * Layout (top → bottom within the right-aligned column):
 *   1. Image thumbnails (file parts where mediaType starts with "image/")
 *   2. Text bubble(s) with --primary background
 *
 * Bubbles use a rounded pill with a flattened top-right corner to indicate
 * the user's side — mirrors the desktop secondary-bg pill pattern but uses
 * --primary to visually distinguish user vs assistant.
 *
 * Touch target: the message area itself is not a button so no min-h required
 * here; interactive controls (resend/delete) live in the parent screen and
 * are wired via the chat context, not here.
 */
export function MobileUserBubble({ message }: MobileUserBubbleProps) {
  // Narrow to concrete part shapes so we avoid `any`
  const textParts = message.parts.filter(
    (p): p is Extract<typeof p, { type: "text" }> => p.type === "text",
  );
  const imageParts = message.parts.filter(
    (p): p is FileUIPart =>
      p.type === "file" &&
      typeof (p as FileUIPart).mediaType === "string" &&
      ((p as FileUIPart).mediaType as string).startsWith("image/"),
  );

  if (textParts.length === 0 && imageParts.length === 0) {
    return null;
  }

  return (
    <Message align="end" variant="user" className="px-4 py-1">
      <MessageContent align="end" variant="user" className="max-w-[85%]">
        <BubbleGroup className="items-end">
          {/* Image thumbnails */}
          {imageParts.map((part, i) => (
            /* eslint-disable-next-line @next/next/no-img-element -- data URLs not supported by next/image */
            <img
              key={`img-${i}`}
              src={part.url}
              alt={part.filename ?? "Attached image"}
              className="max-h-48 max-w-full rounded-2xl object-contain"
            />
          ))}

          {/* Text bubble(s) */}
          {textParts.map((part, i) => (
            <BubbleContent
              key={`text-${i}`}
              align="end"
              variant="user"
              className="rounded-2xl bg-primary py-2.5 text-primary-foreground"
            >
              <p className="whitespace-pre-wrap break-words">{part.text}</p>
            </BubbleContent>
          ))}
        </BubbleGroup>
      </MessageContent>
    </Message>
  );
}
