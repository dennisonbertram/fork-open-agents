import type { Dirent } from "node:fs";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SandboxType,
  SnapshotResult,
} from "./interface";
import type { VmDriver, VmHandle } from "./driver";
import type { ProxyRegistrar } from "./proxy/registrar";

/** Mirror of Vercel's MAX_OUTPUT_LENGTH (packages/sandbox/vercel/sandbox.ts:14). */
const MAX_OUTPUT_LENGTH = 50_000;
/** Mirror of Vercel's DETACHED_QUICK_FAILURE_WINDOW_MS (:20). */
const DETACHED_QUICK_FAILURE_WINDOW_MS = 2_000;

function truncateCommandOutput(output: string): {
  output: string;
  truncated: boolean;
} {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return { output, truncated: false };
  }
  return { output: output.slice(0, MAX_OUTPUT_LENGTH), truncated: true };
}

/**
 * Lifecycle state machine for a Hetzner sandbox.
 * active -> hibernating -> hibernated -> restoring -> active
 */
export type HetznerLifecycle =
  | "active"
  | "hibernating"
  | "hibernated"
  | "restoring";

/**
 * Persisted state returned by getState(). Shape mirrors the Vercel provider's
 * getState() requirements consumed by canOperateOnSandbox / lifecycle.ts:
 * it MUST carry `sandboxName` and (when live) `expiresAt`.
 */
export interface HetznerState {
  type: "hetzner";
  /** Stable sandbox name (== Vercel's sandboxName). */
  sandboxName: string;
  /** Underlying machine id (container id / hcloud server id). */
  machineId: string;
  /** Last snapshot id, if hibernated. */
  snapshotId?: string;
  lifecycle: HetznerLifecycle;
  workingDirectory: string;
  expiresAt?: number;
}

export interface HetznerSandboxOptions {
  sandboxId: string;
  driver: VmDriver;
  registrar: ProxyRegistrar;
  handle: VmHandle;
  workingDirectory: string;
  /** Wildcard base host, e.g. "lvh.me" or "sandbox.example.com". */
  wildcardBase: string;
  /** Scheme + optional host port for the proxy, e.g. "http" and 8088. */
  proxyScheme?: string;
  proxyPort?: number;
  env?: Record<string, string>;
  hooks?: SandboxHooks;
  /** Proactive timeout in ms (client-side, mirrors Vercel). */
  timeout?: number;
}

/**
 * HetznerSandbox — implements the real open-agents `Sandbox` interface on top
 * of a pluggable {@link VmDriver} and a {@link ProxyRegistrar}.
 *
 * Conformance to the real interface is asserted at compile time in
 * src/conformance.ts against ../../../packages/sandbox/interface.ts.
 *
 * Behavioral parity with packages/sandbox/vercel/sandbox.ts:
 *  - exec runs `bash -c 'cd "<cwd>" && <command>'` and truncates at 50_000 chars
 *  - timeouts return { success:false, exitCode:null, ... } (no throw)
 *  - execDetached returns { commandId } after a ~2s quick-failure probe
 *  - domain(port) returns a per-port subdomain URL
 *  - snapshot() marks the sandbox stopped and returns { snapshotId }
 *  - client-side timeout/expiresAt with an onTimeout hook
 */
export class HetznerSandbox implements Sandbox {
  readonly type: SandboxType = "cloud";
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly hooks?: SandboxHooks;
  readonly timeout?: number;

  private readonly sandboxId: string;
  private readonly driver: VmDriver;
  private readonly registrar: ProxyRegistrar;
  private handle: VmHandle;
  private readonly wildcardBase: string;
  private readonly proxyScheme: string;
  private readonly proxyPort?: number;

  private lifecycle: HetznerLifecycle = "active";
  private snapshotId?: string;
  private isStopped = false;
  private _expiresAt?: number;
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  /** Ports already registered with the proxy (for clean teardown). */
  private readonly exposedHosts = new Set<string>();
  private githubAuthToken?: string;

  constructor(opts: HetznerSandboxOptions) {
    this.sandboxId = opts.sandboxId;
    this.driver = opts.driver;
    this.registrar = opts.registrar;
    this.handle = opts.handle;
    this.workingDirectory = opts.workingDirectory;
    this.wildcardBase = opts.wildcardBase;
    this.proxyScheme = opts.proxyScheme ?? "http";
    this.proxyPort = opts.proxyPort;
    this.env = opts.env;
    this.hooks = opts.hooks;
    this.timeout = opts.timeout;

    if (opts.timeout !== undefined) {
      this._expiresAt = Date.now() + opts.timeout;
      this.scheduleTimeout();
    }
  }

  get expiresAt(): number | undefined {
    return this._expiresAt;
  }

  /** Base host for the sandbox (port 80 route), mirrors Vercel's `host`. */
  get host(): string | undefined {
    try {
      return new URL(this.domain(80)).host;
    } catch {
      return undefined;
    }
  }

