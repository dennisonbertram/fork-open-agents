import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { InferenceProfilesSection } from "../inference-profiles-section";
import { ModelVariantsSection } from "../model-variants-section";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { ModelPreferencesSection } from "./models-preferences-section";

export const metadata: Metadata = toNextMetadata("models");

export default function ModelsPage() {
  const route = getSettingsRouteMetadata("models");

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={route.title} description={route.description} />

      <ModelPreferencesSection />

      <div className="border-t border-border/50" />

      <InferenceProfilesSection />

      <div className="border-t border-border/50" />

      <ModelVariantsSection />
    </div>
  );
}
