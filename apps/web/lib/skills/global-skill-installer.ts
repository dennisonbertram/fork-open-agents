import "server-only";

import type { Sandbox } from "@open-agents/sandbox";
import {
  type GlobalSkillRef,
  globalSkillRefsSchema,
} from "@/lib/skills/global-skill-refs";
import {
  resolveSandboxHomeDirectory,
  shellEscape,
} from "@/lib/sandbox/home-directory";

const GLOBAL_SKILLS_INSTALL_TIMEOUT_MS = 120_000;

interface SkillInstallObservability {
  sessionId?: string;
  sandboxName?: string | null;
}

function logSkillInstall(
  level: "info" | "warn",
  event: string,
  payload: SkillInstallObservability & {
    skillRef: string;
    durationMs: number;
    outcome: "started" | "success" | "failed";
    errorKind?: string;
  },
) {
  if (!payload.sessionId) {
    return;
  }

  console[level](event, payload);
}

export async function installGlobalSkills(params: {
  sandbox: Sandbox;
  globalSkillRefs: GlobalSkillRef[];
  observability?: SkillInstallObservability;
}): Promise<void> {
  const globalSkillRefs = globalSkillRefsSchema.parse(params.globalSkillRefs);
  if (globalSkillRefs.length === 0) {
    return;
  }

  const homeDirectory = await resolveSandboxHomeDirectory(params.sandbox);

  await Promise.all(
    globalSkillRefs.map(async (globalSkillRef) => {
      const skillRef = `${globalSkillRef.source}:${globalSkillRef.skillName}`;
      const startedAt = Date.now();
      logSkillInstall("info", "[sandbox] skill-install-started", {
        sessionId: params.observability?.sessionId,
        sandboxName: params.observability?.sandboxName,
        skillRef,
        durationMs: 0,
        outcome: "started",
      });

      const result = await params.sandbox.exec(
        `HOME=${shellEscape(homeDirectory)} npx skills add ${shellEscape(globalSkillRef.source)} --skill ${shellEscape(globalSkillRef.skillName)} --agent amp -g -y --copy`,
        params.sandbox.workingDirectory,
        GLOBAL_SKILLS_INSTALL_TIMEOUT_MS,
      );
      const durationMs = Date.now() - startedAt;

      if (!result.success) {
        logSkillInstall("warn", "[sandbox] skill-install-failed", {
          sessionId: params.observability?.sessionId,
          sandboxName: params.observability?.sandboxName,
          skillRef,
          durationMs,
          outcome: "failed",
          errorKind: "skill_install_failed",
        });
        throw new Error(
          `Failed to install global skill ${globalSkillRef.skillName} from ${globalSkillRef.source}: ${result.stderr || result.stdout || "unknown error"}`,
        );
      }

      logSkillInstall("info", "[sandbox] skill-install-finished", {
        sessionId: params.observability?.sessionId,
        sandboxName: params.observability?.sandboxName,
        skillRef,
        durationMs,
        outcome: "success",
      });
    }),
  );
}
