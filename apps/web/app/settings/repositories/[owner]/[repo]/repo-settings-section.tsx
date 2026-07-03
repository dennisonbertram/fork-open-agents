"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { listManagedRuntimeProfiles } from "@open-agents/sandbox/managed-runtime-profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsGroup, SettingRow } from "@/components/ui/settings-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  ResolvedRepoDefaults,
  RepoSettingsSlice,
} from "@/lib/repo-settings/resolve-repo-defaults";
import type { VercelProjectSelection } from "@/lib/vercel/types";
import type { GitHubConnectionStatusResponse } from "@/lib/github/status";
import type { RepoToolkitEffectiveStatus } from "@/lib/composio/repo-tools-effective-status";
import { getRepoToolkitStatusCopy } from "@/lib/composio/repo-tools-status-copy";
import {
  VCPU_OPTIONS,
  RUNTIME_MODE_OPTIONS,
  type RepoEditState,
} from "./repo-settings-form";

// ── Props ──────────────────────────────────────────────────────────────────────

export interface RepoSettingsSectionProps {
  owner: string;
  repo: string;
  resolved: ResolvedRepoDefaults;
  raw: RepoSettingsSlice | null;
  integrations: {
    github: GitHubConnectionStatusResponse;
    vercel: VercelProjectSelection | null;
    composioHref: string;
  };
  /**
   * Server-computed effective per-repo tool status (#805, epic #796 T9) —
   * one entry per relevant toolkit, sourced from
   * deriveRepoToolkitEffectiveStatuses. Renders as a plain-language list
   * alongside the existing bare "Manage tools" link; omitted (undefined) or
   * empty renders no list, matching prior behavior for callers that haven't
   * wired the loader yet.
   */
  toolStatuses?: RepoToolkitEffectiveStatus[];
  /** Override the default PATCH handler (e.g. dev-preview stub). */
  onSave?: (patch: Partial<RepoEditState>) => Promise<void>;
  /** Override the default DELETE/reset handler (e.g. dev-preview stub). */
  onReset?: () => Promise<void>;
}

// ── Derived state seeding ──────────────────────────────────────────────────────

function seedEditState(
  resolved: ResolvedRepoDefaults,
  raw: RepoSettingsSlice | null,
): RepoEditState {
  return {
    fullClone: raw?.fullClone ?? null,
    prewarmEnabled: raw?.prewarmEnabled ?? null,
    runtimeMode: raw?.runtimeMode ?? null,
    managedRuntimeProfileId: raw?.managedRuntimeProfileId ?? null,
    vcpus: raw?.vcpus ?? null,
    autoCommitPush: raw?.autoCommitPush ?? null,
    autoCreatePr: raw?.autoCreatePr ?? null,
    defaultBranch: raw?.defaultBranch ?? null,
    isNewBranch: raw?.isNewBranch ?? null,
  };
  // raw null fields produce null in state = "inherited" (show placeholder from resolved)
  void resolved; // resolved used as placeholder text, not seeded into state directly
}

// ── Small UI helpers ───────────────────────────────────────────────────────────

/** Tag shown beside an inherited field value. */
function InheritedTag() {
  return (
    <span className="ml-1.5 rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Inherited
    </span>
  );
}

/** Reset-to-inherit button that appears on overridden rows. */
function ResetButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      aria-label="Reset to inherited value"
      className="ml-1.5 h-6 w-6 text-muted-foreground hover:text-foreground"
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </Button>
  );
}

// ── Main section ───────────────────────────────────────────────────────────────

const MANAGED_RUNTIME_PROFILES = listManagedRuntimeProfiles();

