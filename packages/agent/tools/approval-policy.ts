/**
 * Tool approval policy engine for the open-agents platform.
 *
 * Provides a composable, pure, first-match-wins policy classifier that
 * determines whether a tool call requires human approval before execution.
 *
 * Conservative default: unknown outward-facing tools require approval.
 * Internal/read-only tools (read, glob, grep, task, list) do not require approval.
 *
 * Sub-policies exported for independent testing:
 *   - bashPolicy: dangerous rm/find/shred + dotenv file patterns
 *   - gitPushPolicy: git force-push, reset --hard, clean -fd
 *   - externalWritePolicy: non-GET/HEAD HTTP methods
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolApprovalDecision = {
  requires: boolean;
  category: string | null;
  reason: string | null;
};

// ---------------------------------------------------------------------------
// Pattern constants (lifted from bash.ts, behavior-preserving)
// ---------------------------------------------------------------------------

/**
 * Patterns for commands that could cause irreversible filesystem damage.
 * Ported from DANGEROUS_COMMAND_PATTERNS in bash.ts.
 */
const DANGEROUS_COMMAND_PATTERNS = [
  /\bcurl\b/,
  /\brm\s+(?:[^\n;&|]*\s)?(?:-[A-Za-z]*r[A-Za-z]*f|-[A-Za-z]*f[A-Za-z]*r|-r\s+-f|-f\s+-r|-{1,2}recursive\b.*-{1,2}force\b|-{1,2}force\b.*-{1,2}recursive\b)/,
  /\bfind\b[^\n;&|]*(?:-delete|-exec\s+rm\b)/,
  /\b(?:shred|mkfs|dd)\b/,
  /:\(\)\s*\{\s*:\|:/,
];

/**
 * Patterns for files that contain credentials or sensitive environment data.
 * Ported from SENSITIVE_FILE_PATTERNS in bash.ts.
 */
const SENSITIVE_FILE_PATTERNS = [
  /\.\s*env/i,
  /\.e(?:['"]{2}|\\|\$\{[^}]*\}|\$\([^)]*\))?nv/i,
  /\.e\$\([^)]*nv[^)]*\)/i,
  /\$\([^)]*env[^)]*\)/i,
  /`[^`]*env[^`]*`/i,
  /\b(?:aws\/credentials|id_rsa|id_ed25519|\.ssh|proc\/self\/environ)\b/i,
];

/**
 * Patterns for destructive git operations.
 */
const GIT_FORCE_PUSH_PATTERNS = [
  /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|-f\b)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+[^\n]*-[^\n]*f/,
];

// ---------------------------------------------------------------------------
// Read-only / internal tool names that never require approval
// ---------------------------------------------------------------------------

/**
 * Tools that are purely read-only or internal orchestration — no approval needed.
 */
const INTERNAL_READONLY_TOOLS = new Set([
  "read",
  "readFile",
  "readFileTool",
  "list",
  "glob",
  "globTool",
  "grep",
  "grepTool",
  "task",
  "taskTool",
  "todo",
  "todoWrite",
  "todoWriteTool",
  "skill",
  "skillTool",
]);

/**
 * Tools that are explicitly known to be outward-facing (write/mutate externally).
 * For these, the policy sub-classifiers determine whether approval is needed.
 */
const KNOWN_OUTWARD_FACING_TOOLS = new Set([
  "bash",
  "bashTool",
  "webFetch",
  "webFetchTool",
  "write",
  "writeFile",
  "writeFileTool",
  "edit",
  "editFile",
  "editFileTool",
]);

/**
 * Browser tool names — all require approval unconditionally because they reach
 * outward-facing / external web surfaces (arbitrary navigation, DOM interaction).
 */
const BROWSER_TOOL_NAMES = new Set([
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_extract",
  "browser_screenshot",
]);

// ---------------------------------------------------------------------------
// Sub-policies
// ---------------------------------------------------------------------------

/**
 * Bash command safety policy.
 * Returns requires:true for dangerous rm/find/shred patterns and dotenv files.
 * Behavior-preserving port of commandNeedsApproval() from bash.ts.
 */
