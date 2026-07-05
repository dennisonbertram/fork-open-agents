import "server-only";

import type { Sandbox } from "@open-agents/sandbox";

const DEFAULT_HOME_DIRECTORY = "/root";
const HOME_RESOLUTION_TIMEOUT_MS = 5_000;

const homeDirectoryCache = new WeakMap<Sandbox, string>();

export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function resolveSandboxHomeDirectory(
  sandbox: Sandbox,
): Promise<string> {
  const cached = homeDirectoryCache.get(sandbox);
  if (cached !== undefined) {
    return cached;
  }

  const result = await sandbox.exec(
    'printf %s "$HOME"',
    sandbox.workingDirectory,
    HOME_RESOLUTION_TIMEOUT_MS,
  );
  const homeDirectory = result.success ? result.stdout.trim() : "";

  // Only cache successful results that are non-empty
  if (homeDirectory) {
    homeDirectoryCache.set(sandbox, homeDirectory);
    return homeDirectory;
  }

  // On failure or empty result, return default without caching
  // so a transient failure does not pin the default for the sandbox lifetime
  return DEFAULT_HOME_DIRECTORY;
}
