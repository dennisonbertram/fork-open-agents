/**
 * ILLUSTRATIVE, TYPE-CHECKED patch for apps/web/lib/sandbox/lifecycle.ts:187.
 *
 * The current guard hard-codes the only supported provider:
 *
 *   // lifecycle.ts:187 (current)
 *   if (sandboxState.type !== "vercel") {
 *     return { action: "skipped", reason: "unsupported-sandbox-type" };
 *   }
 *
 * To support Hetzner, generalize the guard to an allow-list of provider types
 * that implement the operations lifecycle needs (connect + snapshot + stop).
 * `connectSandbox()` already dispatches by `type`, so once Hetzner is in the
 * union, the only change here is widening the guard.
 */

type SupportedSandboxType = "vercel" | "hetzner";

const LIFECYCLE_SUPPORTED_TYPES: ReadonlySet<SupportedSandboxType> = new Set([
  "vercel",
  "hetzner",
]);

export function isLifecycleSupported(
  type: string,
): type is SupportedSandboxType {
  return LIFECYCLE_SUPPORTED_TYPES.has(type as SupportedSandboxType);
}

/**
 * Drop-in replacement for the lifecycle.ts:187 guard.
 *
 *   // AFTER
 *   if (!isLifecycleSupported(sandboxState.type)) {
 *     return { action: "skipped", reason: "unsupported-sandbox-type" };
 *   }
 *
 * `getState()` for Hetzner returns `{ type, sandboxName, expiresAt, ... }`, so
 * canOperateOnSandbox (which checks sandboxName + expiresAt) keeps working
 * unchanged for the new provider.
 */
export type LifecycleGuardResult =
  | { ok: true }
  | { ok: false; action: "skipped"; reason: "unsupported-sandbox-type" };

export function lifecycleGuard(sandboxType: string): LifecycleGuardResult {
  if (!isLifecycleSupported(sandboxType)) {
    return {
      ok: false,
      action: "skipped",
      reason: "unsupported-sandbox-type",
    };
  }
  return { ok: true };
}
