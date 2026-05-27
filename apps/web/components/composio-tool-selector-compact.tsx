"use client";

import { Settings, Wrench } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import type { ComposioSettingsResponse } from "@/app/api/settings/composio/route";
import type { ChatComposioSelection } from "@/lib/composio/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ComposioToolSelectorCompactProps {
  selection: ChatComposioSelection;
  disabled?: boolean;
  repoOwner?: string | null;
  repoName?: string | null;
  onChange: (selection: ChatComposioSelection) => void;
}

async function fetchComposioSettings(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Composio settings");
  }
  return (await response.json()) as ComposioSettingsResponse;
}

export function ComposioToolSelectorCompact({
  selection,
  disabled = false,
  repoOwner,
  repoName,
  onChange,
}: ComposioToolSelectorCompactProps) {
  const settingsUrl =
    repoOwner && repoName
      ? `/api/settings/composio?${new URLSearchParams({
          repoOwner,
          repoName,
        }).toString()}`
      : "/api/settings/composio";
  const { data, isLoading } = useSWR(settingsUrl, fetchComposioSettings);
  const selectedProfile =
    data?.profiles.find((profile) => profile.id === selection.mainProfileId) ??
    null;
  const hasProfiles = (data?.profiles.length ?? 0) > 0;
  const isUnavailable = data
    ? !data.status.configured || !data.status.available
    : false;
  const disabledReason = isUnavailable
    ? data?.status.message
    : hasProfiles
      ? null
      : "No Composio profiles configured";
  const isDisabled = disabled || isLoading;
  const label = selectedProfile?.name ?? "Off";
  const profileOptions =
    data?.profileOptions ??
    data?.profiles.map((profile) => ({
      ...profile,
      available: true,
      disabledReason: null,
    })) ??
    [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isDisabled}
          aria-label="Select external tools"
          title={disabledReason ?? "Select external tools"}
          className={cn(
            "flex h-8 max-w-[180px] items-center gap-1.5 rounded-md px-2.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300 disabled:pointer-events-none disabled:opacity-60",
            selectedProfile && "text-foreground",
          )}
        >
          <Wrench className="size-3.5 shrink-0" />
          <span className="truncate">Tools: {label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          External tools
        </DropdownMenuLabel>
        {!hasProfiles ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No tool profiles yet.
          </div>
        ) : null}
        {isUnavailable ? (
          <div className="px-2 py-1.5 text-xs text-destructive">
            {data?.status.message ?? "Composio is unavailable."}
          </div>
        ) : null}
        <DropdownMenuRadioGroup
          value={selection.mainProfileId ?? "off"}
          onValueChange={(value) => {
            onChange({
              ...selection,
              mainProfileId: value === "off" ? null : value,
            });
          }}
        >
          <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
          {profileOptions.map((profile) => (
            <DropdownMenuRadioItem
              key={profile.id}
              value={profile.id}
              disabled={!profile.available}
              title={profile.disabledReason ?? profile.name}
            >
              <span className="min-w-0 truncate">{profile.name}</span>
              {profile.disabledReason ? (
                <span className="ml-auto max-w-[8rem] truncate text-[11px] text-muted-foreground">
                  {profile.disabledReason}
                </span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/composio">
            <Settings className="size-4" />
            Manage Composio
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
