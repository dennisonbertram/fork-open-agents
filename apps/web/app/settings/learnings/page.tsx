import type { Metadata } from "next";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { LearningsSection } from "./learnings-section";

export const metadata: Metadata = {
  title: "Learnings",
  description:
    "Durable patterns, gotchas, and conventions your repos have learned from pull requests.",
};

export default function LearningsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Learnings"
        description="Durable patterns, gotchas, and conventions your repos have learned from pull requests."
      />
      <LearningsSection />
    </>
  );
}
