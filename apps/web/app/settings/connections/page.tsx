import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { AccountsSection, AccountsSectionSkeleton } from "../accounts-section";
import { VercelSection, VercelSectionSkeleton } from "../vercel-section";

export const metadata: Metadata = {
  title: "Connections",
  description: "Manage your connected accounts and integrations.",
};

export default function ConnectionsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Connections"
        description="Link the accounts Open Agents uses to act on your behalf."
      />
      <Suspense fallback={<VercelSectionSkeleton />}>
        <VercelSection />
      </Suspense>
      <Suspense fallback={<AccountsSectionSkeleton />}>
        <AccountsSection />
      </Suspense>
    </>
  );
}
