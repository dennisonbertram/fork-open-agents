import { discoverSkills } from "@open-agents/agent";
import {
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from "@open-agents/sandbox";
import { getManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";
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
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

export type ResolvedChatSandboxRuntime = {
  sandboxState: SandboxState;
  runtimeMode: SessionRecord["runtimeMode"];
  managedRuntime?: {
    profileId: string;
    profileVersion: string;
    profileDisplayName: string;
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

async function getGitUser(userId: string) {
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

async function installSessionGlobalSkills(params: {
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

async function ensureManagedRuntimeEnvironment(params: {
  sandbox: Sandbox;
}): Promise<string[]> {
  const notes: string[] = [];
  const profile = getManagedRuntimeProfile();

  await sendWorkspaceStatus({
    status: "setting-up",
    message: `Managed runtime selected. Preparing profile ${profile.displayName}...`,
  });

  for (const setupCommand of profile.setupCommands) {
    await sendWorkspaceStatus({
      status: "setting-up",
      message: `Managed runtime profile setup: ${setupCommand.label}...`,
    });

    const result = await params.sandbox.exec(
      setupCommand.command,
      params.sandbox.workingDirectory,
      setupCommand.timeoutMs ?? 120_000,
    );

    if (!result.success) {
      const summary = [result.stderr, result.stdout]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .join("\n");
      console.warn(
        `Managed runtime profile setup failed (${setupCommand.id}): ${summary}`,
      );
      notes.push(
        `Profile setup failed: ${setupCommand.label}. Verify the runtime profile before relying on its tools.`,
      );
      await sendWorkspaceStatus({
        status: "setting-up",
        message: `Managed runtime is active, but profile setup failed: ${setupCommand.label}.`,
      });
      return notes;
    }
  }

  for (const verificationCommand of profile.verificationCommands) {
    const result = await params.sandbox.exec(
      verificationCommand.command,
      params.sandbox.workingDirectory,
      verificationCommand.timeoutMs ?? 30_000,
    );

    if (result.success) {
      notes.push(`Verified: ${verificationCommand.label}.`);
      continue;
    }

    if (verificationCommand.required === false) {
      notes.push(`Optional tool unavailable: ${verificationCommand.label}.`);
      continue;
    }

    notes.push(
      `Required profile verification failed: ${verificationCommand.label}.`,
    );
    await sendWorkspaceStatus({
      status: "setting-up",
      message: `Managed runtime is active, but verification failed: ${verificationCommand.label}.`,
    });
    return notes;
  }

  await sendWorkspaceStatus({
    status: "setting-up",
    message: `Managed runtime profile is ready: ${profile.displayName}.`,
  });
  return notes;
}

export async function resolveChatSandboxRuntime(params: {
  userId: string;
  sessionId: string;
  assistantId: string;
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

  const didSetupWorkspace = !isSandboxActive(session.sandboxState);
  if (didSetupWorkspace) {
    await sendWorkspaceStatus({
      status: "setting-up",
      message: "Setting up the workspace...",
    });
  }

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

    setupToken = await mintInstallationToken({
      installationId: access.installationId,
      repositoryIds: [access.repositoryId],
      permissions: { contents: "read" },
    });
  }

  let sandbox: Sandbox;
  try {
    sandbox = await connectSandbox({
      state: buildSandboxState(session),
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
    : buildSandboxState(session);

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
  ]);

  const managedRuntimeProfile =
    session.runtimeMode === "managed_runtime"
      ? getManagedRuntimeProfile()
      : undefined;
  const managedRuntimeNotes =
    session.runtimeMode === "managed_runtime"
      ? await ensureManagedRuntimeEnvironment({ sandbox })
      : [];

  kickSandboxLifecycleWorkflow({
    sessionId: params.sessionId,
    reason: "sandbox-created",
  });

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
            sandboxName: sandboxState.sandboxName,
          },
        }
      : {}),
    workingDirectory: sandbox.workingDirectory,
    currentBranch: sandbox.currentBranch,
    environmentDetails:
      session.runtimeMode === "managed_runtime"
        ? `${sandbox.environmentDetails}\n\n# Managed Runtime\n\n- Runtime mode: managed runtime.\n- The user selected managed runtime for this session. Make that explicit in status updates and final verification notes when runtime behavior matters.\n- Managed runtime service previews, service logs, and browser checks are available from the app UI for local web apps.\n- Managed runtime uses a profile-specific setup step. Do not assume Node, npm, Bun, Python, or any other tool exists unless the active profile verifies it.\n${managedRuntimeNotes.map((note) => `- ${note}`).join("\n")}`
        : sandbox.environmentDetails,
    skills,
    didSetupWorkspace,
    sessionTitle: session.title,
    repoOwner: session.repoOwner ?? undefined,
    repoName: session.repoName ?? undefined,
  };
}
