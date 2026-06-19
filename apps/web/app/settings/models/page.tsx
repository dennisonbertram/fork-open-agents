import type { Metadata } from "next";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { InferenceProfilesSection } from "../inference-profiles-section";
import { ModelVariantsSection } from "../model-variants-section";
import { ModelPreferencesSection } from "./models-preferences-section";

export const metadata: Metadata = {
  title: "Models",
  description: "Configure model preferences and create model variants.",
};

export default function ModelsPage() {
  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Models"
        description="Pick the models your agents use and create named setups for specific jobs."
      />

      <ModelPreferencesSection />

      <div className="border-t border-border/50" />

      <InferenceProfilesSection />

      <div className="border-t border-border/50" />

      <ModelVariantsSection />
    </div>
  );
}
