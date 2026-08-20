import * as path from "path";
import type { Sandbox } from "@open-agents/sandbox";
import { isPathWithinDirectory, shellEscape } from "./utils";

/**
 * Suffixes that mark a dotenv file as a committed template rather than a real
 * one: `.env.example`, `.env.sample`, `.env.template`, `.env.dist`. These hold
 * placeholder keys, ship in the repository on purpose, and are exactly what an
 * agent is meant to read to learn which variables exist.
 */
const DOTENV_TEMPLATE_SUFFIXES = [".example", ".sample", ".template", ".dist"];

export function isDotEnvFilePath(filePath: string): boolean {
  const basename = path.basename(filePath.replaceAll("\\", "/")).toLowerCase();
  if (!basename.startsWith(".env")) {
    return false;
  }

  // Match on the LAST suffix only. `.env.production.example` is a template,
  // but `.env.example.local` is a real local file wearing a template-looking
  // segment in the middle, and must stay gated.
  //
  // Gating the templates is not harmless caution: a read of
  // `apps/web/.env.example` parked a headless run on an approval nobody could
  // give, because a run dispatched over MCP has no human attached.
  return !DOTENV_TEMPLATE_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

export function resolveWorkspacePath(
  filePath: string,
  workingDirectory: string,
): string | null {
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workingDirectory, filePath);

  return isPathWithinDirectory(absolutePath, workingDirectory)
    ? absolutePath
    : null;
}

export async function resolveSandboxRealPath(params: {
  sandbox: Sandbox;
  absolutePath: string;
  workingDirectory: string;
}): Promise<string | null> {
  if (typeof params.sandbox.exec !== "function") {
    return null;
  }

  const result = await params.sandbox.exec(
    `realpath -- ${shellEscape(params.absolutePath)}`,
    params.workingDirectory,
    5000,
  );

  if (!result.success) {
    return null;
  }

  const realPath = result.stdout.trim();
  if (!realPath) {
    return null;
  }

  return realPath;
}

export function isSensitiveDotEnvPath(params: {
  requestedPath: string;
  absolutePath: string;
  realPath?: string | null;
}): boolean {
  return (
    isDotEnvFilePath(params.requestedPath) ||
    isDotEnvFilePath(params.absolutePath) ||
    (params.realPath ? isDotEnvFilePath(params.realPath) : false)
  );
}