  get environmentDetails(): string {
    const host = this.host;
    return host ? `\n- Sandbox host: ${host}` : "";
  }

  private getCommandEnv(): Record<string, string> {
    const env: Record<string, string> = { ...(this.env ?? {}) };
    if (this.githubAuthToken) {
      env.GITHUB_TOKEN = this.githubAuthToken;
      env.GH_TOKEN = this.githubAuthToken;
    }
    return env;
  }

  private scheduleTimeout(): void {
    if (this._expiresAt === undefined) return;
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    const msUntil = this._expiresAt - Date.now();
    if (msUntil <= 0) return;
    this.timeoutTimer = setTimeout(async () => {
      try {
        if (this.hooks?.onTimeout) {
          await this.hooks.onTimeout(this);
        }
      } catch (error) {
        console.error("[HetznerSandbox] onTimeout hook failed:", error);
      } finally {
        await this.stop().catch(() => {});
      }
    }, msUntil);
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    try {
      const res = await this.driver.exec(
        this.handle,
        command,
        cwd,
        timeoutMs,
        this.getCommandEnv(),
        options?.signal,
      );

      if (res.timedOut) {
        return {
          success: false,
          exitCode: null,
          stdout: "",
          stderr: `Command timed out after ${timeoutMs}ms`,
          truncated: false,
        };
      }

      const stdout = truncateCommandOutput(res.stdout);
      const stderr = truncateCommandOutput(res.stderr);
      return {
        success: res.exitCode === 0,
        exitCode: res.exitCode,
        stdout: stdout.output,
        stderr: stderr.output,
        truncated: stdout.truncated || stderr.truncated,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
      };
    }
  }

  async execDetached(
    command: string,
    cwd: string,
  ): Promise<{ commandId: string }> {
    const { commandId } = await this.driver.execDetached(
      this.handle,
      command,
      cwd,
      this.getCommandEnv(),
    );

    // Quick-failure probe: mirror Vercel's ~2s window. If the command's pid is
    // gone within the window AND it left a non-empty error log, surface it.
    await new Promise((r) => setTimeout(r, DETACHED_QUICK_FAILURE_WINDOW_MS));
    const probe = await this.driver.exec(
      this.handle,
      `pid=$(cat /tmp/poc-cmd-${commandId}.pid 2>/dev/null); ` +
        `if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then ` +
        `echo DEAD; cat /tmp/poc-cmd-${commandId}.log 2>/dev/null; fi`,
      "/",
      10_000,
      {},
    );
    if (probe.stdout.startsWith("DEAD")) {
      const stderr = probe.stdout.slice("DEAD".length).trim();
      throw new Error(
        `Background command exited early. stderr:\n${stderr.slice(0, MAX_OUTPUT_LENGTH) || "<no stderr>"}`,
      );
    }
    return { commandId };
  }

  async setGitHubAuthToken(token?: string): Promise<void> {
    this.githubAuthToken = token;
  }

  domain(port: number): string {
    const base = `${this.proxyScheme}://${this.sandboxId}-${port}.${this.wildcardBase}`;
    return this.proxyPort ? `${base}:${this.proxyPort}` : base;
  }

  /**
   * Expose a port: registers a wildcard-subdomain route on the proxy and
   * returns the public URL. Idempotent per (sandbox, port).
   */
  async exposePort(port: number): Promise<string> {
    const exposed = await this.driver.exposePort(this.handle, port);
    const host = `${this.sandboxId}-${port}.${this.wildcardBase}`;
    await this.registrar.register({
      host,
      backendAddress: exposed.backendAddress,
    });
    this.exposedHosts.add(host);
    return this.domain(port);
  }

  // ---- filesystem methods ----

  async readFile(path: string, _encoding: "utf-8"): Promise<string> {
    const buf = await this.driver.getFile(this.handle, path);
    return buf.toString("utf-8");
  }

  async readFileBuffer(path: string): Promise<Buffer> {
    return this.driver.getFile(this.handle, path);
  }

  async writeFile(
    path: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    await this.driver.putFile(this.handle, path, Buffer.from(content, "utf-8"));
  }

  async stat(path: string): Promise<SandboxStats> {
    const res = await this.driver.exec(
      this.handle,
      // %s size, %Y mtime seconds, %F type
      `stat -c '%s|%Y|%F' ${shellQuote(path)}`,
      "/",
      10_000,
      {},
    );
    if (res.exitCode !== 0) {
      throw new Error(`stat failed for ${path}: ${res.stderr}`);
    }
    const [sizeStr, mtimeStr, type] = res.stdout.trim().split("|");
    const isDir = type === "directory";
    return {
      isDirectory: () => isDir,
      isFile: () => type === "regular file" || type === "regular empty file",
      size: Number(sizeStr),
      mtimeMs: Number(mtimeStr) * 1000,
    };
  }

