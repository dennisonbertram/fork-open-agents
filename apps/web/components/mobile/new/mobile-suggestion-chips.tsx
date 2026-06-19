"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const CANNED_PROMPTS = [
  "Fix the failing tests",
  "Review this PR",
  "Add a README",
  "Refactor for clarity",
  "Write unit tests",
  "Debug the error",
  "Add type safety",
  "Optimise performance",
];

export interface MobileSuggestionChipsProps {
  /** Called with the selected prompt text when the user taps a chip */
  onPick: (prompt: string) => void;
}

/**
 * Horizontally scrolling row of canned-prompt chips for the New session screen.
 * Chips meet the >=44px touch-target height requirement.
 */
export function MobileSuggestionChips({ onPick }: MobileSuggestionChipsProps) {
  return (
    <ScrollArea className="w-full">
      <div className="flex gap-2 pb-2">
        {CANNED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className={cn(
              "min-h-[44px] shrink-0 whitespace-nowrap rounded-full border border-border",
              "bg-muted/50 px-4 py-2 text-sm font-medium text-foreground",
              "transition-colors hover:bg-accent active:bg-accent/70",
            )}
          >
            {prompt}
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
