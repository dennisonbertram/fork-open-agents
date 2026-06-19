import type { Metadata } from "next";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { PreferencesSection } from "../preferences-section";

export const metadata: Metadata = {
  title: "Preferences",
  description: "Adjust Open Agents preferences and behavior.",
};

export default function PreferencesPage() {
  return (
    <>
      <SettingsPageHeader
        title="Preferences"
        description="Tune how Open Agents behaves for you. Changes apply to new chats right away."
      />
      <PreferencesSection />
    </>
  );
}
