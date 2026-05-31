import { randomUUID } from "node:crypto";
import type { SandboxHooks } from "./interface";
import type { VmDriver } from "./driver";
import type { ProxyRegistrar } from "./proxy/registrar";
import { HetznerSandbox } from "./sandbox";

/**
 * connectHetzner — the provider seam entrypoint that mirrors `connectVercel`.
 *
 * In the real codebase this is the branch `connectSandbox()` takes when
 * `state.type === "hetzner"` (see integration/factory.patch.ts). It provisions
 * (or restores) a machine via the driver, runs the afterStart hook, and returns
 * a HetznerSandbox.
 */

export interface ConnectHetznerOptions {
  driver: VmDriver;
  registrar: ProxyRegistrar;
  wildcardBase: string;
  proxyScheme?: string;
  proxyPort?: number;
  /** Working directory inside the sandbox. */
  workingDirectory?: string;
  env?: Record<string, string>;
  hooks?: SandboxHooks;
  timeout?: number;
  /** Reuse an existing sandbox id (resume) or mint a new one. */
  sandboxId?: string;
  /** Restore from this snapshot id instead of a clean create. */
  restoreSnapshotId?: string;
}

const DEFAULT_TIMEOUT_MS = 300_000; // 5 min, matches factory.ts default.

export async function connectHetzner(
  opts: ConnectHetznerOptions,
): Promise<HetznerSandbox> {
  const sandboxId = opts.sandboxId ?? randomUUID().slice(0, 8);
  const workingDirectory = opts.workingDirectory ?? "/workspace";

  const handle = opts.restoreSnapshotId
    ? await opts.driver.restore(opts.restoreSnapshotId, {
        sandboxId,
        workingDirectory,
        env: opts.env,
      })
    : await opts.driver.create({
        sandboxId,
        workingDirectory,
        env: opts.env,
      });

  const sandbox = new HetznerSandbox({
    sandboxId,
    driver: opts.driver,
    registrar: opts.registrar,
    handle,
    workingDirectory,
    wildcardBase: opts.wildcardBase,
    proxyScheme: opts.proxyScheme,
    proxyPort: opts.proxyPort,
    env: opts.env,
    hooks: opts.hooks,
    timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
  });

  if (opts.hooks?.afterStart) {
    await opts.hooks.afterStart(sandbox);
  }

  return sandbox;
}
