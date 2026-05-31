import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  DriverExecResult,
  ExposedPort,
  VmCreateOptions,
  VmDriver,
  VmHandle,
  VmStatus,
} from "../driver";
import { HcloudClient } from "./hcloud-client";

/**
 * HcloudDriver — PRODUCTION driver (Architecture A from RESEARCH.md).
 *
 * Provisions one Hetzner Cloud server per sandbox via the hcloud REST API,
 * bootstraps it with cloud-init (SSH key + sshd ready), polls until SSH is
 * reachable, and runs commands over SSH. Snapshot uses hcloud `create_image`;
 * stop() DELETES the server (RESEARCH.md Gap 3: stopped servers still bill, so
 * the lifecycle event that ends billing is delete, not power-off).
 *
 * This code is REAL and runnable once HCLOUD_TOKEN + an SSH key are present.
 * It does NOT run live in this environment (no token). It is exercised against
 * a local mock of the hcloud API (test/hcloud-driver.test.ts) which asserts the
 * exact create payload, the poll-until-running loop, snapshot image creation,
 * and delete-on-stop.
 *
 * RESEARCH.md recommends Firecracker-on-dedicated (Arch B) for production scale;
 * see README "Recommended scale-out". The HcloudDriver is the simpler,
 * API-driven, most-testable path and the right first step.
 */

export interface HcloudDriverConfig {
  token: string;
  /** OS image slug, e.g. "ubuntu-24.04". */
  image?: string;
  /** Server type slug, e.g. "cx23" (x86) or "cax11" (ARM). */
  serverType?: string;
  /** Datacenter location, e.g. "nbg1" | "fsn1" | "hel1". */
  location?: string;
  /** Names/ids of SSH keys already registered in the hcloud project. */
  sshKeys?: Array<string | number>;
  /** Public SSH key to inject via cloud-init if no project key is used. */
  sshPublicKey?: string;
  /** Path to the matching private key used by the local ssh client. */
  sshPrivateKeyPath?: string;
  /** SSH login user created by cloud-init. */
  sshUser?: string;
  /** Override base url (mock testing). */
  baseUrl?: string;
  /** Override fetch (mock testing). */
  fetchImpl?: typeof fetch;
  /** Poll cadence for status/action loops (ms). Lowered in tests. */
  pollIntervalMs?: number;
  /** Max time to wait for "running" + SSH (ms). */
  readyTimeoutMs?: number;
}

interface HcloudVmHandle extends VmHandle {
  serverId: number;
  publicIp: string;
}

const DEFAULTS = {
  image: "ubuntu-24.04",
  serverType: "cx23",
  location: "nbg1",
  sshUser: "sandbox",
  pollIntervalMs: 2000,
  readyTimeoutMs: 120_000,
};

/**
 * cloud-init user_data (RESEARCH.md §1A, 32 KiB limit). Creates the sandbox
 * user with the injected SSH key, ensures sshd, and drops a readiness marker
 * the driver greps for to know the box finished bootstrapping.
 */
export function buildCloudInit(opts: {
  user: string;
  sshPublicKey: string;
  workingDirectory: string;
}): string {
  return [
    "#cloud-config",
    "users:",
    `  - name: ${opts.user}`,
    "    groups: sudo",
    "    sudo: ALL=(ALL) NOPASSWD:ALL",
    "    shell: /bin/bash",
    "    ssh_authorized_keys:",
    `      - ${opts.sshPublicKey}`,
    "package_update: true",
    "packages:",
    "  - bash",
    "  - coreutils",
    "runcmd:",
    `  - mkdir -p ${opts.workingDirectory}`,
    `  - chown -R ${opts.user}:${opts.user} ${opts.workingDirectory}`,
    "  - systemctl enable --now ssh || systemctl enable --now sshd || true",
    "  - touch /run/sandbox-ready",
    "",
  ].join("\n");
}

export class HcloudDriver implements VmDriver {
  readonly kind = "hcloud";
  private readonly api: HcloudClient;
  private readonly cfg: Required<
    Pick<
      HcloudDriverConfig,
      | "image"
      | "serverType"
      | "location"
      | "sshUser"
      | "pollIntervalMs"
      | "readyTimeoutMs"
    >
  > &
    HcloudDriverConfig;

