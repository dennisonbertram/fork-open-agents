"use client";

import { Github, Settings } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";
import type { ComposioSettingsResponse } from "@/app/api/settings/composio/route";
import { summarizeChatTools } from "@/lib/composio/chat-tool-summary";
import { markDisconnectedProfilesUnavailable } from "@/lib/composio/profile-option-availability";
import type { ChatComposioSelection } from "@/lib/composio/types";
import { cn } from "@/lib/utils";
import { ComposioToolkitPicker } from "@/app/settings/composio-toolkit-picker";
import {
  ToolIconStack,
  buildToolIconItems,
} from "@/components/tool-icon-stack";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ComposioToolSelectorCompactProps {
  selection: ChatComposioSelection;
  disabled?: boolean;
  repoOwner?: string | null;
  repoName?: string | null;
  githubConnected?: boolean;
  onChange: (selection: ChatComposioSelection) => void;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return (await response.json()) as T;
}

export function ComposioToolSelectorCompact({
  selection,
  disabled = false,
  repoOwner,
  repoName,
  githubConnected = false,
  onChange,
}: ComposioToolSelectorCompactProps) {
  const settingsUrl =
    repoOwner && repoName
      ? `/api/settings/composio?${new URLSearchParams({
          repoOwner,
          repoName,
        }).toString()}`
      : "/api/settings/composio";
  const { data, isLoading } = useSWR<ComposioSettingsResponse>(
    settingsUrl,
    fetchJson<ComposioSettingsResponse>,
  );
  const { data: toolkitsData } = useSWR<ComposioToolkitsResponse>(
    "/api/composio/toolkits",
    fetchJson<ComposioToolkitsResponse>,
  );
  const { data: accountsData } = useSWR<ComposioConnectedAccountsResponse>(
    "/api/composio/connected-accounts",
    fetchJson<ComposioConnectedAccountsResponse>,
  );
  const selectedProfile =
    data?.profiles.find((profile) => profile.id === selection.mainProfileId) ??
    null;
  const hasProfiles = (data?.profiles.length ?? 0) > 0;
  const isUnavailable = data
    ? !data.status.configured || !data.status.available
    : false;
  const isDisabled = disabled || isLoading;

  const directSlugs = selection.directToolkitSlugs ?? [];
  const hasDirectSlugs = directSlugs.length > 0;

  const disabledReason = isUnavailable
    ? data?.status.message
    : hasProfiles || hasDirectSlugs
      ? null
      : "No Composio profiles configured";

  const activeToolkits = hasDirectSlugs
    ? directSlugs
    : (selectedProfile?.toolkitSlugs ?? []);

  const profileOptions = markDisconnectedProfilesUnavailable({
    profiles:
      data?.profileOptions ??
      data?.profiles.map((profile) => ({
        ...profile,
        available: true,
        disabledReason: null,
      })) ??
      [],
    toolkits: toolkitsData?.toolkits ?? [],
    connectedAccounts: accountsData?.accounts ?? [],
  });

  const activeProfileId = hasDirectSlugs
    ? ""
    : (selection.mainProfileId ?? "off");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isDisabled}
          aria-label="Select external tools"
          title={disabledReason ?? "Select external tools"}
          className={cn(
            "flex h-8 max-w-[180px] items-center gap-1.5 rounded-md px-2.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300 disabled:pointer-events-none disabled:opacity-60",
            (selectedProfile || hasDirectSlugs) && "text-foreground",
          )}
        >
          <ToolIconStack
            items={buildToolIconItems({
              activeToolkits,
              githubConnected,
            })}
            maxVisible={3}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] max-h-[480px] overflow-y-auto p-3"
      >
        {githubConnected && (
          <div className="mb-3 rounded-md border border-border/60 bg-muted/20 p-2">
            <p className="mb-1 text-xs font-medium text-foreground">
              Native connections
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Github className="size-3.5 shrink-0 text-foreground" />
              <span>GitHub</span>
              <span className="text-[10px] text-muted-foreground/60">
                Always on for this repo
              </span>
            </div>
          </div>
        )}

        <p className="mb-2 text-xs font-semibold text-foreground">
          Tools this chat can use
        </p>

        {/* Direct toolkit picker — "Choose specific tools" */}
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium text-foreground">
            Choose specific tools
          </p>
          <ComposioToolkitPicker
            selectedSlugs={directSlugs}
            onChange={(slugs) => {
              onChange({
                ...selection,
                directToolkitSlugs: slugs,
                mainProfileId:
                  slugs.length > 0 ? null : selection.mainProfileId,
              });
            }}
            disabled={isDisabled}
            repoOwner={repoOwner}
            repoName={repoName}
          />
        </div>

        {/* Saved profiles — alternative to direct picker */}
        {hasProfiles ? (
          <>
            <div className="my-2 border-t border-border/60" />
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Or use a saved profile
            </p>
            {isUnavailable ? (
              <div className="mb-2 text-xs text-destructive">
                {data?.status.message ?? "Composio is unavailable."}
              </div>
            ) : null}
            <div className="space-y-1">
              {/* "Off" option */}
              <button
                type="button"
                onClick={() => {
                  onChange({
                    ...selection,
                    mainProfileId: null,
                    directToolkitSlugs: [],
                  });
                }}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  activeProfileId === "off" &&
                    "bg-accent text-accent-foreground",
                )}
              >
                Off
              </button>
              {profileOptions.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  disabled={!profile.available}
                  title={profile.disabledReason ?? profile.name}
                  onClick={() => {
                    onChange({
                      ...selection,
                      mainProfileId: profile.id,
                      directToolkitSlugs: [],
                    });
                  }}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                    activeProfileId === profile.id &&
                      "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{profile.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {profile.disabledReason ??
                        summarizeChatTools(profile.toolkitSlugs, 4)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className="mt-3 border-t border-border/60 pt-2">
          <Link
            href="/settings/composio"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Settings className="size-3.5" />
            Manage Composio
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
