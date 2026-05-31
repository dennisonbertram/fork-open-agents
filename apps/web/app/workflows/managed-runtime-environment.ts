import type { Sandbox } from "@open-agents/sandbox";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";
import { emitSessionEvent } from "@/lib/observability/events";
import {
  appendManagedRuntimeSetupResult,
  appendManagedRuntimeVerificationResult,
  buildManagedRuntimeCommandObservation,
  finishManagedRuntimeProfileRun,
  startManagedRuntimeProfileRun,
} from "@/lib/observability/managed-runtime-profile-runs";
import type { WorkspaceStartupReporter } from "./workspace-startup-log";

type SessionRecord = {
  id: string;
  userId: string;
};

export class WorkspaceSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSetupError";
  }
}


function buildSetupStepMessage(params: {
  profile: ManagedRuntimeProfile;
  command: ManagedRuntimeProfile["setupCommands"][number];
  stepNumber: number;
  totalSteps: number;
}) {
  return [
    `Managed runtime profile setup (${params.stepNumber}/${params.totalSteps}): ${params.command.label}.`,
    `Profile: ${params.profile.displayName} (${params.profile.id}).`,
    params.command.description,
  ].join(" ");
}

function buildSetupScriptMessage(params: { profile: ManagedRuntimeProfile }) {
  return [
    `Managed runtime profile setup (1/1): Running setup script.`,
    `Profile: ${params.profile.displayName} (${params.profile.id}).`,
    `Running the profile setup script to install dependencies.`,
  ].join(" ");
}

function buildVerificationStepMessage(params: {
  profile: ManagedRuntimeProfile;
  command: ManagedRuntimeProfile["verificationCommands"][number];
  stepNumber: number;
  totalSteps: number;
}) {
  return [
    `Managed runtime profile verification (${params.stepNumber}/${params.totalSteps}): ${params.command.label}.`,
    `Profile: ${params.profile.displayName} (${params.profile.id}).`,
    params.command.description,
  ].join(" ");
}

