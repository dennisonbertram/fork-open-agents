import { createEmptyGitHubRepo } from "@/app/api/github/repos/_lib/create-empty-repo";
import { getUserOctokit } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/token";
import { getGitHubUserProfile } from "@/lib/github/users";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreateEmptyRepoRequest {
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  /** The account login to create the repo under (org name or username) */
  owner?: string;
}

// GitHub repo names: alphanumerics, hyphens, underscores, periods; max 100.
const REPO_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

function logEvent(
  event: string,
  level: "info" | "error",
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({ event, level, ...fields });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function errorJson(error: string, errorKind: string, status: number): Response {
  return Response.json({ error, errorKind }, { status });
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return errorJson("Not authenticated", "unauthorized", 401);
  }
  const userId = session.user.id;

  // 2. Parse and validate request
  let body: CreateEmptyRepoRequest;
  try {
    body = (await req.json()) as CreateEmptyRepoRequest;
  } catch {
    return errorJson("Invalid JSON body", "invalid_request", 400);
  }

  const { repoName, description, isPrivate, owner } = body;

  if (!repoName) {
    return errorJson("Repository name is required", "invalid_request", 400);
  }
  if (!REPO_NAME_PATTERN.test(repoName)) {
    return errorJson(
      "Repository name may only contain letters, numbers, hyphens, underscores, and periods (max 100 characters).",
      "invalid_request",
      400,
    );
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["github-create-empty-repo", userId]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  // 3. Resolve the user's GitHub OAuth token. Installation tokens cannot
  // create repositories on user accounts, so the user token is required here.
  const repoToken = await getUserGitHubToken(userId);
  const octokit = repoToken ? await getUserOctokit(userId) : null;
  if (!repoToken || !octokit) {
    logEvent("create-empty-repo.refused", "info", {
      userId,
      owner: owner ?? null,
      errorKind: "github_not_connected",
      status: 401,
    });
    return errorJson(
      "GitHub not connected. Connect GitHub before creating a repository.",
      "github_not_connected",
      401,
    );
  }

  // 4. Resolve owner type: personal account vs organization.
  const ghProfile = await getGitHubUserProfile(userId);
  const githubUsername = ghProfile?.username?.trim();
  let accountType: "User" | "Organization" | undefined;
  if (owner) {
    accountType =
      githubUsername && owner.toLowerCase() === githubUsername.toLowerCase()
        ? "User"
        : "Organization";
  }

  logEvent("create-empty-repo.start", "info", {
    userId,
    owner: owner ?? githubUsername ?? null,
    isPrivate: isPrivate === true,
  });

  // 5. Create the empty repository on GitHub.
  const result = await createEmptyGitHubRepo({
    octokit,
    repoName,
    description,
    isPrivate,
    owner,
    accountType,
  });

  if (!result.ok) {
    logEvent(
      result.status >= 500
        ? "create-empty-repo.failed"
        : "create-empty-repo.refused",
      result.status >= 500 ? "error" : "info",
      {
        userId,
        owner: owner ?? null,
        errorKind: result.errorKind,
        status: result.status,
      },
    );
    return errorJson(result.error, result.errorKind, result.status);
  }

  logEvent("create-empty-repo.repo_created", "info", {
    userId,
    owner: result.owner,
    repoName: result.repoName,
    repoUrl: result.repoUrl ?? null,
    isPrivate: isPrivate === true,
  });

  return Response.json({
    success: true,
    owner: result.owner,
    repoName: result.repoName,
    repoUrl: result.repoUrl,
    cloneUrl: result.cloneUrl,
  });
}
