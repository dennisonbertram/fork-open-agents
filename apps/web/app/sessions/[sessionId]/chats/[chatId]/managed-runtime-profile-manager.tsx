"use client";

import { Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ManagedRuntimeProfileCommand } from "@open-agents/sandbox/managed-runtime-profiles";
import type { ManagedRuntimeProfileDetailResponse } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/[profileId]/route";
import type { ManagedRuntimeProfileOption } from "@/app/api/sessions/[sessionId]/managed-runtime/profiles/route";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type ManagedRuntimeProfileManagerProps = {
  sessionId: string;
  profile: ManagedRuntimeProfileOption | undefined;
  disabled?: boolean;
  onProfileDeleted: (fallbackProfileId: string) => Promise<void>;
  onProfileSaved: () => void;
};

type EditableProfile = ManagedRuntimeProfileDetailResponse["profile"];
type SourceDraftEvidence = ManagedRuntimeProfileDetailResponse["sourceDraft"];
type SavedProfileTestEvidence =
  ManagedRuntimeProfileDetailResponse["testEvidence"];
type EditableProfilePayload = Omit<EditableProfile, "id" | "version">;

type ProfileFormState = {
  displayName: string;
  description: string;
  expectedTools: string;
  optionalTools: string;
  defaultPorts: string;
  setupCommands: ManagedRuntimeProfileCommand[];
  verificationCommands: ManagedRuntimeProfileCommand[];
};

