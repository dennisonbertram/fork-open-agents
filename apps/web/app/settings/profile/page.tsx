import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { ProfileContent } from "./profile-content";

export const metadata: Metadata = toNextMetadata("profile");

export default function ProfilePage() {
  const route = getSettingsRouteMetadata("profile");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <ProfileContent />
    </>
  );
}
