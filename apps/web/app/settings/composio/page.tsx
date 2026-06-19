import type { Metadata } from "next";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { ComposioSection } from "../composio-section";

export const metadata: Metadata = {
  title: "Composio",
  description: "Configure Composio tool profiles and agent access.",
};

export default function ComposioPage() {
  return (
    <>
      <SettingsPageHeader
        title="Composio"
        description="Connect external tools — like GitHub, Linear, or Gmail — so your agents can use them in a chat."
      />
      <ComposioSection />
    </>
  );
}
