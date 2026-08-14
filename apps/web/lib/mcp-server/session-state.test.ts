import { describe, expect, test } from "bun:test";
import {
  RUN_SLOT_STALE_MS,
  toActivityState,
  toLastRunOutcome,
  toWorkspaceState,
  WORKSPACE_SETUP_STALL_MS,
} from "./session-state";

/**
 * The state model exists to stop the API claiming things that are not true.
 * The `status: "running"` field it replaced was wrong for 24 of 25 sessions in
 * production, and the first cut of the replacement repeated the mistake in two
 * new places: it read `workspace` straight off `sessions.lifecycle_state`
 * (which says "active" for sandboxes that expired nine days ago) and `activity`
 * straight off `chats.active_stream_id` (which the codebase explicitly
 * documents as the wrong column to trust — see the contract on
 * `reconcileChatRunSlot` in lib/chat/start-run.ts).
 *
 * Every case below is a production row shape, not a hypothetical.
 */
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("toWorkspaceState", () => {
  test("reports ready only while the sandbox is actually live", () => {
    expect(
      toWorkspaceState({
        lifecycleState: "active",
        sandboxExpiresAt: new Date(NOW + HOUR_MS),
        lifecycleUpdatedAt: new Date(NOW - MINUTE_MS),
        now: NOW,
      }),
    ).toBe("ready");
  });

  test("an expired sandbox is not ready, however the lifecycle column reads", () => {
    // 6 of the 7 non-archived production sessions with lifecycle_state
    // 'active' had sandbox_expires_at between 45 and 227 hours in the past.
    // Reporting "ready" — documented as "live and usable right now" — sends an
    // agent straight at a sandbox that died nine days ago.
    expect(
      toWorkspaceState({
        lifecycleState: "active",
        sandboxExpiresAt: new Date(NOW - 226 * HOUR_MS),
        lifecycleUpdatedAt: new Date(NOW - 226 * HOUR_MS),
        now: NOW,
      }),
    ).toBe("hibernated");
  });

  test("an 'active' session that never recorded an expiry is not ready either", () => {
    // The 7th such production row (a smoke-test session) has both
    // sandbox_state and sandbox_expires_at NULL.
    expect(
      toWorkspaceState({
        lifecycleState: "active",
        sandboxExpiresAt: null,
        lifecycleUpdatedAt: new Date(NOW - HOUR_MS),
        now: NOW,
      }),
    ).toBe("hibernated");
  });

  test("an expiry inside the safety buffer counts as gone, not ready", () => {
    expect(
      toWorkspaceState({
        lifecycleState: "active",
        sandboxExpiresAt: new Date(NOW + 1000),
        lifecycleUpdatedAt: new Date(NOW),
        now: NOW,
      }),
    ).toBe("hibernated");
  });

  test("provisioning is reported while setup is plausibly still running", () => {
    expect(
      toWorkspaceState({
        lifecycleState: "provisioning",
        sandboxExpiresAt: null,
        lifecycleUpdatedAt: new Date(NOW - MINUTE_MS),
        now: NOW,
      }),
    ).toBe("provisioning");
  });

  test("provisioning that stopped moving is reported failed, so a poll loop terminates", () => {
    // start_session tells the caller to poll until workspace reports ready.
    // Seven production sessions have sat in 'provisioning' for between 19
    // hours and 81 days with nothing sweeping them, so that loop never ends —
    // the same never-terminates defect the contract test was written for.
    expect(
      toWorkspaceState({
        lifecycleState: "provisioning",
        sandboxExpiresAt: null,
        lifecycleUpdatedAt: new Date(
          NOW - WORKSPACE_SETUP_STALL_MS - MINUTE_MS,
        ),
        now: NOW,
      }),
    ).toBe("failed");
  });

  test("restoring that stopped moving is reported failed too", () => {
    expect(
      toWorkspaceState({
        lifecycleState: "restoring",
        sandboxExpiresAt: null,
        lifecycleUpdatedAt: new Date(
          NOW - WORKSPACE_SETUP_STALL_MS - MINUTE_MS,
        ),
        now: NOW,
      }),
    ).toBe("failed");
  });

  test("hibernating and hibernated both report the resting state", () => {
    for (const lifecycleState of ["hibernating", "hibernated"]) {
      expect(
        toWorkspaceState({
          lifecycleState,
          sandboxExpiresAt: null,
          lifecycleUpdatedAt: new Date(NOW - HOUR_MS),
          now: NOW,
        }),
      ).toBe("hibernated");
    }
  });

  test("an archived or never-provisioned session has no workspace", () => {
    for (const lifecycleState of ["archived", null, undefined]) {
      expect(
        toWorkspaceState({
          lifecycleState,
          sandboxExpiresAt: null,
          lifecycleUpdatedAt: null,
          now: NOW,
        }),
      ).toBe("none");
    }
  });

  test("reads a raw driver timestamp string as UTC, not as local time", () => {
    // postgres-js hands back "2026-08-12 13:00:00" with no offset for a
    // `timestamp` column; parsing that as local time shifts the expiry by the
    // server's UTC offset and flips ready/not-ready near the boundary.
    expect(
      toWorkspaceState({
        lifecycleState: "active",
        sandboxExpiresAt: "2026-08-12 13:00:00",
        lifecycleUpdatedAt: "2026-08-12 11:59:00",
        now: NOW,
      }),
    ).toBe("ready");
  });
});

