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

  return {
    repo: session.cloneUrl,
    ...(shouldCreateNewBranch
      ? { newBranch: session.branch ?? undefined }
      : { branch: session.branch ?? "main" }),
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
