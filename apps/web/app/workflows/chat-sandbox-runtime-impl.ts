import { discoverSkills } from "@open-agents/agent";
import {
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from "@open-agents/sandbox";
import {
  getManagedRuntimeProfile,
  type ManagedRuntimeProfile,
} from "@open-agents/sandbox/managed-runtime-profiles";
import type { UIMessageChunk } from "ai";
import { getWritable } from "workflow";
import type { WebAgentWorkspaceStatusData } from "@/app/types";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import {
  mintInstallationToken,
  revokeInstallationToken,
  type ScopedInstallationToken,
} from "@/lib/github/app";
import { getGitHubUserProfile } from "@/lib/github/users";
import { emitSessionEvent } from "@/lib/observability/events";
import { resolveManagedRuntimeProfile } from "@/lib/managed-runtime/profile-resolution";
import {
  nextActionFor,
  type ManagedRuntimeErrorKind,
} from "@/lib/managed-runtime/profile-run-status";
import {
  appendManagedRuntimeSetupResult,
  appendManagedRuntimeVerificationResult,
  buildManagedRuntimeCommandObservation,
  finishManagedRuntimeProfileRun,
  startManagedRuntimeProfileRun,
} from "@/lib/observability/managed-runtime-profile-runs";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  SANDBOX_SNAPSHOT_EXPIRATION_MS,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import {
  getResumableSandboxName,
  getSessionSandboxName,
  isRecreatableSandboxError,
  isSandboxActive,
} from "@/lib/sandbox/utils";
import { getSandboxSkillDirectories } from "@/lib/skills/directories";
import { installGlobalSkills } from "@/lib/skills/global-skill-installer";
import { installSessionUserSkills } from "@/lib/skills/session-user-skills";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
import { WorkspaceStartupReporter } from "./workspace-startup-log";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

// Deterministic setup-command guard phrases. These are OUR OWN strings —
// the default managed runtime profile's setup commands
// (packages/sandbox/managed-runtime-profiles.ts, INSTALL_BUN_COMMAND /
// INSTALL_AGENT_BROWSER_COMMAND) echo one of these immediately before
// `exit 1` when a precondition the profile itself knows is broken (missing
// Bun, an unsupported CPU architecture, a binary that isn't executable after
// install). None of those can be fixed by re-running the same command, so a
// setup-command failure that contains one of these phrases is fatal.
//
// Everything else — `curl`, `bun install -g agent-browser`,
// `agent-browser install --with-deps` exiting nonzero for a registry or
// network reason — has no guard phrase and stays an ordinary retryable
// failure. Exit code alone cannot tell the two apart (see #1114 review:
// treating every nonzero setup-command exit as fatal killed legitimate
// retries for transient network/registry failures).
//
// Kept in sync with the profile's actual guard text by BT-013 in
// chat-sandbox-runtime.test.ts, which reads
// packages/sandbox/managed-runtime-profiles.ts and fails if any phrase here
// no longer appears verbatim in that file.
export const DETERMINISTIC_SETUP_FAILURE_PHRASES = [
  "Bun is required before installing agent-browser for this profile.",
  "Unsupported agent-browser architecture:",
  "agent-browser native binary was not found after install",
] as const;

function isDeterministicSetupFailure(commandOutput: string): boolean {
  return DETERMINISTIC_SETUP_FAILURE_PHRASES.some((phrase) =>
    commandOutput.includes(phrase),
  );
}

export class WorkspaceSetupError extends Error {
  errorKind?: ManagedRuntimeErrorKind;
  nextAction?: string;

  constructor(
    message: string,
    options?: { errorKind?: ManagedRuntimeErrorKind; nextAction?: string },
  ) {
    super(message);
    this.name = "WorkspaceSetupError";
    this.errorKind = options?.errorKind;
    this.nextAction = options?.nextAction;
  }
}

type ResolvedChatSandboxRuntimeCommon = {
  runtimeMode: SessionRecord["runtimeMode"];
  skills: DiscoveredSkills;
  sessionTitle: string;
  repoOwner?: string;
  repoName?: string;
};

/** Returned when session.sandboxState is null — no VM is provisioned. */
export type SandboxFreeRuntime = ResolvedChatSandboxRuntimeCommon & {
  mode: "sandbox-free";
  sandboxState: null;
};

/** Returned when session.sandboxState is non-null — a sandbox VM is connected. */
export type SandboxBackedRuntime = ResolvedChatSandboxRuntimeCommon & {
  mode: "sandbox";
  sandboxState: SandboxState;
  managedRuntime?: {
    profileId: string;
    profileVersion: string;
    profileDisplayName: string;
    profileRunId?: string;
    sandboxName?: string;
  };
  workingDirectory: string;
  currentBranch?: string;
  environmentDetails?: string;
  didSetupWorkspace: boolean;
};

export type ResolvedChatSandboxRuntime =
  | SandboxFreeRuntime
  | SandboxBackedRuntime;

function isSandboxState(value: unknown): value is SandboxState {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "vercel"
  );
}

function buildSandboxSource(session: SessionRecord): SandboxState["source"] {
  if (!session.cloneUrl) {
    return undefined;
  }

  const branchExistsOnOrigin = session.prNumber != null;
  const shouldCreateNewBranch = session.isNewBranch && !branchExistsOnOrigin;

  if (shouldCreateNewBranch) {
    return {
      repo: session.cloneUrl,
      newBranch: session.branch ?? undefined,
      // #1251: clone at the base the caller asked to start from — see the
      // matching comment in chat-sandbox-runtime.ts's own buildSandboxSource
      // (this file duplicates that logic for its internal callers).
      ...(session.baseBranch ? { branch: session.baseBranch } : {}),
    };
  }

  return {
    repo: session.cloneUrl,
    // ponytail: same deliberate "main" fallback as chat-sandbox-runtime.ts —
    // see its comment for why this stays a literal rather than an async
    // repository-default lookup.
    branch: session.branch ?? "main",
  };
}

