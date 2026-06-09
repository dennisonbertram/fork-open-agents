import { Trophy } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * Delightful gated/empty states for the leaderboard, replacing bare muted
 * sentences. Two reasons:
 * - "no-domain": the user has no eligible work-email domain (no misleading CTA).
 * - "no-data": eligible, but nobody has usage in this range yet (first-run).
 */
export function LeaderboardEmptyState({
  reason,
}: {
  reason: "no-domain" | "no-data";
}) {
  const description =
    reason === "no-domain"
      ? "Leaderboards are grouped by work email domain. Sign in with your work account to join your team's board."
      : "The leaderboard ranks people in your workspace by agent usage. As you and your teammates run agents, you'll show up here.";

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Trophy />
        </EmptyMedia>
        <EmptyTitle>No leaderboard yet</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
