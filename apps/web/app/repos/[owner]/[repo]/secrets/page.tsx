import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  SettingsPageHeader,
  SettingsSection,
} from "@/components/ui/settings-section";
import { getServerSession } from "@/lib/session/get-server-session";
import { RepositorySecretsClient } from "./repository-secrets-client";

export const metadata: Metadata = {
  title: "Secrets",
  description: "View and manage repository Actions secrets.",
};

type SecretsPageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function SecretsPage({ params }: SecretsPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const { owner, repo } = await params;

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <SettingsPageHeader
          title="Secrets"
          description={`View repository Actions secret names for ${owner}/${repo}.`}
        />
        <SettingsSection
          title="Repository secrets"
          description="GitHub never returns secret values, so we only show names."
        >
          <RepositorySecretsClient owner={owner} repo={repo} />
        </SettingsSection>
      </div>
    </main>
  );
}