export function buildSandboxState(session: SessionRecord): SandboxState {
  const existingState = session.sandboxState;
  const sandboxName =
    getResumableSandboxName(existingState) ?? getSessionSandboxName(session.id);
  const source = buildSandboxSource(session);

  return {
    type: "vercel",
    ...(isSandboxState(existingState) ? existingState : {}),
    sandboxName,
    ...(source ? { source } : {}),
  };
}

export async function getGitUser(userId: string) {
  const profile = await getGitHubUserProfile(userId);
  const githubNoreplyEmail =
    profile?.externalUserId && profile.username
      ? `${profile.externalUserId}+${profile.username}@users.noreply.github.com`
      : undefined;

  return {
    name: profile?.username ?? "Open Harness",
    email: githubNoreplyEmail ?? `${userId}@users.noreply.github.com`,
  };
}

export async function installSessionGlobalSkills(params: {
  session: SessionRecord;
  sandbox: Sandbox;
  didSetupWorkspace: boolean;
}): Promise<void> {
  if (!params.didSetupWorkspace) {
    return;
  }

  const globalSkillRefs = params.session.globalSkillRefs ?? [];
  if (globalSkillRefs.length === 0) {
    return;
  }

  try {
    await installGlobalSkills({
      sandbox: params.sandbox,
      globalSkillRefs,
    });
  } catch (error) {
    console.error(
      `Failed to install global skills for session ${params.session.id}:`,
      error,
    );
  }
}

export async function loadSessionSkills(params: {
  sessionId: string;
  sandboxState: SandboxState;
  sandbox: Sandbox;
}): Promise<DiscoveredSkills> {
  const cachedSkills = await getCachedSkills(
    params.sessionId,
    params.sandboxState,
  );
  if (cachedSkills !== null) {
    return cachedSkills;
  }

  const skillDirs = await getSandboxSkillDirectories(params.sandbox);
  const discoveredSkills = await discoverSkills(params.sandbox, skillDirs);
  await setCachedSkills(
    params.sessionId,
    params.sandboxState,
    discoveredSkills,
  );
  return discoveredSkills;
}

async function sendWorkspaceStatus(data: WebAgentWorkspaceStatusData) {
  const writer = getWritable<UIMessageChunk>().getWriter();
  try {
    await writer.write({
      type: "data-workspace-status",
      id: "workspace-status",
      data,
      transient: true,
    });
  } finally {
    writer.releaseLock();
  }
}

async function sendStart(messageId: string) {
  const writer = getWritable<UIMessageChunk>().getWriter();
  try {
    await writer.write({ type: "start", messageId });
  } finally {
    writer.releaseLock();
  }
}

function compactCommandOutput(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-4)
    .join("\n");
}

function buildSetupStepMessage(params: {
  profile: ReturnType<typeof getManagedRuntimeProfile>;
  command: ReturnType<typeof getManagedRuntimeProfile>["setupCommands"][number];
  stepNumber: number;
  totalSteps: number;
}) {
  return [
    `Managed runtime profile setup (${params.stepNumber}/${params.totalSteps}): ${params.command.label}.`,
    `Profile: ${params.profile.displayName} (${params.profile.id}).`,
    params.command.description,
  ].join(" ");
}

function buildVerificationStepMessage(params: {
  profile: ReturnType<typeof getManagedRuntimeProfile>;
  command: ReturnType<
    typeof getManagedRuntimeProfile
  >["verificationCommands"][number];
  stepNumber: number;
  totalSteps: number;
}) {
  return [
    `Managed runtime profile verification (${params.stepNumber}/${params.totalSteps}): ${params.command.label}.`,
    `Profile: ${params.profile.displayName} (${params.profile.id}).`,
    params.command.description,
  ].join(" ");
}

