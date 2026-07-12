import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { parseAutomationFilters } from "@/lib/automations/filters";
import { listAutomations } from "@/lib/automations/store";
import { getServerSession } from "@/lib/session/get-server-session";
import { AutomationsList } from "./automations-list";

export const metadata: Metadata = {
  title: "Automations",
  description: "Manage single-step and multi-step coding automations.",
};

type AutomationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toUrlSearchParams(
  values: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

export default async function AutomationsPage({
  searchParams,
}: AutomationsPageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect("/");

  const rawSearchParams = await searchParams;
  const parsed = parseAutomationFilters(toUrlSearchParams(rawSearchParams));
  if (!parsed.ok) redirect("/automations");

  const snapshot = await listAutomations({
    userId: session.user.id,
    filters: parsed.filters,
  });
  return (
    <AutomationsList
      filters={parsed.filters}
      response={{ requestId: crypto.randomUUID(), ...snapshot }}
    />
  );
}
