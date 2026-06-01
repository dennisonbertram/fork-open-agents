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
import { getSessionById } from "@/lib/db/sessions";
import { emitSessionEvent } from "@/lib/observability/events";
import { resolveManagedRuntimeProfile } from "@/lib/managed-runtime/profile-resolution";
import {
  appendManagedRuntimeSetupResult,
  appendManagedRuntimeVerificationResult,
  buildManagedRuntimeCommandObservation,
  finishManagedRuntimeProfileRun,
  startManagedRuntimeProfileRun,
} from "@/lib/observability/managed-runtime-profile-runs";
import {
  kickSandboxProvisioningWorkflow,
  waitForSandboxProvisioningRun,
} from "@/lib/sandbox/provisioning-kick";
import {
  getResumableSandboxName,
  getSessionSandboxName,
  isSandboxActive,
} from "@/lib/sandbox/utils";
import { getSandboxSkillDirectories } from "@/lib/skills/directories";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";
import { WorkspaceStartupReporter } from "./workspace-startup-log";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

export class WorkspaceSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSetupError";
  }
}

export type ResolvedChatSandboxRuntime = {
  sandboxState: SandboxState;
  runtimeMode: SessionRecord["runtimeMode"];
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
  skills: DiscoveredSkills;
  didSetupWorkspace: boolean;
  sessionTitle: string;
  repoOwner?: string;
  repoName?: string;
};

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

