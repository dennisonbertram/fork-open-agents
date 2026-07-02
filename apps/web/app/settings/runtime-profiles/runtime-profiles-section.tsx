"use client";

import {
  ChevronDown,
  Copy,
  Cpu,
  Loader2,
  LogIn,
  Plus,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";
import type { ManagedRuntimeSavedProfile } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import type {
  RuntimeProfileFormFieldErrors,
  RuntimeProfileFormState,
} from "./runtime-profile-payload";
import { validateCreateForm } from "./runtime-profile-payload";
import {
  getRuntimeProfileTemplate,
  RUNTIME_PROFILE_TEMPLATES,
} from "./runtime-profile-templates";
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

/**
 * Builds an editable create-form state from a built-in profile, for the
 * "Clone" action on BuiltInProfileRow. The result is an ordinary user_default
 * scoped form — cloning does not create any special profile kind.
 */
function builtInProfileToFormState(
  profile: ManagedRuntimeProfile,
): RuntimeProfileFormState {
  return {
    displayName: `${profile.displayName} (copy)`,
    description: profile.description,
    expectedTools: profile.expectedTools.join(", "),
    optionalTools: profile.optionalTools.join(", "),
    defaultPorts: profile.defaultPorts.join(", "),
    setupCommands: profile.setupCommands,
    verificationCommands: profile.verificationCommands,
  };
}

/** Extracts a user-facing message from an API error response body, honoring
 * the structured errorKind/failureMessage shape when present (from MR-1/MR-6)
 * and falling back to a generic message otherwise. Never returns empty. */
function extractApiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.failureMessage === "string" && record.failureMessage) {
      return record.failureMessage;
    }
    if (typeof record.error === "string" && record.error) {
      return record.error;
    }
    if (typeof record.errorKind === "string" && record.errorKind) {
      return `${fallback} (${record.errorKind})`;
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Profile editor form fields (extracted so field help text is directly
// testable without needing the save/cancel/delete action wiring)
// ---------------------------------------------------------------------------

export function ProfileFormFields({
  formState,
  onChange,
  fieldErrors,
}: {
  formState: RuntimeProfileFormState;
  onChange: (next: RuntimeProfileFormState) => void;
  fieldErrors?: RuntimeProfileFormFieldErrors;
}) {
  const errors = fieldErrors ?? {};

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field error={errors.displayName} label="Name">
          {(helpId) => (
            <Input
              aria-describedby={helpId}
              aria-invalid={Boolean(errors.displayName)}
              onChange={(e) =>
                onChange({ ...formState, displayName: e.currentTarget.value })
              }
              placeholder="My runtime profile"
              value={formState.displayName}
            />
          )}
        </Field>
        <Field
          error={errors.defaultPorts}
          help="Ports the sandbox exposes for preview URLs when this profile runs."
          label="Default ports"
        >
          {(helpId) => (
            <Input
              aria-describedby={helpId}
              aria-invalid={Boolean(errors.defaultPorts)}
              onChange={(e) =>
                onChange({ ...formState, defaultPorts: e.currentTarget.value })
              }
              placeholder="3000, 5173"
              value={formState.defaultPorts}
            />
          )}
        </Field>
      </div>

      <Field error={errors.description} label="Description">
        {(helpId) => (
          <Textarea
            aria-describedby={helpId}
            aria-invalid={Boolean(errors.description)}
            className="min-h-20"
            onChange={(e) =>
              onChange({ ...formState, description: e.currentTarget.value })
            }
            placeholder="What this profile sets up and when to use it"
            value={formState.description}
          />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          help="Shown as environment info and used for verification labeling — NOT installed automatically. Install these with a setup command below."
          label="Expected tools"
        >
          {(helpId) => (
            <Input
              aria-describedby={helpId}
              onChange={(e) =>
                onChange({
                  ...formState,
                  expectedTools: e.currentTarget.value,
                })
              }
              placeholder="bun, node"
              value={formState.expectedTools}
            />
          )}
        </Field>
        <Field
          help="Shown as environment info and used for verification labeling — NOT installed automatically. Install these with a setup command below."
          label="Optional tools"
        >
          {(helpId) => (
            <Input
              aria-describedby={helpId}
              onChange={(e) =>
                onChange({
                  ...formState,
                  optionalTools: e.currentTarget.value,
                })
              }
              placeholder="docker"
              value={formState.optionalTools}
            />
          )}
        </Field>
      </div>

      <Field error={errors.setupCommands} label="Setup commands">
        {() => (
          <CommandEditor
            commands={formState.setupCommands}
            onChange={(cmds) => onChange({ ...formState, setupCommands: cmds })}
            title="setup"
          />
        )}
      </Field>

      <Field error={errors.verificationCommands} label="Verification commands">
        {() => (
          <CommandEditor
            commands={formState.verificationCommands}
            onChange={(cmds) =>
              onChange({ ...formState, verificationCommands: cmds })
            }
            title="verification"
          />
        )}
      </Field>
    </>
  );
}

// ---------------------------------------------------------------------------
// Starter template chooser
// ---------------------------------------------------------------------------

export function ProfileTemplatePicker({
  onSelect,
}: {
  onSelect: (templateId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">Start from a template</Label>
      <div className="grid gap-2 sm:grid-cols-3">
        {RUNTIME_PROFILE_TEMPLATES.map((template) => (
          <button
            className="rounded-md border bg-muted/10 p-3 text-left hover:bg-muted/30"
            key={template.id}
            onClick={() => onSelect(template.id)}
            type="button"
          >
            <p className="text-sm font-medium">{template.displayName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {template.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
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
  showTemplatePicker,
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
  showTemplatePicker?: boolean;
}) {
  const validation = validateCreateForm(formState);
  const fieldErrors = validation.ok ? {} : validation.fieldErrors;
  const missingCount = Object.keys(fieldErrors).length;

  function handleSelectTemplate(templateId: string) {
    const template = getRuntimeProfileTemplate(templateId);
    if (template) {
      onChange(template.form);
    }
  }

  return (
    <div className="space-y-4 pt-4">
      {showTemplatePicker ? (
        <ProfileTemplatePicker onSelect={handleSelectTemplate} />
      ) : null}

      <ProfileFormFields
        fieldErrors={fieldErrors}
        formState={formState}
        onChange={onChange}
      />

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
        <div className="flex flex-col items-end gap-1">
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
              disabled={isBusy || !validation.ok}
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
          {!validation.ok && missingCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Fix{" "}
              {missingCount === 1
                ? "the field above"
                : `${missingCount} fields above`}{" "}
              to enable {saveLabel}.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Built-in profile row (read-only)
// ---------------------------------------------------------------------------

function BuiltInProfileRow({
  profile,
  onClone,
}: {
  profile: ManagedRuntimeProfile;
  onClone: (formState: RuntimeProfileFormState) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setExpanded((v) => !v)}
          type="button"
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
        <Button
          aria-label={`Clone ${profile.displayName}`}
          onClick={() => onClone(builtInProfileToFormState(profile))}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Copy className="size-4" />
          Clone
        </Button>
      </div>

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
// Delete confirmation dialog
// ---------------------------------------------------------------------------

/**
 * Presenter for the delete-confirmation dialog body. Extracted from
 * DeleteProfileDialog so it is directly testable — Radix DialogPortal does
 * not emit children via renderToStaticMarkup (same portal-gated pattern as
 * DropdownMenuContent used elsewhere in this app).
 */
export function DeleteProfileDialogContent({
  profileName,
  isDefault,
  onConfirm,
  onCancel,
}: {
  profileName: string;
  isDefault: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete this profile?</DialogTitle>
        <DialogDescription>
          This permanently deletes{" "}
          <strong className="font-medium text-foreground">{profileName}</strong>
          . This cannot be undone.
          {isDefault ? (
            <>
              {" "}
              This is your current Preferences default — deleting it will leave
              your default profile unset until you choose another one.
            </>
          ) : null}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button onClick={onConfirm} type="button" variant="destructive">
          Delete profile
        </Button>
      </DialogFooter>
    </>
  );
}

export function DeleteProfileDialog({
  open,
  profileName,
  isDefault,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  profileName: string;
  isDefault: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog onOpenChange={(isOpen) => !isOpen && onCancel()} open={open}>
      <DialogContent>
        <DeleteProfileDialogContent
          isDefault={isDefault}
          onCancel={onCancel}
          onConfirm={onConfirm}
          profileName={profileName}
        />
      </DialogContent>
    </Dialog>
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isBusy = isSaving || isDeleting;

  async function handleSave() {
    const validation = validateCreateForm(formState);
    if (!validation.ok) {
      const msg =
        Object.values(validation.fieldErrors)[0] ??
        "Fix the highlighted fields above before saving";
      setError(msg);
      toast.error("This profile is missing required fields");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/settings/runtime-profiles/${profile.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validation.payload),
        },
      );
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok || !("profile" in body)) {
        throw new Error(extractApiErrorMessage(body, "Failed to save profile"));
      }
      const detail = body as unknown as UserDefaultProfileDetailResponse;
      toast.success("Profile saved");
      onSaved({ ...profile, ...detail.profile } as SavedProfileRow);
      setExpanded(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save profile";
      setError(msg);
      toast.error(msg);
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
      const body = (await response.json()) as Record<string, unknown> & {
        deletedProfileId?: string;
      };
      if (!response.ok || !body.deletedProfileId) {
        throw new Error(
          extractApiErrorMessage(body, "Failed to delete profile"),
        );
      }
      toast.success("Profile deleted");
      onDeleted(profile.id);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete profile";
      setError(msg);
      toast.error(msg);
      setIsDeleting(false);
    } finally {
      setShowDeleteConfirm(false);
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

      <DeleteProfileDialog
        isDefault={false}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => void handleDelete()}
        open={showDeleteConfirm}
        profileName={profile.displayName}
      />

      {expanded ? (
        <div className="border-t border-border px-4 pb-4">
          <ProfileForm
            error={error}
            formState={formState}
            isBusy={isBusy}
            onCancel={handleCancel}
            onChange={setFormState}
            onDelete={() => setShowDeleteConfirm(true)}
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
  initialFormState,
  onCreated,
  onCancel,
}: {
  initialFormState?: RuntimeProfileFormState;
  onCreated: (profile: SavedProfileRow) => void;
  onCancel: () => void;
}) {
  const [formState, setFormState] = useState<RuntimeProfileFormState>(
    () => initialFormState ?? emptyFormState(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const validation = validateCreateForm(formState);
    if (!validation.ok) {
      // Guard against a swallowed-throw regression: validation must always
      // surface a visible error, never fail silently.
      setError(
        Object.values(validation.fieldErrors)[0] ??
          "Fix the highlighted fields above before creating this profile",
      );
      toast.error("This profile is missing required fields");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.payload),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok || !("profile" in body)) {
        throw new Error(
          extractApiErrorMessage(body, "Failed to create profile"),
        );
      }
      const created = body as unknown as RuntimeProfileCreateResponse;
      toast.success("Profile created");
      // The API returns a RuntimeProfileOption; build a minimal SavedProfileRow shape
      onCreated({
        id: created.profile.id,
        userId: "",
        sessionId: null,
        sourceDraftId: null,
        scope: "user_default",
        version: created.profile.version,
        displayName: created.profile.displayName,
        description: created.profile.description,
        setupCommands: formState.setupCommands,
        verificationCommands: formState.verificationCommands,
        expectedTools: created.profile.expectedTools,
        optionalTools: created.profile.optionalTools,
        defaultPorts: created.profile.defaultPorts,
        latestTestRunId: null,
        testResults: [],
        testFailureMessage: null,
        testedAt: null,
        lastTestScope: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as SavedProfileRow);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create profile";
      setError(msg);
      toast.error(msg);
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
        showTemplatePicker
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

// ---------------------------------------------------------------------------
// Unauthenticated state
// ---------------------------------------------------------------------------

export function RuntimeProfilesSignInPrompt() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LogIn />
        </EmptyMedia>
        <EmptyTitle>Sign in to manage runtime profiles</EmptyTitle>
        <EmptyDescription>
          Runtime profiles are saved per account. Sign in to view your saved
          profiles and the platform&apos;s built-in profiles.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

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
  const [cloneFormState, setCloneFormState] =
    useState<RuntimeProfileFormState | null>(null);

  function handleCreated(profile: SavedProfileRow) {
    setUserProfiles((prev) => [profile, ...prev]);
    setShowNewForm(false);
    setCloneFormState(null);
  }

  function handleClone(formState: RuntimeProfileFormState) {
    setCloneFormState(formState);
    setShowNewForm(true);
  }

  function handleCancelNewForm() {
    setShowNewForm(false);
    setCloneFormState(null);
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
              initialFormState={cloneFormState ?? undefined}
              onCancel={handleCancelNewForm}
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
            <BuiltInProfileRow
              key={profile.id}
              onClone={handleClone}
              profile={profile}
            />
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
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: (describedBy: string | undefined) => React.ReactNode;
}) {
  const helpId = useId();
  const errorId = useId();
  const describedBy =
    [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div aria-invalid={Boolean(error)} className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children(describedBy)}
      {error ? (
        <p className="text-xs text-destructive" id={errorId}>
          {error}
        </p>
      ) : null}
      {help ? (
        <p className="text-xs text-muted-foreground" id={helpId}>
          {help}
        </p>
      ) : null}
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
                {() => (
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
                )}
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium">Required</p>
                  <p className="text-xs text-muted-foreground">
                    A failing required command blocks the profile — in tests and
                    in live sessions.
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
