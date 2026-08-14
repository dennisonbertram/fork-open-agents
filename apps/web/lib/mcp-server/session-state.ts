import { SANDBOX_EXPIRES_BUFFER_MS } from "@/lib/sandbox/config";
import { type CoercibleTimestamp, toEpochMs } from "./timestamps";

/**
 * The state an MCP client sees for a session.
 *
 * Three orthogonal things used to be crammed into one `status` field, which is
 * why it was wrong for 24 of 25 sessions in production:
 *
 *   `state`     filing — did the user archive it. Nothing else.
 *   `workspace` the SANDBOX's own lifecycle, independent of filing.
 *   `activity`  whether a run is live right now.
 *
 * `resumable` answers the one question a caller actually acts on: can I
 * continue this session. It tracks the precondition the write path enforces
 * (`requireOwnedSession(..., { rejectArchived: true })`), not the workspace —
 * every non-archived session accepts a message, and the workflow provisions or
 * restores a sandbox on demand.
 */
export type McpSessionState = "active" | "archived";
export type McpWorkspaceState =
  | "ready"
  | "hibernated"
  | "provisioning"
  | "restoring"
  | "failed"
  | "none";
export type McpActivityState = "working" | "idle";

// TDD red stub (#1241) — replaced by the real derivation in the green commit.
export function toLastRunOutcome(_status: string | null | undefined): unknown {
  throw new Error("not implemented");
}

/**
 * How long a workspace may sit in a transitional state before the API stops
 * claiming it is still setting up.
 *
 * Nothing sweeps abandoned `provisioning` rows: production holds seven that
 * have been frozen there for between 19 hours and 81 days. `start_session`
 * tells callers to poll until the workspace is ready, so an unbounded
 * transitional state is an unbounded poll loop. This is a display bound, not a
 * controller — it never cancels anything, it only stops the API asserting that
 * setup is still in progress when it demonstrably is not.
 */
export const WORKSPACE_SETUP_STALL_MS = 15 * 60 * 1000;

/**
 * How old a claimed run slot may be before it is treated as stale.
 *
 * `chats.active_stream_id` cannot be trusted raw — `reconcileChatRunSlot`
 * (lib/chat/start-run.ts) is the definitive check, and it is deliberately not
 * called from these tools because it clears the slot via compare-and-set, a
 * write the read tools' `readOnlyHint: true` annotation promises they do not
 * make. The bound below is the read-only approximation: it sits comfortably
 * above the longest possible sandbox lifetime (5 hours), so no genuinely live
 * run is ever reported idle, while the 60-day-old slot sitting in production
 * stops being reported as live work.
 */
export const RUN_SLOT_STALE_MS = 6 * 60 * 60 * 1000;

export function toSessionState(
  status: string | null | undefined,
): McpSessionState {
  return status === "archived" ? "archived" : "active";
}

/** Every non-archived session accepts a message; that is the whole gate. */
export function isResumable(state: McpSessionState): boolean {
  return state !== "archived";
}

/**
 * Map the sandbox's lifecycle onto the vocabulary exposed as `workspace`.
 *
 *   null / "archived" -> "none"          no workspace to speak of
 *   "provisioning"    -> "provisioning"  first-time setup, still moving
 *                     -> "failed"        ... or stopped moving (see above)
 *   "restoring"       -> "restoring"     waking from hibernation, still moving
 *                     -> "failed"        ... or stopped moving
 *   "active"          -> "ready"         sandbox is live RIGHT NOW
 *                     -> "hibernated"    ... or its expiry has passed
 *   "hibernating"     -> "hibernated"    parked, or on the way there — resumes
 *   "hibernated"      -> "hibernated"    automatically on the next message
 *   "failed"          -> "failed"        setup or restore failed
 *
 * `lifecycle_state` alone is not enough for "ready". It is orchestration
 * bookkeeping, not liveness: all 7 non-archived production sessions reading
 * 'active' had no live sandbox — 6 with an expiry between 45 and 227 hours in
 * the past, 1 with none recorded at all. Claiming those are "live and usable
 * right now" is the same lie as the `status: "running"` field this replaced.
 */
export function toWorkspaceState(input: {
  lifecycleState: string | null | undefined;
  /** `sessions.sandbox_expires_at` — the cheap liveness signal. */
  sandboxExpiresAt: CoercibleTimestamp;
  /** `sessions.updated_at` — how long the lifecycle column has been stuck. */
  lifecycleUpdatedAt: CoercibleTimestamp;
  now?: number;
}): McpWorkspaceState {
  const now = input.now ?? Date.now();

  switch (input.lifecycleState) {
    case "active":
      return isSandboxLive(input.sandboxExpiresAt, now)
        ? "ready"
        : "hibernated";
    case "provisioning":
      return hasStalled(input.lifecycleUpdatedAt, now)
        ? "failed"
        : "provisioning";
    case "restoring":
      return hasStalled(input.lifecycleUpdatedAt, now) ? "failed" : "restoring";
    case "hibernating":
    case "hibernated":
      return "hibernated";
    case "failed":
      return "failed";
    default:
      return "none";
  }
}

/**
 * Whether a run is live right now.
 *
 * `hasActiveRunSlot` is the raw `chats.active_stream_id IS NOT NULL` read; the
 * timestamp bounds it. Erring toward "working" when there is no timestamp is
 * the safe direction — it makes a caller wait or re-check rather than start a
 * second billed run alongside a live one.
 */
export function toActivityState(input: {
  hasActiveRunSlot: boolean;
  lastActivityAt: CoercibleTimestamp;
  now?: number;
}): McpActivityState {
  if (!input.hasActiveRunSlot) {
    return "idle";
  }
  const touchedAt = toEpochMs(input.lastActivityAt);
  if (touchedAt === null) {
    return "working";
  }
  const now = input.now ?? Date.now();
  return now - touchedAt > RUN_SLOT_STALE_MS ? "idle" : "working";
}

function isSandboxLive(expiresAt: CoercibleTimestamp, now: number): boolean {
  const expiresAtMs = toEpochMs(expiresAt);
  if (expiresAtMs === null) {
    return false;
  }
  // Same buffer the sandbox status route applies, so "ready" here and a live
  // reconnect there agree on where the edge is.
  return now < expiresAtMs - SANDBOX_EXPIRES_BUFFER_MS;
}

function hasStalled(updatedAt: CoercibleTimestamp, now: number): boolean {
  const updatedAtMs = toEpochMs(updatedAt);
  if (updatedAtMs === null) {
    return false;
  }
  return now - updatedAtMs > WORKSPACE_SETUP_STALL_MS;
}
