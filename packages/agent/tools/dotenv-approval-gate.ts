import {
  isCommittedDotEnvTemplate,
  isDotEnvFilePath,
  isSensitiveDotEnvPath,
  resolveSandboxRealPath,
  resolveWorkspacePath,
} from "./path-security";
import { getSandbox } from "./utils";

/**
 * Shared dotenv approval gate for read/write/edit.
 *
 * A dotenv name alone no longer decides. The sandbox is needed either way:
 * to resolve symlinks, and to ask git whether a template really is a
 * committed, unmodified placeholder. No sandbox means fail closed for
 * anything dotenv-shaped.
 */
export async function requiresDotEnvApproval(params: {
  filePath: string;
  experimental_context: unknown;
  toolName: string;
}): Promise<boolean> {
  let sandbox;
  try {
    sandbox = await getSandbox(params.experimental_context, params.toolName);
  } catch {
    return isDotEnvFilePath(params.filePath);
  }
  const workingDirectory = sandbox.workingDirectory;
  const absolutePath = resolveWorkspacePath(params.filePath, workingDirectory);
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
      requestedPath: params.filePath,
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
}
