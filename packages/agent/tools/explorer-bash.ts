import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { getContextSessionId, getSandbox } from "./utils";
import { classifyExplorerBashCommand } from "./explorer-bash-policy";
import { emitToolPolicyDenied } from "./tool-policy-events";

const TIMEOUT_MS = 120_000;

const explorerBashInputSchema = z.object({
  command: z.string().describe("The read-only bash command to execute"),
  cwd: z
    .string()
    .optional()
    .describe(
      "Workspace-relative working directory for the command (e.g., apps/web)",
    ),
});

/**
 * Read-only bash for the explorer subagent.
 *
 * Mutating commands are refused by policy before sandbox exec. Approvals are
 * not used here — explorer must not mutate even if a human would approve.
 */
export const explorerBashTool = () =>
  tool({
    needsApproval: false,
    description: `Execute a READ-ONLY bash command in the user's shell.

WHEN TO USE:
- Listing files (ls), finding paths (find), reading via cat/head/tail
- Read-only git (status, log, diff, show, branch)
- Piping read-only filters (grep, awk, sort, wc)

WHEN NOT TO USE:
- Creating, modifying, or deleting files (denied by policy)
- Package installs, git writes, redirections (>, >>), tee
- Prefer read/grep/glob tools for code search when possible

IMPORTANT:
- This tool enforces read-only policy in code — mutating commands are refused
- All commands run in the working directory — do NOT prepend cd`,
    inputSchema: explorerBashInputSchema,
    execute: async (
      { command, cwd },
      { experimental_context, abortSignal },
    ) => {
      const decision = classifyExplorerBashCommand(command);
      if (!decision.allowed) {
        // chatId/runId are not carried in tool experimental_context today;
        // they are passed explicitly as undefined until a caller threads them.
        emitToolPolicyDenied({
          tool: "bash",
          reason: decision.reason,
          command,
          sessionId: getContextSessionId(experimental_context),
          chatId: undefined,
          runId: undefined,
        });
        return {
          success: false,
          exitCode: null,
          stdout: "",
          stderr: decision.message,
          error: decision.message,
          errorKind: decision.errorKind,
          reason: decision.reason,
        };
      }

      const sandbox = await getSandbox(experimental_context, "bash");
      const workingDirectory = sandbox.workingDirectory;
      const workingDir = cwd
        ? path.isAbsolute(cwd)
          ? cwd
          : path.resolve(workingDirectory, cwd)
        : workingDirectory;

      const result = await sandbox.exec(command, workingDir, TIMEOUT_MS, {
        signal: abortSignal,
      });

      return {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.truncated && { truncated: true }),
      };
    },
  });