export async function ensureManagedRuntimeEnvironment(params: {
  session: SessionRecord;
  chatId?: string | null;
  userId: string;
  workflowRunId?: string | null;
  sandbox: Sandbox;
  sandboxName?: string | null;
  profile: ManagedRuntimeProfile;
  startupReporter: WorkspaceStartupReporter;
  snapshotId?: string | null;
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
      snapshotId: params.snapshotId ?? null,
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

  // Per-session setup: run individual setupCommands, or fall back to setupScript
  // when setupCommands is empty but a setupScript is defined.
  if (profile.setupCommands.length > 0) {
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
        console.warn(
          `Managed runtime profile setup failed (${setupCommand.id}): ${observation.summary ?? "no output"}`,
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
            `Managed runtime profile setup failed while running ${setupCommand.label} for ${profile.displayName} (${profile.id}).`,
          );
        }
        return { notes, profileRunId };
      }
    }
  } else if (profile.setupScript) {
    // Decision B1: fall back to setupScript when setupCommands is empty
    const { setupScript } = profile;
    await params.startupReporter.send(buildSetupScriptMessage({ profile }), [
      `$ ${setupScript.command}`,
    ]);
    await emitSessionEvent({
      sessionId: params.session.id,
      chatId: params.chatId ?? null,
      userId: params.userId,
      source: "managed_runtime",
      actorType: "sandbox",
      eventName: "managed_runtime.profile.setup.command.started",
      status: "running",
      summary: `Setup script started for profile: ${profile.displayName}`,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      managedRuntimeProfileRunId: profileRunId ?? null,
      payload: {
        commandId: "setup-script",
        label: "Setup script",
        required: true,
        timeoutMs: setupScript.timeoutMs ?? 300_000,
      },
    });

    const commandStartedAt = new Date();
    let scriptResult: Awaited<ReturnType<typeof params.sandbox.exec>>;
    try {
      scriptResult = await params.sandbox.exec(
        setupScript.command,
        params.sandbox.workingDirectory,
        setupScript.timeoutMs ?? 300_000,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Unknown error: ${String(error)}`;
      throw new WorkspaceSetupError(
        `Managed runtime profile setup script failed for ${profile.displayName} (${profile.id}). Error: ${message}`,
      );
    }
    const commandFinishedAt = new Date();

    // Build a redacted observation the same way the setupCommands path does.
    // summarizeManagedRuntimeCommandOutput (called inside) applies
    // redactHarnessValue/redactSandboxLog so tokens and secrets in the raw
    // stdout/stderr are never persisted or emitted.
    const scriptObservation = buildManagedRuntimeCommandObservation({
      command: {
        id: "setup-script",
        label: "Setup script",
        description: "Profile setup script",
        command: setupScript.command,
        required: true,
      },
      status: scriptResult.success ? "passed" : "failed",
      startedAt: commandStartedAt,
      finishedAt: commandFinishedAt,
      result: scriptResult,
    });

    if (profileRunId) {
      try {
        await appendManagedRuntimeSetupResult({
          profileRunId,
          observation: scriptObservation,
        });
      } catch (error) {
        console.error(
          "[managed-runtime] Failed to append setup observation:",
          error,
        );
      }
    }

    await params.startupReporter.appendCommandResult({
      message: scriptResult.success
        ? `Managed runtime setup script passed.`
        : `Managed runtime setup script failed.`,
      command: setupScript.command,
      exitCode: scriptResult.exitCode,
      stdout: scriptResult.stdout,
      stderr: scriptResult.stderr,
    });

    await emitSessionEvent({
      sessionId: params.session.id,
      chatId: params.chatId ?? null,
      userId: params.userId,
      source: "managed_runtime",
      actorType: "sandbox",
      eventName: scriptResult.success
        ? "managed_runtime.profile.setup.command.succeeded"
        : "managed_runtime.profile.setup.command.failed",
      status: scriptResult.success ? "succeeded" : "failed",
      summary: scriptResult.success
        ? `Setup script passed for profile: ${profile.displayName}`
        : `Setup script failed for profile: ${profile.displayName}`,
      workflowRunId: params.workflowRunId ?? null,
      sandboxName: params.sandboxName ?? null,
      managedRuntimeProfileRunId: profileRunId ?? null,
      payload: scriptObservation,
    });

    if (!scriptResult.success) {
      notes.push(
        `Profile setup script failed. Verify the runtime profile before relying on its tools.`,
      );
      if (profileRunId) {
        try {
          await finishManagedRuntimeProfileRun({
            profileRunId,
            status: "failed",
            summary: `Profile setup script failed`,
            failureMessage: scriptObservation.summary,
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
        summary: `Managed runtime profile setup script failed`,
        workflowRunId: params.workflowRunId ?? null,
        sandboxName: params.sandboxName ?? null,
        managedRuntimeProfileRunId: profileRunId ?? null,
        payload: {
          commandId: "setup-script",
          summary: scriptObservation.summary,
        },
      });
      throw new WorkspaceSetupError(
        `Managed runtime profile setup script failed for ${profile.displayName} (${profile.id}).`,
      );
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
      if (profileRunId) {
        try {
          await finishManagedRuntimeProfileRun({
            profileRunId,
            status: "failed",
            summary: `Verification command threw: ${verificationCommand.label}`,
            failureMessage: `Verification exec threw an error: ${message}`,
          });
        } catch {
          // best-effort
        }
      }
      await emitSessionEvent({
        sessionId: params.session.id,
        chatId: params.chatId ?? null,
        userId: params.userId,
        source: "managed_runtime",
        actorType: "sandbox",
        eventName: "managed_runtime.profile.verify.command.failed",
        status: "failed",
        summary: `Verification command threw: ${verificationCommand.label}`,
        workflowRunId: params.workflowRunId ?? null,
        sandboxName: params.sandboxName ?? null,
        managedRuntimeProfileRunId: profileRunId ?? null,
        payload: { commandId: verificationCommand.id, error: message },
      });
      return { notes, profileRunId };
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
