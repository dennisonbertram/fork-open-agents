"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSection } from "@/components/ui/settings-section";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { mapComposioStatusToVerdict } from "./composio-status-verdict";
import { ComposioToolCatalog } from "./composio-tool-catalog";
import { ComposioToolkitPicker } from "./composio-toolkit-picker";
import {
  shouldShowMainDefaultTip,
  profileRowSummary,
  AGENT_ROLE_DESCRIPTIONS,
} from "./composio-section-helpers";

/** Where users manage Composio toolkits, auth configs, and connected accounts. */
const COMPOSIO_DASHBOARD_URL = "https://app.composio.dev";

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

// ── Logo strip (collapsed row) ────────────────────────────────────────────

interface LogoStripProps {
  toolkitSlugs: string[];
  /** Optional catalog lookup for logo URLs. When absent, all logos are null. */
  catalog?: Array<{ slug: string; name: string; logo: string | null }>;
}

function LogoStrip({ toolkitSlugs, catalog = [] }: LogoStripProps) {
  const { logos, overflow } = profileRowSummary(toolkitSlugs, catalog);

  if (logos.length === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">No tools yet</span>
    );
  }

  return (
    <span className="flex items-center gap-0.5">
      {logos.map((entry) =>
        entry.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Remote Composio logos not compatible with next/image domain config
          <img
            key={entry.slug}
            src={entry.logo}
            alt={entry.name}
            width={16}
            height={16}
            referrerPolicy="no-referrer"
            title={entry.name}
            className="h-4 w-4 rounded object-contain"
          />
        ) : (
          <span
            key={entry.slug}
            title={entry.name}
            className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted"
          >
            <span className="text-[9px] font-medium uppercase text-muted-foreground">
              {entry.name.slice(0, 2)}
            </span>
          </span>
        ),
      )}
      {overflow > 0 ? (
        <span className="ml-0.5 text-xs text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

// ── Inline profile editor (expanded state) ───────────────────────────────

interface ProfileEditorProps {
  profile: Profile;
  isNew?: boolean;
  onSaved: () => void;
  onDeleted: () => void;
  onCancel: () => void;
}

function ProfileEditor({
  profile,
  isNew = false,
  onSaved,
  onDeleted,
  onCancel,
}: ProfileEditorProps) {
  const [name, setName] = useState(profile.name);
  const [toolkitSlugs, setToolkitSlugs] = useState<string[]>(
    profile.toolkitSlugs,
  );
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus name on mount
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isNew) {
      setName(profile.name);
      setToolkitSlugs(profile.toolkitSlugs);
      setAuthConfigs(formatAuthConfigMap(profile.authConfigIdsByToolkit));
      setConnectedAccounts(
        formatConnectedAccountMap(profile.connectedAccountIdsByToolkit),
      );
      setWorkbenchEnabled(profile.workbenchEnabled);
      setAllowInChatConnectionManagement(
        profile.allowInChatConnectionManagement,
      );
    }
  }, [profile, isNew]);

  async function saveProfile() {
    setIsSaving(true);
    setError(null);
    try {
      const method = isNew ? "POST" : "PATCH";
      const requestBody = isNew
        ? {
            name,
            toolkitSlugs,
            authConfigIdsByToolkit: parseAuthConfigMap(authConfigs),
            connectedAccountIdsByToolkit:
              parseConnectedAccountMap(connectedAccounts),
            workbenchEnabled,
            allowInChatConnectionManagement,
          }
        : {
            profileId: profile.id,
            profile: {
              name,
              toolkitSlugs,
              authConfigIdsByToolkit: parseAuthConfigMap(authConfigs),
              connectedAccountIdsByToolkit:
                parseConnectedAccountMap(connectedAccounts),
              workbenchEnabled,
              allowInChatConnectionManagement,
            },
          };
      const response = await fetch("/api/settings/composio", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to save profile");
      }
      toast.success(isNew ? "Profile created" : "Profile saved");
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
    if (isNew) {
      onCancel();
      return;
    }
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
      toast.success("Profile deleted");
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
    <div className="px-3 pb-3 pt-2 grid gap-2">
      {/* Name — compact, not full-width */}
      <Input
        ref={nameRef}
        id={`composio-name-${profile.id}`}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        placeholder="Profile name"
        disabled={isSaving}
        aria-label="Profile name"
        className="h-7 text-sm max-w-xs"
      />

      {/* Tool picker — search-driven, compact */}
      <ComposioToolkitPicker
        selectedSlugs={toolkitSlugs}
        onChange={setToolkitSlugs}
        disabled={isSaving}
      />
      {toolkitSlugs.length === 0 && name.trim() ? (
        <p className="text-xs text-muted-foreground">
          Select at least one tool to save this profile.
        </p>
      ) : null}

      {/* Advanced disclosure — closed by default */}
      <div className="border-t border-border/60 pt-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          aria-expanded={advancedOpen}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              advancedOpen && "rotate-180",
            )}
          />
          Advanced
        </button>
        {advancedOpen ? (
          <div className="mt-2 grid gap-3">
            {/* Workbench + In-chat toggles */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                <Switch
                  id={`composio-workbench-${profile.id}`}
                  checked={workbenchEnabled}
                  onCheckedChange={setWorkbenchEnabled}
                  disabled={isSaving}
                />
                <Label
                  htmlFor={`composio-workbench-${profile.id}`}
                  className="text-xs"
                >
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
                <Label
                  htmlFor={`composio-in-chat-management-${profile.id}`}
                  className="text-xs"
                >
                  In-chat connection tools
                </Label>
                <span className="text-xs text-muted-foreground">
                  Let agents create account connection links during a run.
                </span>
              </div>
            </div>

            {/* Specific account IDs */}
            <p className="text-xs text-muted-foreground">
              Only set these if a tool must use a specific connected account.{" "}
              <a
                href={COMPOSIO_DASHBOARD_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
              >
                Find these IDs in Composio
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`composio-auth-${profile.id}`}
                  className="text-xs"
                >
                  Auth config IDs
                </Label>
                <Textarea
                  id={`composio-auth-${profile.id}`}
                  value={authConfigs}
                  onChange={(event) =>
                    setAuthConfigs(event.currentTarget.value)
                  }
                  placeholder="gmail=ac_..."
                  disabled={isSaving}
                  className="min-h-20 font-mono text-xs"
                />
                <FieldHelp>One per line, as toolkit=auth_config_id.</FieldHelp>
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor={`composio-accounts-${profile.id}`}
                  className="text-xs"
                >
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
                  One per line, as toolkit=connected_account_id.
                </FieldHelp>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Action row: Save + Cancel + Delete */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          onClick={saveProfile}
          disabled={isSaving || !name.trim() || toolkitSlugs.length === 0}
          className="h-7 text-xs"
        >
          {isSaving ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isSaving}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={deleteProfile}
          disabled={isSaving}
          aria-label={`Delete ${profile.name || "profile"}`}
          className="ml-auto text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

// ── Collapsed profile row ─────────────────────────────────────────────────

interface ProfileListRowProps {
  profile: Profile;
  isExpanded: boolean;
  catalog: Array<{ slug: string; name: string; logo: string | null }>;
  onExpand: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onCollapse: () => void;
}

function ProfileListRow({
  profile,
  isExpanded,
  catalog,
  onExpand,
  onSaved,
  onDeleted,
  onCollapse,
}: ProfileListRowProps) {
  const toolCount = profile.toolkitSlugs.length;

  return (
    <div>
      {/* Collapsed row */}
      {!isExpanded ? (
        <div className="group flex items-center hover:bg-muted/30">
          {/* Main expand button — spans name + logos + count */}
          <button
            type="button"
            className="flex flex-1 min-w-0 items-center gap-3 px-3 py-2.5 text-left"
            onClick={onExpand}
            aria-expanded={false}
            aria-label={`Edit profile ${profile.name}`}
          >
            {/* Name */}
            <span className="text-sm font-medium shrink-0">{profile.name}</span>

            {/* Logo strip */}
            <span className="flex-1 min-w-0">
              <LogoStrip
                toolkitSlugs={profile.toolkitSlugs}
                catalog={catalog}
              />
            </span>

            {/* Tool count */}
            <span className="text-xs text-muted-foreground shrink-0">
              {toolCount === 0
                ? "No tools"
                : toolCount === 1
                  ? "1 tool"
                  : `${toolCount} tools`}
            </span>
          </button>

          {/* Action buttons — always rendered, visible on row hover/focus */}
          <span className="flex items-center gap-1 pr-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 shrink-0 transition-opacity">
            <button
              type="button"
              aria-label={`Edit ${profile.name}`}
              onClick={onExpand}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <DeleteProfileButton profile={profile} onDeleted={onDeleted} />
          </span>
        </div>
      ) : (
        /* Expanded editor inline */
        <ProfileEditor
          profile={profile}
          onSaved={() => {
            onSaved();
            onCollapse();
          }}
          onDeleted={onDeleted}
          onCancel={onCollapse}
        />
      )}
    </div>
  );
}

// ── Quick delete button for collapsed row ────────────────────────────────

interface DeleteProfileButtonProps {
  profile: Profile;
  onDeleted: () => void;
}

function DeleteProfileButton({ profile, onDeleted }: DeleteProfileButtonProps) {
  const [isPending, setIsPending] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setIsPending(true);
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
      toast.success("Profile deleted");
      onDeleted();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete profile",
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={`Delete ${profile.name}`}
      onClick={handleDelete}
      disabled={isPending}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

// ── "New profile" pending row (expanded immediately) ─────────────────────

/** A blank profile stub used for the add-new flow. */
const NEW_PROFILE_STUB: Profile = {
  id: "__new__",
  userId: "",
  name: "",
  toolkitSlugs: [],
  authConfigIdsByToolkit: {},
  connectedAccountIdsByToolkit: {},
  workbenchEnabled: false,
  allowInChatConnectionManagement: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

// ── Main ComposioSection ───────────────────────────────────────────────────

export function ComposioSection() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/settings/composio",
    fetchComposioSettings,
  );
  const [authConfigId, setAuthConfigId] = useState("");
  const [connectionAlias, setConnectionAlias] = useState("");
  const [connectionUrl, setConnectionUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bringYourOwnAuthOpen, setBringYourOwnAuthOpen] = useState(false);

  // Which profile row is currently expanded: a profile.id string, or "__new__" for the add form
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const profiles = data?.profiles ?? [];
  const defaults = data?.defaults;
  const status = data?.status;
  const isComposioAvailable = status?.configured && status.available;

  // Build a minimal catalog from the toolkit picker's SWR data is not
  // available here, so the logo strip uses whatever catalog the SWR toolkit
  // call returns. We derive a catalog stub from profile data itself when
  // toolkits API data is not available — logos will appear once the SWR
  // data lands in the picker's own cache, but we fetch it here for the strip.
  const [toolkitCatalog, setToolkitCatalog] = useState<
    Array<{ slug: string; name: string; logo: string | null }>
  >([]);

  useEffect(() => {
    // Fetch toolkits for the logo strip (best-effort, not blocking)
    fetch("/api/composio/toolkits")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          body: {
            toolkits: Array<{
              slug: string;
              name: string;
              logo: string | null;
            }>;
          } | null,
        ) => {
          if (body?.toolkits) {
            setToolkitCatalog(body.toolkits);
          }
        },
      )
      .catch(() => {
        // Best-effort — logo strip degrades gracefully to initials
      });
  }, []);

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
      toast.success("Agent default updated");
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

  const verdict = mapComposioStatusToVerdict(status);

  // Tip: show when profiles exist but Main has no default
  const mainDefaultProfileId = defaults?.main.defaultProfileId ?? null;
  const showMainTip = shouldShowMainDefaultTip(profiles, mainDefaultProfileId);

  const isAddingNew = expandedId === "__new__";

  return (
    <div className="space-y-6">
      <ReadinessVerdict
        status={verdict.status}
        headline={verdict.headline}
        subtext={verdict.subtext}
        checks={verdict.checks}
        onRefresh={checkConnection}
        refreshing={isSubmitting}
      />

      <SettingsSection
        title="Connect tools"
        description="Connect the apps your agents can use. Search for an app, connect it once, and it stays pinned here."
      >
        <ComposioToolCatalog />
      </SettingsSection>

      {/* ── Tool profiles: single bordered panel ─────────────────────── */}
      <SettingsSection
        title="Tool profiles"
        description="Named bundles of connected tools. Assign a profile to an agent below (Main, Explorer, …) so different agents get different tools — or pick tools directly in a chat."
        learnMore={{ href: COMPOSIO_DASHBOARD_URL, label: "Open Composio" }}
      >
        <div className="rounded-lg border border-border/70 overflow-hidden">
          {/* Existing profile rows */}
          {profiles.length > 0 || isAddingNew ? (
            <div className="divide-y divide-border/60">
              {profiles.map((profile) => (
                <ProfileListRow
                  key={profile.id}
                  profile={profile}
                  isExpanded={expandedId === profile.id}
                  catalog={toolkitCatalog}
                  onExpand={() =>
                    setExpandedId((prev) =>
                      prev === profile.id ? null : profile.id,
                    )
                  }
                  onCollapse={() => setExpandedId(null)}
                  onSaved={() => {
                    void mutate();
                    setExpandedId(null);
                  }}
                  onDeleted={() => {
                    void mutate();
                    setExpandedId(null);
                  }}
                />
              ))}

              {/* New profile row — expanded editor at bottom of list */}
              {isAddingNew ? (
                <div>
                  <div className="px-3 py-2 border-b border-border/60 bg-muted/20">
                    <span className="text-xs text-muted-foreground font-medium">
                      New profile
                    </span>
                  </div>
                  <ProfileEditor
                    profile={NEW_PROFILE_STUB}
                    isNew
                    onSaved={() => {
                      void mutate();
                      setExpandedId(null);
                    }}
                    onDeleted={() => setExpandedId(null)}
                    onCancel={() => setExpandedId(null)}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            /* Empty state — no profiles yet */
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">
              No tool profiles yet. Create one to bundle tools for an agent.
            </p>
          )}

          {/* "New profile" button — always at bottom of panel */}
          {!isAddingNew ? (
            <div
              className={cn(
                "border-t border-border/60",
                profiles.length === 0 && "border-t-0",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (!isComposioAvailable) return;
                  setExpandedId("__new__");
                }}
                disabled={!isComposioAvailable}
                className={cn(
                  "flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium",
                  "text-muted-foreground hover:text-foreground hover:bg-muted/30",
                  "disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
                New profile
              </button>
            </div>
          ) : null}
        </div>
      </SettingsSection>

      {/* Agent defaults — compact one-row cards */}
      <SettingsSection
        title="Agent defaults"
        description="Pick the tools each agent starts with when a chat hasn't chosen its own. Main is your chat agent; Explorer and Executor are subagents it spawns for bigger tasks; Design handles design work. 'Off' means that agent gets no external tools."
      >
        {defaults ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              {COMPOSIO_AGENT_KEYS.map((agentKey) => (
                <div
                  key={agentKey}
                  className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
                >
                  {/* Agent label + description */}
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">
                      {AGENT_LABELS[agentKey]}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {AGENT_ROLE_DESCRIPTIONS[agentKey]}
                    </span>
                  </div>

                  {/* Profile select */}
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
                    <SelectTrigger className="h-7 w-36 text-xs">
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

                  {/* Allow chat override toggle */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className="hidden text-xs text-muted-foreground sm:inline"
                      title="When on, an individual chat can swap this agent's tools for that conversation only — your saved default stays. Off locks the default."
                    >
                      Chat override
                    </span>
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
                      aria-label={`Allow chat override for ${AGENT_LABELS[agentKey]}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Chat override:
              </span>{" "}
              when on, an individual chat can change that agent&apos;s tools for
              the conversation; your saved default stays. Turn it off to lock
              the default.
            </p>

            {/* Tip: suggest setting Main's default when profiles exist */}
            {showMainTip && (
              <p className="text-xs text-muted-foreground rounded-md border border-border/50 bg-muted/40 px-3 py-2">
                Tip: set a default profile for Main so new chats start with
                tools.
              </p>
            )}
          </div>
        ) : null}
      </SettingsSection>

      {/* Bring your own auth — demoted to a closed disclosure */}
      <SettingsSection
        title="Bring your own auth (advanced)"
        description="Most people don't need this. Use Connect tools above to connect apps in one click."
        learnMore={{
          href: COMPOSIO_DASHBOARD_URL,
          label: "Open Composio dashboard",
        }}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Use this only if you&apos;re bringing your own OAuth app — paste its
            Auth config ID from the{" "}
            <a
              href={COMPOSIO_DASHBOARD_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
            >
              Composio dashboard
              <ExternalLink className="h-3 w-3" />
            </a>
            .
          </p>

          {/* Closed-by-default disclosure */}
          <button
            type="button"
            onClick={() => setBringYourOwnAuthOpen((v) => !v)}
            aria-expanded={bringYourOwnAuthOpen}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                bringYourOwnAuthOpen && "rotate-180",
              )}
            />
            Advanced — bring your own auth config
          </button>

          {bringYourOwnAuthOpen && (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end border-t border-border/60 pt-3">
              <div className="grid gap-1.5">
                <Label htmlFor="composio-auth-config-id">Auth config ID</Label>
                <Input
                  id="composio-auth-config-id"
                  value={authConfigId}
                  onChange={(event) =>
                    setAuthConfigId(event.currentTarget.value)
                  }
                  placeholder="ac_..."
                  disabled={isSubmitting || !isComposioAvailable}
                  className="font-mono text-xs"
                />
                <FieldHelp>From your Composio dashboard.</FieldHelp>
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
                <FieldHelp>An optional friendly name.</FieldHelp>
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
          )}

          {connectionUrl ? (
            <a
              href={connectionUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block truncate text-sm text-primary underline"
            >
              Open Composio connection link
            </a>
          ) : null}
        </div>
      </SettingsSection>

      {actionError ? (
        <p className="text-sm text-destructive">{actionError}</p>
      ) : null}
    </div>
  );
}
