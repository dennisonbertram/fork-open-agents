import "server-only";

import { connectSandbox } from "@open-agents/sandbox";
import type { SandboxState } from "@open-agents/sandbox";
import {
  buildSandboxState,
  getGitUser,
  installSessionGlobalSkills,
} from "@/app/workflows/chat-sandbox-runtime";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import {
  verifyRepoAccess,
  getRepoAccessErrorMessage,
} from "@/lib/github/access";
import {
  mintInstallationToken,
  revokeInstallationToken,
} from "@/lib/github/app";
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
import { isSandboxActive } from "@/lib/sandbox/utils";
import { installSessionUserSkills } from "@/lib/skills/session-user-skills";

function isSandboxState(value: unknown): value is SandboxState {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type: unknown }).type === "vercel"
  );
}

export type PrewarmResult =
  | { status: "prewarmed" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export async function prewarmSessionSandbox(params: {
  sessionId: string;
  userId: string;
}): Promise<PrewarmResult> {
  const { sessionId, userId } = params;

  // ── Guard: session existence ───────────────────────────────────────────────
  const session = await getSessionById(sessionId);
  if (!session) {
    return { status: "skipped", reason: "session-not-found" };
  }

  // ── Guard: ownership ───────────────────────────────────────────────────────
  if (session.userId !== userId) {
    return { status: "skipped", reason: "unauthorized" };
  }

  // ── Guard: archived ────────────────────────────────────────────────────────
  if (session.status === "archived") {
    return { status: "skipped", reason: "archived" };
  }

  // ── Guard: sandbox-free (no repo / null or non-vercel sandboxState) ────────
  if (!isSandboxState(session.sandboxState)) {
    return { status: "skipped", reason: "sandbox-free" };
  }

  // ── Guard: already-active (idempotent) ────────────────────────────────────
  if (isSandboxActive(session.sandboxState)) {
    return { status: "skipped", reason: "already-active" };
  }

  // ── Provisioning ───────────────────────────────────────────────────────────
  try {
    const gitUser = await getGitUser(userId);
    const sandboxInputState = buildSandboxState(session);

    let setupToken:
      | Awaited<ReturnType<typeof mintInstallationToken>>
      | undefined;

    if (session.cloneUrl) {
      if (!session.repoOwner || !session.repoName) {
        return { status: "failed", reason: "Session is missing repository metadata" };
      }

      const access = await verifyRepoAccess({
        userId,
        owner: session.repoOwner,
        repo: session.repoName,
      });

      if (!access.ok) {
        return {
          status: "failed",
          reason: getRepoAccessErrorMessage(access.reason),
        };
      }

      setupToken = await mintInstallationToken({
        installationId: access.installationId,
        repositoryIds: [access.repositoryId],
        permissions: { contents: "read" },
      });
    }

    let sandbox: Awaited<ReturnType<typeof connectSandbox>>;
    try {
      sandbox = await connectSandbox({
        state: sandboxInputState,
        options: {
          githubToken: setupToken?.token,
          gitUser,
          timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
          vcpus: DEFAULT_SANDBOX_VCPUS,
          ports: DEFAULT_SANDBOX_PORTS,
          baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
          persistent: true,
          resume: true,
          createIfMissing: true,
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

    await Promise.all([
      updateSession(sessionId, {
        sandboxState,
        snapshotUrl: null,
        snapshotCreatedAt: null,
        lifecycleVersion: getNextLifecycleVersion(session.lifecycleVersion),
        ...buildActiveLifecycleUpdate(sandboxState),
      }),
      installSessionGlobalSkills({
        session,
        sandbox,
        didSetupWorkspace: true,
      }),
      installSessionUserSkills({
        userId,
        sessionId,
        sandboxName: sandboxState.sandboxName ?? null,
        sandbox,
        didSetupWorkspace: true,
      }),
    ]);

    kickSandboxLifecycleWorkflow({ sessionId, reason: "sandbox-created" });

    return { status: "prewarmed" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during pre-warm";
    console.error(
      `[prewarm] Failed to pre-warm session ${sessionId}:`,
      error,
    );
    return { status: "failed", reason: message };
  }
}
