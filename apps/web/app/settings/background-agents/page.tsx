import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { BackgroundAgentsSection } from "../background-agents-section";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";

export const metadata: Metadata = toNextMetadata("background-agents");

export default function BackgroundAgentsPage() {
  const route = getSettingsRouteMetadata("background-agents");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <BackgroundAgentsSection />
    </>
  );
}
