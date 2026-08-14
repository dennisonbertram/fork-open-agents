import type { SandboxState } from "@open-agents/sandbox";

export class WorkspaceSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSetupError";
  }
}

export type {
  ResolvedChatSandboxRuntime,
  SandboxBackedRuntime,
  SandboxFreeRuntime,
} from "./chat-sandbox-runtime-impl";

type ResolveChatSandboxRuntimeParams = Parameters<
  typeof import("./chat-sandbox-runtime-impl").resolveChatSandboxRuntime
>[0];

type BuildSandboxStateSession = {
  id: string;
  branch: string | null;
  // The branch a new working `branch` was cut from (#1251). Only read when
  // isNewBranch is true; absent/null preserves today's behavior (clone at
  // the repository's default HEAD, same as before this field existed).
  baseBranch?: string | null;
  cloneUrl: string | null;
  isNewBranch: boolean;
  prNumber: number | null;
  sandboxState: unknown;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSandboxState(value: unknown): value is SandboxState {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "vercel"
  );
}

function getResumableSandboxName(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const sandboxName = (state as { sandboxName?: unknown }).sandboxName;
  if (hasNonEmptyString(sandboxName)) {
    return sandboxName;
  }

  const sandboxId = (state as { sandboxId?: unknown }).sandboxId;
  return hasNonEmptyString(sandboxId) ? sandboxId : null;
}

function buildSandboxSource(
  session: BuildSandboxStateSession,
): SandboxState["source"] {
  if (!session.cloneUrl) {
    return undefined;
  }

  const branchExistsOnOrigin = session.prNumber != null;
  const shouldCreateNewBranch = session.isNewBranch && !branchExistsOnOrigin;

  if (shouldCreateNewBranch) {
    return {
      repo: session.cloneUrl,
      newBranch: session.branch ?? undefined,
      // #1251: clone at the base the caller asked to start from, so the new
      // working branch is cut from it rather than the repository's default
      // HEAD. No base recorded (a pre-#1251 session, or one where neither
      // the caller nor repo settings named a branch) falls through to
      // source.branch being omitted — the sandbox layer's own existing
      // default (repository HEAD) applies, unchanged from before this field
      // existed.
      ...(session.baseBranch ? { branch: session.baseBranch } : {}),
    };
  }

  return {
    repo: session.cloneUrl,
    // ponytail: literal "main" fallback for the rare case a repo-backed
    // session has no branch at all (isNewBranch: false, no caller branch, no
    // repo-settings default branch — create-session.ts's own precedence
    // chain already covers the common case via repoDefaults.defaultBranch).
    // A real per-repo lookup here would make this function async and thread
    // a GitHub token through both of buildSandboxSource's call sites
    // (prewarm.ts and the workflow VM path) for a fallback that should
    // already be rare; upgrade if it turns out not to be.
    branch: session.branch ?? "main",
  };
}

export async function resolveChatSandboxRuntime(
  params: ResolveChatSandboxRuntimeParams,
): Promise<
  Awaited<
    ReturnType<
      typeof import("./chat-sandbox-runtime-impl").resolveChatSandboxRuntime
    >
  >
> {
  "use step";
  const { resolveChatSandboxRuntime: resolveRuntime } =
    await import("./chat-sandbox-runtime-impl");
  return resolveRuntime(params);
}

export function buildSandboxState(
  session: BuildSandboxStateSession,
): SandboxState {
  const existingState = session.sandboxState;
  const sandboxName =
    getResumableSandboxName(existingState) ?? `session_${session.id}`;
  const source = buildSandboxSource(session);

  return {
    type: "vercel",
    ...(isSandboxState(existingState) ? existingState : {}),
    sandboxName,
    ...(source ? { source } : {}),
  };
}

export async function getGitUser(
  userId: string,
): Promise<
  Awaited<ReturnType<typeof import("./chat-sandbox-runtime-impl").getGitUser>>
> {
  "use step";
  const { getGitUser: loadGitUser } =
    await import("./chat-sandbox-runtime-impl");
  return loadGitUser(userId);
}

export async function installSessionGlobalSkills(
  params: Parameters<
    typeof import("./chat-sandbox-runtime-impl").installSessionGlobalSkills
  >[0],
): Promise<
  Awaited<
    ReturnType<
      typeof import("./chat-sandbox-runtime-impl").installSessionGlobalSkills
    >
  >
> {
  "use step";
  const { installSessionGlobalSkills: installSkills } =
    await import("./chat-sandbox-runtime-impl");
  return installSkills(params);
}

export async function loadSessionSkills(
  params: Parameters<
    typeof import("./chat-sandbox-runtime-impl").loadSessionSkills
  >[0],
): Promise<
  Awaited<
    ReturnType<typeof import("./chat-sandbox-runtime-impl").loadSessionSkills>
  >
> {
  "use step";
  const { loadSessionSkills: loadSkills } =
    await import("./chat-sandbox-runtime-impl");
  return loadSkills(params);
}
