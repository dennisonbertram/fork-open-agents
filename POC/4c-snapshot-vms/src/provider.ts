// SnapshotProvider abstraction.
//
// This is the seam that the real codebase already (partially) exposes:
//   - packages/sandbox/interface.ts -> Sandbox.snapshot(): Promise<SnapshotResult>
//                                      (SnapshotResult = { snapshotId: string })
//   - packages/sandbox/vercel/sandbox.ts -> VercelSandbox.snapshot() calls
//                                      session.snapshot() and marks the sandbox stopped
//                                      (native Vercel snapshot; "automatically stops")
//   - VercelSandbox.connect(name, { resume: true }) -> resume from the named snapshot
//
// The Vercel platform implements snapshot/resume natively (filesystem only). We
// model the SAME two-method contract so the production binding is a thin adapter:
//
//   snapshot(sandboxId) -> snapshotRef     (== VercelSandbox.snapshot().snapshotId / durable name)
//   resume(snapshotRef) -> sandbox         (== connectVercelSandbox({ sandboxName, resume: true }))
//
// The local fake provider (fake-provider.ts) implements these by archiving the
// sandbox's filesystem + git working tree + service records to disk, proving the
// abstraction is sound and pinning down EXACTLY what state must be captured.

import type { ServiceRecord } from "./service-records";

/** Opaque reference to a saved snapshot. Mirrors Vercel's `{ snapshotId }`. */
export interface SnapshotRef {
  /** Native snapshot identifier (Vercel: snapshotId; fake: archive id). */
  snapshotId: string;
  /** Durable sandbox name this snapshot belongs to (Vercel two-level model). */
  sandboxName: string;
  /** ms-since-epoch the snapshot was taken. */
  createdAt: number;
  /** Compressed snapshot size in bytes (for cost characterization). */
  sizeBytes: number;
}

/**
 * What a live sandbox instance looks like to the provider. The fake provider
 * gives each "session" a real on-disk working directory; production maps this
 * onto a VercelSandbox handle.
 */
export interface SandboxInstance {
  /** Durable sandbox name (survives across sessions — Vercel model). */
  readonly name: string;
  /** Current session id (changes every resume — Vercel model). */
  readonly sessionId: string;
  /** Absolute path to this session's working directory (fake-provider only). */
  readonly workdir: string;
  /** Service records known to this session (mirrors sandboxServices rows). */
  services: ServiceRecord[];
  /** Environment variables for this session. */
  env: Record<string, string>;
}

export interface SnapshotProvider {
  /**
   * Capture the current state of a live sandbox into a durable snapshot, then
   * tear the live instance down. Mirrors VercelSandbox.snapshot() which
   * "automatically stops the sandbox after snapshot creation".
   */
  snapshot(instance: SandboxInstance): Promise<SnapshotRef>;

  /**
   * Boot a NEW session from a snapshot, restoring captured state. Mirrors
   * connectVercelSandbox({ sandboxName, resume: true }).
   */
  resume(ref: SnapshotRef): Promise<SandboxInstance>;

  /** Permanently delete a snapshot (mirrors sandbox.delete() / expiration). */
  discard(ref: SnapshotRef): Promise<void>;
}