export function bashPolicy(command: string): ToolApprovalDecision {
  const trimmedCommand = command.trim();
  const lowerCommand = trimmedCommand.toLowerCase();

  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return {
        requires: true,
        category: "dangerous-command",
        reason: `Command matches dangerous pattern: ${pattern}`,
      };
    }
  }

  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(lowerCommand)) {
      return {
        requires: true,
        category: "sensitive-file",
        reason: "Command references a sensitive file (.env, credentials, etc.)",
      };
    }
  }

  return { requires: false, category: null, reason: null };
}

/**
 * Git force-push / destructive git operation policy.
 * Gates git push --force/--force-with-lease/-f, git reset --hard, git clean -fd.
 * Applies when the bash command contains a destructive git operation.
 */
export function gitPushPolicy(command: string): ToolApprovalDecision {
  for (const pattern of GIT_FORCE_PUSH_PATTERNS) {
    if (pattern.test(command)) {
      return {
        requires: true,
        category: "git-force-push",
        reason:
          "Command contains a destructive git operation (force-push, reset --hard, or clean -f)",
      };
    }
  }

  return { requires: false, category: null, reason: null };
}

/**
 * External HTTP write policy for the webFetch/fetch tool.
 * GET and HEAD are read-only; POST/PUT/PATCH/DELETE require approval.
 * Undefined method defaults to GET (no approval).
 */
export function externalWritePolicy(method: string): ToolApprovalDecision {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") {
    return { requires: false, category: null, reason: null };
  }

  return {
    requires: true,
    category: "external-write",
    reason: `HTTP ${upper} is a mutating method and requires approval`,
  };
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify whether a tool call requires human approval.
 *
 * Policy composition order (first-match-wins):
 *  1. gitPushPolicy  — destructive git ops (runs BEFORE bashPolicy so it can
 *                       capture the more specific category)
 *  2. bashPolicy     — dangerous rm/find/shred + dotenv patterns
 *  3. externalWritePolicy — non-GET/HEAD HTTP methods for fetch tools
 *  4. Internal/read-only tools whitelist — no approval
 *  5. Conservative default — unknown outward-facing tools require approval
 *
 * @param toolName - The name of the tool being called
 * @param input    - The parsed input object for the tool call
 */
export function classifyToolApproval(
  toolName: string,
  input: unknown,
): ToolApprovalDecision {
  const safeInput =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  // 0. Browser tools — always require approval (outward-facing external web surfaces)
  if (BROWSER_TOOL_NAMES.has(toolName)) {
    return {
      requires: true,
      category: "browser-navigation",
      reason: `Browser tool "${toolName}" navigates external web surfaces and requires approval`,
    };
  }

  // 1. Bash-specific policies (gitPush checked first for more specific category)
  if (toolName === "bash" || toolName === "bashTool") {
    const command =
      typeof safeInput.command === "string" ? safeInput.command : "";

    const gitResult = gitPushPolicy(command);
    if (gitResult.requires) return gitResult;

    return bashPolicy(command);
  }

  // 2. webFetch / fetch — HTTP method policy
  if (
    toolName === "webFetch" ||
    toolName === "webFetchTool" ||
    toolName === "fetch"
  ) {
    const method =
      typeof safeInput.method === "string" ? safeInput.method : "GET";
    return externalWritePolicy(method);
  }

  // 3. Internal / read-only tools — no approval
  if (INTERNAL_READONLY_TOOLS.has(toolName)) {
    return { requires: false, category: null, reason: null };
  }

  // 4. Known outward-facing tools that didn't match a specific policy above
  //    (e.g. writeFileTool, editFileTool) — require approval conservatively
  if (KNOWN_OUTWARD_FACING_TOOLS.has(toolName)) {
    return {
      requires: true,
      category: "unknown-outward-facing",
      reason: `Tool "${toolName}" is outward-facing but has no specific policy — requiring approval conservatively`,
    };
  }

  // 5. Unknown tool — conservative default: require approval
  return {
    requires: true,
    category: "unknown-outward-facing",
    reason: `Tool "${toolName}" is not in the known internal set — requiring approval conservatively`,
  };
}
