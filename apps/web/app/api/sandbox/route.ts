import { connectSandbox, type SandboxState } from "@open-agents/sandbox";
import { after } from "next/server";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  type SessionRecord,
} from "@/app/api/sessions/_lib/session-context";
import { checkBotProtection } from "@/lib/botid";
import { getGitHubUserProfile } from "@/lib/github/users";
import { updateSession } from "@/lib/db/sessions";
import { parseGitHubHttpsUrl } from "@/lib/github/urls";
import {
  getRepoAccessErrorStatus,
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import {
  mintInstallationToken,
  revokeInstallationToken,
  type ScopedInstallationToken,
} from "@/lib/github/app";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import { installGlobalSkills } from "@/lib/skills/global-skill-installer";
import { installSessionUserSkills } from "@/lib/skills/session-user-skills";
import {
  canOperateOnSandbox,
  clearSandboxState,
  getSessionSandboxName,
  hasResumableSandboxState,
  isSandboxActive,
} from "@/lib/sandbox/utils";
import { readWorkspaceRepoState } from "@/lib/sandbox/workspace-repo";
import { getServerSession } from "@/lib/session/get-server-session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
// import { buildDevelopmentDotenvFromVercelProject } from "@/lib/vercel/projects";
// import { getUserVercelToken } from "@/lib/vercel/token";

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  sessionId?: string;
  sandboxType?: "vercel";
}

// async function syncVercelProjectEnvVarsToSandbox(params: {
//   userId: string;
//   sessionRecord: SessionRecord;
//   sandbox: Awaited<ReturnType<typeof connectSandbox>>;
// }): Promise<void> {
//   if (!params.sessionRecord.vercelProjectId) {
//     return;
//   }
//
//   const token = await getUserVercelToken(params.userId);
//   if (!token) {
//     return;
//   }
//
//   const dotenvContent = await buildDevelopmentDotenvFromVercelProject({
//     token,
//     projectIdOrName: params.sessionRecord.vercelProjectId,
//     teamId: params.sessionRecord.vercelTeamId,
//   });
//   if (!dotenvContent) {
//     return;
//   }
//
//   await params.sandbox.writeFile(
//     `${params.sandbox.workingDirectory}/.env.local`,
//     dotenvContent,
//     "utf-8",
//   );
// }

async function installSessionGlobalSkills(params: {
  sessionRecord: SessionRecord;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  sandboxName: string | null;
}): Promise<void> {
  const globalSkillRefs = params.sessionRecord.globalSkillRefs ?? [];
  if (globalSkillRefs.length === 0) {
    return;
  }

  await installGlobalSkills({
    sandbox: params.sandbox,
    globalSkillRefs,
    observability: {
      sessionId: params.sessionRecord.id,
      sandboxName: params.sandboxName,
    },
  });
}

/**
 * Stops a sandbox that came up unusable so it is not left running and untracked.
 *
 * Best effort by design: the caller is already returning a failure, and failing
 * to stop is strictly better than turning a typed 409 into an unhandled 500.
 */
