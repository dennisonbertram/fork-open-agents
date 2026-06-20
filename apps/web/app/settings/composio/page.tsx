import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { ComposioSection } from "../composio-section";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";

export const metadata: Metadata = toNextMetadata("composio");

export default function ComposioPage() {
  const route = getSettingsRouteMetadata("composio");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <ComposioSection />
    </>
  );
}
