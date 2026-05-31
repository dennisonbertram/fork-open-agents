import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type {
  DriverExecResult,
  ExposedPort,
  VmCreateOptions,
  VmDriver,
  VmHandle,
  VmStatus,
} from "../driver";

/**
 * LocalDockerDriver — the EVAL stand-in for a Hetzner machine.
 *
 * Each sandbox == one Docker container. A container is the closest local
 * isolation boundary to a VM that exists on a macOS dev host without
 * KVM/Firecracker: separate PID/mount/network namespaces, its own filesystem,
 * its own loopback. It is NOT a true microVM (shared host kernel), and the
 * README is explicit that production isolation needs Firecracker. But every
 * VmDriver primitive maps cleanly onto Docker, which makes the *sandbox logic*
 * provable end-to-end here.
 *
 * Mapping:
 *   create        docker run -d ... (container joined to a shared user network)
 *   exec          docker exec
 *   execDetached  docker exec -d  (background process, returns a tracked id)
 *   putFile       docker exec sh -c 'cat > path'  (stdin pipe)
 *   getFile       docker exec cat path
 *   exposePort    container is on the proxy network -> "<name>:<port>"
 *   snapshot      docker commit  -> image tag
 *   restore       docker run from the committed image
 *   destroy       docker rm -f
 *   status        docker inspect
 */

const DOCKER = process.env.POC_DOCKER_BIN ?? "docker";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runDocker(
  args: string[],
  opts: { input?: Buffer; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(DOCKER, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf-8"),
        stderr: Buffer.concat(err).toString("utf-8"),
        timedOut,
      });
    });

    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/** Same as runDocker but returns raw stdout bytes (for getFile). */
function runDockerBuffer(args: string[]): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(DOCKER, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf-8") }),
    );
  });
}

export interface LocalDockerDriverOptions {
  /** Docker image used for sandbox containers. Must contain bash + coreutils. */
  image?: string;
  /** Shared Docker network the proxy and sandboxes share (for name routing). */
  network: string;
  /** Label applied to all POC resources for easy GC. */
  label?: string;
}

export class LocalDockerDriver implements VmDriver {
  readonly kind = "local-docker";
  private readonly image: string;
  private readonly network: string;
  private readonly label: string;

  constructor(opts: LocalDockerDriverOptions) {
    this.image = opts.image ?? "python:3.12-slim";
    this.network = opts.network;
    this.label = opts.label ?? "poc-hetzner-sandbox";
  }

  private containerName(sandboxId: string): string {
    return `sbx-${sandboxId}`;
  }

