"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  InferenceProfileProvider,
  InferenceProfileTestResult,
  SafeInferenceProfile,
} from "@/lib/inference/types";
import {
  CURSOR_OPENAI_COMPATIBLE_BASE_URL,
  CURSOR_OPENAI_COMPATIBLE_MODEL_IDS,
  getInferenceProfileModelProviderDisplayName,
} from "@/lib/inference/profile-models";
import { fetcher } from "@/lib/swr";
import { cn } from "@/lib/utils";

export interface InferenceProfilesResponse {
  profiles: SafeInferenceProfile[];
}

type SaveProfileInput = {
  name: string;
  provider: InferenceProfileProvider;
  baseUrl: string;
  modelIds: string[];
  apiKey: string;
  enabled: boolean;
};

export function createCursorInferenceProfileDraft(currentName: string): {
  provider: InferenceProfileProvider;
  name: string | null;
  baseUrl: string;
  modelIds: string;
} {
  return {
    provider: "openai-compatible",
    name: currentName.trim() ? null : "Cursor",
    baseUrl: CURSOR_OPENAI_COMPATIBLE_BASE_URL,
    modelIds: CURSOR_OPENAI_COMPATIBLE_MODEL_IDS.join("\n"),
  };
}

function parseModelIds(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((modelId) => modelId.trim())
        .filter(Boolean),
    ),
  );
}

function getProfileProviderLabel(profile: SafeInferenceProfile): string {
  return getInferenceProfileModelProviderDisplayName(profile);
}

function formatProfileDate(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function InferenceProfilesSectionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}

