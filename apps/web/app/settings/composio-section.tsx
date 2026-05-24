"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import useSWR from "swr";
import type { ComposioSettingsResponse } from "@/app/api/settings/composio/route";
import type {
  ComposioAgentDefaults,
  ComposioAgentKey,
} from "@/lib/composio/types";
import { COMPOSIO_AGENT_KEYS } from "@/lib/composio/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Profile = ComposioSettingsResponse["profiles"][number];

const AGENT_LABELS: Record<ComposioAgentKey, string> = {
  main: "Main",
  explorer: "Explorer",
  executor: "Executor",
  design: "Design",
};

async function fetchComposioSettings(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Composio settings");
  }
  return (await response.json()) as ComposioSettingsResponse;
}

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAuthConfigMap(value: Record<string, string | null>): string {
  return Object.entries(value)
    .map(([toolkit, authConfigId]) => `${toolkit}=${authConfigId ?? ""}`)
    .join("\n");
}

function parseAuthConfigMap(value: string): Record<string, string | null> {
  const next: Record<string, string | null> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [toolkit, authConfigId = ""] = trimmed.split("=");
    const normalizedToolkit = toolkit?.trim();
    if (!normalizedToolkit) continue;
    const normalizedAuthConfigId = authConfigId.trim();
    next[normalizedToolkit] =
      normalizedAuthConfigId.length > 0 ? normalizedAuthConfigId : null;
  }
  return next;
}

function formatConnectedAccountMap(value: Record<string, string[]>): string {
  return Object.entries(value)
    .map(
      ([toolkit, connectedAccountIds]) =>
        `${toolkit}=${connectedAccountIds.join(",")}`,
    )
    .join("\n");
}

function parseConnectedAccountMap(value: string): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [toolkit, connectedAccountIds = ""] = trimmed.split("=");
    const normalizedToolkit = toolkit?.trim();
    if (!normalizedToolkit) continue;
    const ids = splitList(connectedAccountIds);
    if (ids.length > 0) {
      next[normalizedToolkit] = ids;
    }
  }
  return next;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function ComposioSectionSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    </div>
  );
}

