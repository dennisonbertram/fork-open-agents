"use client";

import { ShieldCheck } from "lucide-react";
import type { ManagedRuntimeProfilesResponse } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ManagedRuntimeProfileEvidenceBadge,
  getManagedRuntimeProfileEvidenceSummary,
} from "./managed-runtime-profile-evidence-badge";
import { ManagedRuntimeProfileManager } from "./managed-runtime-profile-manager";

type RuntimeMode = "classic" | "managed_runtime";
type ManagedRuntimeProfileOption =
  ManagedRuntimeProfilesResponse["profiles"][number];

export function getRuntimeModeSummary({
  runtimeMode,
  profile,
}: {
  runtimeMode: RuntimeMode;
  profile: ManagedRuntimeProfileOption | undefined;
}): string {
  if (runtimeMode === "managed_runtime") {
    const profileName = profile?.displayName ?? "the selected profile";
    const evidenceSummary = getManagedRuntimeProfileEvidenceSummary(profile);

    return `Managed runtime is selected with ${profileName}. The top-level agent is the Coordinator: it plans, delegates repo work to managed workers, and summarizes evidence. ${evidenceSummary} Runtime Inspector shows sandbox, profile setup, services, browser checks, and incomplete proof if work bypasses the worker path.`;
  }

  return "Classic runtime is selected. The top-level agent can work directly in the sandbox. Switch to managed runtime before sending when you want a coordinator/managed-worker execution path and proof bundle.";
}

export function RuntimeModeSelectorCompact({
  runtimeMode,
  managedRuntimeProfileId,
  selectedProfile,
  profiles,
  disabled,
  sessionId,
  onRuntimeModeChange,
  onManagedRuntimeProfileChange,
  onManagedProfileSaved,
  onManagedProfileDeleted,
}: {
  runtimeMode: RuntimeMode;
  managedRuntimeProfileId: string;
  selectedProfile: ManagedRuntimeProfileOption | undefined;
  profiles: ManagedRuntimeProfileOption[];
  disabled?: boolean;
  sessionId?: string;
  onRuntimeModeChange: (runtimeMode: RuntimeMode) => void;
  onManagedRuntimeProfileChange: (profileId: string) => void;
  onManagedProfileSaved?: () => void;
  onManagedProfileDeleted?: (fallbackProfileId: string) => Promise<void>;
}) {
  const isManagedRuntime = runtimeMode === "managed_runtime";
  const summary = getRuntimeModeSummary({
    runtimeMode,
    profile: selectedProfile,
  });

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={summary}
              className={cn(
                "h-8 shrink-0 gap-1.5 rounded-full px-2 text-xs",
                isManagedRuntime
                  ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/15 dark:text-cyan-300"
                  : "text-muted-foreground",
              )}
              disabled={disabled}
              size="sm"
              type="button"
              variant={isManagedRuntime ? "outline" : "ghost"}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{isManagedRuntime ? "Managed" : "Classic"}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 text-pretty" side="top">
          {summary}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Runtime mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={runtimeMode}
          onValueChange={(value) => {
            if (value === "classic" || value === "managed_runtime") {
              onRuntimeModeChange(value);
            }
          }}
        >
          <DropdownMenuRadioItem className="items-start" value="classic">
            <span className="flex flex-col gap-0.5">
              <span>Classic</span>
              <span className="text-muted-foreground text-xs">
                Top-level agent can work directly in the sandbox.
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            className="items-start"
            value="managed_runtime"
          >
            <span className="flex flex-col gap-0.5">
              <span>Managed runtime</span>
              <span className="text-muted-foreground text-xs">
                Coordinator delegates repo work to managed workers and records
                proof.
              </span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Managed profile</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={managedRuntimeProfileId}
          onValueChange={onManagedRuntimeProfileChange}
        >
          {profiles.map((profile) => (
            <DropdownMenuRadioItem
              className="items-start"
              key={profile.id}
              value={profile.id}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{profile.displayName}</span>
                  <ManagedRuntimeProfileEvidenceBadge profile={profile} />
                </span>
                <span className="text-muted-foreground text-xs">
                  {profile.expectedTools.length > 0
                    ? profile.expectedTools.join(", ")
                    : "No required tools"}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {sessionId ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-1 py-1">
              <RuntimeModeSelectorManageItem
                disabled={!selectedProfile}
                onManagedProfileDeleted={
                  onManagedProfileDeleted ?? (async () => undefined)
                }
                onManagedProfileSaved={onManagedProfileSaved ?? (() => undefined)}
                selectedProfile={selectedProfile}
                sessionId={sessionId}
              />
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The manage-profile section rendered inside the runtime selector dropdown.
 * Exported separately so tests can render it directly — Radix DropdownMenuContent
 * is portal-gated and not emitted by renderToStaticMarkup when closed.
 */
export function RuntimeModeSelectorManageItem({
  sessionId,
  selectedProfile,
  disabled,
  onManagedProfileSaved,
  onManagedProfileDeleted,
}: {
  sessionId: string;
  selectedProfile: ManagedRuntimeProfileOption | undefined;
  disabled?: boolean;
  onManagedProfileSaved: () => void;
  onManagedProfileDeleted: (fallbackProfileId: string) => Promise<void>;
}) {
  return (
    <ManagedRuntimeProfileManager
      disabled={disabled ?? !selectedProfile}
      onProfileDeleted={onManagedProfileDeleted}
      onProfileSaved={onManagedProfileSaved}
      profile={selectedProfile}
      sessionId={sessionId}
    />
  );
}
