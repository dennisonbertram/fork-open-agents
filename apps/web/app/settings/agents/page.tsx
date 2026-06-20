import type { Metadata } from "next";
import Link from "next/link";
import { SettingsPageHeader } from "../_components/page-header";
import { getSettingsRouteMetadata, toNextMetadata } from "../settings-routes";
import { AgentsLoader } from "./agents-loader";

export const metadata: Metadata = toNextMetadata("agents");

export default function AgentsPage() {
  const route = getSettingsRouteMetadata("agents");

  return (
    <>
      <SettingsPageHeader title={route.title} description={route.description} />
      <p className="text-sm text-muted-foreground">
        Looking for triggered automations?{" "}
        <Link
          href="/settings/background-agents"
          className="underline underline-offset-2 hover:text-foreground"
        >
          See Background agents &rarr;
        </Link>
      </p>
      <AgentsLoader />
    </>
  );
}
