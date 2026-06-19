"use client";

import Link from "next/link";
import type { LeaderboardRankResponse } from "@/app/api/usage/rank/route";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The user's live leaderboard standing, shown under their identity on the
 * profile page. Honest by construction: a skeleton while loading, nothing when
 * the user has no eligible domain, and a real, clickable rank otherwise.
 */
export function ProfileRank({
  rank,
  loading,
}: {
  rank: LeaderboardRankResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-4 w-24" />;
  }
  if (!rank) {
    return null;
  }
  return (
    <Link
      href="/settings/leaderboard"
      className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
    >
      Your rank: #{rank.rank} of {rank.total} · {rank.domain}
    </Link>
  );
}
