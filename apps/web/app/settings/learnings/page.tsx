import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { LearningsSection } from "./learnings-section";

export const metadata: Metadata = toNextMetadata("learnings");

export default function LearningsPage() {
  const route = getSettingsRouteMetadata("learnings");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <LearningsSection />
    </>
  );
}
