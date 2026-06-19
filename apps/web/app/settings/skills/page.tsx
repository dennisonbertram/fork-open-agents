import type { Metadata } from "next";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { SkillsSection } from "./skills-section";

export const metadata: Metadata = {
  title: "Skills",
  description:
    "Create and manage reusable skills your agents can run, with AI-assisted authoring.",
};

export default function SkillsPage() {
  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Skills"
        description="Author reusable instructions your agents can run like tools. Build them by hand or generate a draft with AI, then enable the ones you want available in every chat."
      />

      <SkillsSection />
    </div>
  );
}
