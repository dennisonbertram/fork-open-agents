/**
 * Extensible action classifier (approval policy).
 *
 * Generalizes the bash-only `commandNeedsApproval()` matcher
 * (packages/agent/tools/bash.ts) into a policy that decides whether ANY
 * outward-facing / destructive tool call requires human sign-off:
 * destructive bash, git push, external API writes, etc.
 *
 * A policy is just `(toolName, input) => ApprovalVerdict`. Policies compose:
 * the first one that returns `requires: true` wins. This mirrors how `bash.ts`
 * layers a hardcoded matcher under a caller-supplied `ToolOptions.needsApproval`.
 */

export type ApprovalVerdict = {
  requires: boolean;
  /** Human-readable category, surfaced to the approver and into evidence. */
  category?: string;
  /** Short reason shown in the approval prompt. */
  reason?: string;
};

export type ApprovalPolicy = (
  toolName: string,
  input: unknown,
) => ApprovalVerdict | Promise<ApprovalVerdict>;

const SAFE = { requires: false } as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// --- Destructive bash patterns (copied from packages/agent/tools/bash.ts) ----
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(?:[^\n;&|]*\s)?(?:-[A-Za-z]*r[A-Za-z]*f|-[A-Za-z]*f[A-Za-z]*r|-r\s+-f|-f\s+-r|-{1,2}recursive\b.*-{1,2}force\b|-{1,2}force\b.*-{1,2}recursive\b)/,
  /\bfind\b[^\n;&|]*(?:-delete|-exec\s+rm\b)/,
  /\b(?:shred|mkfs|dd)\b/,
  /:\(\)\s*\{\s*:\|:/,
];

const SENSITIVE_FILE_PATTERNS = [
  /\.\s*env/i,
  /\b(?:aws\/credentials|id_rsa|id_ed25519|\.ssh|proc\/self\/environ)\b/i,
];

/** Destructive shell commands. Mirrors bash.ts commandNeedsApproval(). */
export const bashPolicy: ApprovalPolicy = (toolName, input) => {
  if (toolName !== "bash") return SAFE;
  const command = asString((input as { command?: unknown })?.command).trim();
  if (!command) return SAFE;

  if (DANGEROUS_COMMAND_PATTERNS.some((p) => p.test(command))) {
    return {
      requires: true,
      category: "destructive-bash",
      reason: "Command matches a destructive shell pattern (rm -rf / dd / fork-bomb).",
    };
  }
  if (SENSITIVE_FILE_PATTERNS.some((p) => p.test(command.toLowerCase()))) {
    return {
      requires: true,
      category: "sensitive-file-access",
      reason: "Command references credentials or dotenv files.",
    };
  }
  return SAFE;
};

/** Git history-rewriting / publishing operations. */
export const gitPushPolicy: ApprovalPolicy = (toolName, input) => {
  // Catch both a dedicated git tool and `git ...` run via bash.
  const command =
    toolName === "git"
      ? asString((input as { args?: unknown })?.args)
      : toolName === "bash"
        ? asString((input as { command?: unknown })?.command)
        : "";
  if (!command) return SAFE;
  const lower = command.toLowerCase();
  if (/\bgit\b/.test(lower) || toolName === "git") {
    if (/\bpush\b/.test(lower)) {
      const forced = /(--force\b|--force-with-lease\b|\s-f\b)/.test(lower);
      return {
        requires: true,
        category: forced ? "git-force-push" : "git-push",
        reason: forced
          ? "Force-pushing rewrites remote history."
          : "Pushing publishes commits to a remote.",
      };
    }
    if (/\breset\s+--hard\b/.test(lower)) {
      return {
        requires: true,
        category: "git-destructive",
        reason: "git reset --hard discards local work.",
      };
    }
  }
  return SAFE;
};

/** External API writes (non-idempotent HTTP, third-party SDK mutations). */
export const externalWritePolicy: ApprovalPolicy = (toolName, input) => {
  if (toolName === "http_request") {
    const method = asString(
      (input as { method?: unknown })?.method,
    ).toUpperCase();
    const url = asString((input as { url?: unknown })?.url);
    const isExternal = /^https?:\/\//i.test(url);
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (isExternal && isWrite) {
      return {
        requires: true,
        category: "external-api-write",
        reason: `${method} to an external endpoint mutates third-party state.`,
      };
    }
  }
  // A generic "send email / post message" style tool is always outward-facing.
  if (toolName === "send_email" || toolName === "post_message") {
    return {
      requires: true,
      category: "outbound-message",
      reason: "Sends an outbound message to a third party.",
    };
  }
  return SAFE;
};

export const DEFAULT_POLICIES: ApprovalPolicy[] = [
  bashPolicy,
  gitPushPolicy,
  externalWritePolicy,
];

/** Compose policies: first match that requires approval wins. */
export function composePolicies(
  policies: ApprovalPolicy[] = DEFAULT_POLICIES,
): ApprovalPolicy {
  return async (toolName, input) => {
    for (const policy of policies) {
      const verdict = await policy(toolName, input);
      if (verdict.requires) return verdict;
    }
    return SAFE;
  };
}

export const classifyAction = composePolicies();
