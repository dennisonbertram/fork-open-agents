import { spawn } from "node:child_process";

/**
 * Boots Caddy as a Docker container that acts as the wildcard reverse proxy for
 * the eval. The host's macOS lacks a `caddy` binary, so Caddy runs in a
 * container (per the environment constraints).
 *
 * Topology:
 *   - A user-defined Docker network ("poc-hetzner-net") is shared by Caddy and
 *     all sandbox containers. Caddy reaches sandboxes by container DNS name.
 *   - Caddy publishes :80 (proxy) and :2019 (admin API) to host ports.
 *   - The host hits  http://<id>-<port>.lvh.me:<publishedProxyPort>/  which
 *     resolves to 127.0.0.1, lands on the published proxy port, and Caddy
 *     routes by Host header to the right sandbox container:port.
 */

const DOCKER = process.env.POC_DOCKER_BIN ?? "docker";

function run(args: string[], input?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(DOCKER, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf-8"),
        stderr: Buffer.concat(err).toString("utf-8"),
      }),
    );
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export interface CaddyContainerOptions {
  network: string;
  containerName?: string;
  /** Host port for the proxy (Caddy :80). */
  proxyHostPort: number;
  /** Host port for the admin API (Caddy :2019). */
  adminHostPort: number;
  image?: string;
}

export interface CaddyHandle {
  containerName: string;
  /** Admin API base reachable from the host. */
  adminBase: string;
  /** Proxy host port the browser/curl hits. */
  proxyHostPort: number;
}

export async function ensureNetwork(network: string): Promise<void> {
  const exists = await run(["network", "inspect", network]);
  if (exists.code !== 0) {
    const created = await run(["network", "create", network]);
    if (created.code !== 0) {
      throw new Error(`failed to create network: ${created.stderr}`);
    }
  }
}

/**
 * Minimal initial Caddy config: an HTTP server "srv0" on :80 with an empty
 * routes array, plus the admin endpoint bound to 0.0.0.0:2019 so the host can
 * program it. Routes are added at runtime via CaddyRegistrar.
 */
function initialCaddyJson(): string {
  return JSON.stringify({
    admin: { listen: "0.0.0.0:2019" },
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":80"],
            routes: [],
          },
        },
      },
    },
  });
}

export async function startCaddy(
  opts: CaddyContainerOptions,
): Promise<CaddyHandle> {
  const containerName = opts.containerName ?? "poc-caddy";
  const image = opts.image ?? "caddy:2-alpine";
  await ensureNetwork(opts.network);

  // Clean any stale container.
  await run(["rm", "-f", containerName]);

  // Start Caddy with the admin API; we push config via the admin API after boot
  // (avoids bind-mounting a config file from macOS into the container).
  const res = await run([
    "run",
    "-d",
    "--name",
    containerName,
    "--network",
    opts.network,
    "--label",
    "poc-hetzner-sandbox=true",
    // CADDY_ADMIN makes Caddy bind its admin API to 0.0.0.0 (default is
    // localhost-only, which the published host port cannot reach).
    "-e",
    "CADDY_ADMIN=0.0.0.0:2019",
    "-p",
    `${opts.proxyHostPort}:80`,
    "-p",
    `${opts.adminHostPort}:2019`,
    image,
    "caddy",
    "run",
  ]);
  if (res.code !== 0) {
    throw new Error(`failed to start caddy: ${res.stderr}`);
  }

  const adminBase = `http://127.0.0.1:${opts.adminHostPort}`;

  // Wait for admin API, then load the base config.
  await waitForAdmin(adminBase);
  const load = await fetch(`${adminBase}/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: initialCaddyJson(),
  });
  if (!load.ok) {
    throw new Error(`caddy /load failed: ${load.status} ${await load.text()}`);
  }

  return { containerName, adminBase, proxyHostPort: opts.proxyHostPort };
}

async function waitForAdmin(adminBase: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${adminBase}/config/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("caddy admin API never became ready");
}

export async function stopCaddy(containerName: string): Promise<void> {
  await run(["rm", "-f", containerName]);
}