function ProfileDialog({
  open,
  onOpenChange,
  editingProfile,
  isSaving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProfile: SafeInferenceProfile | null;
  isSaving: boolean;
  onSubmit: (input: SaveProfileInput) => Promise<true | string>;
}) {
  const [name, setName] = useState("");
  const [provider, setProvider] =
    useState<InferenceProfileProvider>("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelIds, setModelIds] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(editingProfile?.name ?? "");
    setProvider(editingProfile?.provider ?? "anthropic");
    setBaseUrl(editingProfile?.baseUrl ?? "");
    setModelIds((editingProfile?.modelIds ?? []).join("\n"));
    setApiKey("");
    setEnabled(editingProfile?.enabled ?? true);
    setError(null);
  }, [editingProfile, open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!editingProfile && !apiKey.trim()) {
      setError("API key is required");
      return;
    }
    const parsedModelIds = parseModelIds(modelIds);
    if (provider === "openai-compatible") {
      if (!baseUrl.trim()) {
        setError("Base URL is required for OpenAI-compatible profiles");
        return;
      }
      if (parsedModelIds.length === 0) {
        setError("Add at least one model ID");
        return;
      }
    }

    const result = await onSubmit({
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim(),
      modelIds: parsedModelIds,
      apiKey: apiKey.trim(),
      enabled,
    });

    if (result === true) {
      onOpenChange(false);
      return;
    }

    setError(result);
  };

  const isEditing = editingProfile !== null;
  const applyCursorPreset = () => {
    const draft = createCursorInferenceProfileDraft(name);
    setProvider(draft.provider);
    if (draft.name) {
      setName(draft.name);
    }
    setBaseUrl(draft.baseUrl);
    setModelIds(draft.modelIds);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Inference Profile" : "New Inference Profile"}
          </DialogTitle>
          <DialogDescription>
            Save provider credentials for direct user-paid model calls.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="inference-profile-provider">Provider type</Label>
            <Select
              value={provider}
              onValueChange={(value) =>
                setProvider(value as InferenceProfileProvider)
              }
              disabled={isSaving}
            >
              <SelectTrigger id="inference-profile-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic-compatible</SelectItem>
                <SelectItem value="openai-compatible">
                  OpenAI-compatible
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="inference-profile-name">Name</Label>
            <Input
              id="inference-profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                provider === "openai-compatible"
                  ? "Sakana"
                  : "Personal Anthropic"
              }
              disabled={isSaving}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="inference-profile-base-url">Base URL</Label>
            <Input
              id="inference-profile-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={
                provider === "openai-compatible"
                  ? "https://api.sakana.ai/fugu/v1"
                  : "https://api.anthropic.com/v1 or https://api.fireworks.ai/inference/v1"
              }
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              {provider === "openai-compatible" ? (
                <>
                  Use the provider&apos;s OpenAI-compatible base URL, not the{" "}
                  <span className="font-mono">/chat/completions</span> path. For
                  Cursor Composer, run an OpenAI-compatible Cursor proxy and use{" "}
                  <span className="font-mono">
                    {CURSOR_OPENAI_COMPATIBLE_BASE_URL}
                  </span>
                  .
                </>
              ) : (
                <>
                  Empty uses Anthropic. Fireworks URLs are normalized to{" "}
                  <span className="font-mono">
                    https://api.fireworks.ai/inference/v1
                  </span>
                  .
                </>
              )}
            </p>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium">Cursor Composer preset</p>
                <p className="text-xs text-muted-foreground">
                  Fills the OpenAI-compatible local Cursor proxy URL and
                  Composer model IDs. You can still edit the list for any Cursor
                  model your proxy exposes.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={applyCursorPreset}
                disabled={isSaving}
                className="shrink-0"
              >
                Use Cursor
              </Button>
            </div>
          </div>

          {provider === "openai-compatible" && (
            <div className="grid gap-1.5">
              <Label htmlFor="inference-profile-model-ids">Model IDs</Label>
              <Textarea
                id="inference-profile-model-ids"
                value={modelIds}
                onChange={(event) => setModelIds(event.target.value)}
                placeholder={"composer-2.5\ncomposer-2.5-fast"}
                disabled={isSaving}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Enter one model ID per line, or separate them with commas.
              </p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="inference-profile-api-key">API Key</Label>
            <Input
              id="inference-profile-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={isEditing ? "Leave blank to keep current key" : ""}
              autoComplete="off"
              disabled={isSaving}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
            <div className="space-y-0.5">
              <Label htmlFor="inference-profile-enabled">Enabled</Label>
              <p className="text-xs text-muted-foreground">
                Disabled profiles stay saved but are hidden from chat pickers.
              </p>
            </div>
            <Switch
              id="inference-profile-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={isSaving}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? "Saving..." : isEditing ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProfileStatus({ profile }: { profile: SafeInferenceProfile }) {
  const testedAt = formatProfileDate(profile.lastTestedAt);

  if (profile.status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" />
        {testedAt ? `Verified ${testedAt}` : "Verified"}
      </span>
    );
  }

  if (profile.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="size-3.5" />
        {testedAt ? `Failed ${testedAt}` : "Failed"}
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">Untested</span>;
}

function ProfileCard({
  profile,
  isSaving,
  isTesting,
  onEdit,
  onDelete,
  onTest,
}: {
  profile: SafeInferenceProfile;
  isSaving: boolean;
  isTesting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-card transition-colors hover:border-border/80 hover:bg-accent/30",
        !profile.enabled && "opacity-65",
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/70">
          <KeyRound className="size-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-medium leading-tight">
              {profile.name}
            </h3>
            {!profile.enabled && (
              <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                Disabled
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-muted-foreground">
              {getProfileProviderLabel(profile)} key ending {profile.keyLast4}
            </span>
            {profile.baseUrl && (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {profile.baseUrl}
              </span>
            )}
            {profile.modelIds.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {profile.modelIds.length} model
                {profile.modelIds.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <ProfileStatus profile={profile} />
            {profile.lastTestMessage && (
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {profile.lastTestMessage}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onTest}
            disabled={isSaving || isTesting || !profile.enabled}
          >
            {isTesting && <Loader2 className="size-3.5 animate-spin" />}
            Test
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={onEdit}
                disabled={isSaving || isTesting}
                aria-label="Edit inference profile"
              >
                <Pencil className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit profile</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={onDelete}
                disabled={isSaving || isTesting}
                aria-label="Delete inference profile"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete profile</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export function InferenceProfilesSection() {
  const { data, isLoading, mutate } = useSWR<InferenceProfilesResponse>(
    "/api/inference-profiles",
    fetcher,
  );
  const profiles = data?.profiles ?? [];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<SafeInferenceProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setEditingProfile(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (profile: SafeInferenceProfile) => {
    setEditingProfile(profile);
    setDialogOpen(true);
  };

  const handleSubmit = async (
    input: SaveProfileInput,
  ): Promise<true | string> => {
    setIsSaving(true);
    setError(null);

    try {
      const isEditing = editingProfile !== null;
      const response = await fetch("/api/inference-profiles", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEditing ? { profileId: editingProfile.id } : {}),
          name: input.name,
          provider: input.provider,
          baseUrl: input.baseUrl || null,
          modelIds: input.modelIds,
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
          enabled: input.enabled,
        }),
      });
      const responseData = (await response.json()) as
        | { profile: SafeInferenceProfile }
        | { error?: string };

      if (!response.ok || !("profile" in responseData)) {
        return "error" in responseData
          ? (responseData.error ?? "Failed to save inference profile")
          : "Failed to save inference profile";
      }

      await mutate(
        {
          profiles: isEditing
            ? profiles.map((profile) =>
                profile.id === responseData.profile.id
                  ? responseData.profile
                  : profile,
              )
            : [responseData.profile, ...profiles],
        },
        { revalidate: false },
      );
      return true;
    } catch (submitError) {
      console.error("Failed to save inference profile:", submitError);
      return "Failed to save inference profile";
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    if (!window.confirm("Delete this inference profile?")) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/inference-profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!response.ok) {
        const responseData = (await response.json()) as { error?: string };
        setError(responseData.error ?? "Failed to delete inference profile");
        return;
      }
      await mutate(
        { profiles: profiles.filter((profile) => profile.id !== profileId) },
        { revalidate: false },
      );
    } catch (deleteError) {
      console.error("Failed to delete inference profile:", deleteError);
      setError("Failed to delete inference profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (profileId: string) => {
    setTestingProfileId(profileId);
    setError(null);
    try {
      const response = await fetch(
        `/api/inference-profiles/${profileId}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const responseData = (await response.json()) as
        | {
            profile: SafeInferenceProfile | null;
            result: InferenceProfileTestResult;
          }
        | { error?: string };

      if (!response.ok || !("result" in responseData)) {
        setError(
          "error" in responseData
            ? (responseData.error ?? "Failed to test inference profile")
            : "Failed to test inference profile",
        );
        return;
      }

      if (responseData.profile) {
        await mutate(
          {
            profiles: profiles.map((profile) =>
              profile.id === responseData.profile?.id
                ? responseData.profile
                : profile,
            ),
          },
          { revalidate: false },
        );
      }
    } catch (testError) {
      console.error("Failed to test inference profile:", testError);
      setError("Failed to test inference profile");
    } finally {
      setTestingProfileId(null);
    }
  };

  if (isLoading) {
    return <InferenceProfilesSectionSkeleton />;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Inference Profiles
            </h3>
            <p className="text-sm text-muted-foreground">
              Add user-paid Anthropic-compatible or OpenAI-compatible
              credentials. Saved profiles appear under their provider in the
              chat model selector.
            </p>
          </div>
          <Button
            size="sm"
            onClick={handleOpenCreate}
            disabled={isSaving || testingProfileId !== null}
            className="shrink-0"
          >
            <Plus className="size-3.5" />
            New Profile
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            No inference profiles yet.
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                isSaving={isSaving}
                isTesting={testingProfileId === profile.id}
                onEdit={() => handleOpenEdit(profile)}
                onDelete={() => handleDelete(profile.id)}
                onTest={() => handleTest(profile.id)}
              />
            ))}
          </div>
        )}
      </div>

      <ProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingProfile={editingProfile}
        isSaving={isSaving}
        onSubmit={handleSubmit}
      />
    </>
  );
}
