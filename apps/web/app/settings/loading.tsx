import { AccountsSectionSkeleton } from "./accounts-section";
import { SettingsPageHeader } from "./_components/page-header";
import { InferenceProfilesSectionSkeleton } from "./inference-profiles-section";
import { LeaderboardSectionSkeleton } from "./leaderboard-section";
import { ModelVariantsSectionSkeleton } from "./model-variants-section";
import {
  ModelPreferencesSectionSkeleton,
  PreferencesSectionSkeleton,
} from "./preferences-section";
import {
  getSettingsRouteMetadata,
  type SettingsRouteId,
} from "./settings-routes";
import { VercelSectionSkeleton } from "./vercel-section";

function LoadingHeader({ routeId }: { routeId: SettingsRouteId }) {
  const route = getSettingsRouteMetadata(routeId);

  return (
    <SettingsPageHeader title={route.title} description={route.description} />
  );
}

function ProfilePageLoading() {
  return (
    <>
      <LoadingHeader routeId="profile" />
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
        <div className="w-full shrink-0 lg:w-56">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 shrink-0 rounded-full bg-muted" />
              <div className="space-y-1.5">
                <div className="h-5 w-28 rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-muted" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-8">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Activity
              </h2>
            </div>
            <div className="h-[96px] w-full rounded-md bg-muted" />
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="h-28 rounded-xl bg-muted" />
            <div className="h-28 rounded-xl bg-muted" />
            <div className="h-28 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    </>
  );
}

function ConnectionsPageLoading() {
  return (
    <>
      <LoadingHeader routeId="connections" />
      <VercelSectionSkeleton />
      <AccountsSectionSkeleton />
    </>
  );
}

function PreferencesPageLoading() {
  return (
    <div className="space-y-6">
      <LoadingHeader routeId="preferences" />
      <PreferencesSectionSkeleton />
    </div>
  );
}

function ModelsPageLoading() {
  return (
    <div className="space-y-8">
      <LoadingHeader routeId="models" />
      <ModelPreferencesSectionSkeleton />
      <div className="border-t border-border/50" />
      <InferenceProfilesSectionSkeleton />
      <div className="border-t border-border/50" />
      <ModelVariantsSectionSkeleton />
    </div>
  );
}

function LeaderboardPageLoading() {
  return (
    <div className="space-y-6">
      <LoadingHeader routeId="leaderboard" />
      <LeaderboardSectionSkeleton />
    </div>
  );
}

export default function SettingsLoading() {
  return <ProfilePageLoading />;
}

export {
  ConnectionsPageLoading,
  LeaderboardPageLoading,
  ModelsPageLoading,
  PreferencesPageLoading,
  ProfilePageLoading,
};
