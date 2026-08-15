import type { SandboxState } from "@open-agents/sandbox";

/**
 * Connects the sandbox and lists every path this run has changed, for the
 * #1288 acceptance check. Reuses `@/lib/sandbox/git-changed-paths`, the same
 * base-ref resolution `computeAndCacheDiff` uses for `get_diff_summary`, so
 * the two never disagree about which files a run touched.
 *
 * Returns null on any connection or probe failure — the caller treats null
 * as "unknown, cannot report a violation" rather than failing the run over a
 * sandbox/tooling hiccup.
 */
export async function probeChangedFilePaths(
  sandboxState: SandboxState,
): Promise<string[] | null> {
  "use step";
  try {
    const { connectSandbox } = await import("@open-agents/sandbox");
    const { probeChangedFilePaths: probe } =
      await import("@/lib/sandbox/git-changed-paths");
    const sandbox = await connectSandbox(sandboxState);
    return await probe(sandbox);
  } catch (error) {
    console.error(
      "[chat] Failed to probe changed file paths for the #1288 diff acceptance check:",
      error,
    );
    return null;
  }
}
