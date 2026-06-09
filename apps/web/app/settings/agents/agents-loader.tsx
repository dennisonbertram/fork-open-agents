"use client";

import useSWR from "swr";
import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import { fetcher } from "@/lib/swr";
import type { ComposioSettingsResponse } from "@/app/api/settings/composio/route";
import type { UserPreferences } from "@/hooks/use-user-preferences";
import type { ComposioToolProfileSummary } from "@/lib/composio/types";
import { defaultComposioAgentDefaults } from "@/lib/composio/types";
import { AgentsSectionSkeleton, AgentsSection } from "./agents-section";
import { buildAgentRoster } from "./agents-roster";

const RUNTIME_PROFILES = listManagedRuntimeProfiles();

interface PreferencesResponse {
  preferences: UserPreferences;
}

/**
 * Fetches preferences + composio defaults and renders the AgentsSection.
 * Falls back gracefully if either API is unavailable.
 */
export function AgentsLoader() {
  const { data: prefsData, isLoading: prefsLoading } =
    useSWR<PreferencesResponse>("/api/settings/preferences", fetcher);

  const { data: composioData, isLoading: composioLoading } =
    useSWR<ComposioSettingsResponse>("/api/settings/composio", fetcher);

  if (prefsLoading || composioLoading) {
    return <AgentsSectionSkeleton />;
  }

  const preferences = prefsData?.preferences ?? {
    defaultModelId: "anthropic/claude-opus-4-5",
    defaultSubagentModelId: null,
    defaultManagedRuntimeProfileId: "web-bun-agent-browser",
  };

  const composioDefaults =
    composioData?.defaults ?? defaultComposioAgentDefaults;

  const profileSummaries: ComposioToolProfileSummary[] =
    composioData?.profiles ?? [];

  const rows = buildAgentRoster({
    preferences,
    composioDefaults,
    runtimeProfiles: RUNTIME_PROFILES,
    profileSummaries,
  });

  return <AgentsSection rows={rows} />;
}
