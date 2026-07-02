import type { Metadata } from "next";
import { getServerSession } from "@/lib/session/get-server-session";
import { listUserDefaultProfiles } from "@/lib/db/managed-runtime-saved-profiles";
import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import {
  RuntimeProfilesSection,
  RuntimeProfilesSignInPrompt,
} from "./runtime-profiles-section";

export const metadata: Metadata = toNextMetadata("runtime-profiles");

export default async function RuntimeProfilesPage() {
  const session = await getServerSession();
  const route = getSettingsRouteMetadata("runtime-profiles");

  if (!session?.user) {
    return (
      <>
        <SettingsPageHeader
          description={route.description}
          title={route.title}
        />
        <RuntimeProfilesSignInPrompt />
      </>
    );
  }

  const [userProfiles, builtInProfiles] = await Promise.all([
    listUserDefaultProfiles({ userId: session.user.id }),
    Promise.resolve(listManagedRuntimeProfiles()),
  ]);

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <RuntimeProfilesSection
        initialUserProfiles={userProfiles}
        builtInProfiles={builtInProfiles}
      />
    </>
  );
}
