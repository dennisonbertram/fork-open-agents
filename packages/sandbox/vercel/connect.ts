import type { Sandbox, SandboxHooks } from "../interface";
import type { SandboxMeterAttribution } from "../meter";
import type { VercelSandboxConfig } from "./config";
import { VercelSandbox } from "./sandbox";
import type { VercelState } from "./state";

interface ConnectOptions {
  meter?: SandboxMeterAttribution;
  env?: Record<string, string>;
  githubToken?: string;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
  vcpus?: number;
  ports?: number[];
  baseSnapshotId?: string;
  resume?: boolean;
  createIfMissing?: boolean;
  persistent?: boolean;
  snapshotExpiration?: number;
  skipGitWorkspaceBootstrap?: boolean;
  cloneDepth?: number;
}

function getRemainingTimeout(
  expiresAt: number | undefined,
): number | undefined {
  if (!expiresAt) {
    return undefined;
  }

  const remaining = expiresAt - Date.now();
  return remaining > 10_000 ? remaining : undefined;
}

function getSandboxName(state: VercelState): string | undefined {
  if (typeof state.sandboxName === "string" && state.sandboxName.length > 0) {
    return state.sandboxName;
  }

  if (typeof state.sandboxId === "string" && state.sandboxId.length > 0) {
    return state.sandboxId;
  }

  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isSandboxNotFoundError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("status code 404") || message.includes("not found");
}

export function buildCreateConfig(
  state: VercelState,
  options?: ConnectOptions,
): VercelSandboxConfig {
  const sandboxName = getSandboxName(state);

  return {
    ...(sandboxName ? { name: sandboxName } : {}),
    ...(state.source
      ? {
          source: {
            url: state.source.repo,
            branch: state.source.branch,
            newBranch: state.source.newBranch,
          },
        }
      : {}),
    ...(state.snapshotId ? { restoreSnapshotId: state.snapshotId } : {}),
    ...(options?.meter ? { meter: options.meter } : {}),
    env: options?.env,
    githubToken: options?.githubToken,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.vcpus !== undefined && { vcpus: options.vcpus }),
    ...(options?.ports && { ports: options.ports }),
    ...(options?.baseSnapshotId && {
      baseSnapshotId: options.baseSnapshotId,
    }),
    ...(options?.persistent !== undefined && {
      persistent: options.persistent,
    }),
    ...(options?.snapshotExpiration !== undefined && {
      snapshotExpiration: options.snapshotExpiration,
    }),
    ...(options?.skipGitWorkspaceBootstrap && {
      skipGitWorkspaceBootstrap: true,
    }),
    ...(options?.cloneDepth !== undefined && {
      cloneDepth: options.cloneDepth,
    }),
  };
}

async function connectNamedSandbox(
  state: VercelState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const sandboxName = getSandboxName(state);
  if (!sandboxName) {
    throw new Error("Persistent sandbox name is required");
  }

  const remainingTimeout = getRemainingTimeout(state.expiresAt);

  try {
    return await VercelSandbox.connect(sandboxName, {
      env: options?.env,
      githubToken: options?.githubToken,
      hooks: options?.hooks,
      remainingTimeout,
      ports: options?.ports,
      resume: options?.resume,
      // Forwarded so a resumed sandbox — the common case once a session has
      // hibernated once — can open a billing span with a real size.
      meter: options?.meter,
      vcpus: options?.vcpus,
      // Carried through the resume path too: it is only applied at creation
      // otherwise, so every reconnect would leave the snapshot this sandbox
      // writes on stop unbounded.
      snapshotExpiration: options?.snapshotExpiration,
    });
  } catch (error) {
    if (!options?.createIfMissing || !isSandboxNotFoundError(error)) {
      throw error;
    }
  }

  return VercelSandbox.create(buildCreateConfig(state, options));
}

/**
 * Connect to the Vercel-backed cloud sandbox based on the provided state.
 *
 * - If `sandboxName` is present, reconnects to the named persistent sandbox
 * - If `snapshotId` is present without `sandboxName`, restores from a legacy snapshot
 * - If `source` is present, creates a new sandbox and prepares the repo
 * - Otherwise, creates an empty sandbox
 */
export async function connectVercel(
  state: VercelState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const sandboxName = getSandboxName(state);

  if (sandboxName) {
    return connectNamedSandbox(state, options);
  }

  return VercelSandbox.create(buildCreateConfig(state, options));
}
