"use client";

/**
 * builder-whats-next-note.tsx — dismissible "What happens next" note shown
 * on first landing in the builder after creating a loop (#768).
 *
 * A first-time user lands here right after "Create loop" with no sense of
 * what comes after building the graph. This note names the four remaining
 * steps: Draft -> Activate -> Add a trigger (or Run now) -> Watch runs.
 */

import { X } from "lucide-react";

const STEPS = [
  "Draft",
  "Activate",
  "Add a trigger (or Run now)",
  "Watch runs",
];

export type BuilderWhatsNextNoteProps = {
  dismissed: boolean;
  onDismiss: () => void;
};

export function BuilderWhatsNextNote({
  dismissed,
  onDismiss,
}: BuilderWhatsNextNoteProps) {
  if (dismissed) {
    return null;
  }

  return (
    <div className="mx-3 mt-3 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">What happens next: </span>
        {STEPS.join(" → ")}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
