/**
 * Pure status-derivation helpers for the mobile view.
 *
 * These are side-effect-free so they can be tested without any framework setup.
 */

import type {
  ActivityFilter,
  MobileStatusDescriptor,
  MobileStatusTone,
  SessionWithUnread,
} from "./types";

/**
 * Map a SessionWithUnread to a MobileStatusDescriptor.
 *
 * Priority order mirrors inbox-sidebar.tsx logic:
 *   1. Streaming         -> working
 *   2. PR merged         -> done
 *   3. PR open           -> waiting (needs review)
 *   4. PR closed         -> done (closed without merge)
 *   5. Branch + diff     -> waiting (needs attention)
 *   6. Branch only       -> idle
 *   7. No repo (chat)    -> idle
 *   8. status=failed     -> error
 *   9. status=completed  -> done
 *  10. status=archived   -> idle
 *  11. fallthrough       -> idle
 */
export function deriveMobileStatus(
  session: SessionWithUnread,
): MobileStatusDescriptor {
  if (session.hasStreaming) {
    return { label: "Working", tone: "working", prNumber: null };
  }

  if (session.prNumber && session.prStatus === "merged") {
    return {
      label: `PR #${session.prNumber}`,
      tone: "done",
      prNumber: session.prNumber,
    };
  }

  if (session.prNumber && session.prStatus === "open") {
    return {
      label: `PR #${session.prNumber}`,
      tone: "waiting",
      prNumber: session.prNumber,
    };
  }

  if (session.prNumber && session.prStatus === "closed") {
    return {
      label: `PR #${session.prNumber}`,
      tone: "done",
      prNumber: session.prNumber,
    };
  }

  const hasDiff = session.linesAdded || session.linesRemoved;

  if (session.branch && hasDiff) {
    return { label: "Needs attention", tone: "waiting", prNumber: null };
  }

  if (session.branch) {
    return { label: "New session", tone: "idle", prNumber: null };
  }

  const isPlainChat = !session.repoName?.trim();
  if (isPlainChat) {
    return { label: "Chat", tone: "idle", prNumber: null };
  }

  if (session.status === "failed") {
    return { label: "Failed", tone: "error", prNumber: null };
  }

  if (session.status === "completed") {
    return { label: "Done", tone: "done", prNumber: null };
  }

  if (session.status === "archived") {
    return { label: "Archived", tone: "idle", prNumber: null };
  }

  return { label: "Idle", tone: "idle", prNumber: null };
}

/**
 * Sort sessions so attention-first items come first:
 *   working -> waiting -> idle -> done -> error -> everything else
 * Within each group, most recently active first.
 */
const TONE_ORDER: Record<MobileStatusTone, number> = {
  working: 0,
  waiting: 1,
  idle: 2,
  done: 3,
  error: 4,
};

export function sortActivity(
  sessions: SessionWithUnread[],
): SessionWithUnread[] {
  return [...sessions].sort((a, b) => {
    const toneA = TONE_ORDER[deriveMobileStatus(a).tone];
    const toneB = TONE_ORDER[deriveMobileStatus(b).tone];
    if (toneA !== toneB) {
      return toneA - toneB;
    }
    // Within the same tone, most recently active first
    const timeA = a.lastActivityAt
      ? new Date(a.lastActivityAt).getTime()
      : new Date(a.createdAt).getTime();
    const timeB = b.lastActivityAt
      ? new Date(b.lastActivityAt).getTime()
      : new Date(b.createdAt).getTime();
    return timeB - timeA;
  });
}

/**
 * Return true if a session matches the given ActivityFilter.
 */
export function matchesFilter(
  session: SessionWithUnread,
  filter: ActivityFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  return deriveMobileStatus(session).tone === filter;
}

/**
 * Map a MobileStatusTone to a Tailwind utility class combination.
 * Uses only tokens that exist in the design system (no second token set).
 */
export function toneToClass(tone: MobileStatusTone): string {
  switch (tone) {
    case "working":
      return "bg-warning/10 text-warning-foreground border-warning/25";
    case "waiting":
      return "bg-warning/10 text-warning-foreground border-warning/25";
    case "done":
      return "bg-success/10 text-success-foreground border-success/25";
    case "error":
      return "bg-destructive/10 text-destructive border-destructive/25";
    default:
      return "bg-muted/40 text-muted-foreground border-border";
  }
}
