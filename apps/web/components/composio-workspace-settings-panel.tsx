"use client";

import { RefreshCw, Save, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { RepositoryComposioSettingsResponse } from "@/app/api/settings/repositories/[repoOwner]/[repoName]/composio/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ComposioToolkitPicker } from "@/app/settings/composio-toolkit-picker";
import { computeSelectedToolkitSlugsForSave } from "./composio-workspace-settings-panel-save-payload";

type ComposioWorkspaceSettingsPanelProps = {
  repoOwner: string | null;
  repoName: string | null;
};

async function fetchRepositoryPolicy(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load repository integrations");
  }
  return (await response.json()) as RepositoryComposioSettingsResponse;
}

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function isRepositoryPolicyResponse(
  body: RepositoryComposioSettingsResponse | { error?: string } | null,
): body is RepositoryComposioSettingsResponse {
  return Boolean(body && !("error" in body));
}

export function ComposioWorkspaceSettingsPanel({
  repoOwner,
  repoName,
}: ComposioWorkspaceSettingsPanelProps) {
  const policyUrl =
    repoOwner && repoName
      ? `/api/settings/repositories/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/composio`
      : null;
  const { data, error, isLoading, mutate } =
    useSWR<RepositoryComposioSettingsResponse>(
      policyUrl,
      fetchRepositoryPolicy,
    );
  const [inheritsGlobal, setInheritsGlobal] = useState(true);
  const [restrictsProfiles, setRestrictsProfiles] = useState(false);
  const [allowedProfileIds, setAllowedProfileIds] = useState<string[]>([]);
  const [blockedToolkits, setBlockedToolkits] = useState("");
  // Active toolkits for this repo (subset of globally-connected). GitHub is
  // default-on when the repo has never been configured (null). The picker
  // can only display a concrete array, so ["github"] here is a DISPLAY
  // default only — selectedToolkitSlugsTouched tracks whether the user has
  // actually changed the selection, which is what savePolicy consults
  // (#799, finding G6) so an untouched picker never persists a materialized
  // ["github"] as if the user chose it.
  const [selectedToolkitSlugs, setSelectedToolkitSlugs] = useState<string[]>(
    [],
  );
  const [selectedToolkitSlugsTouched, setSelectedToolkitSlugsTouched] =
    useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const settings = data?.repositorySettings;
    setInheritsGlobal(settings?.inheritGlobalDefaults ?? true);
    setAllowedProfileIds(settings?.allowedProfileIds ?? []);
    setRestrictsProfiles((settings?.allowedProfileIds.length ?? 0) > 0);
    setBlockedToolkits((settings?.blockedToolkitSlugs ?? []).join(", "));
    // null/undefined = never configured → GitHub default-on for DISPLAY
    // only. selectedToolkitSlugsTouched resets to false on every data load,
    // so loading an explicit saved selection (non-null) also resets the
    // touched flag — the display value below reflects "touched" reality
    // once the user interacts with the picker again.
    setSelectedToolkitSlugs(settings?.selectedToolkitSlugs ?? ["github"]);
    setSelectedToolkitSlugsTouched(settings?.selectedToolkitSlugs != null);
    setStatus(
      data
        ? settings
          ? "Workspace access rules loaded."
          : "No workspace override yet. Saving will create one."
        : null,
    );
  }, [data]);

  function toggleAllowedProfile(profileId: string, checked: boolean) {
    setAllowedProfileIds((current) =>
      checked
        ? Array.from(new Set([...current, profileId]))
        : current.filter((id) => id !== profileId),
    );
  }

  async function savePolicy() {
    if (!policyUrl) return;

    setIsSaving(true);
    setActionError(null);
    setStatus(null);
    try {
      const response = await fetch(policyUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inheritGlobalDefaults: inheritsGlobal,
          allowedProfileIds: restrictsProfiles ? allowedProfileIds : [],
          blockedToolkitSlugs: splitList(blockedToolkits),
          agentDefaults: data?.repositorySettings?.agentDefaults ?? {},
          // Preserves null (never configured) unless the user actually
          // touched the picker this session (#799, finding G6).
          selectedToolkitSlugs: computeSelectedToolkitSlugsForSave({
            touched: selectedToolkitSlugsTouched,
            currentSlugs: selectedToolkitSlugs,
          }),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | RepositoryComposioSettingsResponse
        | { error?: string }
        | null;
      if (!response.ok || !isRepositoryPolicyResponse(body)) {
        throw new Error(
          body && "error" in body && body.error
            ? body.error
            : "Failed to save repository integrations",
        );
      }
      await mutate(body, { revalidate: false });
      setStatus("Workspace access rules saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save repository integrations",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="rounded-lg bg-muted/40 px-3 py-2.5">
          <p className="text-sm font-medium leading-snug">
            Per-repository tool access
          </p>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            Control which connected tools (Composio integrations) agents may use
            when working in <strong>this repository</strong>. Your account-level
            integrations remain unchanged — these settings only restrict or
            override them here.
          </p>
        </div>

        {!repoOwner || !repoName ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground/70">
              No repository attached
            </p>
            <p className="text-xs text-muted-foreground">
              Workspace integration rules are only available for sessions linked
              to a GitHub repository. Open a session that has a repository to
              configure tool access here.
            </p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
            Failed to load repository integration rules.
          </div>
        ) : null}

        {data ? (
          <>
            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-sm font-medium">Global integrations</p>
              <p className="mt-1 text-pretty text-xs text-muted-foreground">
                Connected apps and profiles are managed globally in your account
                settings. Use the options below to restrict which ones agents
                can use for this repository specifically.
              </p>
              <div className="mt-3">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/settings/composio">
                    <Settings2 />
                    Manage global integrations
                  </Link>
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/70 p-3">
              <Label>Tools for this repository</Label>
              <FieldHelp>
                Choose which connected tools agents can use in every chat on
                this repository. Only tools connected globally are shown. GitHub
                is on by default.
              </FieldHelp>
              <div className="mt-2">
                <ComposioToolkitPicker
                  selectedSlugs={selectedToolkitSlugs}
                  onChange={(slugs) => {
                    setSelectedToolkitSlugs(slugs);
                    setSelectedToolkitSlugsTouched(true);
                  }}
                  source="connected"
                  repoOwner={repoOwner}
                  repoName={repoName}
                  disabled={isSaving}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="repo-composio-inherit">
                    Inherit global default
                  </Label>
                  <FieldHelp>
                    Use your account-level default unless a chat explicitly
                    chooses a profile.
                  </FieldHelp>
                </div>
                <Switch
                  id="repo-composio-inherit"
                  checked={inheritsGlobal}
                  disabled={isSaving}
                  onCheckedChange={setInheritsGlobal}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="repo-composio-restrict">
                    Limit profiles for this workspace
                  </Label>
                  <FieldHelp>
                    Leave off to allow every global profile in this repository.
                  </FieldHelp>
                  <FieldHelp>
                    Leaving this empty allows all connected profiles; it does
                    not block any profile.
                  </FieldHelp>
                </div>
                <Switch
                  id="repo-composio-restrict"
                  checked={restrictsProfiles}
                  disabled={isSaving || data.profiles.length === 0}
                  onCheckedChange={setRestrictsProfiles}
                />
              </div>

              {restrictsProfiles ? (
                <div className="space-y-2">
                  {data.profiles.length > 0 ? (
                    data.profiles.map((profile) => (
                      <div
                        key={profile.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {profile.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {profile.toolkitSlugs.join(", ")}
                          </p>
                        </div>
                        <Switch
                          checked={allowedProfileIds.includes(profile.id)}
                          disabled={isSaving}
                          onCheckedChange={(checked) =>
                            toggleAllowedProfile(profile.id, checked)
                          }
                          aria-label={`Allow ${profile.name} for this repository`}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
                      Create a global Composio profile before adding repository
                      access rules.
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-lg border border-border/70 p-3">
              <Label htmlFor="repo-composio-blocked-toolkits">
                Block toolkits in this workspace
              </Label>
              <Input
                id="repo-composio-blocked-toolkits"
                value={blockedToolkits}
                onChange={(event) =>
                  setBlockedToolkits(event.currentTarget.value)
                }
                name="blockedToolkits"
                autoComplete="off"
                spellCheck={false}
                placeholder="gmail, slack"
                disabled={isSaving}
              />
              <FieldHelp>
                Use this when a broad profile is allowed, but one app should
                stay unavailable for this repository.
              </FieldHelp>
            </div>

            {data.profileOptions.length > 0 ? (
              <div className="rounded-lg border border-border/70 p-3">
                <p className="text-sm font-medium">Chat Tools Preview</p>
                <div className="mt-2 space-y-1 text-sm">
                  {data.profileOptions.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex min-w-0 items-center justify-between gap-3"
                    >
                      <span className="truncate">{profile.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {profile.available
                          ? "Available"
                          : profile.disabledReason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {actionError ? (
              <p className="text-sm text-destructive">{actionError}</p>
            ) : null}
            {status ? (
              <p className="text-sm text-muted-foreground">{status}</p>
            ) : null}
          </>
        ) : null}
      </div>

      {data ? (
        <div className="border-t border-border p-3">
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void mutate()}
              disabled={isSaving}
            >
              <RefreshCw />
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void savePolicy()}
              disabled={isSaving}
            >
              <Save />
              Save Rules
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
