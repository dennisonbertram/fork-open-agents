import type { Sandbox } from "@open-agents/sandbox";
import { withTemporaryGitHubAuth } from "@open-agents/sandbox";
import { gateway, generateText } from "ai";
import { getGitHubUserProfile } from "@/lib/github/users";

// Escape shell metacharacters to prevent command injection
const escapeShellArg = (arg: string) => `'${arg.replace(/'/g, "'\\''")}'`;

/** Minimal structural slice of Octokit used by this workflow. */
export interface CreateRepoOctokit {
  rest: {
    repos: {
      createForAuthenticatedUser(params: {
        name: string;
        description?: string;
        private?: boolean;
      }): Promise<{ data: CreatedRepoData }>;
      createInOrg(params: {
        org: string;
        name: string;
        description?: string;
        private?: boolean;
      }): Promise<{ data: CreatedRepoData }>;
    };
  };
}

interface CreatedRepoData {
  html_url?: string;
  clone_url?: string;
  name?: string;
  owner?: { login?: string } | null;
}

type SessionUser = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
};

type WorkflowSandbox = Pick<Sandbox, "exec" | "setGitHubAuthToken">;

type WorkflowResult =
  | { ok: false; response: Response }
  | {
      ok: true;
      repoUrl: string | undefined;
      cloneUrl: string;
      owner: string;
      repoName: string;
      branch: "main";
    };

export interface RunCreateRepoWorkflowParams {
  octokit: CreateRepoOctokit;
  sandbox: WorkflowSandbox;
  cwd: string;
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  sessionTitle: string;
  owner?: string;
  accountType?: "User" | "Organization";
  repoToken: string;
  sessionUser: SessionUser;
}

function errorResponse(
  error: string,
  errorKind: string,
  status: number,
): { ok: false; response: Response } {
  return {
    ok: false,
    response: Response.json({ error, errorKind }, { status }),
  };
}

function githubStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function githubMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function runCreateRepoWorkflow({
  octokit,
  sandbox,
  cwd,
  repoName,
  description,
  isPrivate,
  sessionTitle,
  owner,
  accountType,
  repoToken,
  sessionUser,
}: RunCreateRepoWorkflowParams): Promise<WorkflowResult> {
  // 1. Check if there are any files to push, before touching GitHub.
  const filesResult = await sandbox.exec("ls -A", cwd, 10000);
  if (!filesResult.success || !filesResult.stdout.trim()) {
    return errorResponse(
      "No files in sandbox. Create some files before creating a repository.",
      "workspace_empty",
      400,
    );
  }

  // 2. Create the GitHub repository with the user's OAuth token. Installation
  // tokens cannot create repos on user accounts, so the user token is the only
  // identity that covers both user and org owners.
  let repoData: CreatedRepoData;
  try {
    const response =
      accountType === "Organization" && owner
        ? await octokit.rest.repos.createInOrg({
            org: owner,
            name: repoName,
            description,
            private: isPrivate,
          })
        : await octokit.rest.repos.createForAuthenticatedUser({
            name: repoName,
            description,
            private: isPrivate,
          });
    repoData = response.data;
  } catch (error) {
    const status = githubStatus(error);
    if (status === 422) {
      return errorResponse(
        owner
          ? `A repository named "${repoName}" already exists under ${owner}.`
          : `A repository named "${repoName}" already exists.`,
        "repo_name_taken",
        409,
      );
    }
    if (status === 403 || status === 404) {
      return errorResponse(
        "GitHub rejected the request. Reconnect GitHub to grant repository creation access, then try again.",
        "github_scope_required",
        403,
      );
    }
    return errorResponse(
      githubMessage(error, "Failed to create repository"),
      "github_error",
      502,
    );
  }

  const repoOwner = repoData.owner?.login ?? owner;
  if (!repoData.clone_url || !repoOwner || !repoData.name) {
    return errorResponse(
      "Repository created but GitHub returned incomplete data.",
      "create_repo_failed",
      500,
    );
  }

  // Helper to create error responses with context about the created repo.
  const repoCreatedError = (message: string) =>
    errorResponse(
      `${message}. Note: Repository "${repoOwner}/${repoData.name}" was created on GitHub. You may need to delete it manually before retrying.`,
      "create_repo_failed",
      500,
    );

  // 3. Initialize git if not already initialized.
  const gitCheckResult = await sandbox.exec(
    "git rev-parse --git-dir",
    cwd,
    5000,
  );
  if (!gitCheckResult.success) {
    const initResult = await sandbox.exec("git init", cwd, 10000);
    if (!initResult.success) {
      return repoCreatedError("Failed to initialize git repository");
    }
  }

  // 4. Configure git author identity (GitHub noreply email preferred).
  const ghProfile = await getGitHubUserProfile(sessionUser.id);
  const githubNoreplyEmail =
    ghProfile?.externalUserId && ghProfile.username
      ? `${ghProfile.externalUserId}+${ghProfile.username}@users.noreply.github.com`
      : undefined;
  const userName =
    sessionUser.name ?? ghProfile?.username ?? sessionUser.username;
  const userEmail =
    githubNoreplyEmail ??
    sessionUser.email ??
    `${sessionUser.username}@users.noreply.github.com`;

  await sandbox.exec(
    `git config user.name ${escapeShellArg(userName)}`,
    cwd,
    5000,
  );
  await sandbox.exec(
    `git config user.email ${escapeShellArg(userEmail)}`,
    cwd,
    5000,
  );

  // 5. Add remote origin. The URL carries no credentials; the push authenticates
  // through the sandbox credential broker instead.
  await sandbox.exec("git remote remove origin 2>/dev/null || true", cwd, 5000);
  const addRemoteResult = await sandbox.exec(
    `git remote add origin ${escapeShellArg(repoData.clone_url)}`,
    cwd,
    5000,
  );
  if (!addRemoteResult.success) {
    return repoCreatedError("Failed to add remote origin");
  }

  // 6. Stage all files.
  const addResult = await sandbox.exec("git add -A", cwd, 10000);
  if (!addResult.success) {
    return repoCreatedError("Failed to stage files");
  }

  // 7. Generate a commit message with AI (fallback to a static message).
  const diffResult = await sandbox.exec("git diff --cached --stat", cwd, 30000);
  let commitMessage = "feat: initial commit";

  // Sanitize sessionTitle to prevent prompt injection and limit length.
  const sanitizedSessionTitle = sessionTitle
    .slice(0, 200)
    .replace(/[^\w\s.,!?-]/g, "");

  try {
    const commitMsgResult = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for an initial commit of a new project. Use conventional commit format. One line only, max 72 characters.

Session context: ${sanitizedSessionTitle}

Files being committed:
${diffResult.stdout.slice(0, 4000)}

Respond with ONLY the commit message, nothing else.`,
    });
    commitMessage = commitMsgResult.text.trim() || "feat: initial commit";
  } catch {
    // Use fallback message if AI generation fails
  }

  const commitResult = await sandbox.exec(
    `git commit -m ${escapeShellArg(commitMessage)}`,
    cwd,
    10000,
  );
  if (!commitResult.success) {
    return repoCreatedError(
      `Failed to commit: ${commitResult.stderr.slice(0, 200)}`,
    );
  }

  // 8. Rename branch to main.
  await sandbox.exec("git branch -M main", cwd, 5000);

  // 9. Push, brokering the token through the sandbox credential helper so it
  // never lands in the repo's git config. The broker is always cleared.
  const pushResult = await withTemporaryGitHubAuth(
    sandbox as Sandbox,
    repoToken,
    () => sandbox.exec("git push -u origin main", cwd, 60000),
  );
  if (!pushResult.success) {
    return repoCreatedError("Failed to push to remote");
  }

  return {
    ok: true,
    repoUrl: repoData.html_url,
    cloneUrl: repoData.clone_url,
    owner: repoOwner,
    repoName: repoData.name,
    branch: "main",
  };
}
