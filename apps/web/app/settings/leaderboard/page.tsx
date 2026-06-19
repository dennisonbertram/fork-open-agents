import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { LeaderboardSection } from "../leaderboard-section";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";

export const metadata: Metadata = toNextMetadata("leaderboard");

export default function LeaderboardPage() {
  const route = getSettingsRouteMetadata("leaderboard");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <LeaderboardSection />
    </>
  );
}
