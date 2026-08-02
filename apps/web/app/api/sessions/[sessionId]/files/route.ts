import { sandboxNotInitializedResponse } from "@/app/api/sessions/_lib/sandbox-lifecycle-response";
import { connectSandbox } from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { updateSession } from "@/lib/db/sessions";
import { buildHibernatedLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  clearUnavailableSandboxState,
  hasRuntimeSandboxState,
  isSandboxUnavailableError,
} from "@/lib/sandbox/utils";

export type FileSuggestion = {
  value: string;
  display: string;
  isDirectory: boolean;
};

export type FilesResponse = {
  files: FileSuggestion[];
};

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const MAX_FILE_SUGGESTIONS = 5000;

function getPathDepth(suggestion: FileSuggestion): number {
  const normalizedPath = suggestion.isDirectory
    ? suggestion.value.slice(0, -1)
    : suggestion.value;
  return normalizedPath ? normalizedPath.split("/").length : 0;
}

/**
 * Parse git ls-files output and extract files and directories.
 *
 * Exported for unit testing.
 *
 * Edge case: git can emit entries that end with "/" (e.g. submodule paths or
 * special tracked directories like "apps/web/public/.well-known/"). If we
 * naively emit such an entry as a file AND separately synthesise the same
 * path as a directory while processing its siblings, @pierre/trees throws
 * "Duplicate path" and crashes the file-tree UI. We fix this by:
 *   1. Skipping any raw entry that ends with "/" — it is already covered by
 *      the directory synthesis loop when real files beneath it are processed.
 *   2. Deduplicating all emitted values via a Set so no path can appear twice
 *      regardless of how git orders its output.
 */
export function parseGitFiles(output: string): FileSuggestion[] {
  const results: FileSuggestion[] = [];
  const seenDirs = new Set<string>();
  const seenValues = new Set<string>();

  const files = output.trim().split("\n").filter(Boolean);

  for (const file of files) {
    // Skip raw entries that end with "/" — these are directory hints emitted by
    // git for submodules or tracked empty dirs. The directory is already
    // synthesised below when we encounter files nested inside it. Emitting it
    // again as a non-directory entry creates a duplicate path.
    if (file.endsWith("/")) {
      // Still ensure the directory itself is recorded if we haven't seen it yet.
      const dirKey = file.slice(0, -1);
      if (!seenDirs.has(dirKey)) {
        seenDirs.add(dirKey);
        if (!seenValues.has(file)) {
          seenValues.add(file);
          results.push({ value: file, display: file, isDirectory: true });
        }
      }
      continue;
    }

    // Add parent directories
    const parts = file.split("/");
    let dirPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;
      dirPath = dirPath ? `${dirPath}/${part}` : part;
      if (!seenDirs.has(dirPath)) {
        seenDirs.add(dirPath);
        const dirValue = `${dirPath}/`;
        if (!seenValues.has(dirValue)) {
          seenValues.add(dirValue);
          results.push({
            value: dirValue,
            display: dirValue,
            isDirectory: true,
          });
        }
      }
    }

    // Add the file (guarded against duplicates in case git output has repeats)
    if (!seenValues.has(file)) {
      seenValues.add(file);
      results.push({
        value: file,
        display: file,
        isDirectory: false,
      });
    }
  }

  // Keep top-level paths first so files like README.md are always surfaced.
  results.sort((a, b) => {
    const depthDiff = getPathDepth(a) - getPathDepth(b);
    if (depthDiff !== 0) return depthDiff;
    return a.display.localeCompare(b.display);
  });

  return results;
}

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: hasRuntimeSandboxState,
    sandboxErrorMessage: "Sandbox not initialized",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return sandboxNotInitializedResponse();
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;

    // Run git commands sequentially; some sandbox backends are not reliable
    // with concurrent command streams after reconnect.
    const trackedResult = await sandbox.exec("git ls-files", cwd, 30000);
    const untrackedResult = await sandbox.exec(
      "git ls-files --others --exclude-standard",
      cwd,
      30000,
    );

    if (!trackedResult.success) {
      const stderr = trackedResult.stderr ?? "";
      if (isSandboxUnavailableError(stderr)) {
        await updateSession(sessionId, {
          sandboxState: clearUnavailableSandboxState(
            sessionRecord.sandboxState,
            stderr,
          ),
          ...buildHibernatedLifecycleUpdate(),
        });
        return Response.json(
          {
            error: "Sandbox is unavailable. Please resume sandbox.",
            errorKind: "conflict",
          },
          { status: 409 },
        );
      }
      console.error("Git ls-files failed:", trackedResult.stderr);
      return Response.json(
        {
          error: "Failed to list files. Ensure this is a git repository.",
          errorKind: "invalid_request",
        },
        { status: 400 },
      );
    }

    if (!untrackedResult.success) {
      const stderr = untrackedResult.stderr ?? "";
      if (isSandboxUnavailableError(stderr)) {
        await updateSession(sessionId, {
          sandboxState: clearUnavailableSandboxState(
            sessionRecord.sandboxState,
            stderr,
          ),
          ...buildHibernatedLifecycleUpdate(),
        });
        return Response.json(
          {
            error: "Sandbox is unavailable. Please resume sandbox.",
            errorKind: "conflict",
          },
          { status: 409 },
        );
      }
    }

    // Combine tracked and untracked files
    const trackedFiles = trackedResult.stdout.trim();
    const untrackedFiles = untrackedResult.success
      ? untrackedResult.stdout.trim()
      : "";

    const combinedOutput = [trackedFiles, untrackedFiles]
      .filter(Boolean)
      .join("\n");

    const files = parseGitFiles(combinedOutput);

    // Keep a high upper bound to avoid huge payloads on very large repos.
    const limitedFiles = files.slice(0, MAX_FILE_SUGGESTIONS);

    const response: FilesResponse = {
      files: limitedFiles,
    };

    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSandboxUnavailableError(message)) {
      await updateSession(sessionId, {
        sandboxState: clearUnavailableSandboxState(
          sessionRecord.sandboxState,
          message,
        ),
        ...buildHibernatedLifecycleUpdate(),
      });
      return Response.json(
        {
          error: "Sandbox is unavailable. Please resume sandbox.",
          errorKind: "conflict",
        },
        { status: 409 },
      );
    }
    console.error("Failed to list files:", error);
    return Response.json(
      { error: "Failed to connect to sandbox", errorKind: "internal_error" },
      { status: 500 },
    );
  }
}
