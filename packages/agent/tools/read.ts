import { tool } from "ai";
import { z } from "zod";
import { getSandbox, toDisplayPath } from "./utils";
import {
  isCommittedDotEnvTemplate,
  isDotEnvFilePath,
  isSensitiveDotEnvPath,
  resolveSandboxRealPath,
  resolveWorkspacePath,
} from "./path-security";

const readInputSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Workspace-relative path to the file to read (e.g., src/index.ts)",
    ),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-indexed)"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of lines to read. Default: 2000"),
});

export const readFileTool = () =>
  tool({
    needsApproval: async ({ filePath }, { experimental_context }) => {
      // A dotenv name alone no longer decides. The sandbox is needed either
      // way: to resolve symlinks, and to ask git whether a template really is
      // a committed, unmodified placeholder. No sandbox means fail closed for
      // anything dotenv-shaped.
      let sandbox;
      try {
        sandbox = await getSandbox(experimental_context, "read");
      } catch {
        return isDotEnvFilePath(filePath);
      }
      const workingDirectory = sandbox.workingDirectory;
      const absolutePath = resolveWorkspacePath(filePath, workingDirectory);
      if (!absolutePath) {
        return false;
      }

      const realPath = await resolveSandboxRealPath({
        sandbox,
        absolutePath,
        workingDirectory,
      });

      if (
        !isSensitiveDotEnvPath({
          requestedPath: filePath,
          absolutePath,
          realPath,
        })
      ) {
        return false;
      }

      // It is dotenv-shaped. Only a template git confirms is committed and
      // unmodified skips approval; everything else stays gated. Checked
      // against the resolved real path so a symlink cannot launder a live
      // dotenv file behind a template name.
      return !(await isCommittedDotEnvTemplate({
        sandbox,
        absolutePath: realPath ?? absolutePath,
        workingDirectory,
      }));
    },
    description: `Read a file from the filesystem.

USAGE:
- Use workspace-relative paths (e.g., "src/index.ts")
- Paths are resolved from the workspace root
- By default reads up to 2000 lines starting from line 1
- Use offset and limit for long files (both are line-based, 1-indexed)
- Results include line numbers starting at 1 in "N: content" format

IMPORTANT:
- Always read a file at least once before editing it with the edit/write tools
- This tool can only read files, not directories - attempting to read a directory returns an error
- You can call multiple reads in parallel to speculatively load several files

EXAMPLES:
- Read an entire file: filePath: "src/index.ts"
- Read a slice of a long file: filePath: "logs/app.log", offset: 500, limit: 200`,
    inputSchema: readInputSchema,
    execute: async (
      { filePath, offset = 1, limit = 2000 },
      { experimental_context },
    ) => {
      const sandbox = await getSandbox(experimental_context, "read");
      const workingDirectory = sandbox.workingDirectory;

      try {
        const absolutePath = resolveWorkspacePath(filePath, workingDirectory);
        if (!absolutePath) {
          return {
            success: false,
            error: "Path must stay within the workspace.",
          };
        }

        const realPath = await resolveSandboxRealPath({
          sandbox,
          absolutePath,
          workingDirectory,
        });
        if (realPath && !resolveWorkspacePath(realPath, workingDirectory)) {
          return {
            success: false,
            error: "Path resolves outside the workspace.",
          };
        }

        const stats = await sandbox.stat(absolutePath);
        if (stats.isDirectory()) {
          return {
            success: false,
            error: "Cannot read a directory. Use glob or ls command instead.",
          };
        }

        const content = await sandbox.readFile(absolutePath, "utf-8");
        const lines = content.split("\n");
        const startLine = Math.max(1, offset) - 1;
        const endLine = Math.min(lines.length, startLine + limit);
        const selectedLines = lines.slice(startLine, endLine);

        const numberedLines = selectedLines.map(
          (line, i) => `${startLine + i + 1}: ${line}`,
        );

        return {
          success: true,
          path: toDisplayPath(absolutePath, workingDirectory),
          totalLines: lines.length,
          startLine: startLine + 1,
          endLine,
          content: numberedLines.join("\n"),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to read file: ${message}`,
        };
      }
    },
  });
