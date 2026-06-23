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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { INFERENCE_PROFILE_PROVIDER_LABELS } from "@/lib/inference/types";
import { fetcher } from "@/lib/swr";
import { cn } from "@/lib/utils";
import { SettingsSectionHeader } from "./_components/section-header";

export interface InferenceProfilesResponse {
  profiles: SafeInferenceProfile[];
}

type SaveProfileInput = {
  name: string;
  provider: InferenceProfileProvider;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};

const PROVIDER_OPTIONS: InferenceProfileProvider[] = [
  "anthropic",
  "openai-compatible",
];

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
    if (provider === "openai-compatible" && !baseUrl.trim()) {
      setError("Base URL is required for OpenAI-compatible endpoints");
      return;
    }

    const result = await onSubmit({
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim(),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Inference Profile" : "New Inference Profile"}
          </DialogTitle>
          <DialogDescription>
            Save user-paid provider credentials for direct model calls.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="inference-profile-name">Name</Label>
            <Input
              id="inference-profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Personal Anthropic"
              disabled={isSaving}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="inference-profile-provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) =>
                setProvider(value as InferenceProfileProvider)
              }
              disabled={isSaving}
            >
              <SelectTrigger id="inference-profile-provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {INFERENCE_PROFILE_PROVIDER_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="inference-profile-base-url">Base URL</Label>
            <Input
              id="inference-profile-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.anthropic.com/v1"
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              {provider === "anthropic"
                ? "Empty uses Anthropic. URLs without a version segment are normalized to end in /v1."
                : "Required. Enter the OpenAI-compatible API root. Full /chat/completions or /models URLs are normalized back to the /v1 root."}
            </p>
          </div>

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
              {INFERENCE_PROFILE_PROVIDER_LABELS[profile.provider]} key ending{" "}
              {profile.keyLast4}
            </span>
            {profile.baseUrl && (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {profile.baseUrl}
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
        <SettingsSectionHeader
          title="Inference Profiles"
          description="Add user-paid provider credentials. Tested profiles appear as a User group in the chat model selector."
          action={
            <Button
              size="sm"
              onClick={handleOpenCreate}
              disabled={isSaving || testingProfileId !== null}
              className="shrink-0"
            >
              <Plus className="size-3.5" />
              New Profile
            </Button>
          }
        />

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
