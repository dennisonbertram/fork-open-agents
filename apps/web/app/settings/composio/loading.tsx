import { SettingsPageHeader } from "../_components/page-header";
import { ComposioSectionSkeleton } from "../composio-section";
import { getSettingsRouteMetadata } from "../settings-routes";

export default function Loading() {
  const route = getSettingsRouteMetadata("composio");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <ComposioSectionSkeleton />
    </>
  );
}
