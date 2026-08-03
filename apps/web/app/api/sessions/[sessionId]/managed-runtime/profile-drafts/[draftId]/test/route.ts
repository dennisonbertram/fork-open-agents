import { connectSandbox } from "@open-agents/sandbox";
import type {
  ManagedRuntimeProfile,
  ManagedRuntimeProfileCommand,
} from "@open-agents/sandbox/managed-runtime-profiles";
import { z } from "zod";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import {
  finishManagedRuntimeProfileDraftTest,
  getManagedRuntimeProfileDraft,
  markManagedRuntimeProfileDraftTesting,
  toManagedRuntimeProfileDraftSnapshot,
} from "@/lib/db/managed-runtime-profile-drafts";
import type {
  ManagedRuntimeCommandObservation,
  ManagedRuntimeProfileDraftData,
} from "@/lib/db/schema";
import { updateSession } from "@/lib/db/sessions";
import type { ManagedRuntimeErrorKind } from "@/lib/managed-runtime/profile-run-status";
import { nextActionFor } from "@/lib/managed-runtime/profile-run-status";
import { buildManagedRuntimeCommandObservation } from "@/lib/observability/managed-runtime-profile-runs";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearUnavailableSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string; draftId: string }>;
};

type CommandResultLike = {
  success: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const testModeSchema = z
  .object({
    mode: z.enum(["verify", "setup_and_verify"]).default("verify"),
  })
  .default({ mode: "verify" });

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return auth.response;
  }

  const parsedBody = await parseTestMode(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const { sessionId, draftId } = await context.params;
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: auth.userId,
    sessionId,
    sandboxGuard: hasRuntimeSandboxState,
    sandboxErrorMessage:
      "Resume the sandbox before testing managed runtime profile drafts.",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const draft = await getManagedRuntimeProfileDraft({
    userId: auth.userId,
    sessionId,
    draftId,
  });
  if (!draft) {
    return Response.json(
      { error: "Profile draft not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  const sandboxState = sessionContext.sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json(
      {
        error:
          "Resume the sandbox before testing managed runtime profile drafts.",
        errorKind: "conflict",
      },
      { status: 409 },
    );
  }

  await markManagedRuntimeProfileDraftTesting({
    userId: auth.userId,
    sessionId,
    draftId,
  });

  try {
    const sandbox = await connectSandbox(sandboxState);
    const profile = profileFromDraft(draft.id, draft.profileDraft);
    const { observations, failureMessage, failedCommand, errorKind } =
      await runDraftTest({
        profile,
        mode: parsedBody.mode,
        exec: (commandText, timeoutMs) =>
          sandbox.exec(
            commandText,
            sandbox.workingDirectory,
            timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
          ),
      });

    const updatedDraft = await finishManagedRuntimeProfileDraftTest({
      userId: auth.userId,
      sessionId,
      draftId,
      status: failureMessage ? "needs_changes" : "tested",
      testResults: observations,
      testFailureMessage: failureMessage,
      testScope: parsedBody.mode,
    });

    if (!updatedDraft) {
      return Response.json(
        { error: "Profile draft not found", errorKind: "not_found" },
        { status: 404 },
      );
    }

    return Response.json({
      draft: {
        ...toManagedRuntimeProfileDraftSnapshot(updatedDraft),
        testScope: updatedDraft.lastTestScope ?? parsedBody.mode,
        ...(errorKind
          ? {
              errorKind,
              failureMessage,
              failedCommandLabel: failedCommand?.label,
              nextAction: nextActionFor(errorKind),
            }
          : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearUnavailableSandboxState(
          sessionContext.sessionRecord.sandboxState,
          message,
        ),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        {
          error: "Sandbox is unavailable. Please resume sandbox.",
          errorKind: "conflict",
        },
        { status: 409 },
      );
    }

    const updatedDraft = await finishManagedRuntimeProfileDraftTest({
      userId: auth.userId,
      sessionId,
      draftId,
      status: "needs_changes",
      testResults: [],
      testFailureMessage: message,
      testScope: parsedBody.mode,
    });

    return Response.json(
      {
        draft: updatedDraft
          ? {
              ...toManagedRuntimeProfileDraftSnapshot(updatedDraft),
              testScope: parsedBody.mode,
              errorKind: "setup_exec_error" satisfies ManagedRuntimeErrorKind,
              failureMessage: message,
              nextAction: nextActionFor("setup_exec_error"),
            }
          : undefined,
        error: "Failed to test managed runtime profile draft",
      },
      { status: 500 },
    );
  }
}

async function parseTestMode(req: Request): Promise<
  | {
      ok: true;
      mode: "verify" | "setup_and_verify";
    }
  | {
      ok: false;
      response: Response;
    }
> {
  let rawBody: unknown = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      rawBody = await req.json();
    } catch {
      return {
        ok: false,
        response: Response.json(
          { error: "Invalid JSON body", errorKind: "invalid_request" },
          { status: 400 },
        ),
      };
    }
  }

  const parsed = testModeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: Response.json(
        {
          error: "Invalid managed runtime profile test mode",
          errorKind: "invalid_request",
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, mode: parsed.data.mode };
}

function profileFromDraft(
  draftId: string,
  draft: ManagedRuntimeProfileDraftData,
): ManagedRuntimeProfile {
  return {
    id: `draft-${draftId}`,
    version: "draft",
    displayName: draft.displayName,
    description: draft.description,
    setupCommands: draft.setupCommands,
    verificationCommands: draft.verificationCommands,
    expectedTools: draft.expectedTools,
    optionalTools: draft.optionalTools,
    defaultPorts: draft.defaultPorts,
  };
}

function getCommandsForMode(
  profile: ManagedRuntimeProfile,
  mode: "verify" | "setup_and_verify",
): ManagedRuntimeProfileCommand[] {
  return mode === "setup_and_verify"
    ? [...profile.setupCommands, ...profile.verificationCommands]
    : profile.verificationCommands;
}

/**
 * Unified required-command-failure loop semantics (#814): a required
 * command failure stops the run in BOTH `verify` and `setup_and_verify`
 * modes, mirroring the saved-profile test route.
 */
async function runDraftTest(params: {
  profile: ManagedRuntimeProfile;
  mode: "verify" | "setup_and_verify";
  exec: (
    command: string,
    timeoutMs: number | undefined,
  ) => Promise<CommandResultLike>;
}): Promise<{
  observations: ManagedRuntimeCommandObservation[];
  failureMessage: string | null;
  failedCommand: ManagedRuntimeProfileCommand | null;
  errorKind: ManagedRuntimeErrorKind | null;
}> {
  const observations: ManagedRuntimeCommandObservation[] = [];
  let failureMessage: string | null = null;
  let failedCommand: ManagedRuntimeProfileCommand | null = null;
  let errorKind: ManagedRuntimeErrorKind | null = null;
  const setupCommandIds = new Set(
    params.profile.setupCommands.map((command) => command.id),
  );

  for (const command of getCommandsForMode(params.profile, params.mode)) {
    const startedAt = new Date();
    const result = await runDraftTestCommand({
      command,
      exec: params.exec,
    });
    const finishedAt = new Date();
    const status = result.success ? "passed" : "failed";
    const observation = buildManagedRuntimeCommandObservation({
      command,
      status,
      startedAt,
      finishedAt,
      result,
    });
    observations.push(observation);

    if (!result.success && command.required !== false && !failureMessage) {
      failureMessage = `${command.label} failed.`;
      failedCommand = command;
      errorKind = setupCommandIds.has(command.id)
        ? "setup_command_failed"
        : "verification_failed";
      break;
    }
  }

  return { observations, failureMessage, failedCommand, errorKind };
}

async function runDraftTestCommand(params: {
  command: ManagedRuntimeProfileCommand;
  exec: (
    command: string,
    timeoutMs: number | undefined,
  ) => Promise<CommandResultLike>;
}): Promise<CommandResultLike> {
  try {
    return await params.exec(params.command.command, params.command.timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      throw error;
    }
    return {
      success: false,
      exitCode: null,
      stderr: message,
    };
  }
}
