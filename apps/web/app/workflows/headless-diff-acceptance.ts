import type { SandboxState } from "@open-agents/sandbox";

// Thin "use step" wrapper — mirrors headless-progress-fuse.ts. The sandbox
// connect + probe (a Node/DB-touching operation) stays behind a dynamic
// import in headless-diff-acceptance-impl.ts so this module, which
// `app/workflows/chat.ts` (a "use workflow" function) imports statically,
// never pulls those in at workflow-setup time.
export async function probeChangedFilePaths(
  sandboxState: SandboxState,
): Promise<string[] | null> {
  "use step";
  const { probeChangedFilePaths: probe } =
    await import("./headless-diff-acceptance-impl");
  return probe(sandboxState);
}
