"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import { useSessions } from "@/hooks/use-sessions";
import {
  deriveMobileStatus,
  sortActivity,
  matchesFilter,
} from "@/components/mobile/lib/status";
import { MobileScreenHeader } from "@/components/mobile/shell/mobile-screen-header";
import { MobileActivityFilterChips } from "@/components/mobile/activity/mobile-activity-filter-chips";
import { MobileSessionRow } from "@/components/mobile/activity/mobile-session-row";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ActivityFilter,
  SessionWithUnread,
} from "@/components/mobile/lib/types";

/**
 * Compute per-filter badge counts from the full (unfiltered) session list.
 */
function computeCounts(sessions: SessionWithUnread[]) {
  const counts = { all: sessions.length, working: 0, waiting: 0, done: 0 };
  for (const s of sessions) {
    const tone = deriveMobileStatus(s).tone;
    if (tone === "working") counts.working++;
    if (tone === "waiting") counts.waiting++;
    if (tone === "done") counts.done++;
  }
  return counts;
}

/**
 * Full Activity screen — real sessions from useSWR via useSessions.
 *
 * - Attention-first sort: working -> waiting -> idle -> done -> error.
 * - Filter chips narrow the list by tone; counts stay based on the full list.
 * - Row tap navigates to /m/chat/[latestChatId].
 */
export function MobileActivityScreen() {
  const router = useRouter();
  // Active sessions only (exclude archived) to match the desktop default view.
  const { sessions, loading } = useSessions({ includeArchived: false });
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const handleOpen = useCallback(
    (session: SessionWithUnread) => {
      if (session.latestChatId) {
        router.push(`/m/chat/${session.latestChatId}`);
      }
    },
    [router],
  );

  const sorted = sortActivity(sessions);
  const visible = sorted.filter((s) => matchesFilter(s, filter));
  const counts = computeCounts(sessions);

  return (
    <div className="flex min-h-dvh flex-col">
      <MobileScreenHeader title="Activity" />

      <MobileActivityFilterChips
        value={filter}
        counts={counts}
        onChange={setFilter}
      />

      <div className="flex-1 divide-y divide-border pb-[calc(env(safe-area-inset-bottom,0px)+64px)]">
        {loading ? (
          <SkeletonRows />
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          visible.map((session) => (
            <MobileSessionRow
              key={session.id}
              session={session}
              descriptor={deriveMobileStatus(session)}
              onOpen={handleOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <Skeleton className="mt-0.5 h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-2.5 w-8 rounded" />
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyState({ filter }: { filter: ActivityFilter }) {
  const message =
    filter === "all"
      ? "No sessions yet. Tap + to start one."
      : `No ${filter} sessions.`;

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Inbox
        className="h-10 w-10 text-muted-foreground/40"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
