/**
 * Structured logging for the GitHub App install callback route.
 *
 * Colocated per the repo's file-organization rule against appending new
 * concerns to an existing file — this is a distinct observability concern
 * from the redirect/sync logic in `route.ts`.
 *
 * Debug recipe: `grep '"event":"install_state_rejected"' <logs>` (plain
 * `console.warn` output; not yet wired into a structured JSON log pipeline
 * for this route).
 */

const MODULE = "github-app-callback" as const;

export function logInstallStateRejected(params: {
  userId: string;
  hasCookie: boolean;
  hasParam: boolean;
}): void {
  console.warn(
    JSON.stringify({
      module: MODULE,
      event: "install_state_rejected",
      level: "warn",
      userId: params.userId,
      hasCookie: params.hasCookie,
      hasParam: params.hasParam,
    }),
  );
}