function ProfileEditor({
  profile,
  onSaved,
  onDeleted,
}: {
  profile: Profile;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [toolkits, setToolkits] = useState(profile.toolkitSlugs.join(", "));
  const [authConfigs, setAuthConfigs] = useState(
    formatAuthConfigMap(profile.authConfigIdsByToolkit),
  );
  const [connectedAccounts, setConnectedAccounts] = useState(
    formatConnectedAccountMap(profile.connectedAccountIdsByToolkit),
  );
  const [workbenchEnabled, setWorkbenchEnabled] = useState(
    profile.workbenchEnabled,
  );
  const [allowInChatConnectionManagement, setAllowInChatConnectionManagement] =
    useState(profile.allowInChatConnectionManagement);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(profile.name);
    setToolkits(profile.toolkitSlugs.join(", "));
    setAuthConfigs(formatAuthConfigMap(profile.authConfigIdsByToolkit));
    setConnectedAccounts(
      formatConnectedAccountMap(profile.connectedAccountIdsByToolkit),
    );
    setWorkbenchEnabled(profile.workbenchEnabled);
    setAllowInChatConnectionManagement(profile.allowInChatConnectionManagement);
  }, [profile]);

  async function saveProfile() {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/composio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          profile: {
            name,
            toolkitSlugs: splitList(toolkits),
            authConfigIdsByToolkit: parseAuthConfigMap(authConfigs),
            connectedAccountIdsByToolkit:
              parseConnectedAccountMap(connectedAccounts),
            workbenchEnabled,
            allowInChatConnectionManagement,
          },
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to save profile");
      }
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save profile",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteProfile() {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/composio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to delete profile");
      }
      onDeleted();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete profile",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 p-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="grid gap-1.5">
          <Label htmlFor={`composio-name-${profile.id}`}>Name</Label>
          <Input
            id={`composio-name-${profile.id}`}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            disabled={isSaving}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`composio-toolkits-${profile.id}`}>
            Toolkit slugs
          </Label>
          <Input
            id={`composio-toolkits-${profile.id}`}
            value={toolkits}
            onChange={(event) => setToolkits(event.currentTarget.value)}
            disabled={isSaving}
          />
          <FieldHelp>
            Comma-separated Composio toolkit IDs, for example github, linear, or
            hackernews.
          </FieldHelp>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`composio-auth-${profile.id}`}>Auth config IDs</Label>
          <Textarea
            id={`composio-auth-${profile.id}`}
            value={authConfigs}
            onChange={(event) => setAuthConfigs(event.currentTarget.value)}
            placeholder="gmail=ac_..."
            disabled={isSaving}
            className="min-h-20 font-mono text-xs"
          />
          <FieldHelp>
            Optional toolkit to auth config mapping from Composio, one per line.
          </FieldHelp>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`composio-accounts-${profile.id}`}>
            Connected account IDs
          </Label>
          <Textarea
            id={`composio-accounts-${profile.id}`}
            value={connectedAccounts}
            onChange={(event) =>
              setConnectedAccounts(event.currentTarget.value)
            }
            placeholder="gmail=ca_..."
            disabled={isSaving}
            className="min-h-20 font-mono text-xs"
          />
          <FieldHelp>
            Optional toolkit to connected account IDs when a toolkit should use
            specific accounts.
          </FieldHelp>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Switch
              id={`composio-workbench-${profile.id}`}
              checked={workbenchEnabled}
              onCheckedChange={setWorkbenchEnabled}
              disabled={isSaving}
            />
            <Label htmlFor={`composio-workbench-${profile.id}`}>
              Workbench
            </Label>
            <span className="text-xs text-muted-foreground">
              Include Composio hosted workbench tools.
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch
              id={`composio-in-chat-management-${profile.id}`}
              checked={allowInChatConnectionManagement}
              onCheckedChange={setAllowInChatConnectionManagement}
              disabled={isSaving}
            />
            <Label htmlFor={`composio-in-chat-management-${profile.id}`}>
              In-chat connection tools
            </Label>
            <span className="text-xs text-muted-foreground">
              Let agents create account connection links during a run.
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={saveProfile}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={deleteProfile}
            disabled={isSaving}
            aria-label={`Delete ${profile.name}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function ComposioSection() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/settings/composio",
    fetchComposioSettings,
  );
  const [newName, setNewName] = useState("");
  const [newToolkits, setNewToolkits] = useState("");
  const [authConfigId, setAuthConfigId] = useState("");
  const [connectionAlias, setConnectionAlias] = useState("");
  const [connectionUrl, setConnectionUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const profiles = data?.profiles ?? [];
  const defaults = data?.defaults;
  const status = data?.status;
  const isComposioAvailable = status?.configured && status.available;

  const statusText = useMemo(() => {
    if (!status) return "Checking Composio...";
    if (!status.configured) return "Not configured";
    if (status.available) return "Configured";
    if (status.reason === "invalid_api_key") return "Invalid API key";
    return "Connection check failed";
  }, [status]);

  async function createProfile() {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const response = await fetch("/api/settings/composio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          toolkitSlugs: splitList(newToolkits),
          authConfigIdsByToolkit: {},
          connectedAccountIdsByToolkit: {},
          workbenchEnabled: false,
          allowInChatConnectionManagement: false,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to create profile");
      }
      setNewName("");
      setNewToolkits("");
      await mutate();
    } catch (createError) {
      setActionError(
        createError instanceof Error
          ? createError.message
          : "Failed to create profile",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function checkConnection() {
    setIsSubmitting(true);
    setActionError(null);
    try {
      await mutate();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateDefaults(nextDefaults: ComposioAgentDefaults) {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const response = await fetch("/api/settings/composio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaults: nextDefaults }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to update defaults");
      }
      await mutate();
    } catch (defaultsError) {
      setActionError(
        defaultsError instanceof Error
          ? defaultsError.message
          : "Failed to update defaults",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createConnectionLink() {
    setIsSubmitting(true);
    setActionError(null);
    setConnectionUrl(null);
    try {
      const response = await fetch("/api/composio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authConfigId,
          ...(connectionAlias ? { alias: connectionAlias } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        redirectUrl?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.redirectUrl) {
        throw new Error(body?.error ?? "Failed to create connection link");
      }
      setConnectionUrl(body.redirectUrl);
    } catch (connectError) {
      setActionError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to create connection link",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <ComposioSectionSkeleton />;
  }

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
        Failed to load Composio settings.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <SectionHeader>Status</SectionHeader>
        <div className="rounded-lg border border-border/70 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">{statusText}</p>
              <p className="text-pretty text-xs text-muted-foreground">
                {status?.message ??
                  "External account credentials remain in Composio. Open Agents stores profile selection, toolkit slugs, account IDs, and session IDs only."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs">
                COMPOSIO_API_KEY
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={checkConnection}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                Check
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <SectionHeader>Profiles</SectionHeader>
        <div className="grid gap-3 rounded-lg border border-dashed border-border/70 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="new-composio-profile-name">Name</Label>
              <Input
                id="new-composio-profile-name"
                value={newName}
                onChange={(event) => setNewName(event.currentTarget.value)}
                placeholder="GitHub"
                disabled={isSubmitting}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="new-composio-profile-toolkits">
                Toolkit slugs
              </Label>
              <Input
                id="new-composio-profile-toolkits"
                value={newToolkits}
                onChange={(event) => setNewToolkits(event.currentTarget.value)}
                placeholder="github, linear"
                disabled={isSubmitting}
              />
              <FieldHelp>
                Use Composio toolkit slugs. Add account IDs only for tools that
                need a specific connection.
              </FieldHelp>
            </div>
            <Button
              type="button"
              onClick={createProfile}
              disabled={
                isSubmitting ||
                !isComposioAvailable ||
                !newName.trim() ||
                !newToolkits.trim()
              }
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus />}
              Add
            </Button>
          </div>
          {actionError ? (
            <p className="text-sm text-destructive">{actionError}</p>
          ) : null}
        </div>
        {profiles.length > 0 ? (
          <div className="space-y-3">
            {profiles.map((profile) => (
              <ProfileEditor
                key={profile.id}
                profile={profile}
                onSaved={() => void mutate()}
                onDeleted={() => void mutate()}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border/70 p-3 text-sm text-muted-foreground">
            No Composio profiles configured yet. Add a profile with toolkit
            slugs, select it from the chat toolbar, and connect accounts only
            when a toolkit requires authentication.
          </div>
        )}
      </div>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <SectionHeader>Agent Defaults</SectionHeader>
        {defaults ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {COMPOSIO_AGENT_KEYS.map((agentKey) => (
              <div
                key={agentKey}
                className="grid gap-3 rounded-lg border border-border/70 p-3"
              >
                <Label>{AGENT_LABELS[agentKey]}</Label>
                <Select
                  value={defaults[agentKey].defaultProfileId ?? "off"}
                  disabled={isSubmitting || !isComposioAvailable}
                  onValueChange={(value) => {
                    void updateDefaults({
                      ...defaults,
                      [agentKey]: {
                        ...defaults[agentKey],
                        defaultProfileId: value === "off" ? null : value,
                      },
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <Label htmlFor={`composio-agent-chat-override-${agentKey}`}>
                    Allow chat override
                  </Label>
                  <Switch
                    id={`composio-agent-chat-override-${agentKey}`}
                    checked={defaults[agentKey].allowChatOverride}
                    disabled={isSubmitting}
                    onCheckedChange={(checked) => {
                      void updateDefaults({
                        ...defaults,
                        [agentKey]: {
                          ...defaults[agentKey],
                          allowChatOverride: checked,
                        },
                      });
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/50" />

      <div className="space-y-4">
        <SectionHeader>Connections</SectionHeader>
        <div className="grid gap-3 rounded-lg border border-border/70 p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="composio-auth-config-id">Auth config ID</Label>
              <Input
                id="composio-auth-config-id"
                value={authConfigId}
                onChange={(event) => setAuthConfigId(event.currentTarget.value)}
                placeholder="ac_..."
                disabled={isSubmitting || !isComposioAvailable}
              />
              <FieldHelp>
                Auth config IDs come from Composio connection settings.
              </FieldHelp>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="composio-alias">Alias</Label>
              <Input
                id="composio-alias"
                value={connectionAlias}
                onChange={(event) =>
                  setConnectionAlias(event.currentTarget.value)
                }
                placeholder="work-gmail"
                disabled={isSubmitting || !isComposioAvailable}
              />
              <FieldHelp>
                Optional readable name for the connected account.
              </FieldHelp>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={createConnectionLink}
              disabled={
                isSubmitting || !isComposioAvailable || !authConfigId.trim()
              }
            >
              {isSubmitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ExternalLink />
              )}
              Connect
            </Button>
          </div>
          {connectionUrl ? (
            <a
              href={connectionUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm text-primary underline"
            >
              Open Composio connection link
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
