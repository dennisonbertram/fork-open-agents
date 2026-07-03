"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
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

    return `Delegated (${profileName}): the agent delegates work to a verified sandbox worker and records evidence of every step. Open Runtime Inspector after a run to verify what ran — sandbox, services, browser checks, and any incomplete evidence. Best for shared repos or when you want a record of what happened. ${evidenceSummary}`;
  }

  return "Direct: Agent edits files directly in the sandbox. Fastest — best for quick changes and exploration. Switch to Delegated when you want a verified sandbox worker and a record of what ran.";
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
  onOpenInspector,
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
  onOpenInspector?: () => void;
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
              aria-label={`Runtime: ${isManagedRuntime ? "Delegated" : "Direct"}`}
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
              <span>{isManagedRuntime ? "Delegated" : "Direct"}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-80 text-pretty" side="top">
          {summary}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>How the agent runs</DropdownMenuLabel>
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
              <span>Direct</span>
              <span className="text-muted-foreground text-xs">
                Agent edits files directly — fastest, best for quick changes and
                exploration.
              </span>
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            className="items-start"
            value="managed_runtime"
          >
            <span className="flex flex-col gap-0.5">
              <span>Delegated</span>
              <span className="text-muted-foreground text-xs">
                Agent delegates work to a verified sandbox worker and records
                evidence — best for shared repos or when you want a record of
                what happened.
              </span>
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {isManagedRuntime ? (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
            After a run, open{" "}
            <span className="font-medium">Runtime Inspector</span> to verify
            what ran — workers, services, and the recorded evidence.
          </p>
        ) : null}
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
        <RuntimeModeSelectorUntestedWarning
          onOpenInspector={onOpenInspector}
          selectedProfile={selectedProfile}
        />
        {sessionId ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-1 py-1">
              <RuntimeModeSelectorManageItem
                disabled={!selectedProfile}
                onManagedProfileDeleted={
                  onManagedProfileDeleted ?? (async () => undefined)
                }
                onManagedProfileSaved={
                  onManagedProfileSaved ?? (() => undefined)
                }
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
 * A profile is only "Tested" once it has a setup_and_verify pass (Decision
 * D6) — a verify-only pass, a failure, or no evidence at all all mean the
 * setup commands were never proven and the profile is not yet ready.
 */
function isProfileConsideredTested(
  profile: ManagedRuntimeProfileOption,
): boolean {
  if (profile.source !== "session") {
    return true;
  }

  return (
    profile.testStatus === "passed" &&
    profile.lastTestScope === "setup_and_verify"
  );
}

/**
 * Inline warning shown when the selected profile's persisted state is not
 * "Tested" (#815 §3). Selection stays possible — this warns, it does not
 * block — the real gate is fail-closed at run time (MR-2). Links to the
 * Runtime Inspector so the user can see the actual evidence.
 *
 * Exported separately so tests can render it directly — Radix
 * DropdownMenuContent is portal-gated and not emitted by
 * renderToStaticMarkup when closed.
 */
export function RuntimeModeSelectorUntestedWarning({
  selectedProfile,
  onOpenInspector,
}: {
  selectedProfile: ManagedRuntimeProfileOption | undefined;
  onOpenInspector?: () => void;
}) {
  if (!selectedProfile || isProfileConsideredTested(selectedProfile)) {
    return null;
  }

  return (
    <div className="flex items-start gap-1.5 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <p>
        Not yet tested — run Setup + verify first.{" "}
        <button
          className="font-medium underline underline-offset-2"
          onClick={onOpenInspector}
          type="button"
        >
          Open Runtime Inspector
        </button>
      </p>
    </div>
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
