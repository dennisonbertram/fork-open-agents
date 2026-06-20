import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPageHeader } from "../_components/page-header";
import { AccountsSection, AccountsSectionSkeleton } from "../accounts-section";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { VercelSection, VercelSectionSkeleton } from "../vercel-section";

export const metadata: Metadata = toNextMetadata("connections");

export default function ConnectionsPage() {
  const route = getSettingsRouteMetadata("connections");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <Suspense fallback={<VercelSectionSkeleton />}>
        <VercelSection />
      </Suspense>
      <Suspense fallback={<AccountsSectionSkeleton />}>
        <AccountsSection />
      </Suspense>
    </>
  );
}