describe("toActivityState", () => {
  test("a freshly claimed run slot reports working", () => {
    expect(
      toActivityState({
        hasActiveRunSlot: true,
        lastActivityAt: isoAgo(30 * 1000),
        now: NOW,
      }),
    ).toBe("working");
  });

  test("a long-running turn still reports working", () => {
    // The bound must sit above the longest sandbox lifetime so a genuinely
    // live run is never reported idle.
    expect(
      toActivityState({
        hasActiveRunSlot: true,
        lastActivityAt: isoAgo(5 * HOUR_MS),
        now: NOW,
      }),
    ).toBe("working");
  });

  test("a run slot older than any possible run is stale, not working", () => {
    // Exactly one production chat holds a non-null active_stream_id: it was
    // last touched 1456 hours (60 days) ago. Reporting it as "working" makes
    // an agent wait forever for a run that ended two months ago, or refuse to
    // send because it believes something is already live.
    expect(
      toActivityState({
        hasActiveRunSlot: true,
        lastActivityAt: isoAgo(RUN_SLOT_STALE_MS + HOUR_MS),
        now: NOW,
      }),
    ).toBe("idle");
  });

  test("no run slot is idle regardless of recency", () => {
    expect(
      toActivityState({
        hasActiveRunSlot: false,
        lastActivityAt: isoAgo(1000),
        now: NOW,
      }),
    ).toBe("idle");
  });

  test("a claimed slot with no timestamp at all is reported working", () => {
    // Erring toward "working" here is the safe direction: it makes a caller
    // wait or re-check rather than start a second billed run alongside a live
    // one.
    expect(
      toActivityState({
        hasActiveRunSlot: true,
        lastActivityAt: null,
        now: NOW,
      }),
    ).toBe("working");
  });
});

/**
 * #1241: `lastRunOutcome` is a third, distinct axis from `state` (filing) and
 * `activity` (is a run live right now) — it answers "how did the last
 * completed run end". Before this, a stalled run, a step-capped run, and a
 * genuinely finished run all reported the same thing through get_session,
 * because nothing downstream of `workflow_runs.status` distinguished them.
 */
describe("toLastRunOutcome", () => {
  test("a session with no run yet reports null, not a made-up status", () => {
    expect(toLastRunOutcome(null)).toBeNull();
    expect(toLastRunOutcome(undefined)).toBeNull();
  });

  test("a finished run reports completed", () => {
    expect(toLastRunOutcome("completed")).toBe("completed");
  });

  test("a user-stopped run reports aborted", () => {
    expect(toLastRunOutcome("aborted")).toBe("aborted");
  });

  test("a crash reports failed, distinguishable from every deliberate stop", () => {
    expect(toLastRunOutcome("failed")).toBe("failed");
  });

  test("the no-progress fuse names itself", () => {
    expect(toLastRunOutcome("no_progress_fuse")).toBe("no_progress_fuse");
  });

  test("the no-sandbox step cap names itself, distinct from the fuse", () => {
    expect(toLastRunOutcome("no_sandbox_step_cap")).toBe(
      "no_sandbox_step_cap",
    );
  });

  test("exhausting maxSteps names itself", () => {
    expect(toLastRunOutcome("max_steps")).toBe("max_steps");
  });

  test("repeated tool failure names itself", () => {
    expect(toLastRunOutcome("repeated_tool_failure")).toBe(
      "repeated_tool_failure",
    );
  });

  test("an unrecognized stored value reports null rather than inventing a status", () => {
    // Defensive: a historical or corrupted row must never be echoed back as a
    // typed outcome the schema does not advertise.
    expect(toLastRunOutcome("some-legacy-value")).toBeNull();
  });
});
