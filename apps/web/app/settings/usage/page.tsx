"use client";

import { SettingsPageHeader } from "@/components/ui/settings-section";
import { UsageSection } from "../usage-section";

export default function UsagePage() {
  return (
    <>
      <SettingsPageHeader
        title="Usage"
        description="See how much you've used Open Agents — tokens, cost, and your busiest repos."
      />
      <UsageSection />
    </>
  );
}
