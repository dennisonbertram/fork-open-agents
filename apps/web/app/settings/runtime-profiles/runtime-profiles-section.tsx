"use client";

import { ChevronDown, Cpu, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";
import type { ManagedRuntimeSavedProfile } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/components/ui/settings-section";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  addCommand,
  normalizeCommandId,
  parseOptionalPositiveInteger,
  removeCommand,
  updateCommand,
} from "@/app/sessions/[sessionId]/chats/[chatId]/managed-runtime-profile-manager";
import type { RuntimeProfileFormState } from "./runtime-profile-payload";
import {
  formToCreatePayload,
  isValidCreatePayload,
} from "./runtime-profile-payload";
import type { RuntimeProfileCreateResponse } from "@/app/api/settings/runtime-profiles/route";
import type { UserDefaultProfileDetailResponse } from "@/app/api/settings/runtime-profiles/[profileId]/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SavedProfileRow = ManagedRuntimeSavedProfile;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyFormState(): RuntimeProfileFormState {
  return {
    displayName: "",
    description: "",
    expectedTools: "",
    optionalTools: "",
    defaultPorts: "",
    setupCommands: [
      {
        id: "setup-1",
        label: "Setup",
        description: "Prepare the environment",
        command: "",
        required: true,
      },
    ],
    verificationCommands: [
      {
        id: "verify-1",
        label: "Verify",
        description: "Confirm the environment is ready",
        command: "",
        required: true,
      },
    ],
  };
}

function profileToFormState(profile: SavedProfileRow): RuntimeProfileFormState {
  return {
    displayName: profile.displayName,
    description: profile.description,
    expectedTools: profile.expectedTools.join(", "),
    optionalTools: profile.optionalTools.join(", "),
    defaultPorts: profile.defaultPorts.join(", "),
    setupCommands: profile.setupCommands,
    verificationCommands: profile.verificationCommands,
  };
}

// ---------------------------------------------------------------------------
// Profile editor form (shared between create + edit modes)
// ---------------------------------------------------------------------------

