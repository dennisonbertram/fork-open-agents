/**
 * Explorer bash read-only policy.
 *
 * Prompt text is not enforcement. This module decides whether a bash command
 * is allowed for the explorer subagent before any sandbox exec runs.
 */

export type ExplorerBashDecision =
  | { allowed: true }
  | {
      allowed: false;
      errorKind: "tool_policy_denied";
      reason: "explorer_readonly";
      message: string;
    };

/**
 * Commands / tokens that mutate the filesystem or package/repo state.
 * Heuristic — not a full shell parser. Prefer dedicated tools (read/grep/glob)
 * for exploration; bash is a narrow escape hatch for ls/find/git readouts.
 */
const MUTATING_COMMAND_PATTERNS: RegExp[] = [
  // Redirections that write files
  /(?:^|[\s;|&])(?:>>?|tee\b)/,
  // Common mutating builtins / utilities
  /\b(?:rm|rmdir|mkdir|touch|cp|mv|ln|install|chmod|chown|chgrp|truncate|dd|mkfs|shred)\b/,
  // Editors / in-place mutation
  /\b(?:sed|perl|ruby|python3?)\b[^\n]*\s-i\b/,
  /\b(?:nvim|vim|vi|nano|emacs)\b/,
  // Package / language installs
  /\b(?:npm|pnpm|yarn|bun|pip|pip3|cargo|go)\b[^\n]*\b(?:install|add|remove|uninstall|update|upgrade)\b/,
  // Git writes (stash list/show are read-only — mutating forms only)
  /\bgit\b[^\n]*\b(?:add|commit|push|pull|fetch|merge|rebase|cherry-pick|reset|clean|tag\s+-d|branch\s+-d|stash\s+(?:push|pop|drop|apply|clear)|config\s+(?:--add|--unset))\b/,
  // find delete / exec mutation
  /\bfind\b[^\n]*(?:-delete|-exec\b)/,
  // shell write helpers
  /\b(?:printf|echo)\b[^\n]*>/,
];

/**
 * Allowlist-ish: if the command is *only* composed of these read-oriented
 * heads (after stripping simple pipes/chains), accept. Used as a secondary
 * gate so unknown heads are denied closed.
 */
const READ_ONLY_HEADS = new Set([
  "ls",
  "find",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "cat",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "tree",
  "du",
  "df",
  "pwd",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "which",
  "command",
  "type",
  "echo",
  "printf",
  "true",
  "false",
  "test",
  "[",
  "git",
  "awk",
  "sed",
  "sort",
  "uniq",
  "cut",
  "tr",
  "column",
  "nl",
  "od",
  "hexdump",
  "diff",
  "comm",
  "cmp",
]);

const GIT_READ_ONLY_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "tag",
  "remote",
  "rev-parse",
  "rev-list",
  "describe",
  "ls-files",
  "ls-tree",
  "cat-file",
  "blame",
  "shortlog",
]);

function splitSimpleCommands(command: string): string[] {
  // Split on shell command separators. Heuristic — does not handle quoting.
  return command
    .split(/(?:&&|\|\||;|\n)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function commandHead(simpleCommand: string): string | null {
  const withoutEnv = simpleCommand.replace(
    /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/,
    "",
  );
  const match = withoutEnv.match(/^(?:sudo\s+)?([^\s|]+)/);
  if (!match?.[1]) {
    return null;
  }
  const head = match[1].replace(/^.*\//, "");
  return head.toLowerCase();
}

function isReadOnlyGit(simpleCommand: string): boolean {
  const match = simpleCommand.match(/\bgit\s+([a-z0-9-]+)/i);
  if (!match?.[1]) {
    return false;
  }
  return GIT_READ_ONLY_SUBCOMMANDS.has(match[1].toLowerCase());
}

function isReadOnlySimpleCommand(simpleCommand: string): boolean {
  // Pipes: every stage must be read-only headed.
  const stages = simpleCommand
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stage of stages) {
    const head = commandHead(stage);
    if (!head || !READ_ONLY_HEADS.has(head)) {
      return false;
    }
    if (head === "git" && !isReadOnlyGit(stage)) {
      return false;
    }
    // sed without -i is read-only filter; with -i caught by MUTATING patterns
    if (head === "echo" || head === "printf") {
      if (/(?:^|[\s;|&])(?:>>?)/.test(stage)) {
        return false;
      }
    }
  }
  return stages.length > 0;
}

export function classifyExplorerBashCommand(
  command: string,
): ExplorerBashDecision {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      allowed: false,
      errorKind: "tool_policy_denied",
      reason: "explorer_readonly",
      message: "Explorer bash refused an empty command (read-only policy).",
    };
  }

  for (const pattern of MUTATING_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        errorKind: "tool_policy_denied",
        reason: "explorer_readonly",
        message: `Explorer bash is read-only and refused a filesystem-mutating command. Use read/grep/glob for inspection. Denied by policy (${pattern}).`,
      };
    }
  }

  const simpleCommands = splitSimpleCommands(trimmed);
  for (const simple of simpleCommands) {
    if (!isReadOnlySimpleCommand(simple)) {
      return {
        allowed: false,
        errorKind: "tool_policy_denied",
        reason: "explorer_readonly",
        message:
          "Explorer bash is read-only and refused a command outside the allowlist (grep/find/cat/ls/git-read class).",
      };
    }
  }

  return { allowed: true };
}
