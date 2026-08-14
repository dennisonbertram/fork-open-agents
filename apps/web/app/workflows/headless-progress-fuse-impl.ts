import type { SandboxState } from "@open-agents/sandbox";

/**
 * Connects the sandbox and probes its git working tree, for the headless-run
 * no-progress fuse (#1231). Reuses the exact probe background agents already
 * validate in production (`@/lib/sandbox/git-fingerprint`) — see
 * `lib/progress-budget.ts`'s module doc for why the observation cadence (one
 * probe per chat step) matches background agents' cadence (one probe per
 * turn) exactly.
 *
 * Returns null on any connection or probe failure — the caller's progress
 * budget treats null as "unknown, not stale" rather than failing the run over
 * a sandbox/tooling hiccup.
 */
export async function probeHeadlessRunGitFingerprint(
  sandboxState: SandboxState,
): Promise<string | null> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-agents/sandbox");
    const { probeGitFingerprint } =
      await import("@/lib/sandbox/git-fingerprint");
    const sandbox = await connectSandbox(sandboxState);
    return await probeGitFingerprint(sandbox);
  } catch (error) {
    console.error(
      "[chat] Failed to probe git fingerprint for the headless progress fuse:",
      error,
    );
    return null;
  }
}
