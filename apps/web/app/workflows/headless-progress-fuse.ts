import type { SandboxState } from "@open-agents/sandbox";

// Thin "use step" wrapper — mirrors chat-post-finish.ts. The sandbox connect
// + probe (a Node/DB-touching operation) stays behind a dynamic import in
// headless-progress-fuse-impl.ts so this module, which `app/workflows/chat.ts`
// (a "use workflow" function) imports statically, never pulls those in at
// workflow-setup time.
export async function probeHeadlessRunGitFingerprint(
  sandboxState: SandboxState,
): Promise<string | null> {
  "use step";
  const { probeHeadlessRunGitFingerprint: probe } =
    await import("./headless-progress-fuse-impl");
  return probe(sandboxState);
}
