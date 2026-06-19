import type { Metadata } from "next";
import Link from "next/link";
import { SettingsPageHeader } from "@/components/ui/settings-section";
import { AgentsLoader } from "./agents-loader";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "View the AI roles that run inside your chats — Main and the helper subagents it spawns.",
};

export default function AgentsPage() {
  return (
    <>
      <SettingsPageHeader
        title="Agents"
        description="Agents are the AI roles that work inside your chats — the one you talk to (Main) and the helpers it spawns. To set up agents that run on their own in a repo, see Background agents."
      />
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