  async access(path: string): Promise<void> {
    const res = await this.driver.exec(
      this.handle,
      `test -e ${shellQuote(path)}`,
      "/",
      10_000,
      {},
    );
    if (res.exitCode !== 0) {
      throw new Error(`ENOENT: ${path}`);
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const flag = options?.recursive ? "-p " : "";
    const res = await this.driver.exec(
      this.handle,
      `mkdir ${flag}${shellQuote(path)}`,
      "/",
      10_000,
      {},
    );
    if (res.exitCode !== 0) {
      throw new Error(`mkdir failed for ${path}: ${res.stderr}`);
    }
  }

  async readdir(
    path: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    // Emit "name\ttype" lines; build minimal Dirent-compatible objects.
    const res = await this.driver.exec(
      this.handle,
      `for f in ${shellQuote(path)}/* ${shellQuote(path)}/.*; do ` +
        `[ -e "$f" ] || continue; ` +
        `n=$(basename "$f"); ` +
        `[ "$n" = "." ] || [ "$n" = ".." ] && continue; ` +
        `if [ -d "$f" ]; then echo "$n\td"; else echo "$n\tf"; fi; done`,
      "/",
      10_000,
      {},
    );
    if (res.exitCode !== 0) {
      throw new Error(`readdir failed for ${path}: ${res.stderr}`);
    }
    const entries: Dirent[] = [];
    for (const line of res.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [name, kind] = line.split("\t");
      const isDir = kind === "d";
      entries.push({
        name,
        parentPath: path,
        path,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
      } as Dirent);
    }
    return entries;
  }

  // ---- lifecycle ----

  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    if (this._expiresAt === undefined) {
      this._expiresAt = Date.now() + additionalMs;
    } else {
      this._expiresAt += additionalMs;
    }
    this.scheduleTimeout();
    if (this.hooks?.onTimeoutExtended) {
      await this.hooks.onTimeoutExtended(this, additionalMs).catch((e) =>
        console.error("[HetznerSandbox] onTimeoutExtended hook failed:", e),
      );
    }
    return { expiresAt: this._expiresAt };
  }

  /**
   * Snapshot: hibernate the sandbox.
   * active -> hibernating -> (snapshot) -> hibernated.
   * Mirrors Vercel: marks sandbox stopped, clears expiresAt, removes routes,
   * destroys the live machine. Returns { snapshotId }.
   */
  async snapshot(): Promise<SnapshotResult> {
    this.lifecycle = "hibernating";
    const { snapshotId } = await this.driver.snapshot(this.handle);
    this.snapshotId = snapshotId;

    // Remove proxy routes — a hibernated sandbox is not reachable.
    await this.removeAllRoutes();

    // Tear down the live machine; the snapshot is the durable artifact.
    await this.driver.destroy(this.handle).catch(() => {});

    this.isStopped = true;
    this._expiresAt = undefined;
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    this.lifecycle = "hibernated";
    return { snapshotId };
  }

  /**
   * Restore from the last snapshot: hibernated -> restoring -> active.
   * Provisions a fresh machine from the snapshot id and re-arms timeout.
   */
  async restore(timeout?: number): Promise<void> {
    if (!this.snapshotId) {
      throw new Error("restore() called with no snapshot");
    }
    this.lifecycle = "restoring";
    this.handle = await this.driver.restore(this.snapshotId, {
      sandboxId: this.sandboxId,
      workingDirectory: this.workingDirectory,
      env: this.env,
    });
    this.isStopped = false;
    this.lifecycle = "active";
    const t = timeout ?? this.timeout;
    if (t !== undefined) {
      this._expiresAt = Date.now() + t;
      this.scheduleTimeout();
    }
  }

  async stop(): Promise<void> {
    if (this.isStopped) return;
    this.isStopped = true;
    this._expiresAt = undefined;
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch (error) {
        console.error("[HetznerSandbox] beforeStop hook failed:", error);
      }
    }
    await this.removeAllRoutes();
    await this.driver.destroy(this.handle).catch(() => {});
  }

  private async removeAllRoutes(): Promise<void> {
    for (const host of this.exposedHosts) {
      await this.registrar.remove(host).catch(() => {});
    }
    this.exposedHosts.clear();
  }

  getState(): HetznerState {
    return {
      type: "hetzner",
      sandboxName: this.sandboxId,
      machineId: this.handle.id,
      ...(this.snapshotId ? { snapshotId: this.snapshotId } : {}),
      lifecycle: this.lifecycle,
      workingDirectory: this.workingDirectory,
      ...(this._expiresAt !== undefined ? { expiresAt: this._expiresAt } : {}),
    };
  }

  /** Diagnostic accessor for the eval harness. */
  getLifecycle(): HetznerLifecycle {
    return this.lifecycle;
  }
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}
