"use client";

/**
 * builder-whats-next-note.tsx — dismissible "What happens next" note shown
 * on first landing in the builder after creating a loop (#768).
 *
 * A first-time user lands here right after "Create loop" with no sense of
 * what comes after building the graph. This note names the four remaining
 * steps: Draft -> Activate -> Add a trigger (or Run now) -> Watch runs.
 *
 * Per-step link decisions (#867):
 *   - "Draft" stays plain text — it names the state the user is currently
 *     in (they just created the draft), so there's no destination to link.
 *   - "Activate" links to the loop status <Select> section.
 *   - "Add a trigger" and "Run now" are split into two separate links (the
 *     connective "(or ...)" text stays plain) pointing at the Triggers card
 *     and the header's Run now button container, respectively.
 *   - "Watch runs" links to the Run history section, which always renders
 *     (showing an empty state when there are no runs yet), so it's a stable
 *     anchor target.
 */

import { X } from "lucide-react";
import Link from "next/link";

export type BuilderWhatsNextNoteProps = {
  loopId: string;
  dismissed: boolean;
  onDismiss: () => void;
};

const LINK_CLASSNAME = "underline underline-offset-2 hover:text-foreground";

export function BuilderWhatsNextNote({
  loopId,
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
        Draft →{" "}
        <Link
          href={`/loops/${loopId}#loop-status-section`}
          className={LINK_CLASSNAME}
        >
          Activate
        </Link>{" "}
        →{" "}
        <Link
          href={`/loops/${loopId}#loop-triggers-section`}
          className={LINK_CLASSNAME}
        >
          Add a trigger
        </Link>{" "}
        (or{" "}
        <Link
          href={`/loops/${loopId}#loop-run-now`}
          className={LINK_CLASSNAME}
        >
          Run now
        </Link>
        ) →{" "}
        <Link
          href={`/loops/${loopId}#loop-run-history`}
          className={LINK_CLASSNAME}
        >
          Watch runs
        </Link>
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