  constructor(config: HcloudDriverConfig) {
    if (!config.token) {
      throw new Error("HcloudDriver requires a token (HCLOUD_TOKEN).");
    }
    this.cfg = {
      ...config,
      image: config.image ?? DEFAULTS.image,
      serverType: config.serverType ?? DEFAULTS.serverType,
      location: config.location ?? DEFAULTS.location,
      sshUser: config.sshUser ?? DEFAULTS.sshUser,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      readyTimeoutMs: config.readyTimeoutMs ?? DEFAULTS.readyTimeoutMs,
    };
    this.api = new HcloudClient(config.token, config.baseUrl, config.fetchImpl);
  }

  static fromEnv(
    overrides: Partial<HcloudDriverConfig> = {},
  ): HcloudDriver {
    const token = process.env.HCLOUD_TOKEN ?? "";
    return new HcloudDriver({
      token,
      sshPublicKey: process.env.SANDBOX_SSH_PUBLIC_KEY,
      sshPrivateKeyPath: process.env.SANDBOX_SSH_PRIVATE_KEY_PATH,
      ...overrides,
    });
  }

  private serverName(sandboxId: string): string {
    return `sbx-${sandboxId}`;
  }

  async create(options: VmCreateOptions): Promise<VmHandle> {
    const userData = this.cfg.sshPublicKey
      ? buildCloudInit({
          user: this.cfg.sshUser,
          sshPublicKey: this.cfg.sshPublicKey,
          workingDirectory: options.workingDirectory,
        })
      : undefined;

    const { server, action } = await this.api.createServer({
      name: this.serverName(options.sandboxId),
      server_type: this.cfg.serverType,
      image: this.cfg.image,
      location: this.cfg.location,
      ssh_keys: this.cfg.sshKeys,
      user_data: userData,
      start_after_create: true,
      labels: {
        "managed-by": "open-agents-hetzner-poc",
        "sandbox-id": options.sandboxId,
      },
    });

    // Poll the create action AND the server status until "running".
    await this.waitForServerRunning(server.id, action.id);
    const running = (await this.api.getServer(server.id)).server;
    const publicIp = running.public_net.ipv4?.ip;
    if (!publicIp) {
      throw new Error(`server ${server.id} has no public IPv4`);
    }

    await this.waitForSsh(publicIp);

    const handle: HcloudVmHandle = {
      id: String(server.id),
      serverId: server.id,
      publicIp,
      internalHost: publicIp,
    };
    return handle;
  }

  private async waitForServerRunning(
    serverId: number,
    createActionId: number,
  ): Promise<void> {
    const deadline = Date.now() + this.cfg.readyTimeoutMs;
    // First wait for the create action to finish.
    await this.waitForAction(createActionId, deadline);
    // Then confirm the server reports "running".
    while (Date.now() < deadline) {
      const { server } = await this.api.getServer(serverId);
      if (server.status === "running") return;
      if (server.status === "error") {
        throw new Error(`server ${serverId} entered error state`);
      }
      await sleep(this.cfg.pollIntervalMs);
    }
    throw new Error(`server ${serverId} not running within timeout`);
  }

  private async waitForAction(
    actionId: number,
    deadline: number,
  ): Promise<void> {
    while (Date.now() < deadline) {
      const { action } = await this.api.getAction(actionId);
      if (action.status === "success") return;
      if (action.status === "error") {
        throw new Error(`hcloud action ${actionId} failed`);
      }
      await sleep(this.cfg.pollIntervalMs);
    }
    throw new Error(`hcloud action ${actionId} timed out`);
  }

