/**
 * VmDriver — the pluggable compute backend behind {@link HetznerSandbox}.
 *
 * A driver hides *how* a sandbox is realized (a Docker container locally, a
 * Hetzner Cloud server in production, or — at scale — a Firecracker microVM on
 * a Hetzner dedicated box). The {@link HetznerSandbox} class implements the real
 * open-agents `Sandbox` interface purely in terms of these primitives, so the
 * same sandbox logic runs unchanged on every backend.
 *
 * The method set is deliberately the minimal superset required by the
 * `Sandbox` interface plus port exposure and snapshot/restore:
 *
 *   create        provision an isolated machine, return its handle
 *   exec          run a command to completion, return stdout/stderr/exit code
 *   execDetached  start a background command, return an opaque id
 *   putFile       write bytes to a path inside the machine
 *   getFile       read bytes from a path inside the machine
 *   exposePort    make an internal port reachable; returns a routable backend addr
 *   snapshot      checkpoint the machine's filesystem, return a snapshot id
 *   restore       create a new machine from a snapshot id
 *   destroy       tear the machine down and release resources
 *   status        report the lifecycle status of the machine
 */

export type VmStatus =
  | "creating"
  | "running"
  | "stopped"
  | "snapshotting"
  | "restoring"
  | "destroyed";

/** Opaque handle returned by {@link VmDriver.create}/{@link VmDriver.restore}. */
export interface VmHandle {
  /** Stable id of the underlying machine (container id / hcloud server id). */
  id: string;
  /**
   * Network address the proxy uses to reach this machine on the internal
   * network. For Docker this is the container DNS name; for hcloud it is the
   * server's private IP.
   */
  internalHost: string;
}

/** Raw command result from a driver (truncation/ExecResult shaping happens in the sandbox layer). */
export interface DriverExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True only when the driver itself timed out the command. */
  timedOut: boolean;
}

export interface ExposedPort {
  /** Address the reverse proxy should target, e.g. "container-name:3000". */
  backendAddress: string;
}

export interface VmCreateOptions {
  /** Stable sandbox id; the driver should derive a deterministic machine name from it. */
  sandboxId: string;
  /** Working directory to create/ensure inside the machine. */
  workingDirectory: string;
  /** Environment variables that should be present for every exec. */
  env?: Record<string, string>;
}

export interface VmDriver {
  readonly kind: string;
  create(options: VmCreateOptions): Promise<VmHandle>;
  exec(
    handle: VmHandle,
    command: string,
    cwd: string,
    timeoutMs: number,
    env: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<DriverExecResult>;
  execDetached(
    handle: VmHandle,
    command: string,
    cwd: string,
    env: Record<string, string>,
  ): Promise<{ commandId: string }>;
  putFile(handle: VmHandle, path: string, content: Buffer): Promise<void>;
  getFile(handle: VmHandle, path: string): Promise<Buffer>;
  exposePort(handle: VmHandle, port: number): Promise<ExposedPort>;
  snapshot(handle: VmHandle): Promise<{ snapshotId: string }>;
  restore(
    snapshotId: string,
    options: VmCreateOptions,
  ): Promise<VmHandle>;
  destroy(handle: VmHandle): Promise<void>;
  status(handle: VmHandle): Promise<VmStatus>;
}
