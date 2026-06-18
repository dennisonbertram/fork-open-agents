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
 * Priority order. Terminal statuses (failed/completed/archived) win over
 * branch/diff so old or closed-out sessions are never mislabeled
 * "Needs attention":
 *   1. Streaming         -> working
 *   2. PR merged         -> done
 *   3. PR open           -> waiting (needs review)
 *   4. PR closed         -> done (closed without merge)
 *   5. status=failed     -> error
 *   6. status=completed  -> done
 *   7. status=archived   -> idle
 *   8. Branch + diff     -> waiting (needs attention)
 *   9. Branch only       -> idle (new session)
 *  10. No repo (chat)    -> idle
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

  // Terminal statuses win over branch/diff so old, closed-out, or archived
  // sessions are never mislabeled "Needs attention".
  if (session.status === "failed") {
    return { label: "Failed", tone: "error", prNumber: null };
  }

  if (session.status === "completed") {
    return { label: "Done", tone: "done", prNumber: null };
  }

  if (session.status === "archived") {
    return { label: "Archived", tone: "idle", prNumber: null };
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

  return { label: "Idle", tone: "idle", prNumber: null };
}

/**
 * Sort sessions most-recently-active first (recency-first), so the activity
 * stream reads top-to-bottom by time — like an inbox. Status/attention is
 * conveyed by the row pills and the filter chips ("Needs you" / Working /
 * Done), not by reordering.
 */
export function sortActivity(
  sessions: SessionWithUnread[],
): SessionWithUnread[] {
  return [...sessions].sort((a, b) => {
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
      return "bg-warning/10 text-warning border-warning/25";
    case "waiting":
      return "bg-warning/10 text-warning border-warning/25";
    case "done":
      return "bg-success/10 text-success border-success/25";
    case "error":
      return "bg-destructive/10 text-destructive border-destructive/25";
    default:
      return "bg-muted/40 text-muted-foreground border-border";
  }
}