async function ensureManagedRuntimeEnvironment(params: {
  session: SessionRecord;
  chatId?: string | null;
  userId: string;
  workflowRunId?: string | null;
  sandbox: Sandbox;
  sandboxName?: string | null;
  profile: ManagedRuntimeProfile;
  requestedProfileId: string;
  resolvedProfileId: string;
  startupReporter: WorkspaceStartupReporter;
}): Promise<{ notes: string[]; profileRunId?: string }> {
  const notes: string[] = [];
  const { profile } = params;
  let profileRunId: string | undefined;

  try {
    const profileRun = await startManagedRuntimeProfileRun({
      sessionId: params.session.id,
      chatId: params.chatId ?? null,
      userId: params.userId,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      profile,
      requestedProfileId: params.requestedProfileId,
      resolvedProfileId: params.resolvedProfileId,
    });
    profileRunId = profileRun.id;
  } catch (error) {
    // D8 (recommended): warn-and-continue with a visible "evidence unavailable"
    // state rather than hard-failing the turn when only evidence recording
    // (not the runtime itself) is impacted.
    console.error(
      "[managed-runtime] Failed to create profile run observation:",
      error,
    );
    notes.push(
      "Evidence unavailable: this run's setup/verification results could not be saved.",
    );
    await params.startupReporter.send(
      "Warning: evidence for this managed runtime run could not be saved.",
    );
    try {
      await emitSessionEvent({
        sessionId: params.session.id,
        chatId: params.chatId ?? null,
        userId: params.userId,
        source: "managed_runtime",
        actorType: "sandbox",
        eventName: "managed_runtime.profile.evidence_unavailable",
        status: "failed",
        summary: "Managed runtime profile run evidence could not be saved",
        workflowRunId: params.workflowRunId ?? null,
        sandboxName: params.sandboxName ?? null,
        managedRuntimeProfileRunId: null,
        payload: {
          sessionId: params.session.id,
          chatId: params.chatId ?? null,
          workflowRunId: params.workflowRunId ?? null,
          requestedProfileId: params.requestedProfileId,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    } catch (emitError) {
      console.error(
        "[managed-runtime] Failed to emit evidence_unavailable event:",
        emitError,
      );
    }
  }

  const verificationLabels = profile.verificationCommands
    .map((command) => command.label)
    .join(", ");
  await params.startupReporter.send(
    `Managed runtime selected: ${profile.displayName} (${profile.id}). This profile will run setup, then verify: ${verificationLabels || "no verification commands"}.`,
    [
      `Managed runtime profile: ${profile.displayName} (${profile.id}@${profile.version})`,
      `Expected tools: ${profile.expectedTools.join(", ") || "none"}`,
      `Optional tools: ${profile.optionalTools.join(", ") || "none"}`,
    ],
  );
  await emitSessionEvent({
    sessionId: params.session.id,
    chatId: params.chatId ?? null,
    userId: params.userId,
    source: "managed_runtime",
    actorType: "sandbox",
    eventName: "managed_runtime.profile.started",
    status: "started",
    summary: `Preparing managed runtime profile: ${profile.displayName}`,
    workflowRunId: params.workflowRunId ?? null,
    sandboxName: params.sandboxName ?? null,
    managedRuntimeProfileRunId: profileRunId ?? null,
    payload: {
      profileId: profile.id,
      profileVersion: profile.version,
      expectedTools: profile.expectedTools,
      optionalTools: profile.optionalTools,
    },
  });

  for (const [index, setupCommand] of profile.setupCommands.entries()) {
    await params.startupReporter.send(
      buildSetupStepMessage({
        profile,
        command: setupCommand,
        stepNumber: index + 1,
        totalSteps: profile.setupCommands.length,
      }),
      [`$ ${setupCommand.command}`],
    );
    // The "started" observability event is independent of the exec call
    // below — fire it without awaiting so it overlaps with the (often much
    // slower) command execution instead of serializing a network round trip
    // ahead of it. Any failure to emit is logged, never fails the turn; the
    // promise is awaited (settled) below before this command's handling
    // completes, on both the success and exec-error paths.
    const emitStarted = emitSessionEvent({
      sessionId: params.session.id,
      chatId: params.chatId ?? null,
      userId: params.userId,
      source: "managed_runtime",
      actorType: "sandbox",
      eventName: "managed_runtime.profile.setup.command.started",
      status: "running",
      summary: `Setup command started: ${setupCommand.label}`,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      managedRuntimeProfileRunId: profileRunId ?? null,
      payload: {
        commandId: setupCommand.id,
        label: setupCommand.label,
        required: setupCommand.required ?? true,
        timeoutMs: setupCommand.timeoutMs ?? 120_000,
      },
    }).catch((emitError) => {
      console.error(
        "[managed-runtime] Failed to emit started event:",
        emitError,
      );
    });

    const commandStartedAt = new Date();
    let result: Awaited<ReturnType<typeof params.sandbox.exec>>;
    try {
      result = await params.sandbox.exec(
        setupCommand.command,
        params.sandbox.workingDirectory,
        setupCommand.timeoutMs ?? 120_000,
      );
    } catch (error) {
      // Settle the started-event write before handling the exec error —
      // every observability write for this command must be settled before
      // the function throws.
      await emitStarted;
      const message =
        error instanceof Error
          ? error.message
          : `Unknown error: ${String(error)}`;
      const execErrorFinishedAt = new Date();
      const execErrorObservation = buildManagedRuntimeCommandObservation({
        command: setupCommand,
        status: "failed",
        startedAt: commandStartedAt,
        finishedAt: execErrorFinishedAt,
        result: {
          success: false,
          exitCode: null,
          stdout: "",
          stderr: message,
        },
      });
      if (profileRunId) {
        try {
          await appendManagedRuntimeSetupResult({
            profileRunId,
            observation: execErrorObservation,
          });
        } catch (appendError) {
          console.error(
            "[managed-runtime] Failed to append setup exec-error observation:",
            appendError,
          );
        }
        try {
          await finishManagedRuntimeProfileRun({
            profileRunId,
            status: "failed",
            summary: `Setup command could not run: ${setupCommand.label}`,
            failureMessage: execErrorObservation.summary,
            errorKind: "setup_exec_error",
            nextAction: nextActionFor("setup_exec_error"),
          });
        } catch (finishError) {
          console.error(
            "[managed-runtime] Failed to finish profile run after setup exec error:",
            finishError,
          );
        }
      }
      try {
        await emitSessionEvent({
          sessionId: params.session.id,
          chatId: params.chatId ?? null,
          userId: params.userId,
          source: "managed_runtime",
          actorType: "sandbox",
          eventName: "managed_runtime.profile.setup_failed",
          status: "failed",
          summary: `Setup command could not run: ${setupCommand.label}`,
          workflowRunId: params.workflowRunId ?? null,
          sandboxName: params.sandboxName ?? null,
          managedRuntimeProfileRunId: profileRunId ?? null,
          payload: execErrorObservation,
        });
      } catch (emitError) {
        console.error(
          "[managed-runtime] Failed to emit setup_failed event:",
          emitError,
        );
      }
      throw new WorkspaceSetupError(
        `Managed runtime profile setup failed while running ${setupCommand.label} for ${profile.displayName} (${profile.id}). ${setupCommand.description} Error: ${message}`,
        {
          errorKind: "setup_exec_error",
          nextAction: nextActionFor("setup_exec_error"),
        },
      );
    }
    const commandFinishedAt = new Date();
    const observation = buildManagedRuntimeCommandObservation({
      command: setupCommand,
      status: result.success ? "passed" : "failed",
      startedAt: commandStartedAt,
      finishedAt: commandFinishedAt,
      result,
    });
    // The append-observation write and the succeeded/failed event are each
    // independent of one another and of the reporter write — run them
    // concurrently (each keeps its own existing error handling, so one
    // failing never blocks the others from being attempted), then settle
    // everything (including the started-event promise from above) before
    // this command's handling completes.
    const appendResultTask = profileRunId
      ? appendManagedRuntimeSetupResult({
          profileRunId,
          observation,
        }).catch((error) => {
          console.error(
            "[managed-runtime] Failed to append setup observation:",
            error,
          );
        })
      : Promise.resolve();

    await Promise.all([
      emitStarted,
      params.startupReporter.appendCommandResult({
        message: result.success
          ? `Managed runtime setup passed: ${setupCommand.label}.`
          : `Managed runtime setup failed: ${setupCommand.label}.`,
        command: setupCommand.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
      appendResultTask,
      emitSessionEvent({
        sessionId: params.session.id,
        chatId: params.chatId ?? null,
        userId: params.userId,
        source: "managed_runtime",
        actorType: "sandbox",
        eventName: result.success
          ? "managed_runtime.profile.setup.command.succeeded"
          : "managed_runtime.profile.setup.command.failed",
        status: result.success ? "succeeded" : "failed",
        summary: result.success
          ? `Setup command passed: ${setupCommand.label}`
          : `Setup command failed: ${setupCommand.label}`,
        workflowRunId: params.workflowRunId ?? null,
        sandboxName: params.sandboxName ?? null,
        managedRuntimeProfileRunId: profileRunId ?? null,
        payload: observation,
      }),
    ]);

    if (!result.success) {
      const summary = [result.stderr, result.stdout]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .join("\n");
      const compactSummary = compactCommandOutput(summary);
      console.warn(
        `Managed runtime profile setup failed (${setupCommand.id}): ${summary}`,
      );
      notes.push(
        `Profile setup failed: ${setupCommand.label}. Verify the runtime profile before relying on its tools.`,
      );
      await params.startupReporter.send(
        `Managed runtime profile setup failed: ${setupCommand.label}. ${setupCommand.description}`,
      );
      const isRequiredSetupCommand = setupCommand.required ?? true;
      if (profileRunId) {
        try {
          await finishManagedRuntimeProfileRun({
            profileRunId,
            status: "failed",
            summary: `Profile setup failed: ${setupCommand.label}`,
            failureMessage: observation.summary,
            ...(isRequiredSetupCommand
              ? {
                  errorKind: "setup_command_failed",
                  nextAction: nextActionFor("setup_command_failed"),
                }
              : {}),
          });
        } catch (error) {
          console.error(
            "[managed-runtime] Failed to finish profile run observation:",
            error,
          );
        }
      }
      await emitSessionEvent({
        sessionId: params.session.id,
        chatId: params.chatId ?? null,
        userId: params.userId,
        source: "managed_runtime",
        actorType: "sandbox",
        eventName: "managed_runtime.profile.setup_failed",
        status: "failed",
        summary: `Managed runtime profile setup failed: ${setupCommand.label}`,
        workflowRunId: params.workflowRunId ?? null,
        sandboxName: params.sandboxName ?? null,
        managedRuntimeProfileRunId: profileRunId ?? null,
        payload: {
          ...observation,
          requestedProfileId: params.requestedProfileId,
          resolvedProfileId: params.resolvedProfileId,
          errorKind: "setup_command_failed",
          nextAction: nextActionFor("setup_command_failed"),
        },
      });
      if (isRequiredSetupCommand) {
        const setupFailureMessage = [
          `Managed runtime profile setup failed while running ${setupCommand.label} for ${profile.displayName} (${profile.id}).`,
          setupCommand.description,
          compactSummary ? `Command output: ${compactSummary}` : "",
        ]
          .filter((part) => part.length > 0)
          .join(" ");
        // A required setup command that RAN and exited nonzero is fatal ONLY
        // when the output contains one of our own deterministic guard
        // phrases (production incident DCaiJUlpmOobs2Yp18O6R: a missing
        // execute bit, one of these guard phrases, failed 4x in ~12s before
        // the workflow engine gave up "after 3 retries" — no retry could
        // have changed that outcome). Exit code alone cannot distinguish
        // that from an ordinary transient registry/network failure in
        // `curl`/`bun install`/`agent-browser install --with-deps`, which
        // genuinely can succeed on retry — those must stay retryable.
        if (isDeterministicSetupFailure(summary)) {
          // Imported here rather than at module scope: `workflow`
          // re-exports FatalError through a star-export chain that the
          // test runner's resolver does not follow.
          const { FatalError } = await import("workflow");
          const fatalError = new FatalError(setupFailureMessage) as Error & {
            errorKind?: ManagedRuntimeErrorKind;
            nextAction?: string;
          };
          fatalError.errorKind = "setup_command_failed";
          fatalError.nextAction = nextActionFor("setup_command_failed");
          throw fatalError;
        }
        throw new WorkspaceSetupError(setupFailureMessage, {
          errorKind: "setup_command_failed",
          nextAction: nextActionFor("setup_command_failed"),
        });
      }
      return { notes, profileRunId };
    }
  }

  for (const [
    index,
    verificationCommand,
  ] of profile.verificationCommands.entries()) {
    await params.startupReporter.send(
      buildVerificationStepMessage({
        profile,
        command: verificationCommand,
        stepNumber: index + 1,
        totalSteps: profile.verificationCommands.length,
      }),
      [`$ ${verificationCommand.command}`],
    );
    // See the setup-loop comment above: fire the "started" event without
    // awaiting so it overlaps with the exec call instead of serializing a
    // network round trip ahead of it. Settled below on every path.
    const emitStarted = emitSessionEvent({
      sessionId: params.session.id,
      chatId: params.chatId ?? null,
      userId: params.userId,
      source: "managed_runtime",
      actorType: "sandbox",
      eventName: "managed_runtime.profile.verify.command.started",
      status: "running",
      summary: `Verification command started: ${verificationCommand.label}`,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      managedRuntimeProfileRunId: profileRunId ?? null,
      payload: {
        commandId: verificationCommand.id,
        label: verificationCommand.label,
        required: verificationCommand.required ?? true,
        timeoutMs: verificationCommand.timeoutMs ?? 30_000,
      },
    }).catch((emitError) => {
      console.error(
        "[managed-runtime] Failed to emit started event:",
        emitError,
      );
    });
    const commandStartedAt = new Date();
    let result: Awaited<ReturnType<typeof params.sandbox.exec>>;
    try {
      result = await params.sandbox.exec(
        verificationCommand.command,
        params.sandbox.workingDirectory,
        verificationCommand.timeoutMs ?? 30_000,
      );
    } catch (error) {
      // Settle the started-event write before handling the exec error.
      await emitStarted;
      const message =
        error instanceof Error
          ? error.message
          : `Unknown error: ${String(error)}`;
      const execErrorFinishedAt = new Date();
      const execErrorObservation = buildManagedRuntimeCommandObservation({
        command: verificationCommand,
        status: "failed",
        startedAt: commandStartedAt,
        finishedAt: execErrorFinishedAt,
        result: {
          success: false,
          exitCode: null,
          stdout: "",
          stderr: message,
        },
      });
      if (profileRunId) {
        try {
          await appendManagedRuntimeVerificationResult({
            profileRunId,
            observation: execErrorObservation,
          });
        } catch (appendError) {
          console.error(
            "[managed-runtime] Failed to append verification exec-error observation:",
            appendError,
          );
        }
        try {
          await finishManagedRuntimeProfileRun({
            profileRunId,
            status: "failed",
            summary: `Verification command could not run: ${verificationCommand.label}`,
            failureMessage: execErrorObservation.summary,
            errorKind: "setup_exec_error",
            nextAction: nextActionFor("setup_exec_error"),
          });
        } catch (finishError) {
          console.error(
            "[managed-runtime] Failed to finish profile run after verification exec error:",
            finishError,
          );
        }
      }
      try {
        await emitSessionEvent({
          sessionId: params.session.id,
          chatId: params.chatId ?? null,
          userId: params.userId,
          source: "managed_runtime",
          actorType: "sandbox",
          eventName: "managed_runtime.profile.verification_failed",
          status: "failed",
          summary: `Verification command could not run: ${verificationCommand.label}`,
          workflowRunId: params.workflowRunId ?? null,
          sandboxName: params.sandboxName ?? null,
          managedRuntimeProfileRunId: profileRunId ?? null,
          payload: execErrorObservation,
        });
      } catch (emitError) {
        console.error(
          "[managed-runtime] Failed to emit verification_failed event:",
          emitError,
        );
      }
      throw new WorkspaceSetupError(
        `Managed runtime profile verification failed while running ${verificationCommand.label} for ${profile.displayName} (${profile.id}). ${verificationCommand.description} Error: ${message}`,
        {
          errorKind: "setup_exec_error",
          nextAction: nextActionFor("setup_exec_error"),
        },
      );
    }
    const commandFinishedAt = new Date();
    const observation = buildManagedRuntimeCommandObservation({
      command: verificationCommand,
      status: result.success
        ? "passed"
        : verificationCommand.required === false
          ? "skipped"
          : "failed",
      startedAt: commandStartedAt,
      finishedAt: commandFinishedAt,
      result,
    });
    // appendCommandResult and the append-observation write are common to all
    // three outcomes below (succeeded/skipped/required-failed); kick both off
    // now so they overlap with whichever outcome-specific write follows
    // instead of serializing ahead of it. Each keeps its own existing error
    // handling, so one failing never blocks the others from being attempted.
    const appendCommandResultTask = params.startupReporter.appendCommandResult({
      message: result.success
        ? `Managed runtime verification passed: ${verificationCommand.label}.`
        : `Managed runtime verification finished: ${verificationCommand.label}.`,
      command: verificationCommand.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });

    const appendResultTask = profileRunId
      ? appendManagedRuntimeVerificationResult({
          profileRunId,
          observation,
        }).catch((error) => {
          console.error(
            "[managed-runtime] Failed to append verification observation:",
            error,
          );
        })
      : Promise.resolve();

    if (result.success) {
      notes.push(`Verified: ${verificationCommand.label}.`);
      await Promise.all([
        emitStarted,
        appendCommandResultTask,
        appendResultTask,
        emitSessionEvent({
          sessionId: params.session.id,
          chatId: params.chatId ?? null,
          userId: params.userId,
          source: "managed_runtime",
          actorType: "sandbox",
          eventName: "managed_runtime.profile.verify.command.succeeded",
          status: "succeeded",
          summary: `Verification passed: ${verificationCommand.label}`,
          workflowRunId: params.workflowRunId ?? null,
          sandboxName: params.sandboxName ?? null,
          managedRuntimeProfileRunId: profileRunId ?? null,
          payload: observation,
        }),
      ]);
      continue;
    }

    if (verificationCommand.required === false) {
      notes.push(`Optional tool unavailable: ${verificationCommand.label}.`);
      await Promise.all([
        emitStarted,
        appendCommandResultTask,
        appendResultTask,
        emitSessionEvent({
          sessionId: params.session.id,
          chatId: params.chatId ?? null,
          userId: params.userId,
          source: "managed_runtime",
          actorType: "sandbox",
          eventName: "managed_runtime.profile.verify.command.skipped",
          status: "skipped",
          summary: `Optional verification unavailable: ${verificationCommand.label}`,
          workflowRunId: params.workflowRunId ?? null,
          sandboxName: params.sandboxName ?? null,
          managedRuntimeProfileRunId: profileRunId ?? null,
          payload: observation,
        }),
      ]);
      continue;
    }

    // Required-failure path: ordering below is unchanged (fail-closed), but
    // this command's own observability writes must still be settled first.
    await Promise.all([emitStarted, appendCommandResultTask, appendResultTask]);

    notes.push(
      `Required profile verification failed: ${verificationCommand.label}.`,
    );
    await params.startupReporter.send(
      `Blocked: verification failed for ${verificationCommand.label} — ${nextActionFor("verification_failed")}`,
    );
    if (profileRunId) {
      try {
        await finishManagedRuntimeProfileRun({
          profileRunId,
          status: "blocked",
          summary: `Required verification failed: ${verificationCommand.label}`,
          failureMessage: observation.summary,
          errorKind: "verification_failed",
          nextAction: nextActionFor("verification_failed"),
        });
      } catch (error) {
        console.error(
          "[managed-runtime] Failed to finish profile run observation:",
          error,
        );
      }
    }
    await emitSessionEvent({
      sessionId: params.session.id,
      chatId: params.chatId ?? null,
      userId: params.userId,
      source: "managed_runtime",
      actorType: "sandbox",
      eventName: "managed_runtime.profile.verification_failed",
      status: "blocked",
      summary: `Managed runtime profile verification failed: ${verificationCommand.label}`,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      managedRuntimeProfileRunId: profileRunId ?? null,
      payload: {
        ...observation,
        requestedProfileId: params.requestedProfileId,
        resolvedProfileId: params.resolvedProfileId,
        errorKind: "verification_failed",
        nextAction: nextActionFor("verification_failed"),
      },
    });
    // D7 hard fail-closed: a required verification failure must block the
    // turn — never return a usable runtime with tools proven missing.
    throw new WorkspaceSetupError(
      `Managed runtime is active, but a required verification command failed: ${verificationCommand.label}. ${nextActionFor("verification_failed")}`,
      {
        errorKind: "verification_failed",
        nextAction: nextActionFor("verification_failed"),
      },
    );
  }

  await params.startupReporter.send(
    `Managed runtime profile is ready: ${profile.displayName}.`,
    [`Managed runtime profile ready: ${profile.displayName}`],
  );
  if (profileRunId) {
    try {
      await finishManagedRuntimeProfileRun({
        profileRunId,
        status: "passed",
        summary: `Managed runtime profile ready: ${profile.displayName}`,
      });
    } catch (error) {
      console.error(
        "[managed-runtime] Failed to finish profile run observation:",
        error,
      );
    }
  }
  await emitSessionEvent({
    sessionId: params.session.id,
    chatId: params.chatId ?? null,
    userId: params.userId,
    source: "managed_runtime",
    actorType: "sandbox",
    eventName: "managed_runtime.profile.ready",
    status: "succeeded",
    summary: `Managed runtime profile ready: ${profile.displayName}`,
    workflowRunId: params.workflowRunId ?? null,
    sandboxName: params.sandboxName ?? null,
    managedRuntimeProfileRunId: profileRunId ?? null,
    payload: {
      profileId: profile.id,
      profileVersion: profile.version,
      expectedTools: profile.expectedTools,
      optionalTools: profile.optionalTools,
    },
  });
  return { notes, profileRunId };
}

/**
 * Validate + extract the repo identity needed for a GitHub-backed session.
 * Throws synchronously (same as the original inline guard) when cloneUrl is
 * set but the owner/repo metadata is missing. Returns undefined when the
 * session has no repo at all. Narrowing repoOwner/repoName to non-null
 * strings inside this function (rather than at each call site) keeps the
 * callers free of redundant guards or non-null assertions.
 */
function getRequiredRepoIdentity(
  session: SessionRecord,
): { owner: string; repo: string } | undefined {
  if (!session.cloneUrl) {
    return undefined;
  }
  if (!session.repoOwner || !session.repoName) {
    throw new Error("Session is missing repository metadata");
  }
  return { owner: session.repoOwner, repo: session.repoName };
}

export async function resolveChatSandboxRuntime(params: {
  userId: string;
  sessionId: string;
  chatId?: string | null;
  assistantId: string;
  workflowRunId?: string | null;
}): Promise<ResolvedChatSandboxRuntime> {
  "use step";

  await sendStart(params.assistantId);

  const session = await getSessionById(params.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.userId !== params.userId) {
    throw new Error("Unauthorized");
  }
  if (session.status === "archived") {
    throw new Error("Session is archived");
  }

  // Guard: when sandboxState is null the session is sandbox-free (plain chat, no repo).
  // Return immediately without provisioning or connecting any VM.
  if (!isSandboxState(session.sandboxState)) {
    return {
      mode: "sandbox-free",
      sandboxState: null,
      runtimeMode: session.runtimeMode,
      skills: [],
      sessionTitle: session.title,
      repoOwner: session.repoOwner ?? undefined,
      repoName: session.repoName ?? undefined,
    } satisfies SandboxFreeRuntime;
  }

  // Pre-connect heuristic: we cannot yet know whether connectSandbox will
  // create a fresh workspace or resume an existing snapshot, so we derive an
  // expectation from persisted state for the startup messages that must print
  // before connect. The authoritative signal (sandbox.wasCreated) is applied
  // after connect below.
  const expectsColdStart = !isSandboxActive(session.sandboxState);
  const startupReporter = new WorkspaceStartupReporter(
    session.runtimeMode === "managed_runtime"
      ? "Preparing sandbox and managed runtime"
      : "Preparing sandbox workspace",
    sendWorkspaceStatus,
  );
  const sandboxInputState = buildSandboxState(session);
  if (expectsColdStart) {
    await startupReporter.send("Setting up the workspace...", [
      `Session: ${session.id}`,
      `Sandbox name: ${sandboxInputState.sandboxName ?? "ephemeral"}`,
      session.repoOwner && session.repoName
        ? `Repository: ${session.repoOwner}/${session.repoName}`
        : "Repository: empty workspace",
      session.branch ? `Branch: ${session.branch}` : "Branch: default",
    ]);
  }

  // #811 (MR-2): resolve the managed-runtime profile BEFORE sandbox
  // provisioning so profile.defaultPorts can be passed into connectSandbox,
  // and so an unresolvable profile fails closed before any sandbox is
  // created. Never silently substitutes the built-in default (D7).
  let managedRuntimeProfile: ManagedRuntimeProfile | undefined;
  let requestedProfileId: string | undefined;
  let resolvedProfileId: string | undefined;
  if (session.runtimeMode === "managed_runtime") {
    const resolution = await resolveManagedRuntimeProfile({
      userId: params.userId,
      sessionId: session.id,
      profileId: session.managedRuntimeProfileId,
    });

    if (!resolution.ok) {
      const errorKind: ManagedRuntimeErrorKind = "profile_not_found";
      try {
        await emitSessionEvent({
          sessionId: session.id,
          chatId: params.chatId ?? null,
          userId: params.userId,
          source: "managed_runtime",
          actorType: "sandbox",
          eventName: "managed_runtime.profile.resolution_failed",
          status: "failed",
          summary: `Managed runtime profile could not be resolved: ${resolution.requestedProfileId}`,
          workflowRunId: params.workflowRunId ?? null,
          sandboxName: sandboxInputState.sandboxName ?? null,
          managedRuntimeProfileRunId: null,
          payload: {
            sessionId: session.id,
            chatId: params.chatId ?? null,
            workflowRunId: params.workflowRunId ?? null,
            requestedProfileId: resolution.requestedProfileId,
            errorKind,
            nextAction: resolution.nextAction,
          },
        });
      } catch (emitError) {
        console.error(
          "[managed-runtime] Failed to emit resolution_failed event:",
          emitError,
        );
      }
      await startupReporter.send(
        `Blocked: managed runtime profile "${resolution.requestedProfileId}" could not be resolved — ${resolution.nextAction}`,
      );
      throw new WorkspaceSetupError(
        `Managed runtime profile "${resolution.requestedProfileId}" could not be resolved. ${resolution.nextAction}`,
        { errorKind, nextAction: resolution.nextAction },
      );
    }

    managedRuntimeProfile = resolution.profile;
    requestedProfileId = resolution.requestedProfileId;
    resolvedProfileId = resolution.resolvedProfileId;
  }

  const sandboxPorts =
    session.runtimeMode === "managed_runtime" && managedRuntimeProfile
      ? managedRuntimeProfile.defaultPorts
      : DEFAULT_SANDBOX_PORTS;

  // Throws synchronously (before any connect attempt) if cloneUrl is set but
  // owner/repo metadata is missing — same fail-fast guard as before.
  const repoIdentity = getRequiredRepoIdentity(session);

  const connectOptionsBase = {
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    vcpus: DEFAULT_SANDBOX_VCPUS,
    ports: sandboxPorts,
    baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
    snapshotExpiration: SANDBOX_SNAPSHOT_EXPIRATION_MS,
    persistent: true,
    resume: true,
    // Default shallow clone; opt into full git history per session.
    ...(session.fullClone ? { cloneDepth: 0 } : {}),
  };

  function fireAndForgetRevoke(token: string): void {
    // Scoped contents:read, short-lived; revocation is hygiene, not a gate —
    // never make the turn wait on it.
    void revokeInstallationToken(token).catch((err) => {
      console.error("Failed to revoke installation token:", err);
    });
  }

  let setupToken: ScopedInstallationToken | undefined;
  let sandbox: Sandbox;
  if (repoIdentity && !expectsColdStart) {
    // WARM PATH: reconnecting to an already-live VM. No installation token
    // is minted here — the token was only ever needed to clear a brokering
    // network policy on the sandbox side, and withTemporaryGitHubAuth
    // (packages/sandbox/git.ts) already clears that policy in its `finally`
    // regardless of whether a token is supplied. verifyRepoAccess remains a
    // security gate and still runs (and still fails the turn) on every
    // message, including here — it's just no longer serialized ahead of the
    // connect, since the two are independent.
    const accessPromise = verifyRepoAccess({
      userId: params.userId,
      owner: repoIdentity.owner,
      repo: repoIdentity.repo,
    });
    // Avoid an unhandled-rejection warning while connect is in flight; the
    // real result (or rejection) is awaited below once connect settles.
    accessPromise.catch(() => {});

    try {
      sandbox = await connectSandbox({
        state: sandboxInputState,
        options: {
          ...connectOptionsBase,
          createIfMissing: false,
        },
      });

      // Security: the warm path mints no installation token, so
      // VercelSandbox.connect does not run its credential-broker clear (it only
      // clears when a githubToken is supplied). If a prior withTemporaryGitHubAuth
      // or setup cleanup failed — or a worker crashed mid-broker — a stale
      // GitHub network policy could still be active on this VM. Clear it before
      // any agent command runs, without minting a token.
      await sandbox.setGitHubAuthToken?.();

      const access = await accessPromise;
      if (!access.ok) {
        throw new Error(getRepoAccessErrorMessage(access.reason));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRecreatableSandboxError(message)) {
        throw error;
      }

      // The DB said this sandbox was active, but the VM itself is gone
      // (evicted/expired out from under us) — fall back to the cold flow:
      // mint a token and recreate + re-clone. The recreate produces a fresh VM
      // (sandbox.wasCreated === true), so the post-connect didSetupWorkspace
      // below is true and the skills-install branch runs — a fresh re-cloned
      // workspace has no snapshot to reuse, so it genuinely needs its skills.
      const access = await accessPromise;
      if (!access.ok) {
        throw new Error(getRepoAccessErrorMessage(access.reason), {
          cause: error,
        });
      }

      setupToken = await mintInstallationToken({
        installationId: access.installationId,
        repositoryIds: [access.repositoryId],
        permissions: { contents: "read" },
      });
      const gitUser = await getGitUser(params.userId);

      try {
        sandbox = await connectSandbox({
          state: sandboxInputState,
          options: {
            ...connectOptionsBase,
            githubToken: setupToken.token,
            gitUser,
            createIfMissing: true,
          },
        });
      } finally {
        fireAndForgetRevoke(setupToken.token);
      }
    }
  } else {
    // COLD PATH (didSetupWorkspace === true), or a session with no repo at
    // all (cloneUrl unset) on either path.
    let gitUser: Awaited<ReturnType<typeof getGitUser>>;

    if (repoIdentity) {
      // getGitUser is independent of the verify-then-mint chain — overlap
      // them instead of serializing gitUser ahead of the repo-access round
      // trip.
      const [resolvedGitUser, resolvedToken] = await Promise.all([
        getGitUser(params.userId),
        (async () => {
          const access = await verifyRepoAccess({
            userId: params.userId,
            owner: repoIdentity.owner,
            repo: repoIdentity.repo,
          });
          if (!access.ok) {
            throw new Error(getRepoAccessErrorMessage(access.reason));
          }
          if (expectsColdStart) {
            await startupReporter.send("Repository access verified.", [
              `GitHub installation: ${access.installationId}`,
              `Repository id: ${access.repositoryId}`,
            ]);
          }
          return mintInstallationToken({
            installationId: access.installationId,
            repositoryIds: [access.repositoryId],
            permissions: { contents: "read" },
          });
        })(),
      ]);
      gitUser = resolvedGitUser;
      setupToken = resolvedToken;
    } else {
      gitUser = await getGitUser(params.userId);
    }

    if (expectsColdStart) {
      await startupReporter.send("Starting the sandbox...", [
        DEFAULT_SANDBOX_BASE_SNAPSHOT_ID
          ? `Base snapshot: ${DEFAULT_SANDBOX_BASE_SNAPSHOT_ID}`
          : "Base snapshot: default runtime",
        `Ports: ${sandboxPorts.join(", ")}`,
        `vCPUs: ${DEFAULT_SANDBOX_VCPUS}`,
      ]);
    }

    try {
      sandbox = await connectSandbox({
        state: sandboxInputState,
        options: {
          ...connectOptionsBase,
          githubToken: setupToken?.token,
          gitUser,
          createIfMissing: true,
        },
      });
    } finally {
      if (setupToken) {
        fireAndForgetRevoke(setupToken.token);
      }
    }
  }

  const rawSandboxState = sandbox.getState?.();
  const sandboxState = isSandboxState(rawSandboxState)
    ? rawSandboxState
    : sandboxInputState;

  // Authoritative first-create signal. A resumed sandbox (wasCreated === false)
  // already contains globally-installed skills and the bootstrapped workspace in
  // its snapshot, so re-running that setup only slows the resume. Fall back to
  // the pre-connect heuristic when the implementation cannot report wasCreated.
  const didSetupWorkspace = sandbox.wasCreated ?? expectsColdStart;

  if (expectsColdStart) {
    await startupReporter.send("Sandbox is ready.", [
      `Sandbox session: ${sandboxState.sandboxName ?? sandboxState.sandboxId ?? "unknown"}`,
      `Working directory: ${sandbox.workingDirectory}`,
      sandbox.currentBranch ? `Current branch: ${sandbox.currentBranch}` : "",
    ]);
    // Only narrate a skill install when one will actually run — a warm resume
    // (didSetupWorkspace === false) reuses the snapshot's skills.
    const globalSkillRefs = session.globalSkillRefs ?? [];
    if (didSetupWorkspace && globalSkillRefs.length > 0) {
      await startupReporter.send("Installing session skills...", [
        `Global skills: ${globalSkillRefs.join(", ")}`,
      ]);
    }
  }

  // User skills materialize whenever the VM may lack them:
  //  - a cold resume (expectsColdStart) — re-materialize so skill selections
  //    toggled while hibernated take effect; there is no live-sync path;
  //  - a freshly created OR recreated workspace (didSetupWorkspace via
  //    wasCreated), including the warm-404 recreate where expectsColdStart is
  //    false but the VM is brand new and has no user skills yet.
  // The only case that skips is a warm per-message reconnect to the same live
  // VM (expectsColdStart false, wasCreated false), which already has them.
  const shouldRefreshUserSkills = expectsColdStart || didSetupWorkspace;

  await Promise.all([
    updateSession(params.sessionId, {
      sandboxState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(session.lifecycleVersion),
      ...buildActiveLifecycleUpdate(sandboxState),
    }),
    installSessionGlobalSkills({
      session,
      sandbox,
      didSetupWorkspace,
    }),
    installSessionUserSkills({
      userId: params.userId,
      sessionId: params.sessionId,
      sandboxName: sandboxState.sandboxName ?? null,
      sandbox,
      didSetupWorkspace: shouldRefreshUserSkills,
    }),
  ]);

  if (expectsColdStart) {
    await startupReporter.send("Workspace setup finished.", [
      "Session sandbox state saved.",
      "Workspace skills cache refreshed.",
    ]);
  }

  // Kick the lifecycle workflow BEFORE managed-runtime setup runs. Managed
  // setup can now fail closed (throw), and this is the only lifecycle kick in
  // the provisioning path — kicking it first ensures a failed setup still
  // leaves the persistent sandbox scheduled for hibernation/cleanup rather than
  // orphaned (Codex #832 P2).
  kickSandboxLifecycleWorkflow({
    sessionId: params.sessionId,
    reason: "sandbox-created",
  });

  const managedRuntimeEnvironment =
    session.runtimeMode === "managed_runtime" &&
    managedRuntimeProfile &&
    requestedProfileId &&
    resolvedProfileId
      ? await ensureManagedRuntimeEnvironment({
          session,
          chatId: params.chatId ?? null,
          userId: params.userId,
          workflowRunId: params.workflowRunId ?? null,
          sandbox,
          sandboxName: sandboxState.sandboxName ?? null,
          profile: managedRuntimeProfile,
          requestedProfileId,
          resolvedProfileId,
          startupReporter,
        })
      : { notes: [] };
  const managedRuntimeNotes = managedRuntimeEnvironment.notes;

  const skills = await loadSessionSkills({
    sessionId: params.sessionId,
    sandboxState,
    sandbox,
  });

  return {
    mode: "sandbox",
    sandboxState,
    runtimeMode: session.runtimeMode,
    ...(managedRuntimeProfile
      ? {
          managedRuntime: {
            profileId: managedRuntimeProfile.id,
            profileVersion: managedRuntimeProfile.version,
            profileDisplayName: managedRuntimeProfile.displayName,
            profileRunId: managedRuntimeEnvironment.profileRunId,
            sandboxName: sandboxState.sandboxName,
          },
        }
      : {}),
    workingDirectory: sandbox.workingDirectory,
    currentBranch: sandbox.currentBranch,
    environmentDetails:
      session.runtimeMode === "managed_runtime"
        ? `${sandbox.environmentDetails}\n\n# Managed Runtime\n\n- Runtime mode: managed runtime.\n- The user selected managed runtime for this session. Make that explicit in status updates and final verification notes when runtime behavior matters.\n- Managed runtime service previews, service logs, and browser checks are available from the app UI for local web apps.\n- Managed runtime uses a profile-specific setup step. Do not assume Node, npm, Bun, Python, or any other tool exists unless the active profile verifies it.\n${managedRuntimeEnvironment.profileRunId ? `- Managed runtime profile run id: ${managedRuntimeEnvironment.profileRunId}.\n` : ""}${managedRuntimeNotes.map((note) => `- ${note}`).join("\n")}`
        : sandbox.environmentDetails,
    skills,
    didSetupWorkspace,
    sessionTitle: session.title,
    repoOwner: session.repoOwner ?? undefined,
    repoName: session.repoName ?? undefined,
  } satisfies SandboxBackedRuntime;
}
