import path from "node:path";
import type { Sandbox } from "@open-agents/sandbox";
import { serializeSkillFile, skillDirectoryName } from "./skill-file";

/**
 * Minimal shape needed to materialize a skill into the sandbox. Intentionally a
 * structural subset of the `user_skills` row so callers can pass DB records
 * directly.
 */
export type MaterializableSkill = {
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
};

export type InstallUserSkillsResult = {
  /** Names of skills successfully written to the sandbox. */
  written: string[];
  /** Skills whose write failed, with the surfaced error message. */
  failed: Array<{ name: string; error: string }>;
};

/**
 * Write each enabled skill to `<globalSkillsDirectory>/<name>/SKILL.md` in the
 * sandbox so the existing `discoverSkills` pipeline can pick it up. Disabled
 * skills are skipped. Writes are best-effort: one failure is recorded and the
 * remaining skills still install, so a single bad skill never blocks workspace
 * setup. `sandbox.writeFile` creates parent directories as needed.
 */
export async function installUserAuthoredSkills(params: {
  sandbox: Pick<Sandbox, "writeFile">;
  globalSkillsDirectory: string;
  skills: MaterializableSkill[];
}): Promise<InstallUserSkillsResult> {
  const written: string[] = [];
  const failed: InstallUserSkillsResult["failed"] = [];

  for (const skill of params.skills) {
    if (!skill.enabled) {
      continue;
    }

    const skillDir = path.posix.join(
      params.globalSkillsDirectory,
      skillDirectoryName(skill.name),
    );
    const filePath = path.posix.join(skillDir, "SKILL.md");

    try {
      await params.sandbox.writeFile(
        filePath,
        serializeSkillFile(skill),
        "utf-8",
      );
      written.push(skill.name);
    } catch (error) {
      failed.push({
        name: skill.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { written, failed };
}
