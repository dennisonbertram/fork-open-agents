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
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import {
  getResumableSandboxName,
  getSessionSandboxName,
  isSandboxActive,
} from "@/lib/sandbox/utils";
import { getSandboxSkillDirectories } from "@/lib/skills/directories";
import { installGlobalSkills } from "@/lib/skills/global-skill-installer";
import { installSessionUserSkills } from "@/lib/skills/session-user-skills";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
import { WorkspaceStartupReporter } from "./workspace-startup-log";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

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

  return {
    repo: session.cloneUrl,
    ...(shouldCreateNewBranch
      ? { newBranch: session.branch ?? undefined }
      : { branch: session.branch ?? "main" }),
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
    await emitSessionEvent({
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
    await params.startupReporter.appendCommandResult({
      message: result.success
        ? `Managed runtime setup passed: ${setupCommand.label}.`
        : `Managed runtime setup failed: ${setupCommand.label}.`,
      command: setupCommand.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });

    if (profileRunId) {
      try {
        await appendManagedRuntimeSetupResult({
          profileRunId,
          observation,
        });
      } catch (error) {
        console.error(
          "[managed-runtime] Failed to append setup observation:",
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
    });

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
        throw new WorkspaceSetupError(
          [
            `Managed runtime profile setup failed while running ${setupCommand.label} for ${profile.displayName} (${profile.id}).`,
            setupCommand.description,
            compactSummary ? `Command output: ${compactSummary}` : "",
          ]
            .filter((part) => part.length > 0)
            .join(" "),
          {
            errorKind: "setup_command_failed",
            nextAction: nextActionFor("setup_command_failed"),
          },
        );
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
    await emitSessionEvent({
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
    await params.startupReporter.appendCommandResult({
      message: result.success
        ? `Managed runtime verification passed: ${verificationCommand.label}.`
        : `Managed runtime verification finished: ${verificationCommand.label}.`,
      command: verificationCommand.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });

    if (profileRunId) {
      try {
        await appendManagedRuntimeVerificationResult({
          profileRunId,
          observation,
        });
      } catch (error) {
        console.error(
          "[managed-runtime] Failed to append verification observation:",
          error,
        );
      }
    }

    if (result.success) {
      notes.push(`Verified: ${verificationCommand.label}.`);
      await emitSessionEvent({
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
      });
      continue;
    }

    if (verificationCommand.required === false) {
      notes.push(`Optional tool unavailable: ${verificationCommand.label}.`);
      await emitSessionEvent({
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
      });
      continue;
    }

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

  const didSetupWorkspace = !isSandboxActive(session.sandboxState);
  const startupReporter = new WorkspaceStartupReporter(
    session.runtimeMode === "managed_runtime"
      ? "Preparing sandbox and managed runtime"
      : "Preparing sandbox workspace",
    sendWorkspaceStatus,
  );
  const sandboxInputState = buildSandboxState(session);
  if (didSetupWorkspace) {
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

  const gitUser = await getGitUser(params.userId);
  let setupToken: ScopedInstallationToken | undefined;

  if (session.cloneUrl) {
    if (!session.repoOwner || !session.repoName) {
      throw new Error("Session is missing repository metadata");
    }

    const access = await verifyRepoAccess({
      userId: params.userId,
      owner: session.repoOwner,
      repo: session.repoName,
    });
    if (!access.ok) {
      throw new Error(getRepoAccessErrorMessage(access.reason));
    }
    if (didSetupWorkspace) {
      await startupReporter.send("Repository access verified.", [
        `GitHub installation: ${access.installationId}`,
        `Repository id: ${access.repositoryId}`,
      ]);
    }

    setupToken = await mintInstallationToken({
      installationId: access.installationId,
      repositoryIds: [access.repositoryId],
      permissions: { contents: "read" },
    });
  }

  let sandbox: Sandbox;
  try {
    if (didSetupWorkspace) {
      await startupReporter.send("Starting the sandbox...", [
        DEFAULT_SANDBOX_BASE_SNAPSHOT_ID
          ? `Base snapshot: ${DEFAULT_SANDBOX_BASE_SNAPSHOT_ID}`
          : "Base snapshot: default runtime",
        `Ports: ${sandboxPorts.join(", ")}`,
        `vCPUs: ${DEFAULT_SANDBOX_VCPUS}`,
      ]);
    }
    sandbox = await connectSandbox({
      state: sandboxInputState,
      options: {
        githubToken: setupToken?.token,
        gitUser,
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        vcpus: DEFAULT_SANDBOX_VCPUS,
        ports: sandboxPorts,
        baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
        persistent: true,
        resume: true,
        createIfMissing: true,
        // Default shallow clone; opt into full git history per session.
        ...(session.fullClone ? { cloneDepth: 0 } : {}),
      },
    });
  } finally {
    if (setupToken) {
      await revokeInstallationToken(setupToken.token);
    }
  }

  const rawSandboxState = sandbox.getState?.();
  const sandboxState = isSandboxState(rawSandboxState)
    ? rawSandboxState
    : sandboxInputState;

  if (didSetupWorkspace) {
    await startupReporter.send("Sandbox is ready.", [
      `Sandbox session: ${sandboxState.sandboxName ?? sandboxState.sandboxId ?? "unknown"}`,
      `Working directory: ${sandbox.workingDirectory}`,
      sandbox.currentBranch ? `Current branch: ${sandbox.currentBranch}` : "",
    ]);
    const globalSkillRefs = session.globalSkillRefs ?? [];
    if (globalSkillRefs.length > 0) {
      await startupReporter.send("Installing session skills...", [
        `Global skills: ${globalSkillRefs.join(", ")}`,
      ]);
    }
  }

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
      didSetupWorkspace,
    }),
  ]);

  if (didSetupWorkspace) {
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