function buildSandboxState(session: SessionRecord): SandboxState {
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

/**
 * Ensures the session's sandbox is provisioned and active before the chat
 * turn reconnects to it. Provisioning now runs in a durable workflow kicked
 * at session-create time; on the first chat turn we kick (idempotently) and
 * await the in-flight run rather than provisioning inline.
 */
async function getReadySessionSandbox(params: {
  sessionId: string;
  userId: string;
}): Promise<{ session: SessionRecord; didSetupWorkspace: boolean }> {
  let session = await getSessionById(params.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.userId !== params.userId) {
    throw new Error("Unauthorized");
  }
  if (session.status === "archived") {
    throw new Error("Session is archived");
  }
  if (isSandboxActive(session.sandboxState)) {
    return { session, didSetupWorkspace: false };
  }

  const kick = await kickSandboxProvisioningWorkflow(params.sessionId);
  if (kick.runId) {
    await waitForSandboxProvisioningRun(kick.runId);
  }

  session = await getSessionById(params.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (!isSandboxActive(session.sandboxState)) {
    throw new Error(session.lifecycleError ?? "Workspace setup failed");
  }

  return { session, didSetupWorkspace: true };
}

async function loadSessionSkills(params: {
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
    });
    profileRunId = profileRun.id;
  } catch (error) {
    console.error(
      "[managed-runtime] Failed to create profile run observation:",
      error,
    );
  }

  await params.startupReporter.send(
    `Managed runtime selected: ${profile.displayName} (${profile.id}). This profile installs ${profile.expectedTools.join(
      " and ",
    )} so the agent can run web app commands and browser checks in the sandbox.`,
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
      throw new WorkspaceSetupError(
        `Managed runtime profile setup failed while running ${setupCommand.label} for ${profile.displayName} (${profile.id}). ${setupCommand.description} Error: ${message}`,
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
      if (profileRunId) {
        try {
          await finishManagedRuntimeProfileRun({
            profileRunId,
            status: "failed",
            summary: `Profile setup failed: ${setupCommand.label}`,
            failureMessage: observation.summary,
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
        eventName: "managed_runtime.profile.failed",
        status: "failed",
        summary: `Managed runtime profile setup failed: ${setupCommand.label}`,
        workflowRunId: params.workflowRunId ?? null,
        sandboxName: params.sandboxName ?? null,
        managedRuntimeProfileRunId: profileRunId ?? null,
        payload: observation,
      });
      if (setupCommand.required ?? true) {
        throw new WorkspaceSetupError(
          [
            `Managed runtime profile setup failed while running ${setupCommand.label} for ${profile.displayName} (${profile.id}).`,
            setupCommand.description,
            compactSummary ? `Command output: ${compactSummary}` : "",
          ]
            .filter((part) => part.length > 0)
            .join(" "),
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
    const result = await params.sandbox.exec(
      verificationCommand.command,
      params.sandbox.workingDirectory,
      verificationCommand.timeoutMs ?? 30_000,
    );
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
      `Managed runtime is active, but verification failed: ${verificationCommand.label}.`,
    );
    if (profileRunId) {
      try {
        await finishManagedRuntimeProfileRun({
          profileRunId,
          status: "blocked",
          summary: `Required verification failed: ${verificationCommand.label}`,
          failureMessage: observation.summary,
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
      eventName: "managed_runtime.profile.blocked",
      status: "blocked",
      summary: `Managed runtime profile verification failed: ${verificationCommand.label}`,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      managedRuntimeProfileRunId: profileRunId ?? null,
      payload: observation,
    });
    return { notes, profileRunId };
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

  const initialSession = await getSessionById(params.sessionId);
  if (!initialSession) {
    throw new Error("Session not found");
  }
  if (initialSession.userId !== params.userId) {
    throw new Error("Unauthorized");
  }
  if (initialSession.status === "archived") {
    throw new Error("Session is archived");
  }

  const didSetupWorkspace = !isSandboxActive(initialSession.sandboxState);
  const startupReporter = new WorkspaceStartupReporter(
    initialSession.runtimeMode === "managed_runtime"
      ? "Preparing sandbox and managed runtime"
      : "Preparing sandbox workspace",
    sendWorkspaceStatus,
  );
  if (didSetupWorkspace) {
    const sandboxInputState = buildSandboxState(initialSession);
    await startupReporter.send("Setting up the workspace...", [
      `Session: ${initialSession.id}`,
      `Sandbox name: ${sandboxInputState.sandboxName ?? "ephemeral"}`,
      initialSession.repoOwner && initialSession.repoName
        ? `Repository: ${initialSession.repoOwner}/${initialSession.repoName}`
        : "Repository: empty workspace",
      initialSession.branch
        ? `Branch: ${initialSession.branch}`
        : "Branch: default",
    ]);
  }

  // Provisioning (sandbox boot, repo clone, token mint/revoke, global skill
  // install, and the create-time lifecycle kick) now runs in the durable
  // sandboxProvisioningWorkflow that is started at session-create time. Here
  // we await the in-flight run (kicking it on demand as a fallback) and then
  // bare-reconnect to the ready sandbox instead of provisioning inline.
  const { session } = await getReadySessionSandbox({
    sessionId: params.sessionId,
    userId: params.userId,
  });

  const sandboxState = session.sandboxState;
  if (!sandboxState) {
    throw new Error("Workspace setup failed");
  }

  const sandbox = await connectSandbox(sandboxState);

  if (didSetupWorkspace) {
    await startupReporter.send("Sandbox is ready.", [
      `Sandbox session: ${sandboxState.sandboxName ?? sandboxState.sandboxId ?? "unknown"}`,
      `Working directory: ${sandbox.workingDirectory}`,
      sandbox.currentBranch ? `Current branch: ${sandbox.currentBranch}` : "",
    ]);
  }

  const managedRuntimeProfile =
    session.runtimeMode === "managed_runtime"
      ? await resolveManagedRuntimeProfile({
          userId: params.userId,
          sessionId: session.id,
          profileId: session.managedRuntimeProfileId,
        })
      : undefined;
  const managedRuntimeEnvironment =
    session.runtimeMode === "managed_runtime"
      ? await ensureManagedRuntimeEnvironment({
          session,
          chatId: params.chatId ?? null,
          userId: params.userId,
          workflowRunId: params.workflowRunId ?? null,
          sandbox,
          sandboxName: sandboxState.sandboxName ?? null,
          profile: managedRuntimeProfile!,
          startupReporter,
        })
      : { notes: [] };
  const managedRuntimeNotes = managedRuntimeEnvironment.notes;

  // The create-time lifecycle kick is owned by provisionSessionSandbox. Do not
  // re-fire kickSandboxLifecycleWorkflow here, or it would double-fire for the
  // same provisioning run.

  const skills = await loadSessionSkills({
    sessionId: params.sessionId,
    sandboxState,
    sandbox,
  });

  return {
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
  };
}
