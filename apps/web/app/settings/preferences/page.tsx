import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { PreferencesSection } from "../preferences-section";

export const metadata: Metadata = toNextMetadata("preferences");

export default function PreferencesPage() {
  const route = getSettingsRouteMetadata("preferences");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <PreferencesSection />
    </>
  );
}
