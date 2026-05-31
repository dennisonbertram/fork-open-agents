// LocalFakeSnapshotProvider — a self-contained implementation of SnapshotProvider
// that proves the snapshot/resume abstraction WITHOUT a real Vercel MicroVM.
//
// Mechanism (this is what production must capture too):
//   snapshot(instance):
//     1. archive the ENTIRE working directory to a gzip tarball (filesystem +
//        git .git dir + uncommitted/untracked working tree, all at once)
//     2. serialize the resumable service records (relaunchOnResume, command,
//        port) + env to a sidecar JSON
//     3. tear the live session directory down (discard the live instance)
//     -> returns an opaque SnapshotRef (snapshotId == archive id)
//
//   resume(ref):
//     1. boot a NEW session directory
//     2. extract the tarball back into it (byte-exact restore)
//     3. rehydrate the service records (pids cleared — processes did NOT survive)
//     -> returns a fresh SandboxInstance with a NEW sessionId, SAME name
//
// The tarball stands in for Vercel's "compressed copy of the sandbox's disk"
// (.img -> .vhs). Vercel does this natively; we do it with tar to prove the
// state-capture contract and measure size/time.
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { run } from "./exec";
import type {
  SandboxInstance,
  SnapshotProvider,
  SnapshotRef,
} from "./provider";
import {
  type ServiceRecord,
  toResumableServiceRecord,
} from "./service-records";

interface SnapshotSidecar {
  sandboxName: string;
  services: ServiceRecord[];
  env: Record<string, string>;
}

export interface SnapshotCost {
  snapshotId: string;
  sizeBytes: number;
  snapshotMs: number;
  resumeMs: number;
}

export class LocalFakeSnapshotProvider implements SnapshotProvider {
  /** Root dir holding live sessions + snapshot archives. */
  private readonly root: string;
  private readonly sessionsDir: string;
  private readonly snapshotsDir: string;
  readonly costs: SnapshotCost[] = [];

  constructor(root: string) {
    this.root = root;
    this.sessionsDir = join(root, "sessions");
    this.snapshotsDir = join(root, "snapshots");
    mkdirSync(this.sessionsDir, { recursive: true });
    mkdirSync(this.snapshotsDir, { recursive: true });
  }

  /** Provision a brand-new live sandbox (lifecycle: provisioning -> active). */
  provision(name: string, env: Record<string, string> = {}): SandboxInstance {
    const sessionId = `sess_${randomUUID().slice(0, 8)}`;
    const workdir = join(this.sessionsDir, name, sessionId);
    mkdirSync(workdir, { recursive: true });
    return { name, sessionId, workdir, services: [], env };
  }

  async snapshot(instance: SandboxInstance): Promise<SnapshotRef> {
    const t0 = performance.now();
    const snapshotId = `snap_${randomUUID().slice(0, 12)}`;
    const snapDir = join(this.snapshotsDir, snapshotId);
    mkdirSync(snapDir, { recursive: true });

    // 1. Archive the whole working directory (filesystem + git + uncommitted).
    //    Portable flags (works under both BSD tar on macOS and GNU tar in the
    //    sandbox). This tarball stands in for Vercel's compressed .vhs disk image.
    const archivePath = join(snapDir, "fs.tar.gz");
    run(
      `tar -czf "${archivePath}" -C "${instance.workdir}" .`,
      this.root,
    );

    // 2. Sidecar: service records (resumable form) + env.
    const sidecar: SnapshotSidecar = {
      sandboxName: instance.name,
      services: instance.services.map(toResumableServiceRecord),
      env: instance.env,
    };
    writeFileSync(
      join(snapDir, "meta.json"),
      JSON.stringify(sidecar, null, 2),
      "utf-8",
    );

    const sizeBytes = statSync(archivePath).size;
    const snapshotMs = performance.now() - t0;

    // 3. Tear down the live instance (discard the live session dir entirely).
    rmSync(instance.workdir, { recursive: true, force: true });

    const ref: SnapshotRef = {
      snapshotId,
      sandboxName: instance.name,
      createdAt: Date.now(),
      sizeBytes,
    };
    this.costs.push({ snapshotId, sizeBytes, snapshotMs, resumeMs: -1 });
    return ref;
  }

  async resume(ref: SnapshotRef): Promise<SandboxInstance> {
    const t0 = performance.now();
    const snapDir = join(this.snapshotsDir, ref.snapshotId);
    if (!existsSync(snapDir)) {
      throw new Error(`snapshot ${ref.snapshotId} not found (expired/discarded)`);
    }

    // 1. Boot a NEW session (new sessionId, same durable name).
    const sessionId = `sess_${randomUUID().slice(0, 8)}`;
    const workdir = join(this.sessionsDir, ref.sandboxName, sessionId);
    mkdirSync(workdir, { recursive: true });

    // 2. Restore the filesystem byte-for-byte.
    run(
      `tar -xzf "${join(snapDir, "fs.tar.gz")}" -C "${workdir}"`,
      this.root,
    );

    // 3. Rehydrate service records (pids already cleared in the sidecar).
    const sidecar = JSON.parse(
      readFileSync(join(snapDir, "meta.json"), "utf-8"),
    ) as SnapshotSidecar;

    const resumeMs = performance.now() - t0;
    const cost = this.costs.find((c) => c.snapshotId === ref.snapshotId);
    if (cost) cost.resumeMs = resumeMs;

    return {
      name: ref.sandboxName,
      sessionId,
      workdir,
      services: sidecar.services,
      env: sidecar.env,
    };
  }

  async discard(ref: SnapshotRef): Promise<void> {
    const snapDir = join(this.snapshotsDir, ref.snapshotId);
    rmSync(snapDir, { recursive: true, force: true });
  }

  /** Copy a directory's contents into a sandbox workdir (test setup helper). */
  seedFrom(instance: SandboxInstance, srcDir: string): void {
    cpSync(srcDir, instance.workdir, { recursive: true });
  }
}
