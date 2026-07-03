"use client";

import { useState } from "react";
import { Link as LinkIcon, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { type ThemePreference, useTheme } from "@/app/providers";
import type { RuntimeProfilesResponse } from "@/app/api/settings/runtime-profiles/route";
import {
  DEFAULT_SANDBOX_TYPE,
  type SandboxType,
} from "@/components/sandbox-selector-compact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsGroup, SettingRow } from "@/components/ui/settings-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { fetcher } from "@/lib/swr";
import { useSession } from "@/hooks/use-session";
import {
  type DiffMode,
  useUserPreferences,
} from "@/hooks/use-user-preferences";
import {
  globalSkillRefSchema,
  type GlobalSkillRef,
} from "@/lib/skills/global-skill-refs";
import { SettingsSectionHeader } from "./_components/section-header";
import {
  getSingleOptionPickerState,
  groupRuntimeProfileOptions,
} from "./preferences-helpers";

// Re-export model section components so loading.tsx and layout.tsx keep working
// without changing their import paths. The canonical definitions now live in
// models/models-preferences-section.tsx.
export {
  ModelPreferencesSection,
  ModelPreferencesSectionSkeleton,
} from "./models/models-preferences-section";

const SANDBOX_OPTIONS: Array<{ id: SandboxType; name: string }> = [
  { id: "vercel", name: "Vercel" },
];

const THEME_OPTIONS: Array<{ id: ThemePreference; name: string }> = [
  { id: "system", name: "System" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

const DIFF_MODE_OPTIONS: Array<{ id: DiffMode; name: string }> = [
  { id: "unified", name: "Unified" },
  { id: "split", name: "Split" },
];

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

function getGlobalSkillRefError(params: {
  source: string;
  skillName: string;
  existingRefs: GlobalSkillRef[];
}): string | null {
  const parsedRef = globalSkillRefSchema.safeParse({
    source: params.source,
    skillName: params.skillName,
  });

  if (!parsedRef.success) {
    return parsedRef.error.issues[0]?.message ?? "Invalid global skill ref";
  }

  const duplicateExists = params.existingRefs.some(
    (ref) =>
      ref.source.toLowerCase() === parsedRef.data.source.toLowerCase() &&
      ref.skillName.toLowerCase() === parsedRef.data.skillName.toLowerCase(),
  );

  return duplicateExists ? "That global skill has already been added" : null;
}

function PreferenceGroupTitle({ children }: { children: React.ReactNode }) {
  return <SettingsSectionHeader title={String(children)} />;
}

/**
 * Read-only value shown when a picker has only one option. Styled to match the
 * height/border of a Select trigger so single-option fields read as a settled
 * value in line with the editable fields beside them — not floating text.
 */
function ReadOnlyValue({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex h-9 items-center justify-between rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground">
      <span className="truncate">{label}</span>
      <span className="ml-2 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {status}
      </span>
    </div>
  );
}

export function PreferencesSectionSkeleton() {
  return (
    <div className="space-y-8">
      {/* Appearance — mirrors the single SettingsGroup card used in the loaded UI */}
      <SettingsGroup title="Appearance">
        <div className="flex flex-col items-start gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
          </div>
          <Skeleton className="h-9 w-full sm:max-w-xs" />
        </div>
      </SettingsGroup>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <PreferenceGroupTitle>Defaults for new chats</PreferenceGroupTitle>
        <div className="grid gap-6 sm:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <PreferenceGroupTitle>Git automation</PreferenceGroupTitle>
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <PreferenceGroupTitle>Notifications</PreferenceGroupTitle>
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <PreferenceGroupTitle>Sharing &amp; privacy</PreferenceGroupTitle>
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <PreferenceGroupTitle>Skills</PreferenceGroupTitle>
        <div className="space-y-3">
          <div className="space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-[28rem] max-w-full" />
          </div>
          <div className="rounded-lg border border-border/70">
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0"
              >
                <div className="grid min-w-0 flex-1 gap-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-44" />
                </div>
                <Skeleton className="size-8 rounded-md" />
              </div>
            ))}
          </div>
          <div className="grid gap-2.5 rounded-lg border border-dashed border-border/60 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="grid gap-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-10 w-20" />
            </div>
            <Skeleton className="h-4 w-[30rem] max-w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function usePreferencesSectionState() {
  const { theme, setTheme } = useTheme();
  const { session } = useSession();
  const { preferences, loading, updatePreferences } = useUserPreferences();
  // MR-4 (#812): source runtime profile options from the merged endpoint
  // (built-ins + the caller's own user_default profiles) instead of the
  // built-ins-only listManagedRuntimeProfiles() constant.
  const { data: runtimeProfilesData } = useSWR<RuntimeProfilesResponse>(
    "/api/settings/runtime-profiles",
    fetcher,
  );
  const runtimeProfiles = runtimeProfilesData?.profiles ?? [];
  const [isSaving, setIsSaving] = useState(false);
  const [globalSkillSource, setGlobalSkillSource] = useState("");
  const [globalSkillName, setGlobalSkillName] = useState("");
  const [globalSkillsError, setGlobalSkillsError] = useState<string | null>(
    null,
  );
  const [copiedPublicProfile, setCopiedPublicProfile] = useState(false);

  const publicProfilePath = session?.user?.username
    ? `/u/${session.user.username}`
    : null;

  const handleThemeChange = (nextTheme: string) => {
    if (isThemePreference(nextTheme)) {
      setTheme(nextTheme);
    }
  };

  const handleSandboxChange = async (sandboxType: SandboxType) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultSandboxType: sandboxType });
    } catch (error) {
      console.error("Failed to update sandbox preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManagedRuntimeProfileChange = async (profileId: string) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultManagedRuntimeProfileId: profileId });
    } catch (error) {
      console.error("Failed to update managed runtime profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiffModeChange = async (diffMode: DiffMode) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultDiffMode: diffMode });
    } catch (error) {
      console.error("Failed to update diff mode preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoCommitPushChange = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updatePreferences({ autoCommitPush: enabled });
    } catch (error) {
      console.error("Failed to update auto-commit preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoCreatePrChange = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updatePreferences({ autoCreatePr: enabled });
    } catch (error) {
      console.error("Failed to update auto-PR preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAlertsEnabledChange = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updatePreferences({ alertsEnabled: enabled });
    } catch (error) {
      console.error("Failed to update alerts preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAlertSoundEnabledChange = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updatePreferences({ alertSoundEnabled: enabled });
    } catch (error) {
      console.error("Failed to update alert sound preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublicUsageEnabledChange = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await updatePreferences({ publicUsageEnabled: enabled });
      if (!enabled) {
        setCopiedPublicProfile(false);
      }
    } catch (error) {
      console.error("Failed to update public usage preference:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyPublicProfileUrl = async () => {
    if (!publicProfilePath || typeof window === "undefined") {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${publicProfilePath}`,
      );
      setCopiedPublicProfile(true);
      window.setTimeout(() => setCopiedPublicProfile(false), 1500);
    } catch (error) {
      console.error("Failed to copy public usage URL:", error);
    }
  };

  const handleAddGlobalSkillRef = async () => {
    const existingRefs = preferences?.globalSkillRefs ?? [];
    const errorMessage = getGlobalSkillRefError({
      source: globalSkillSource,
      skillName: globalSkillName,
      existingRefs,
    });

    if (errorMessage) {
      setGlobalSkillsError(errorMessage);
      return;
    }

    setIsSaving(true);
    setGlobalSkillsError(null);
    try {
      const nextRef = globalSkillRefSchema.parse({
        source: globalSkillSource,
        skillName: globalSkillName,
      });
      await updatePreferences({
        globalSkillRefs: [...existingRefs, nextRef],
      });
      setGlobalSkillSource("");
      setGlobalSkillName("");
    } catch (error) {
      console.error("Failed to add global skill preference:", error);
      setGlobalSkillsError("Failed to add global skill");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveGlobalSkillRef = async (index: number) => {
    const existingRefs = preferences?.globalSkillRefs ?? [];

    setIsSaving(true);
    setGlobalSkillsError(null);
    try {
      await updatePreferences({
        globalSkillRefs: existingRefs.filter(
          (_, refIndex) => refIndex !== index,
        ),
      });
    } catch (error) {
      console.error("Failed to remove global skill preference:", error);
      setGlobalSkillsError("Failed to remove global skill");
    } finally {
      setIsSaving(false);
    }
  };

  return {
    theme,
    preferences,
    loading,
    runtimeProfiles,
    isSaving,
    globalSkillSource,
    setGlobalSkillSource,
    globalSkillName,
    setGlobalSkillName,
    globalSkillsError,
    copiedPublicProfile,
    publicProfilePath,
    handleThemeChange,
    handleSandboxChange,
    handleManagedRuntimeProfileChange,
    handleDiffModeChange,
    handleAutoCommitPushChange,
    handleAutoCreatePrChange,
    handleAlertsEnabledChange,
    handleAlertSoundEnabledChange,
    handlePublicUsageEnabledChange,
    handleCopyPublicProfileUrl,
    handleAddGlobalSkillRef,
    handleRemoveGlobalSkillRef,
  };
}

export function PreferencesSection() {
  const state = usePreferencesSectionState();

  if (state.loading) {
    return <PreferencesSectionSkeleton />;
  }

  const {
    theme,
    preferences,
    runtimeProfiles,
    isSaving,
    copiedPublicProfile,
    publicProfilePath,
    globalSkillName,
    setGlobalSkillName,
    globalSkillSource,
    setGlobalSkillSource,
    globalSkillsError,
    handleThemeChange,
    handleSandboxChange,
    handleManagedRuntimeProfileChange,
    handleDiffModeChange,
    handleAutoCommitPushChange,
    handleAutoCreatePrChange,
    handleAlertsEnabledChange,
    handleAlertSoundEnabledChange,
    handlePublicUsageEnabledChange,
    handleCopyPublicProfileUrl,
    handleAddGlobalSkillRef,
    handleRemoveGlobalSkillRef,
  } = state;

  const selectedRuntimeProfile = runtimeProfiles.find(
    (p) =>
      p.id ===
      (preferences?.defaultManagedRuntimeProfileId ?? runtimeProfiles[0]?.id),
  );
  const managedRuntimePickerOptions = runtimeProfiles.map((profile) => ({
    id: profile.id,
    name: profile.displayName,
  }));
  const managedRuntimeProfileGroups = groupRuntimeProfileOptions(
    runtimeProfiles.map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      source: profile.source,
    })),
  );
  const sandboxPickerState = getSingleOptionPickerState(SANDBOX_OPTIONS);
  const managedRuntimePickerState = getSingleOptionPickerState(
    managedRuntimePickerOptions,
  );

  return (
    <div className="space-y-8">
      {/* ── 1. Appearance ── */}
      <SettingsGroup
        title="Appearance"
        description="How Open Agents looks in this browser."
      >
        <SettingRow
          label="Theme"
          htmlFor="appearance"
          description="Saved in this browser only — it doesn't follow you to other devices."
          controlClassName="w-full sm:max-w-xs"
        >
          <Select value={theme} onValueChange={handleThemeChange}>
            <SelectTrigger id="appearance" className="w-full">
              <SelectValue placeholder="Select a theme" />
            </SelectTrigger>
            <SelectContent>
              {THEME_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsGroup>

      <div className="border-t border-border/50" />

      {/* ── 2. Defaults for new chats ── */}
      <div className="space-y-4">
        <PreferenceGroupTitle>Defaults for new chats</PreferenceGroupTitle>
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Default sandbox */}
          <div className="grid gap-2">
            <Label htmlFor="sandbox">Default sandbox</Label>
            {sandboxPickerState ? (
              <ReadOnlyValue
                label={sandboxPickerState.label}
                status={sandboxPickerState.status}
              />
            ) : (
              <Select
                value={preferences?.defaultSandboxType ?? DEFAULT_SANDBOX_TYPE}
                onValueChange={(value) =>
                  handleSandboxChange(value as SandboxType)
                }
                disabled={isSaving}
              >
                <SelectTrigger id="sandbox" className="w-full">
                  <SelectValue placeholder="Select a sandbox" />
                </SelectTrigger>
                <SelectContent>
                  {SANDBOX_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Vercel is currently the only execution backend; more will appear
              here as they&apos;re added.
            </p>
          </div>

          {/* Default runtime profile */}
          <div className="grid gap-2">
            <Label htmlFor="managed-runtime-profile">
              Default runtime profile
            </Label>
            {managedRuntimePickerState ? (
              <ReadOnlyValue
                label={managedRuntimePickerState.label}
                status={managedRuntimePickerState.status}
              />
            ) : (
              <Select
                value={preferences?.defaultManagedRuntimeProfileId}
                onValueChange={handleManagedRuntimeProfileChange}
                disabled={isSaving}
              >
                <SelectTrigger id="managed-runtime-profile" className="w-full">
                  <SelectValue placeholder="Select a runtime profile" />
                </SelectTrigger>
                <SelectContent>
                  {managedRuntimeProfileGroups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedRuntimeProfile?.description && (
              <p className="text-xs text-muted-foreground">
                {selectedRuntimeProfile.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              The sandbox is where code runs; the runtime profile is the
              toolchain and setup used when a session provisions one.
            </p>
            <Link
              href="/settings/runtime-profiles"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <LinkIcon className="size-3" />
              Manage runtime profiles
            </Link>
          </div>

          {/* Default diff mode */}
          <div className="grid gap-2">
            <Label htmlFor="diff-mode">Default diff mode</Label>
            <Select
              value={preferences?.defaultDiffMode ?? "unified"}
              onValueChange={(value) => handleDiffModeChange(value as DiffMode)}
              disabled={isSaving}
            >
              <SelectTrigger id="diff-mode" className="w-full">
                <SelectValue placeholder="Select a diff mode" />
              </SelectTrigger>
              <SelectContent>
                {DIFF_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How code changes are shown in chat: Unified = one column with +/-
              lines; Split = old vs new side by side.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border/50" />

      {/* ── 3. Git automation ── */}
      <SettingsGroup title="Git automation">
        <SettingRow
          label="Auto commit & push"
          htmlFor="auto-commit-push"
          description="Commit and push when an agent turn finishes."
        >
          <Switch
            id="auto-commit-push"
            checked={preferences?.autoCommitPush ?? false}
            onCheckedChange={handleAutoCommitPushChange}
            disabled={isSaving}
          />
        </SettingRow>
        <SettingRow
          label="Auto create PR"
          htmlFor="auto-create-pr"
          description={
            !(preferences?.autoCommitPush ?? false)
              ? "Open a pull request after auto commit. Available once Auto commit & push is on."
              : "Open a pull request after auto commit."
          }
        >
          <Switch
            id="auto-create-pr"
            checked={preferences?.autoCreatePr ?? false}
            onCheckedChange={handleAutoCreatePrChange}
            disabled={isSaving || !(preferences?.autoCommitPush ?? false)}
          />
        </SettingRow>
      </SettingsGroup>

      <div className="border-t border-border/50" />

      {/* ── 4. Notifications ── */}
      <SettingsGroup title="Notifications">
        <SettingRow
          label="Alerts"
          htmlFor="alerts-enabled"
          description="Notify when a background agent finishes."
        >
          <Switch
            id="alerts-enabled"
            checked={preferences?.alertsEnabled ?? true}
            onCheckedChange={handleAlertsEnabledChange}
            disabled={isSaving}
          />
        </SettingRow>
        {(preferences?.alertsEnabled ?? true) && (
          <SettingRow
            label="Alert sound"
            htmlFor="alert-sound-enabled"
            description="Plays with each alert."
          >
            <Switch
              id="alert-sound-enabled"
              checked={preferences?.alertSoundEnabled ?? true}
              onCheckedChange={handleAlertSoundEnabledChange}
              disabled={isSaving}
            />
          </SettingRow>
        )}
      </SettingsGroup>

      <div className="border-t border-border/50" />

      {/* ── 5. Sharing & privacy ── */}
      <div className="space-y-4">
        <PreferenceGroupTitle>Sharing &amp; privacy</PreferenceGroupTitle>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="public-usage-enabled">Public usage profile</Label>
              <p className="text-xs text-muted-foreground">
                Publish a shareable wrapped page at <code>/u/username</code>.
              </p>
            </div>
            <Switch
              id="public-usage-enabled"
              checked={preferences?.publicUsageEnabled ?? false}
              onCheckedChange={handlePublicUsageEnabledChange}
              disabled={isSaving}
            />
          </div>
          {(preferences?.publicUsageEnabled ?? false) && publicProfilePath && (
            <div className="ml-1 grid gap-2 border-l-2 border-border/60 pl-4">
              <Label htmlFor="public-usage-url">Public profile URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="public-usage-url"
                  readOnly
                  value={publicProfilePath}
                  className="font-mono text-xs sm:text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopyPublicProfileUrl}
                  disabled={isSaving}
                >
                  {copiedPublicProfile ? "Copied" : "Copy URL"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link to let others view your public usage stats.
                Append <code>?date=30d</code> to show the last 30 days, or{" "}
                <code>?date=2026-01-01..2026-01-31</code> for a date range.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/50" />

      {/* ── 6. Skills ── */}
      <div className="space-y-4">
        <PreferenceGroupTitle>Skills</PreferenceGroupTitle>

        <div className="grid gap-3">
          <div className="space-y-1">
            <Label>Global skills</Label>
            <p className="text-xs text-muted-foreground">
              Skills from GitHub loaded for every new session. If a repo defines
              a skill with the same name, the repo&apos;s version wins.
            </p>
          </div>

          {(preferences?.globalSkillRefs ?? []).length > 0 ? (
            <div className="divide-y divide-border/60 rounded-lg border border-border/70">
              {(preferences?.globalSkillRefs ?? []).map(
                (globalSkillRef, index) => (
                  <div
                    key={`${globalSkillRef.source}-${globalSkillRef.skillName}`}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {globalSkillRef.skillName}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {globalSkillRef.source}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveGlobalSkillRef(index)}
                      disabled={isSaving}
                      aria-label={`Remove ${globalSkillRef.skillName}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No global skills configured yet.
            </p>
          )}

          <div className="grid gap-2.5 rounded-lg border border-dashed border-border/60 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="global-skill-source"
                  className="text-xs font-medium"
                >
                  Repository source
                </Label>
                <Input
                  id="global-skill-source"
                  value={globalSkillSource}
                  onChange={(event) => setGlobalSkillSource(event.target.value)}
                  placeholder="vercel/ai"
                  disabled={isSaving}
                />
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="global-skill-name"
                  className="text-xs font-medium"
                >
                  Skill name
                </Label>
                <Input
                  id="global-skill-name"
                  value={globalSkillName}
                  onChange={(event) => setGlobalSkillName(event.target.value)}
                  placeholder="ai-sdk"
                  disabled={isSaving}
                />
              </div>
              <Button
                type="button"
                onClick={handleAddGlobalSkillRef}
                disabled={isSaving}
              >
                <Plus />
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the GitHub <code>owner/repo</code> source and the skill
              name, e.g. <code>vercel/ai</code> + <code>ai-sdk</code>.
            </p>
            {globalSkillsError && (
              <p className="text-xs text-destructive">{globalSkillsError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
