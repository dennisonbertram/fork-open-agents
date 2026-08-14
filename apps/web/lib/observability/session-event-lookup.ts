import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessionEvents } from "@/lib/db/schema";
import { toSessionEventSnapshot, type SessionEventSnapshot } from "./events";

/**
 * The single most recent `session_events` row for a session whose
 * `eventName` is one of `eventNames`, or null when none exists.
 *
 * Built for get_session's git-automation-failure signal (#1246): auto-commit
 * and auto-PR outcomes are already recorded as session_events by
 * app/workflows/chat.ts (`workflow.auto_commit.*`, `workflow.auto_pr.*`).
 * This is the read path the issue asks for — it reuses that event vocabulary
 * verbatim (eventName + status + summary) rather than inventing a parallel
 * outcome enum.
 *
 * "Most recent wins": if a session's most recent auto-commit attempt
 * succeeded, this returns the succeeded row, not a stale failure from an
 * earlier run on the same session — a caller reading `status` off the result
 * always sees the current state, not history.
 */
export async function getLatestSessionEventByNames(params: {
  sessionId: string;
  eventNames: readonly string[];
}): Promise<SessionEventSnapshot | null> {
  const [event] = await db.query.sessionEvents.findMany({
    where: and(
      eq(sessionEvents.sessionId, params.sessionId),
      inArray(sessionEvents.eventName, [...params.eventNames]),
    ),
    orderBy: [desc(sessionEvents.createdAt)],
    limit: 1,
  });

  return event ? toSessionEventSnapshot(event) : null;
}