export function RepoSettingsSection({
  owner,
  repo,
  resolved,
  raw,
  integrations,
  toolStatuses = [],
  onSave,
  onReset,
}: RepoSettingsSectionProps) {
  // Local edit state seeded from raw nullable row
  const [state, setState] = useState<RepoEditState>(() =>
    seedEditState(resolved, raw),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Danger-zone typed confirm
  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const confirmTarget = `${owner}/${repo}`;
  const confirmMatches = confirmText === confirmTarget;

  // Default PATCH handler
  const defaultOnSave = async (patch: Partial<RepoEditState>) => {
    const res = await fetch(
      `/api/settings/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? "Failed to save settings");
    }
  };

  const defaultOnReset = async () => {
    const res = await fetch(
      `/api/settings/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? "Failed to reset settings");
    }
  };

  const handleSave = onSave ?? defaultOnSave;
  const handleReset = onReset ?? defaultOnReset;

  // Per-field autosave helper
  async function saveDelta(delta: Partial<RepoEditState>) {
    setIsSaving(true);
    setError(null);
    try {
      await handleSave(delta);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBooleanField(
    key: keyof RepoEditState,
    value: boolean | null,
  ) {
    setState((prev) => ({ ...prev, [key]: value }));
    await saveDelta({ [key]: value });
  }

  // Effective values for rendering (resolved = what's active; raw = what's overridden)
  const effectiveAutoCommitPush =
    state.autoCommitPush ?? resolved.autoCommitPush;

  return (
    <div className="space-y-6">
      {/* ── 1. General ──────────────────────────────────────────────────── */}
      <SettingsGroup
        title="General"
        description="Repository identity and branching defaults."
      >
        {/* Read-only repo identity */}
        <SettingRow label="Repository">
          <span className="font-mono text-sm text-muted-foreground">
            {owner}/{repo}
          </span>
        </SettingRow>

        {/* Default branch */}
        <SettingRow
          label="Default branch"
          description="The branch agents target by default for this repo. Leave empty to follow the repository default."
          htmlFor="repo-default-branch"
        >
          <div className="flex items-center gap-1.5">
            <Input
              id="repo-default-branch"
              value={state.defaultBranch ?? ""}
              onChange={(e) => {
                const val = e.currentTarget.value || null;
                setState((prev) => ({ ...prev, defaultBranch: val }));
              }}
              onBlur={() => {
                void saveDelta({ defaultBranch: state.defaultBranch });
              }}
              placeholder={
                raw?.defaultBranch == null
                  ? (resolved.defaultBranch ?? "Repository default")
                  : undefined
              }
              disabled={isSaving}
              className="h-8 w-48 text-sm"
            />
            {state.defaultBranch === null && <InheritedTag />}
            {state.defaultBranch !== null && (
              <ResetButton
                onClick={() =>
                  void handleBooleanField(
                    "defaultBranch" as keyof RepoEditState,
                    null,
                  )
                }
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>

        {/* isNewBranch */}
        <SettingRow
          label="Always create new branch"
          description="When on, agents always start from a new branch instead of the default branch."
          htmlFor="repo-is-new-branch"
        >
          <div className="flex items-center gap-1.5">
            <Switch
              id="repo-is-new-branch"
              checked={state.isNewBranch ?? resolved.isNewBranch}
              onCheckedChange={(checked) => {
                void handleBooleanField("isNewBranch", checked);
              }}
              disabled={isSaving}
            />
            {state.isNewBranch === null && <InheritedTag />}
            {state.isNewBranch !== null && (
              <ResetButton
                onClick={() => void handleBooleanField("isNewBranch", null)}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>
      </SettingsGroup>

      {/* ── 2. Clone &amp; runtime ─────────────────────────────────────────── */}
      <SettingsGroup
        title="Clone &amp; runtime"
        description="How the agent clones the repo and which execution environment it uses."
      >
        {/* Full clone */}
        <SettingRow
          label="Full clone"
          description="When on, agents perform a full git clone instead of a shallow one. Slower start but full history available."
          htmlFor="repo-full-clone"
        >
          <div className="flex items-center gap-1.5">
            <Switch
              id="repo-full-clone"
              checked={state.fullClone ?? resolved.fullClone}
              onCheckedChange={(checked) => {
                void handleBooleanField("fullClone", checked);
              }}
              disabled={isSaving}
            />
            {state.fullClone === null && <InheritedTag />}
            {state.fullClone !== null && (
              <ResetButton
                onClick={() => void handleBooleanField("fullClone", null)}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>

        {/* Prewarm */}
        <SettingRow
          label="Prewarm sandbox"
          description="Pre-heat the sandbox environment before the agent starts. Reduces first-run latency."
          htmlFor="repo-prewarm"
        >
          <div className="flex items-center gap-1.5">
            <Switch
              id="repo-prewarm"
              checked={state.prewarmEnabled ?? resolved.prewarmEnabled}
              onCheckedChange={(checked) => {
                void handleBooleanField("prewarmEnabled", checked);
              }}
              disabled={isSaving}
            />
            {state.prewarmEnabled === null && <InheritedTag />}
            {state.prewarmEnabled !== null && (
              <ResetButton
                onClick={() => void handleBooleanField("prewarmEnabled", null)}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>

        {/* Runtime mode */}
        <SettingRow
          label="Runtime mode"
          description="Classic runs in a plain sandbox; Managed runtime applies a declared toolchain profile."
          htmlFor="repo-runtime-mode"
        >
          <div className="flex items-center gap-1.5">
            <Select
              value={state.runtimeMode ?? resolved.runtimeMode}
              onValueChange={(val) => {
                const next = val as "classic" | "managed_runtime";
                setState((prev) => ({ ...prev, runtimeMode: next }));
                void saveDelta({ runtimeMode: next });
              }}
              disabled={isSaving}
            >
              <SelectTrigger
                id="repo-runtime-mode"
                className="h-8 w-44 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUNTIME_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.runtimeMode === null && <InheritedTag />}
            {state.runtimeMode !== null && (
              <ResetButton
                onClick={() => {
                  setState((prev) => ({ ...prev, runtimeMode: null }));
                  void saveDelta({ runtimeMode: null });
                }}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>

        {/* Managed runtime profile */}
        <SettingRow
          label="Runtime profile"
          description="The managed runtime toolchain profile to use for this repo's sessions."
          htmlFor="repo-runtime-profile"
        >
          <div className="flex items-center gap-1.5">
            <Select
              value={
                state.managedRuntimeProfileId ??
                resolved.managedRuntimeProfileId
              }
              onValueChange={(val) => {
                setState((prev) => ({ ...prev, managedRuntimeProfileId: val }));
                void saveDelta({ managedRuntimeProfileId: val });
              }}
              disabled={isSaving}
            >
              <SelectTrigger
                id="repo-runtime-profile"
                className="h-8 w-52 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANAGED_RUNTIME_PROFILES.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.managedRuntimeProfileId === null && <InheritedTag />}
            {state.managedRuntimeProfileId !== null && (
              <ResetButton
                onClick={() => {
                  setState((prev) => ({
                    ...prev,
                    managedRuntimeProfileId: null,
                  }));
                  void saveDelta({ managedRuntimeProfileId: null });
                }}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>

        {/* vCPUs */}
        <SettingRow
          label="vCPUs"
          description="Number of vCPUs allocated to the sandbox for this repo's sessions."
          htmlFor="repo-vcpus"
        >
          <div className="flex items-center gap-1.5">
            <Select
              value={String(state.vcpus ?? resolved.vcpus)}
              onValueChange={(val) => {
                const next = Number(val);
                setState((prev) => ({ ...prev, vcpus: next }));
                void saveDelta({ vcpus: next });
              }}
              disabled={isSaving}
            >
              <SelectTrigger id="repo-vcpus" className="h-8 w-32 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VCPU_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.vcpus === null && <InheritedTag />}
            {state.vcpus !== null && (
              <ResetButton
                onClick={() => {
                  setState((prev) => ({ ...prev, vcpus: null }));
                  void saveDelta({ vcpus: null });
                }}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>
      </SettingsGroup>

      {/* ── 3. Git automation ─────────────────────────────────────────────── */}
      <SettingsGroup
        title="Git automation"
        description="How agents commit and open pull requests for this repo."
      >
        {/* Auto-commit + push */}
        <SettingRow
          label="Auto-commit and push"
          description="When on, agents automatically commit and push changes after completing a task."
          htmlFor="repo-auto-commit-push"
        >
          <div className="flex items-center gap-1.5">
            <Switch
              id="repo-auto-commit-push"
              checked={state.autoCommitPush ?? resolved.autoCommitPush}
              onCheckedChange={(checked) => {
                const next = {
                  autoCommitPush: checked,
                } as Partial<RepoEditState>;
                // Enforce invariant: autoCreatePr cannot be true when autoCommitPush is false
                if (!checked && (state.autoCreatePr ?? resolved.autoCreatePr)) {
                  next.autoCreatePr = false;
                }
                setState((prev) => ({ ...prev, ...next }));
                void saveDelta(next);
              }}
              disabled={isSaving}
            />
            {state.autoCommitPush === null && <InheritedTag />}
            {state.autoCommitPush !== null && (
              <ResetButton
                onClick={() => void handleBooleanField("autoCommitPush", null)}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>

        {/* Auto-create PR */}
        <SettingRow
          label="Auto-create PR"
          description="When on, agents automatically open a pull request after committing. Requires auto-commit to be enabled."
          htmlFor="repo-auto-create-pr"
        >
          <div className="flex items-center gap-1.5">
            <Switch
              id="repo-auto-create-pr"
              checked={state.autoCreatePr ?? resolved.autoCreatePr}
              onCheckedChange={(checked) => {
                void handleBooleanField("autoCreatePr", checked);
              }}
              disabled={isSaving || !effectiveAutoCommitPush}
              aria-disabled={!effectiveAutoCommitPush}
            />
            {state.autoCreatePr === null && <InheritedTag />}
            {state.autoCreatePr !== null && (
              <ResetButton
                onClick={() => void handleBooleanField("autoCreatePr", null)}
                disabled={isSaving}
              />
            )}
          </div>
        </SettingRow>
      </SettingsGroup>

      {/* ── 4. Integrations ───────────────────────────────────────────────── */}
      <SettingsGroup
        title="Integrations"
        description="External services connected to this repository."
      >
        {/* GitHub App status */}
        <SettingRow
          label="GitHub"
          description="GitHub App connection status for this account."
        >
          <div className="flex items-center gap-2 text-sm">
            {integrations.github.status === "connected" ? (
              <span className="font-medium text-green-600 dark:text-green-400">
                Connected
              </span>
            ) : integrations.github.status === "reconnect_required" ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                Reconnect required
              </span>
            ) : (
              <span className="font-medium text-muted-foreground">
                Not connected
              </span>
            )}
            {integrations.github.status !== "connected" && (
              <Link
                href="/settings/connections"
                className="text-xs text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
              >
                Connect GitHub
              </Link>
            )}
          </div>
        </SettingRow>

        {/* Vercel project link */}
        <SettingRow
          label="Vercel"
          description="The Vercel project linked to this repository for preview deployments."
        >
          {integrations.vercel ? (
            <span className="text-sm font-medium">
              {integrations.vercel.projectName}
              {integrations.vercel.teamSlug ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({integrations.vercel.teamSlug})
                </span>
              ) : null}
            </span>
          ) : (
            <Link
              href="/settings/connections"
              className="text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
            >
              Link Vercel project
            </Link>
          )}
        </SettingRow>

        {/* Composio — link only, managed separately */}
        <SettingRow
          label="Composio tools"
          description="Manage the external tools agents can use. Configured globally and per-repo in the Composio settings."
        >
          <Link
            href={integrations.composioHref}
            className="text-sm text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
          >
            Manage tools
          </Link>
        </SettingRow>

        {/* #805: effective per-repo tool status list — reuses the shared
            status-copy helper so this list never drifts from the repo
            dashboard's Tools tab vocabulary. */}
        {toolStatuses.length > 0 ? (
          <SettingRow label="Tool access for this repository">
            <div className="w-full space-y-1.5">
              {toolStatuses.map((toolStatus) => {
                const copy = getRepoToolkitStatusCopy(toolStatus);
                return (
                  <div
                    key={toolStatus.slug}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-1.5"
                  >
                    <span className="truncate text-sm">{toolStatus.name}</span>
                    <span
                      className="shrink-0 text-xs font-medium text-muted-foreground"
                      title={copy.explanation}
                    >
                      {copy.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </SettingRow>
        ) : null}
      </SettingsGroup>

      {/* ── 5. Danger zone ────────────────────────────────────────────────── */}
      <SettingsGroup
        title="Danger zone"
        tone="danger"
        description="Destructive actions for this repository's overrides."
      >
        <SettingRow
          label="Reset all overrides"
          description={`Clear every per-repo override so this repo inherits all defaults. Type ${confirmTarget} to confirm.`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.currentTarget.value)}
              placeholder={confirmTarget}
              className={cn(
                "h-8 w-48 font-mono text-sm",
                "border-destructive/30",
              )}
              aria-label={`Type ${confirmTarget} to confirm reset`}
              disabled={isResetting}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8"
              disabled={!confirmMatches || isResetting}
              onClick={async () => {
                setIsResetting(true);
                setError(null);
                try {
                  await handleReset();
                  setConfirmText("");
                  setState(seedEditState(resolved, null));
                } catch (resetError) {
                  setError(
                    resetError instanceof Error
                      ? resetError.message
                      : "Failed to reset",
                  );
                } finally {
                  setIsResetting(false);
                }
              }}
            >
              {isResetting ? <Loader2 className="animate-spin" /> : null}
              Reset to defaults
            </Button>
          </div>
        </SettingRow>
      </SettingsGroup>

      {/* Saving indicator + error */}
      {isSaving ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
