import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { McpSection } from "../mcp-section";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";

export const metadata: Metadata = toNextMetadata("mcp");

export default function McpPage() {
  const route = getSettingsRouteMetadata("mcp");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <McpSection />
    </>
  );
}
