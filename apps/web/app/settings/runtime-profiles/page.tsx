import type { Metadata } from "next";
import { getServerSession } from "@/lib/session/get-server-session";
import { listUserDefaultProfiles } from "@/lib/db/managed-runtime-saved-profiles";
import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { RuntimeProfilesSection } from "./runtime-profiles-section";

export const metadata: Metadata = {
  title: "Runtime profiles",
  description:
    "Create, edit, and delete reusable managed-runtime profiles for your sessions.",
};

export default async function RuntimeProfilesPage() {
  const session = await getServerSession();
  if (!session?.user) {
    return null;
  }

  const [userProfiles, builtInProfiles] = await Promise.all([
    listUserDefaultProfiles({ userId: session.user.id }),
    Promise.resolve(listManagedRuntimeProfiles()),
  ]);

  return (
    <>
      <SettingsPageHeader
        title="Runtime profiles"
        description="A runtime profile is the toolchain and setup a session uses when it provisions a sandbox. Create reusable profiles here and select one as your default in Preferences."
      />
      <RuntimeProfilesSection
        initialUserProfiles={userProfiles}
        builtInProfiles={builtInProfiles}
      />
    </>
  );
}