  private async waitForSsh(host: string): Promise<void> {
    const deadline = Date.now() + this.cfg.readyTimeoutMs;
    while (Date.now() < deadline) {
      const probe = await this.ssh(host, "test -f /run/sandbox-ready && echo ok").catch(
        () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: false }),
      );
      if (probe.exitCode === 0 && probe.stdout.includes("ok")) return;
      await sleep(this.cfg.pollIntervalMs);
    }
    throw new Error(`SSH/cloud-init not ready on ${host} within timeout`);
  }

  /**
   * Run a command over SSH using the system ssh client.
   * `protected` so tests can subclass and stub it (no live VM needed).
   */
  protected ssh(
    host: string,
    command: string,
    env: Record<string, string> = {},
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<DriverExecResult> {
    const sshArgs = [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "BatchMode=yes",
    ];
    if (this.cfg.sshPrivateKeyPath) {
      sshArgs.push("-i", this.cfg.sshPrivateKeyPath);
    }
    sshArgs.push(`${this.cfg.sshUser}@${host}`);
    // Prefix env exports so commands see configured env vars.
    const envPrefix = Object.entries(env)
      .map(([k, v]) => `export ${k}=${shellQuote(v)};`)
      .join(" ");
    sshArgs.push(`${envPrefix} ${command}`);

    return new Promise((resolve, reject) => {
      const child = spawn("ssh", sshArgs, { stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let timedOut = false;
      const timer = timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs)
        : undefined;
      if (signal) {
        if (signal.aborted) child.kill("SIGKILL");
        else signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
      }
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({
          exitCode: timedOut ? null : code,
          stdout: Buffer.concat(out).toString("utf-8"),
          stderr: Buffer.concat(err).toString("utf-8"),
          timedOut,
        });
      });
    });
  }

  async exec(
    handle: VmHandle,
    command: string,
    cwd: string,
    timeoutMs: number,
    env: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<DriverExecResult> {
    const h = handle as HcloudVmHandle;
    // Mirror Vercel: bash -c 'cd "<cwd>" && <command>'.
    return this.ssh(
      h.publicIp,
      `bash -c ${shellQuote(`cd "${cwd}" && ${command}`)}`,
      env,
      timeoutMs,
      signal,
    );
  }

  async execDetached(
    handle: VmHandle,
    command: string,
    cwd: string,
    env: Record<string, string>,
  ): Promise<{ commandId: string }> {
    const h = handle as HcloudVmHandle;
    const commandId = randomUUID();
    const logPath = `/tmp/poc-cmd-${commandId}.log`;
    await this.ssh(
      h.publicIp,
      `bash -c ${shellQuote(
        `cd "${cwd}" && nohup ${command} > ${logPath} 2>&1 & echo $!`,
      )}`,
      env,
    );
    return { commandId };
  }

  async putFile(handle: VmHandle, path: string, content: Buffer): Promise<void> {
    const h = handle as HcloudVmHandle;
    // Pipe base64 over SSH and decode on the remote side (binary-safe, no scp dep).
    const b64 = content.toString("base64");
    const res = await this.ssh(
      h.publicIp,
      `bash -c ${shellQuote(`echo ${b64} | base64 -d > ${path}`)}`,
    );
    if (res.exitCode !== 0) {
      throw new Error(`putFile failed: ${res.stderr}`);
    }
  }

  async getFile(handle: VmHandle, path: string): Promise<Buffer> {
    const h = handle as HcloudVmHandle;
    const res = await this.ssh(h.publicIp, `base64 ${shellQuote(path)}`);
    if (res.exitCode !== 0) {
      throw new Error(`getFile failed: ${res.stderr}`);
    }
    return Buffer.from(res.stdout.replace(/\s+/g, ""), "base64");
  }

  async exposePort(handle: VmHandle, port: number): Promise<ExposedPort> {
    const h = handle as HcloudVmHandle;
    // Production: VM sits on a Hetzner private network; the Caddy proxy dials
    // the VM's private IP:port. Here we surface the public IP:port as the
    // backend the proxy registers (private-net wiring is the only delta).
    return { backendAddress: `${h.internalHost}:${port}` };
  }

  async snapshot(handle: VmHandle): Promise<{ snapshotId: string }> {
    const h = handle as HcloudVmHandle;
    const { image, action } = await this.api.createImage(
      h.serverId,
      `sandbox snapshot ${h.id} @ ${new Date().toISOString()}`,
    );
    // create_image is async and takes minutes (RESEARCH.md §4): poll to done.
    await this.waitForAction(action.id, Date.now() + 15 * 60_000);
    return { snapshotId: String(image.id) };
  }

  async restore(
    snapshotId: string,
    options: VmCreateOptions,
  ): Promise<VmHandle> {
    // Restore == create a new server from the snapshot image id.
    const driver = new HcloudDriver({ ...this.cfg, image: snapshotId });
    return driver.create(options);
  }

  async destroy(handle: VmHandle): Promise<void> {
    const h = handle as HcloudVmHandle;
    // DELETE the server — this is what actually ends billing.
    await this.api.deleteServer(h.serverId);
  }

  async status(handle: VmHandle): Promise<VmStatus> {
    const h = handle as HcloudVmHandle;
    try {
      const { server } = await this.api.getServer(h.serverId);
      if (server.status === "running") return "running";
      if (server.status === "off") return "stopped";
      if (server.status === "initializing" || server.status === "starting")
        return "creating";
      return "stopped";
    } catch {
      return "destroyed";
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}