async function releaseUnusableSandbox({
  sandbox,
  sessionId,
}: {
  sandbox: { stop?: () => Promise<unknown> };
  sessionId: string | undefined;
}): Promise<void> {
  try {
    await sandbox.stop?.();
  } catch (error) {
    console.error("[sandbox] failed to release an unusable sandbox", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A repo-backed sandbox that has no clone is a failed provisioning, not a
 * ready workspace. Surface it as a typed 409 instead of a 200 carrying a
 * branch that is not checked out (issue #1053).
 */
function workspaceNotClonedResponse(sessionId: string): Response {
  console.warn("[sandbox] workspace-not-cloned", { sessionId });
  return Response.json(
    {
      error:
        "Sandbox is running but the repository was not cloned into the workspace.",
      reason: "workspace_not_cloned",
      errorKind: "conflict",
    },
    { status: 409 },
  );
}

function workspaceProbeFailedResponse(sessionId: string): Response {
  console.warn("[sandbox] workspace-probe-failed", { sessionId });
  return Response.json(
    {
      error:
        "Sandbox is running but the workspace git probe did not complete, so its repository state is unknown.",
      reason: "workspace_probe_failed",
      errorKind: "upstream_unavailable",
    },
    { status: 503 },
  );
}

function getErrorKind(error: unknown): string {
  if (error instanceof Error) {
    return error.name || "Error";
  }

  return typeof error;
}

function scheduleSandboxCreateBackgroundWork(
  callback: () => Promise<void>,
): void {
  after(callback);
}

function runBackgroundTask(params: {
  task: () => Promise<void>;
  onError: (error: unknown) => void;
}): void {
  scheduleSandboxCreateBackgroundWork(async () => {
    try {
      await params.task();
    } catch (error) {
      params.onError(error);
    }
  });
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json(
      { error: "Invalid sandbox type", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const { repoUrl, branch = "main", isNewBranch = false, sessionId } = body;

  if (!sessionId) {
    return Response.json(
      { error: "Missing sessionId", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  // Get session for auth
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json(
      { error: "Not authenticated", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json(
      { error: "Access denied", errorKind: "forbidden" },
      { status: 403 },
    );
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["sandbox-create", session.user.id]),
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  // Validate session ownership before minting any short-lived setup tokens.
  let sessionRecord: SessionRecord | undefined;
  const sessionContext = await requireOwnedSession({
    userId: session.user.id,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  sessionRecord = sessionContext.sessionRecord;

  const sandboxName = getSessionSandboxName(sessionId);
  const parsedRequestRepo = repoUrl ? parseGitHubHttpsUrl(repoUrl) : null;
  if (repoUrl && !parsedRequestRepo) {
    return Response.json(
      { error: "Invalid GitHub repository URL", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const activeSandboxState = sessionRecord.sandboxState;
  if (isSandboxActive(activeSandboxState)) {
    const reuseStart = Date.now();
    const expiresAt =
      typeof activeSandboxState.expiresAt === "number"
        ? activeSandboxState.expiresAt
        : reuseStart;

    let currentBranch: string | undefined;
    if (repoUrl) {
      const existing = await connectSandbox(activeSandboxState);
      const workspace = await readWorkspaceRepoState(existing);
      if (workspace.status === "unknown") {
        return workspaceProbeFailedResponse(sessionId);
      }
      if (workspace.status === "not_cloned") {
        return workspaceNotClonedResponse(sessionId);
      }
      currentBranch = workspace.branch;
    }

    const now = Date.now();
    return Response.json({
      createdAt: now,
      timeout: Math.max(0, expiresAt - now),
      currentBranch,
      mode: activeSandboxState.type,
      timing: { readyMs: now - reuseStart },
    });
  }

  const source = repoUrl
    ? {
        repo: repoUrl,
        branch: isNewBranch ? undefined : branch,
        newBranch: isNewBranch ? branch : undefined,
      }
    : undefined;

  // verify repo access (user permissions ∩ installation scope) and get
  // a repo-scoped read token for clone/setup when a repo is provided
  let setupToken: ScopedInstallationToken | undefined;

  if (repoUrl && parsedRequestRepo) {
    const access = await verifyRepoAccess({
      userId: session.user.id,
      owner: parsedRequestRepo.owner,
      repo: parsedRequestRepo.repo,
    });

    if (!access.ok) {
      return Response.json(
        {
          error: getRepoAccessErrorMessage(access.reason),
          reason: access.reason,
        },
        { status: getRepoAccessErrorStatus(access.reason) },
      );
    }

    setupToken = await mintInstallationToken({
      installationId: access.installationId,
      repositoryIds: [access.repositoryId],
      permissions: { contents: "read" },
    });
  }

  // ============================================
  // CREATE OR RESUME: Create a named persistent sandbox for this session.
  // ============================================
  const startTime = Date.now();

  let sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  try {
    const ghProfile = await getGitHubUserProfile(session.user.id);
    const githubNoreplyEmail =
      ghProfile?.externalUserId && ghProfile.username
        ? `${ghProfile.externalUserId}+${ghProfile.username}@users.noreply.github.com`
        : undefined;

    const gitUser = {
      name: session.user.name ?? ghProfile?.username ?? session.user.username,
      email:
        githubNoreplyEmail ??
        session.user.email ??
        `${session.user.username}@users.noreply.github.com`,
    };

    sandbox = await connectSandbox({
      state: {
        type: "vercel",
        ...(sandboxName ? { sandboxName } : {}),
        source,
      },
      options: {
        githubToken: setupToken?.token,
        gitUser,
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        vcpus: DEFAULT_SANDBOX_VCPUS,
        ports: DEFAULT_SANDBOX_PORTS,
        baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
        persistent: !!sandboxName,
        resume: !!sandboxName,
        createIfMissing: !!sandboxName,
      },
    });
  } finally {
    if (setupToken) {
      const token = setupToken.token;
      runBackgroundTask({
        task: () => revokeInstallationToken(token),
        onError: (error) => {
          console.warn("[sandbox] revoke-token-failed", {
            sessionId,
            errorKind: getErrorKind(error),
          });
        },
      });
    }
  }

  // A named sandbox that already existed is reconnected, not recreated, so the
  // requested source may never have been cloned. Confirm before reporting ready.
  let currentBranch: string | undefined;
  if (repoUrl) {
    const workspace = await readWorkspaceRepoState(sandbox);
    if (workspace.status !== "cloned") {
      // Returning here would leave a running VM that the session does not know
      // about: the record still holds the provisional state, so nothing will
      // ever reconnect to this sandbox or stop it, and sandbox duration is
      // billed. Release it before reporting the failure.
      await releaseUnusableSandbox({ sandbox, sessionId });
      return workspace.status === "unknown"
        ? workspaceProbeFailedResponse(sessionId)
        : workspaceNotClonedResponse(sessionId);
    }
    currentBranch = workspace.branch;
  }

  if (sessionId && sandbox.getState) {
    const nextState = sandbox.getState() as SandboxState;
    await updateSession(sessionId, {
      sandboxState: nextState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(
        sessionRecord?.lifecycleVersion,
      ),
      ...buildActiveLifecycleUpdate(nextState),
    });

    if (sessionRecord) {
      // TODO: Re-enable this once we have a solid exfiltration defense strategy.
      // try {
      //   await syncVercelProjectEnvVarsToSandbox({
      //     userId: session.user.id,
      //     sessionRecord,
      //     sandbox,
      //   });
      // } catch (error) {
      //   console.error(
      //     `Failed to sync Vercel env vars for session ${sessionRecord.id}:`,
      //     error,
      //   );
      // }

      const nextSandboxName = nextState.sandboxName ?? sandboxName ?? null;

      runBackgroundTask({
        task: async () => {
          await Promise.all([
            installSessionGlobalSkills({
              sessionRecord,
              sandbox,
              sandboxName: nextSandboxName,
            }),
            installSessionUserSkills({
              userId: session.user.id,
              sessionId: sessionRecord.id,
              sandboxName: nextSandboxName,
              sandbox,
              didSetupWorkspace: true,
            }),
          ]);
        },
        onError: (error) => {
          console.warn("[sandbox] session-skill-install-failed", {
            sessionId: sessionRecord.id,
            sandboxName: nextSandboxName,
            errorKind: getErrorKind(error),
          });
        },
      });
    }

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "sandbox-created",
    });
  }

  const readyMs = Date.now() - startTime;

  return Response.json({
    createdAt: Date.now(),
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    currentBranch,
    mode: "vercel",
    timing: { readyMs },
  });
}

export async function DELETE(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json(
      { error: "Access denied", errorKind: "forbidden" },
      { status: 403 },
    );
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["sandbox-delete", authResult.userId]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("sessionId" in body) ||
    typeof (body as Record<string, unknown>).sessionId !== "string"
  ) {
    return Response.json(
      { error: "Missing sessionId", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const { sessionId } = body as { sessionId: string };

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  // If there's no sandbox to stop, return success (idempotent)
  if (!canOperateOnSandbox(sessionRecord.sandboxState)) {
    return Response.json({ success: true, alreadyStopped: true });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  await sandbox.stop();

  const clearedState = clearSandboxState(sessionRecord.sandboxState);
  await updateSession(sessionId, {
    sandboxState: clearedState,
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleState:
      hasResumableSandboxState(clearedState) || !!sessionRecord.snapshotUrl
        ? "hibernated"
        : "provisioning",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  });

  return Response.json({ success: true });
}