export function ManagedRuntimeProfileManager({
  sessionId,
  profile,
  disabled = false,
  onProfileDeleted,
  onProfileSaved,
}: ManagedRuntimeProfileManagerProps) {
  const [open, setOpen] = useState(false);
  const [loadedProfile, setLoadedProfile] = useState<EditableProfile | null>(
    null,
  );
  const [sourceDraft, setSourceDraft] = useState<SourceDraftEvidence>();
  const [testEvidence, setTestEvidence] = useState<SavedProfileTestEvidence>();
  const [formState, setFormState] = useState<ProfileFormState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testMode, setTestMode] = useState<
    "verify" | "setup_and_verify" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = profile?.source === "session";

  useEffect(() => {
    if (!open || !profile || !canManage) {
      return;
    }

    const abortController = new AbortController();

    async function loadProfile(profileId: string) {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/managed-runtime/profiles/${profileId}`,
          { signal: abortController.signal },
        );
        const body = (await response.json()) as
          | ManagedRuntimeProfileDetailResponse
          | { error?: string };
        if (!response.ok || !("profile" in body)) {
          throw new Error(getErrorMessage(body, "Failed to load profile"));
        }
        setLoadedProfile(body.profile);
        setSourceDraft(body.sourceDraft);
        setTestEvidence(body.testEvidence);
        setFormState(profileToFormState(body.profile));
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        setError(
          error instanceof Error ? error.message : "Failed to load profile",
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadProfile(profile.id);

    return () => abortController.abort();
  }, [canManage, open, profile, sessionId]);

  const isBusy = isLoading || isSaving || isDeleting || Boolean(testMode);
  const triggerLabel = useMemo(
    () => (canManage ? "Manage profile" : "Built-in profile"),
    [canManage],
  );
  const evidenceNotice = getProfileManagerEvidenceNotice({
    profile,
    sourceDraft,
    testEvidence,
  });

  async function saveProfile() {
    if (!profile || !formState) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const payload = formStateToPayload(formState);
      const response = await fetch(
        `/api/sessions/${sessionId}/managed-runtime/profiles/${profile.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as
        | ManagedRuntimeProfileDetailResponse
        | { error?: string };
      if (!response.ok || !("profile" in body)) {
        throw new Error(getErrorMessage(body, "Failed to save profile"));
      }
      setLoadedProfile(body.profile);
      setSourceDraft(body.sourceDraft);
      setTestEvidence(body.testEvidence);
      setFormState(profileToFormState(body.profile));
      onProfileSaved();
      setOpen(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to save profile",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteProfile() {
    if (!profile) {
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/managed-runtime/profiles/${profile.id}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as {
        deletedProfileId?: string;
        fallbackProfileId?: string;
        error?: string;
      };
      if (!response.ok || !body.fallbackProfileId) {
        throw new Error(body.error ?? "Failed to delete profile");
      }
      await onProfileDeleted(body.fallbackProfileId);
      setOpen(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to delete profile",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function testProfile(mode: "verify" | "setup_and_verify") {
    if (!profile) {
      return;
    }

    setTestMode(mode);
    setError(null);
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/managed-runtime/profiles/${profile.id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      const body = (await response.json()) as
        | {
            profile: EditableProfile;
            testEvidence?: SavedProfileTestEvidence;
            error?: string;
          }
        | { error?: string };
      if (!response.ok || !("profile" in body)) {
        throw new Error(getErrorMessage(body, "Failed to test profile"));
      }
      setLoadedProfile(body.profile);
      setTestEvidence(body.testEvidence);
      setSourceDraft(undefined);
      setFormState(profileToFormState(body.profile));
      onProfileSaved();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to test profile",
      );
    } finally {
      setTestMode(null);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button
          className="h-8 w-full justify-start"
          disabled={disabled || !canManage}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Settings2 className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Managed runtime profile</DialogTitle>
          <DialogDescription>
            Adjust the session profile the agent generated for this workspace.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading profile...</p>
        ) : null}

        {formState ? (
          <div className="grid gap-4">
            {testEvidence ? (
              <SavedProfileTestEvidence evidence={testEvidence} />
            ) : sourceDraft ? (
              <SourceDraftEvidence draft={sourceDraft} />
            ) : null}
            {evidenceNotice ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {evidenceNotice}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 rounded-md border bg-muted/20 p-3">
              <Button
                disabled={isBusy || Boolean(testMode) || !loadedProfile}
                onClick={() => void testProfile("verify")}
                size="sm"
                type="button"
                variant="secondary"
              >
                {testMode === "verify" ? "Testing..." : "Test profile"}
              </Button>
              <Button
                disabled={isBusy || Boolean(testMode) || !loadedProfile}
                onClick={() => void testProfile("setup_and_verify")}
                size="sm"
                type="button"
                variant="secondary"
              >
                {testMode === "setup_and_verify"
                  ? "Running setup..."
                  : "Run setup + test"}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      displayName: event.currentTarget.value,
                    })
                  }
                  value={formState.displayName}
                />
              </Field>
              <Field label="Ports">
                <Input
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      defaultPorts: event.currentTarget.value,
                    })
                  }
                  placeholder="3000, 5173"
                  value={formState.defaultPorts}
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                className="min-h-20"
                onChange={(event) =>
                  setFormState({
                    ...formState,
                    description: event.currentTarget.value,
                  })
                }
                value={formState.description}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Expected tools">
                <Input
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      expectedTools: event.currentTarget.value,
                    })
                  }
                  placeholder="bun, agent-browser"
                  value={formState.expectedTools}
                />
              </Field>
              <Field label="Optional tools">
                <Input
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      optionalTools: event.currentTarget.value,
                    })
                  }
                  placeholder="node, npm"
                  value={formState.optionalTools}
                />
              </Field>
            </div>
            <Field label="Setup commands">
              <CommandEditor
                commands={formState.setupCommands}
                onChange={(setupCommands) =>
                  setFormState({ ...formState, setupCommands })
                }
                title="Setup commands"
              />
            </Field>
            <Field label="Verification commands">
              <CommandEditor
                commands={formState.verificationCommands}
                onChange={(verificationCommands) =>
                  setFormState({ ...formState, verificationCommands })
                }
                title="Verification commands"
              />
            </Field>
          </div>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            disabled={isBusy || !loadedProfile}
            onClick={() => void deleteProfile()}
            type="button"
            variant="destructive"
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button
              disabled={isBusy}
              onClick={() => setOpen(false)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={isBusy || !formState}
              onClick={() => void saveProfile()}
              type="button"
            >
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
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
  commands: ManagedRuntimeProfileCommand[];
  onChange: (commands: ManagedRuntimeProfileCommand[]) => void;
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
                onChange={(event) =>
                  onChange(
                    updateCommand(commands, index, {
                      label: event.currentTarget.value,
                    }),
                  )
                }
                placeholder="Label"
                value={command.label}
              />
              <Input
                aria-label={`${title} command id`}
                onChange={(event) =>
                  onChange(
                    updateCommand(commands, index, {
                      id: normalizeCommandId(event.currentTarget.value),
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
              onChange={(event) =>
                onChange(
                  updateCommand(commands, index, {
                    description: event.currentTarget.value,
                  }),
                )
              }
              placeholder="What this command prepares or verifies"
              value={command.description}
            />
            <Textarea
              aria-label={`${title} shell command`}
              className="min-h-20 font-mono text-xs"
              onChange={(event) =>
                onChange(
                  updateCommand(commands, index, {
                    command: event.currentTarget.value,
                  }),
                )
              }
              placeholder="bun install --frozen-lockfile"
              spellCheck={false}
              value={command.command}
            />
            <div className="grid gap-3 sm:grid-cols-[minmax(10rem,14rem)_1fr]">
              <Field label="Timeout (ms)">
                <Input
                  inputMode="numeric"
                  onChange={(event) =>
                    onChange(
                      updateCommand(commands, index, {
                        timeoutMs: parseOptionalPositiveInteger(
                          event.currentTarget.value,
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
                  <p className="font-medium text-xs">Required</p>
                  <p className="text-muted-foreground text-xs">
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

function SourceDraftEvidence({ draft }: { draft: SourceDraftEvidence }) {
  if (!draft) {
    return null;
  }

  const failedResults = draft.testResults.filter(
    (result) => result.status !== "passed",
  );
  const visibleResults =
    failedResults.length > 0 ? failedResults : draft.testResults.slice(0, 3);

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-xs">Original draft test</p>
        <span className="text-muted-foreground text-xs">
          {formatDraftStatus(draft.status)}
          {draft.testedAt ? ` at ${formatTestTime(draft.testedAt)}` : ""}
        </span>
      </div>
      {draft.testFailureMessage ? (
        <p className="text-destructive text-xs">{draft.testFailureMessage}</p>
      ) : draft.testedAt ? (
        <p className="text-muted-foreground text-xs">
          This profile was saved from a tested draft.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          This profile was saved before a passing draft test was recorded.
        </p>
      )}
      {visibleResults.length > 0 ? (
        <div className="space-y-1">
          {visibleResults.map((result) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs"
              key={result.commandId}
            >
              <span>{result.label}</span>
              <span
                className={
                  result.status === "passed"
                    ? "text-emerald-600"
                    : "text-destructive"
                }
              >
                {result.status}
                {typeof result.exitCode === "number"
                  ? ` (${result.exitCode})`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SavedProfileTestEvidence({
  evidence,
}: {
  evidence: SavedProfileTestEvidence;
}) {
  if (!evidence) {
    return null;
  }

  const failedResults = evidence.testResults.filter(
    (result) => result.status !== "passed",
  );
  const visibleResults =
    failedResults.length > 0 ? failedResults : evidence.testResults.slice(0, 3);

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-xs">Current profile test</p>
        <span
          className={
            evidence.status === "passed"
              ? "text-emerald-600 text-xs"
              : "text-destructive text-xs"
          }
        >
          {evidence.status === "passed" ? "Passed" : "Failed"}
          {evidence.testedAt ? ` at ${formatTestTime(evidence.testedAt)}` : ""}
        </span>
      </div>
      {evidence.testFailureMessage ? (
        <p className="text-destructive text-xs">
          {evidence.testFailureMessage}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          This evidence was recorded from the current saved profile commands.
        </p>
      )}
      {visibleResults.length > 0 ? (
        <div className="space-y-1">
          {visibleResults.map((result) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs"
              key={result.commandId}
            >
              <span>{result.label}</span>
              <span
                className={
                  result.status === "passed"
                    ? "text-emerald-600"
                    : "text-destructive"
                }
              >
                {result.status}
                {typeof result.exitCode === "number"
                  ? ` (${result.exitCode})`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function getProfileManagerEvidenceNotice({
  profile,
  sourceDraft,
  testEvidence,
}: {
  profile: ManagedRuntimeProfileOption | undefined;
  sourceDraft: SourceDraftEvidence | undefined;
  testEvidence?: SavedProfileTestEvidence;
}): string | null {
  if (!profile || profile.source !== "session") {
    return null;
  }

  if (sourceDraft || testEvidence) {
    return null;
  }

  if (profile.testStatus === "failed") {
    return "This profile does not have passing test evidence. Ask the agent to revise the profile before relying on it for workspace setup.";
  }

  if (profile.testStatus === "untested" || !profile.testStatus) {
    return "This profile is untested. If you edited it after approval, the original draft evidence no longer proves the current commands.";
  }

  return null;
}

function profileToFormState(profile: EditableProfile): ProfileFormState {
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

function formStateToPayload(
  formState: ProfileFormState,
): EditableProfilePayload {
  return {
    displayName: formState.displayName.trim(),
    description: formState.description.trim(),
    setupCommands: normalizeCommands(formState.setupCommands, "setup"),
    verificationCommands: normalizeCommands(
      formState.verificationCommands,
      "verification",
    ),
    expectedTools: parseCsv(formState.expectedTools),
    optionalTools: parseCsv(formState.optionalTools),
    defaultPorts: parsePorts(formState.defaultPorts),
  };
}

export function normalizeCommands(
  commands: ManagedRuntimeProfileCommand[],
  label: string,
): ManagedRuntimeProfileCommand[] {
  if (commands.length === 0) {
    throw new Error(`${label} commands must include at least one command`);
  }

  return commands.map((command, index) => {
    const normalized = {
      id: normalizeCommandId(command.id) || `${label}-${index + 1}`,
      label: command.label.trim(),
      description: command.description.trim(),
      command: command.command.trim(),
      timeoutMs: command.timeoutMs,
      required: command.required,
    };

    if (!normalized.label || !normalized.description || !normalized.command) {
      throw new Error(`${label} command ${index + 1} is missing required text`);
    }

    return normalized;
  });
}

export function updateCommand(
  commands: ManagedRuntimeProfileCommand[],
  index: number,
  patch: Partial<ManagedRuntimeProfileCommand>,
): ManagedRuntimeProfileCommand[] {
  return commands.map((command, commandIndex) =>
    commandIndex === index ? { ...command, ...patch } : command,
  );
}

export function addCommand(
  commands: ManagedRuntimeProfileCommand[],
  title: string,
): ManagedRuntimeProfileCommand[] {
  const commandNumber = commands.length + 1;
  const idPrefix = normalizeCommandId(title) || "command";

  return [
    ...commands,
    {
      id: `${idPrefix}-${commandNumber}`,
      label: `Command ${commandNumber}`,
      description: "",
      command: "",
      required: true,
    },
  ];
}

export function removeCommand(
  commands: ManagedRuntimeProfileCommand[],
  index: number,
): ManagedRuntimeProfileCommand[] {
  if (commands.length <= 1) {
    return commands;
  }

  return commands.filter((_, commandIndex) => commandIndex !== index);
}

export function normalizeCommandId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseOptionalPositiveInteger(
  value: string,
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getErrorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
  }
  return fallback;
}

function parsePorts(value: string): number[] {
  return parseCsv(value).map((item) => {
    const port = Number.parseInt(item, 10);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid port: ${item}`);
    }
    return port;
  });
}

function formatDraftStatus(status: string): string {
  return status
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatTestTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
