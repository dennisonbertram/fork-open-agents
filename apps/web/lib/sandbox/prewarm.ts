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
  SANDBOX_SNAPSHOT_EXPIRATION_MS,
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
    const sandboxInputState = buildSandboxState(session);

    type AccessOutcome =
      | {
          ok: true;
          setupToken:
            | Awaited<ReturnType<typeof mintInstallationToken>>
            | undefined;
        }
      | { ok: false; result: PrewarmResult };

    const resolveAccessAndToken = async (): Promise<AccessOutcome> => {
      if (!session.cloneUrl) {
        return { ok: true, setupToken: undefined };
      }

      if (!session.repoOwner || !session.repoName) {
        return {
          ok: false,
          result: {
            status: "failed",
            reason: "Session is missing repository metadata",
          },
        };
      }

      const access = await verifyRepoAccess({
        userId,
        owner: session.repoOwner,
        repo: session.repoName,
      });

      if (!access.ok) {
        return {
          ok: false,
          result: {
            status: "failed",
            reason: getRepoAccessErrorMessage(access.reason),
          },
        };
      }

      const setupToken = await mintInstallationToken({
        installationId: access.installationId,
        repositoryIds: [access.repositoryId],
        permissions: { contents: "read" },
      });

      return { ok: true, setupToken };
    };

    // getGitUser has no dependency on repo access / token minting, so run it
    // concurrently with that chain instead of waiting on it first.
    const [gitUser, accessOutcome] = await Promise.all([
      getGitUser(userId),
      resolveAccessAndToken(),
    ]);

    if (!accessOutcome.ok) {
      return accessOutcome.result;
    }

    const setupToken = accessOutcome.setupToken;

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
          snapshotExpiration: SANDBOX_SNAPSHOT_EXPIRATION_MS,
          persistent: true,
          resume: true,
          createIfMissing: true,
          ...(session.fullClone ? { cloneDepth: 0 } : {}),
        },
      });
    } finally {
      if (setupToken) {
        void revokeInstallationToken(setupToken.token).catch((err) => {
          console.error("[prewarm] Failed to revoke setup token:", err);
        });
      }
    }

    const rawSandboxState = sandbox.getState?.();
    const sandboxState = isSandboxState(rawSandboxState)
      ? rawSandboxState
      : sandboxInputState;

    // #1399: persist operable sandboxState BEFORE skill installs. A rejected
    // install must not prevent the DB from recording the live VM (otherwise
    // lifecycle hibernation cannot find it and the box orphans).
    await updateSession(sessionId, {
      sandboxState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(session.lifecycleVersion),
      ...buildActiveLifecycleUpdate(sandboxState),
    });

    const installResults = await Promise.allSettled([
      installSessionGlobalSkills({
        session,
        sandbox,
        // Skip the expensive per-skill `npx skills add` reinstall when the
        // sandbox was resumed from a snapshot that already contains them.
        // Fall back to installing when the backend cannot report wasCreated.
        didSetupWorkspace: sandbox.wasCreated ?? true,
      }),
      installSessionUserSkills({
        userId,
        sessionId,
        sandboxName: sandboxState.sandboxName ?? null,
        sandbox,
        didSetupWorkspace: true,
      }),
    ]);

    const installSkillIds = ["global", "user"] as const;
    for (let i = 0; i < installResults.length; i++) {
      const result = installResults[i];
      // installSessionGlobalSkills reports failure via its result value
      // (ok:false) instead of rejecting; installSessionUserSkills rejects.
      const failed =
        result.status === "rejected" ||
        (result.status === "fulfilled" &&
          typeof result.value === "object" &&
          result.value !== null &&
          (result.value as { ok?: boolean }).ok === false);
      if (failed) {
        console.warn(
          JSON.stringify({
            service: "sandbox-lifecycle",
            event: "prewarm.install_failed_state_preserved",
            sessionId,
            sandboxName: sandboxState.sandboxName ?? null,
            skillId: installSkillIds[i],
            errorKind: "skill_install_failed",
          }),
        );
      }
    }

    kickSandboxLifecycleWorkflow({ sessionId, reason: "sandbox-created" });

    return { status: "prewarmed" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during pre-warm";
    console.error(`[prewarm] Failed to pre-warm session ${sessionId}:`, error);
    return { status: "failed", reason: message };
  }
}
