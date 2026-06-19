import "server-only";

import type { Sandbox } from "@open-agents/sandbox";
import { listEnabledUserSkills } from "@/lib/db/skills";
import { resolveSandboxHomeDirectory } from "@/lib/sandbox/home-directory";
import { getGlobalSkillsDirectory } from "@/lib/skills/directories";
import { installUserAuthoredSkills } from "@/lib/skills/user-skill-installer";

/**
 * Materialize the user's enabled, hand-authored skills into a freshly set up
 * sandbox. Runs alongside global-skill installation during workspace setup and
 * is best-effort: any failure is logged but never blocks the session.
 *
 * Emits `skills` service events:
 * - `user-skill-materialized` (info) on success.
 * - `user-skill-materialize-failed` (warn) when one or more writes fail.
 */
export async function installSessionUserSkills(params: {
  userId: string;
  sessionId: string;
  sandboxName?: string | null;
  sandbox: Sandbox;
  didSetupWorkspace: boolean;
}): Promise<void> {
  if (!params.didSetupWorkspace) {
    return;
  }

  try {
    const skills = await listEnabledUserSkills(params.userId);
    if (skills.length === 0) {
      return;
    }

    const homeDirectory = await resolveSandboxHomeDirectory(params.sandbox);
    const globalSkillsDirectory = getGlobalSkillsDirectory(homeDirectory);

    const result = await installUserAuthoredSkills({
      sandbox: params.sandbox,
      globalSkillsDirectory,
      skills,
    });

    if (result.failed.length > 0) {
      console.warn(
        "[skills] user-skill-materialize-failed",
        JSON.stringify({
          service: "skills",
          event: "user-skill-materialize-failed",
          userId: params.userId,
          sessionId: params.sessionId,
          sandboxName: params.sandboxName ?? null,
          failed: result.failed.map((failure) => failure.name),
        }),
      );
    }

    console.info(
      "[skills] user-skill-materialized",
      JSON.stringify({
        service: "skills",
        event: "user-skill-materialized",
        userId: params.userId,
        sessionId: params.sessionId,
        sandboxName: params.sandboxName ?? null,
        count: result.written.length,
      }),
    );
  } catch (error) {
    console.error(
      `[skills] Failed to materialize user skills for session ${params.sessionId}:`,
      error,
    );
  }
}