function ProfileForm({
  formState,
  onChange,
  isBusy,
  error,
  onSave,
  onCancel,
  onDelete,
  saveLabel,
  showDelete,
}: {
  formState: RuntimeProfileFormState;
  onChange: (next: RuntimeProfileFormState) => void;
  isBusy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  saveLabel: string;
  showDelete: boolean;
}) {
  let payload = null;
  let payloadValid = false;
  try {
    payload = formToCreatePayload(formState);
    payloadValid = isValidCreatePayload(payload);
  } catch {
    payloadValid = false;
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            onChange={(e) =>
              onChange({ ...formState, displayName: e.currentTarget.value })
            }
            placeholder="My runtime profile"
            value={formState.displayName}
          />
        </Field>
        <Field label="Default ports">
          <Input
            onChange={(e) =>
              onChange({ ...formState, defaultPorts: e.currentTarget.value })
            }
            placeholder="3000, 5173"
            value={formState.defaultPorts}
          />
        </Field>
      </div>

      <Field label="Description">
        <Textarea
          className="min-h-20"
          onChange={(e) =>
            onChange({ ...formState, description: e.currentTarget.value })
          }
          placeholder="What this profile sets up and when to use it"
          value={formState.description}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expected tools">
          <Input
            onChange={(e) =>
              onChange({ ...formState, expectedTools: e.currentTarget.value })
            }
            placeholder="bun, node"
            value={formState.expectedTools}
          />
        </Field>
        <Field label="Optional tools">
          <Input
            onChange={(e) =>
              onChange({ ...formState, optionalTools: e.currentTarget.value })
            }
            placeholder="docker"
            value={formState.optionalTools}
          />
        </Field>
      </div>

      <Field label="Setup commands">
        <CommandEditor
          commands={formState.setupCommands}
          onChange={(cmds) => onChange({ ...formState, setupCommands: cmds })}
          title="setup"
        />
      </Field>

      <Field label="Verification commands">
        <CommandEditor
          commands={formState.verificationCommands}
          onChange={(cmds) =>
            onChange({ ...formState, verificationCommands: cmds })
          }
          title="verification"
        />
      </Field>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {showDelete && onDelete ? (
          <Button
            disabled={isBusy}
            onClick={onDelete}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <Button
            disabled={isBusy}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            disabled={isBusy || !payloadValid}
            onClick={onSave}
            size="sm"
            type="button"
          >
            {isBusy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              saveLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Built-in profile row (read-only)
// ---------------------------------------------------------------------------

function BuiltInProfileRow({ profile }: { profile: ManagedRuntimeProfile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {profile.displayName}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Built-in
            </span>
          </div>
          {!expanded ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {profile.expectedTools.length > 0
                ? `Tools: ${profile.expectedTools.join(", ")}`
                : profile.description}
            </p>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="border-t border-border bg-muted/10 px-4 py-3">
          <p className="text-sm text-muted-foreground">{profile.description}</p>
          {profile.setupCommands.length > 0 ? (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Setup commands ({profile.setupCommands.length})
              </p>
              {profile.setupCommands.map((cmd) => (
                <p
                  key={cmd.id}
                  className="font-mono text-xs text-muted-foreground"
                >
                  {cmd.command}
                </p>
              ))}
            </div>
          ) : null}
          {profile.verificationCommands.length > 0 ? (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Verification commands ({profile.verificationCommands.length})
              </p>
              {profile.verificationCommands.map((cmd) => (
                <p
                  key={cmd.id}
                  className="font-mono text-xs text-muted-foreground"
                >
                  {cmd.command}
                </p>
              ))}
            </div>
          ) : null}
          {profile.expectedTools.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium">Expected tools:</span>{" "}
              {profile.expectedTools.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User profile row (editable)
// ---------------------------------------------------------------------------

function UserProfileRow({
  profile,
  onSaved,
  onDeleted,
}: {
  profile: SavedProfileRow;
  onSaved: (updated: SavedProfileRow) => void;
  onDeleted: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [formState, setFormState] = useState<RuntimeProfileFormState>(() =>
    profileToFormState(profile),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBusy = isSaving || isDeleting;

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const payload = formToCreatePayload(formState);
      const response = await fetch(
        `/api/settings/runtime-profiles/${profile.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as
        | UserDefaultProfileDetailResponse
        | { error?: string };
      if (!response.ok || !("profile" in body)) {
        const msg =
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Failed to save profile";
        throw new Error(msg);
      }
      toast.success("Profile saved");
      onSaved({ ...profile, ...body.profile } as SavedProfileRow);
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/settings/runtime-profiles/${profile.id}`,
        {
          method: "DELETE",
        },
      );
      const body = (await response.json()) as {
        deletedProfileId?: string;
        error?: string;
      };
      if (!response.ok || !body.deletedProfileId) {
        throw new Error(body.error ?? "Failed to delete profile");
      }
      toast.success("Profile deleted");
      onDeleted(profile.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete profile");
      setIsDeleting(false);
    }
  }

  function handleCancel() {
    setFormState(profileToFormState(profile));
    setError(null);
    setExpanded(false);
  }

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium">
            {profile.displayName}
          </span>
          {!expanded ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {profile.expectedTools.length > 0
                ? `Tools: ${profile.expectedTools.join(", ")}`
                : profile.description}
            </p>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <div className="border-t border-border px-4 pb-4">
          <ProfileForm
            error={error}
            formState={formState}
            isBusy={isBusy}
            onCancel={handleCancel}
            onChange={setFormState}
            onDelete={() => void handleDelete()}
            onSave={() => void handleSave()}
            saveLabel="Save changes"
            showDelete
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New profile form (create mode)
// ---------------------------------------------------------------------------

function NewProfileForm({
  onCreated,
  onCancel,
}: {
  onCreated: (profile: SavedProfileRow) => void;
  onCancel: () => void;
}) {
  const [formState, setFormState] =
    useState<RuntimeProfileFormState>(emptyFormState);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const payload = formToCreatePayload(formState);
      const response = await fetch("/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as
        | RuntimeProfileCreateResponse
        | { error?: string };
      if (!response.ok || !("profile" in body)) {
        const msg =
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Failed to create profile";
        throw new Error(msg);
      }
      toast.success("Profile created");
      // The API returns a RuntimeProfileOption; build a minimal SavedProfileRow shape
      onCreated({
        id: body.profile.id,
        userId: "",
        sessionId: null,
        sourceDraftId: null,
        scope: "user_default",
        version: body.profile.version,
        displayName: body.profile.displayName,
        description: body.profile.description,
        setupCommands: formState.setupCommands,
        verificationCommands: formState.verificationCommands,
        expectedTools: body.profile.expectedTools,
        optionalTools: body.profile.optionalTools,
        defaultPorts: body.profile.defaultPorts,
        latestTestRunId: null,
        testResults: [],
        testFailureMessage: null,
        testedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SavedProfileRow);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="border-t border-border px-4 pb-4">
      <p className="pt-4 text-sm font-medium">New profile</p>
      <ProfileForm
        error={error}
        formState={formState}
        isBusy={isSaving}
        onCancel={onCancel}
        onChange={setFormState}
        onSave={() => void handleSave()}
        saveLabel="Create profile"
        showDelete={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
      <Cpu className="size-10 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-sm font-medium">No runtime profiles yet</p>
        <p className="max-w-sm text-pretty text-xs text-muted-foreground">
          A runtime profile is a reusable toolchain and setup a session uses
          when it provisions a sandbox &mdash; things like &ldquo;install Bun
          and verify it runs.&rdquo; Create one here, then pick it as your
          default in Preferences.
        </p>
      </div>
      <Button onClick={onNew} size="sm" type="button" variant="secondary">
        <Plus className="size-4" />
        New profile
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section component
// ---------------------------------------------------------------------------

export function RuntimeProfilesSection({
  initialUserProfiles,
  builtInProfiles,
}: {
  initialUserProfiles: SavedProfileRow[];
  builtInProfiles: ManagedRuntimeProfile[];
}) {
  const [userProfiles, setUserProfiles] =
    useState<SavedProfileRow[]>(initialUserProfiles);
  const [showNewForm, setShowNewForm] = useState(false);

  function handleCreated(profile: SavedProfileRow) {
    setUserProfiles((prev) => [profile, ...prev]);
    setShowNewForm(false);
  }

  function handleSaved(updated: SavedProfileRow) {
    setUserProfiles((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p)),
    );
  }

  function handleDeleted(id: string) {
    setUserProfiles((prev) => prev.filter((p) => p.id !== id));
  }

  const hasUserProfiles = userProfiles.length > 0;

  return (
    <div className="space-y-6">
      {/* User-created profiles */}
      <SettingsSection
        title="Your profiles"
        description="Reusable profiles you own. Select one as your default in Preferences."
        action={
          !showNewForm ? (
            <Button
              onClick={() => setShowNewForm(true)}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Plus className="size-4" />
              New profile
            </Button>
          ) : null
        }
      >
        {!hasUserProfiles && !showNewForm ? (
          <EmptyState onNew={() => setShowNewForm(true)} />
        ) : null}

        {hasUserProfiles ? (
          <div className="overflow-hidden rounded-lg border border-border">
            {userProfiles.map((profile) => (
              <UserProfileRow
                key={profile.id}
                onDeleted={handleDeleted}
                onSaved={handleSaved}
                profile={profile}
              />
            ))}
          </div>
        ) : null}

        {showNewForm ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <NewProfileForm
              onCancel={() => setShowNewForm(false)}
              onCreated={handleCreated}
            />
          </div>
        ) : null}
      </SettingsSection>

      {/* Built-in profiles (read-only reference) */}
      <SettingsSection
        title="Built-in profiles"
        description="Profiles provided by the platform. These are read-only and always available."
      >
        <div className="overflow-hidden rounded-lg border border-border">
          {builtInProfiles.map((profile) => (
            <BuiltInProfileRow key={profile.id} profile={profile} />
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function CommandEditor({
  commands,
  onChange,
  title,
}: {
  commands: Array<{
    id: string;
    label: string;
    description: string;
    command: string;
    timeoutMs?: number;
    required?: boolean;
  }>;
  onChange: (next: typeof commands) => void;
  title: string;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {commands.map((command, index) => (
          <div
            className="space-y-3 rounded-md border bg-muted/20 p-3"
            key={`${command.id}-${index}`}
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                aria-label={`${title} command label`}
                onChange={(e) =>
                  onChange(
                    updateCommand(commands, index, {
                      label: e.currentTarget.value,
                    }),
                  )
                }
                placeholder="Label"
                value={command.label}
              />
              <Input
                aria-label={`${title} command id`}
                onChange={(e) =>
                  onChange(
                    updateCommand(commands, index, {
                      id: normalizeCommandId(e.currentTarget.value),
                    }),
                  )
                }
                placeholder="command-id"
                value={command.id}
              />
              <Button
                aria-label={`Remove ${command.label || title} command`}
                disabled={commands.length <= 1}
                onClick={() => onChange(removeCommand(commands, index))}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              aria-label={`${title} command description`}
              className="min-h-16"
              onChange={(e) =>
                onChange(
                  updateCommand(commands, index, {
                    description: e.currentTarget.value,
                  }),
                )
              }
              placeholder="What this command prepares or verifies"
              value={command.description}
            />
            <Textarea
              aria-label={`${title} shell command`}
              className="min-h-20 font-mono text-xs"
              onChange={(e) =>
                onChange(
                  updateCommand(commands, index, {
                    command: e.currentTarget.value,
                  }),
                )
              }
              placeholder="bun install"
              spellCheck={false}
              value={command.command}
            />
            <div className="grid gap-3 sm:grid-cols-[minmax(10rem,14rem)_1fr]">
              <Field label="Timeout (ms)">
                <Input
                  inputMode="numeric"
                  onChange={(e) =>
                    onChange(
                      updateCommand(commands, index, {
                        timeoutMs: parseOptionalPositiveInteger(
                          e.currentTarget.value,
                        ),
                      }),
                    )
                  }
                  placeholder="120000"
                  value={command.timeoutMs?.toString() ?? ""}
                />
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium">Required</p>
                  <p className="text-xs text-muted-foreground">
                    Required command failures block a successful profile test.
                  </p>
                </div>
                <Switch
                  aria-label={`${title} command required`}
                  checked={command.required !== false}
                  onCheckedChange={(checked) =>
                    onChange(
                      updateCommand(commands, index, {
                        required: checked ? undefined : false,
                      }),
                    )
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <Button
        className="w-full justify-center"
        onClick={() => onChange(addCommand(commands, title))}
        type="button"
        variant="secondary"
      >
        <Plus className="size-4" />
        Add command
      </Button>
    </div>
  );
}
