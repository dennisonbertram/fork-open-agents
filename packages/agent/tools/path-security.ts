import * as path from "path";
import type { Sandbox } from "@open-agents/sandbox";
import { isPathWithinDirectory, shellEscape } from "./utils";

/**
 * Suffixes a dotenv file carries when it is meant to be a committed template
 * rather than a live one: `.env.example`, `.env.sample`, `.env.template`,
 * `.env.dist`.
 *
 * The suffix alone proves nothing. A developer can create an untracked
 * `.env.example` holding real credentials, or fill a tracked one in locally.
 * Use `isCommittedDotEnvTemplate`, which checks the claim against git, rather
 * than trusting the name.
 */
const DOTENV_TEMPLATE_SUFFIXES = [".example", ".sample", ".template", ".dist"];

export function isDotEnvFilePath(filePath: string): boolean {
  const basename = path.basename(filePath.replaceAll("\\", "/")).toLowerCase();
  return basename.startsWith(".env");
}

function hasDotEnvTemplateSuffix(filePath: string): boolean {
  const basename = path.basename(filePath.replaceAll("\\", "/")).toLowerCase();
  if (!basename.startsWith(".env")) {
    return false;
  }

  // The LAST suffix decides. `.env.production.example` is a template;
  // `.env.example.local` is a real local file wearing a template-looking
  // segment in the middle, and must not qualify.
  return DOTENV_TEMPLATE_SUFFIXES.some((suffix) => basename.endsWith(suffix));
}

/**
 * Whether a path is a dotenv template that git confirms is committed and
 * unmodified — the only kind safe to read or write without a human.
 *
 * Gating every `.env*` name wedged a headless run on an approval nobody could
 * give, for `apps/web/.env.example`: a committed placeholder file an agent is
 * meant to read. But the name is not evidence. This asks git instead, and
 * fails closed — no sandbox, no exec, a non-zero exit, or any local
 * modification all mean "keep it gated".
 *
 * `git status --porcelain` prints nothing for a tracked, unmodified path, and
 * prints a status line for anything untracked or changed. One command answers
 * both halves of the claim.
 */
export async function isCommittedDotEnvTemplate(params: {
  sandbox: Sandbox;
  absolutePath: string;
  workingDirectory: string;
}): Promise<boolean> {
  if (!hasDotEnvTemplateSuffix(params.absolutePath)) {
    return false;
  }

  if (typeof params.sandbox.exec !== "function") {
    return false;
  }

  let result: Awaited<ReturnType<Sandbox["exec"]>>;
  try {
    result = await params.sandbox.exec(
      `git status --porcelain -- ${shellEscape(params.absolutePath)}`,
      params.workingDirectory,
      5000,
    );
  } catch {
    return false;
  }

  if (!result.success) {
    return false;
  }

  return result.stdout.trim() === "";
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
