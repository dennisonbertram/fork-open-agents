import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { getSandbox, getUnattended } from "./utils";
import { bashPolicy, classifyToolApproval } from "./approval-policy";

const TIMEOUT_MS = 120_000;

const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  cwd: z
    .string()
    .optional()
    .describe(
      "Workspace-relative working directory for the command (e.g., apps/web)",
    ),
  detached: z
    .boolean()
    .optional()
    .describe(
      "Use this whenever you want to run a persistent server in the background (e.g., npm run dev, next dev). The command starts and returns immediately without waiting for it to finish.",
    ),
});

type BashInput = z.infer<typeof bashInputSchema>;
type ApprovalFn = (args: BashInput) => boolean | Promise<boolean>;

interface ToolOptions {
  needsApproval?: boolean | ApprovalFn;
}

/**
 * Check if a command should require approval.
 * Thin wrapper delegating to bashPolicy ONLY (backward-compat export).
 * Returns true for dangerous rm/find/shred and dotenv file patterns.
 *
 * NOTE: This function is intentionally bashPolicy-only. It does NOT include
 * gitPushPolicy. For full policy enforcement (including git force-push / reset
 * --hard / clean -fd), use bashTool().needsApproval or
 * classifyToolApproval("bash", { command }) instead.
 */
export function commandNeedsApproval(command: string): boolean {
  return bashPolicy(command).requires;
}

export const bashTool = (options?: ToolOptions) =>
  tool({
    needsApproval: async (args, { experimental_context }) => {
      // Route through the full policy classifier so gitPushPolicy fires first,
      // then bashPolicy. This ensures destructive git ops (force-push, reset
      // --hard, clean -fd) are gated at runtime, not just in the policy engine.
      const decision = classifyToolApproval("bash", {
        command: args.command,
      });

      if (!decision.requires) {
        return false;
      }

      // In an unattended run (background agent / agent-loop step) there is no
      // human to answer an approval prompt. Split on blast radius, not tool
      // identity, so the run does not wedge on a never-approved tool call:
      //   - local bash effects (bashPolicy) stay inside the ephemeral
      //     per-session sandbox -> auto-approve.
      //   - the git-push family (gitPushPolicy) mutates state that outlives
      //     the sandbox -> keep gated.
      //
      // Keeping it gated in an unattended run ENDS the run: there is no
      // non-browser path that resolves a pending approval, so the run stops
      // with outcome `awaiting_tool_approval` and explains itself. An earlier
      // version of this comment claimed "the unattended loop denies it with a
      // recorded reason" — no such loop exists. Do not rely on one.
      if (getUnattended(experimental_context)) {
        return decision.category === "git-force-push";
      }

      // Attended run: unchanged — respect any caller override else require
      // approval by default.
      if (typeof options?.needsApproval === "function") {
        return options.needsApproval(args);
      }
      return options?.needsApproval ?? true;
    },
    description: `Execute a bash command in the user's shell (non-interactive).

WHEN TO USE:
- Running existing project commands (build, test, lint, typecheck)
- Using read-only CLI tools (git status, git diff, ls, etc.)
- Invoking language/package managers (npm, pnpm, yarn, pip, go, etc.) as part of the task

WHEN NOT TO USE:
- Reading files (use readFileTool instead)
- Editing or creating files (use editFileTool or writeFileTool instead)
- Searching code or text (use grepTool and/or globTool instead)
- Interactive commands (shells, editors, REPLs)

USAGE:
- Runs bash -c "<command>" in a non-interactive shell (no TTY/PTY)
- Commands automatically run in the working directory by default — do NOT prepend "cd /path &&" to commands
- NEVER prefix commands with "cd <working-directory> &&" or any path — this is the most common mistake and is always wrong
- Use the cwd parameter ONLY with a workspace-relative subdirectory when you need to run in a different directory
- Commands automatically timeout after ~2 minutes
- Combined stdout/stderr output is truncated after ~50,000 characters

DO NOT USE FOR:
- File reading (cat, head, tail) - use readFileTool
- File editing (sed, awk, editors) - use editFileTool / writeFileTool
- File creation (touch, redirections like >, >>) - use writeFileTool
- Code search (grep, rg, ag) - use grepTool

IMPORTANT:
- Never chain commands with ';' or '&&' - use separate tool calls for each logical step
- Never use interactive commands (vim, nano, top, bash, ssh, etc.)
- Always quote file paths that may contain spaces
- Use detached: true to start dev servers or other long-running processes in the background

EXAMPLES:
- Run the test suite: command: "npm test"
- Check git status: command: "git status --short"
- List files in src: command: "ls -la", cwd: "src"
- Start a dev server: command: "npm run dev", detached: true`,
    inputSchema: bashInputSchema,
    execute: async (
      { command, cwd, detached },
      { experimental_context, abortSignal },
    ) => {
      const sandbox = await getSandbox(experimental_context, "bash");
      const workingDirectory = sandbox.workingDirectory;

      // Resolve the working directory
      const workingDir = cwd
        ? path.isAbsolute(cwd)
          ? cwd
          : path.resolve(workingDirectory, cwd)
        : workingDirectory;

      // Detached mode: start the command in the background and return immediately
      if (detached) {
        if (!sandbox.execDetached) {
          return {
            success: false,
            exitCode: null,
            stdout: "",
            stderr:
              "Detached mode is not supported in this sandbox environment. Only cloud sandboxes support background processes.",
          };
        }

        try {
          const { commandId } = await sandbox.execDetached(command, workingDir);
          return {
            success: true,
            exitCode: null,
            stdout: `Process started in background (command ID: ${commandId}). The server is now running.`,
            stderr: "",
          };
        } catch (error) {
          return {
            success: false,
            exitCode: null,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      }

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