  async create(options: VmCreateOptions): Promise<VmHandle> {
    const name = this.containerName(options.sandboxId);
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(options.env ?? {})) {
      envArgs.push("-e", `${k}=${v}`);
    }
    // Long-lived container: sleep infinity keeps it alive for docker exec.
    const res = await runDocker([
      "run",
      "-d",
      "--name",
      name,
      "--hostname",
      name,
      "--network",
      this.network,
      "--label",
      `${this.label}=true`,
      "--label",
      `sandbox-id=${options.sandboxId}`,
      ...envArgs,
      this.image,
      "sleep",
      "infinity",
    ]);
    if (res.code !== 0) {
      throw new Error(`docker run failed: ${res.stderr || res.stdout}`);
    }
    await this.exec(
      { id: name, internalHost: name },
      `mkdir -p ${shellQuote(options.workingDirectory)}`,
      "/",
      30_000,
      {},
    );
    return { id: name, internalHost: name };
  }

  async exec(
    handle: VmHandle,
    command: string,
    cwd: string,
    timeoutMs: number,
    env: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<DriverExecResult> {
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(env)) {
      envArgs.push("-e", `${k}=${v}`);
    }
    // Mirror Vercel: bash -c 'cd "<cwd>" && <command>'.
    const res = await runDocker(
      [
        "exec",
        ...envArgs,
        handle.id,
        "bash",
        "-c",
        `cd "${cwd}" && ${command}`,
      ],
      { timeoutMs, signal },
    );
    return {
      exitCode: res.timedOut ? null : res.code,
      stdout: res.stdout,
      stderr: res.stderr,
      timedOut: res.timedOut,
    };
  }

  async execDetached(
    handle: VmHandle,
    command: string,
    cwd: string,
    env: Record<string, string>,
  ): Promise<{ commandId: string }> {
    const commandId = randomUUID();
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(env)) {
      envArgs.push("-e", `${k}=${v}`);
    }
    const logPath = `/tmp/poc-cmd-${commandId}.log`;
    // -d detaches the exec; nohup + redirect keeps the process and its output.
    const res = await runDocker([
      "exec",
      "-d",
      ...envArgs,
      handle.id,
      "bash",
      "-c",
      `cd "${cwd}" && nohup ${command} > ${logPath} 2>&1 & echo $! > /tmp/poc-cmd-${commandId}.pid`,
    ]);
    if (res.code !== 0) {
      throw new Error(`docker exec -d failed: ${res.stderr || res.stdout}`);
    }
    return { commandId };
  }

  async putFile(handle: VmHandle, path: string, content: Buffer): Promise<void> {
    // Stream bytes via stdin into `cat > path` — preserves exact bytes.
    const res = await runDocker(
      ["exec", "-i", handle.id, "sh", "-c", `cat > ${shellQuote(path)}`],
      { input: content },
    );
    if (res.code !== 0) {
      throw new Error(`putFile failed: ${res.stderr}`);
    }
  }

  async getFile(handle: VmHandle, path: string): Promise<Buffer> {
    const res = await runDockerBuffer(["exec", handle.id, "cat", path]);
    if (res.code !== 0) {
      throw new Error(`getFile failed (${res.code}): ${res.stderr}`);
    }
    return res.stdout;
  }

  async exposePort(handle: VmHandle, port: number): Promise<ExposedPort> {
    // The container is already on the proxy's network; Caddy can dial it by
    // container DNS name. No iptables needed in the Docker model — the
    // hcloud/Firecracker drivers do the DNAT/private-IP equivalent.
    return { backendAddress: `${handle.internalHost}:${port}` };
  }

  async snapshot(handle: VmHandle): Promise<{ snapshotId: string }> {
    // docker commit freezes the container's writable layer into an image.
    // This captures the FULL filesystem state (mirrors a disk snapshot). It
    // does NOT capture process memory — the documented gap vs Firecracker.
    const snapshotId = `poc-snap-${handle.id}-${Date.now()}`;
    const res = await runDocker(["commit", handle.id, snapshotId]);
    if (res.code !== 0) {
      throw new Error(`docker commit failed: ${res.stderr}`);
    }
    return { snapshotId };
  }

  async restore(
    snapshotId: string,
    options: VmCreateOptions,
  ): Promise<VmHandle> {
    const name = this.containerName(options.sandboxId);
    // Defensive: snapshot() destroys the live container, but a crashed run may
    // leave a stale one. Remove any leftover with this name before restoring.
    await runDocker(["rm", "-f", name]).catch(() => {});
    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(options.env ?? {})) {
      envArgs.push("-e", `${k}=${v}`);
    }
    const res = await runDocker([
      "run",
      "-d",
      "--name",
      name,
      "--hostname",
      name,
      "--network",
      this.network,
      "--label",
      `${this.label}=true`,
      "--label",
      `sandbox-id=${options.sandboxId}`,
      ...envArgs,
      snapshotId,
      "sleep",
      "infinity",
    ]);
    if (res.code !== 0) {
      throw new Error(`docker run (restore) failed: ${res.stderr}`);
    }
    return { id: name, internalHost: name };
  }

  async destroy(handle: VmHandle): Promise<void> {
    await runDocker(["rm", "-f", handle.id]).catch(() => {});
  }

  async status(handle: VmHandle): Promise<VmStatus> {
    const res = await runDocker([
      "inspect",
      "-f",
      "{{.State.Status}}",
      handle.id,
    ]);
    if (res.code !== 0) return "destroyed";
    const s = res.stdout.trim();
    if (s === "running") return "running";
    if (s === "exited" || s === "dead") return "stopped";
    if (s === "created") return "creating";
    return "destroyed";
  }
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}
