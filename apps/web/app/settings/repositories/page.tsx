import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { RepositoriesPicker } from "./repositories-picker";

export const metadata: Metadata = toNextMetadata("repositories");

export default function RepositoriesPage() {
  const route = getSettingsRouteMetadata("repositories");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <RepositoriesPicker />
    </>
  );
}
