import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { SkillsSection } from "./skills-section";

export const metadata: Metadata = toNextMetadata("skills");

export default function SkillsPage() {
  const route = getSettingsRouteMetadata("skills");

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={route.title} description={route.description} />

      <SkillsSection />
    </div>
  );
}
