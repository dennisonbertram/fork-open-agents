import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  SettingsPageHeader,
  SettingsSection,
} from "@/components/ui/settings-section";
import { getServerSession } from "@/lib/session/get-server-session";
import { ActionsDashboardClient } from "./actions-dashboard-client";

export const metadata: Metadata = {
  title: "Actions",
  description: "View workflow runs and logs for this repository.",
};

type ActionsPageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function ActionsPage({ params }: ActionsPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo } = await params;

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <SettingsPageHeader
          title="Actions"
          description={`View workflow runs and logs for ${owner}/${repo}.`}
        />
        <SettingsSection
          title="Workflow runs"
          description="Read-only status, jobs, and logs from GitHub Actions."
        >
          <ActionsDashboardClient owner={owner} repo={repo} />
        </SettingsSection>
      </div>
    </main>
  );
}
