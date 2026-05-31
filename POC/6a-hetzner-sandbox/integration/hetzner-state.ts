/**
 * Proposed `HetznerState` to add alongside `VercelState` in the real package
 * (would live at `packages/sandbox/hetzner/state.ts`).
 *
 * Mirrors the shape consumed by the real lifecycle/utils code:
 *  - `sandboxName` is required by canOperateOnSandbox / getPersistentSandboxName
 *    (apps/web/lib/sandbox/utils.ts).
 *  - `expiresAt` is read by getSandboxExpiresAt / isSandboxActive.
 */
export interface HetznerState {
  /** Durable sandbox name used for reconnect/resume (== Vercel's sandboxName). */
  sandboxName?: string;
  /** Underlying machine id (hcloud server id / container id). */
  machineId?: string;
  /** Snapshot/image id used to restore a hibernated session. */
  snapshotId?: string;
  /** Lifecycle phase for the session model. */
  lifecycle?: "active" | "hibernating" | "hibernated" | "restoring";
  /** Working directory inside the sandbox. */
  workingDirectory?: string;
  /** Timestamp (ms) when the current runtime session expires. */
  expiresAt?: number;
}
