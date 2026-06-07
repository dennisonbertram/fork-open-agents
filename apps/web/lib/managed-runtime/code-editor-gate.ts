import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

/**
 * Returns a human-readable reason string when the managed runtime profile
 * does not include code-server, or null when the editor is allowed.
 *
 * The result flows into `codeEditorDisabledReason` in the session chat page
 * and through the existing `canUseCodeEditor` plumbing to disable the menu
 * item before the user hits the 500 error from the launch route.
 */
export function getCodeEditorDisabledReason(
  profile: ManagedRuntimeProfile,
): string | null {
  // TODO: implement
  return null;
}
