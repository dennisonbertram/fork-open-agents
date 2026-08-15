import { buildSessionUrl } from "../context";
import { toLastRunOutcome, type McpLastRunOutcome } from "../session-state";
import { toIsoString } from "../timestamps";
import type { McpGitAutomationEvent } from "./sessions-read";
// Type-only: the mapping below never calls into the db, so only the row shape
// crosses here. session-updates.ts is loaded by registry tests that mock
// `@/lib/db/workflow-runs` to a stub containing just
// getLatestWorkflowRunStatusBySessionId — a runtime value import would break
// their load; a type import is erased and cannot.
import type { FinishedWorkflowRun } from "@/lib/db/workflow-runs";

/**
 * One `open_agents_get_updates` change — a session whose run ended inside the
 * caller's `since` window. This is a status read, never a transcript: no prompt
 * text, no message content, no repository content.
 */
export type McpRunUpdate = {
  sessionId: string;
  title: string;
  label: string | null;
  /** How the run ended, reusing get_session's own `lastRunOutcome` vocabulary —
   * never a second set of names. */
  lastRunOutcome: McpLastRunOutcome | null;
  branch: string | null;
  baseBranch: string | null;
  prNumber: number | null;
  prStatus: "open" | "merged" | "closed" | null;
  /** The most recently recorded auto-commit attempt for this session, or null
   * when auto-commit has never run (same shape and rule as get_session). */
  lastAutoCommitEvent: McpGitAutomationEvent | null;
  /** The most recently recorded auto-PR attempt, or null when never run. */
  lastAutoPrEvent: McpGitAutomationEvent | null;
  url: string;
  /** When the run finished (ISO 8601). */
  finishedAt: string;
};

/**
 * Map a finished-run row (already filtered by caller and the `since` window in
 * SQL) plus its git-automation event outcomes into the MCP change shape.
 */
export function toRunUpdate(
  row: FinishedWorkflowRun,
  events: {
    lastAutoCommitEvent: McpGitAutomationEvent | null;
    lastAutoPrEvent: McpGitAutomationEvent | null;
  },
): McpRunUpdate {
  return {
    sessionId: row.sessionId,
    title: row.title,
    label: row.label ?? null,
    lastRunOutcome: toLastRunOutcome(row.status),
    branch: row.branch,
    baseBranch: row.baseBranch,
    prNumber: row.prNumber,
    prStatus: row.prStatus,
    lastAutoCommitEvent: events.lastAutoCommitEvent,
    lastAutoPrEvent: events.lastAutoPrEvent,
    url: buildSessionUrl(row.sessionId),
    finishedAt: toIsoString(row.finishedAt) ?? "",
  };
}
