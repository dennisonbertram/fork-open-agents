import type { Metadata } from "next";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { AdminContent } from "./admin-content";

export const metadata: Metadata = toNextMetadata("admin");

export default function AdminPage() {
  const route = getSettingsRouteMetadata("admin");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <AdminContent />
    </>
  );
}
