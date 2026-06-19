"use client";

import { Send, Square } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface MobileComposerProps {
  /** Prevent sending — e.g. while approval is pending or chat is not ready */
  disabled?: boolean;
  /** Whether the agent is currently processing a request */
  isInFlight: boolean;
  /** Called with the trimmed text when the user submits */
  onSend: (text: string) => void;
  /** Called when the user presses the stop button */
  onStop: () => void;
  // TODO seam: file attach not wired — requires a mobile upload endpoint
}

/**
 * Bottom composer bar for the mobile chat screen.
 *
 * - Auto-growing textarea (field-sizing-content via Tailwind).
 * - Send/Stop toggle button pinned to the right.
 * - All controls meet the >=44px touch-target requirement.
 */
export function MobileComposer({
  disabled = false,
  isInFlight,
  onSend,
  onStop,
}: MobileComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const value = textareaRef.current?.value.trim() ?? "";
    if (!value || disabled || isInFlight) {
      return;
    }
    onSend(value);
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border bg-background px-3 pb-[max(env(safe-area-inset-bottom,0px),12px)] pt-3">
      <Textarea
        ref={textareaRef}
        placeholder="Message…"
        disabled={disabled && !isInFlight}
        onKeyDown={handleKeyDown}
        rows={1}
        className={cn(
          "min-h-[44px] flex-1 resize-none rounded-2xl px-4 py-2.5 text-base leading-snug",
          "field-sizing-content max-h-36 overflow-y-auto",
        )}
        aria-label="Message input"
      />

      {isInFlight ? (
        <Button
          type="button"
          size="icon"
          variant="destructive"
          onClick={onStop}
          className="min-h-[44px] min-w-[44px] shrink-0 rounded-full"
          aria-label="Stop generation"
        >
          <Square className="h-4 w-4 fill-current" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={submit}
          disabled={disabled}
          className="min-h-[44px] min-w-[44px] shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
