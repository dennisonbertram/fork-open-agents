import { connectSandbox } from "@open-agents/sandbox";
import { runCreateRepoWorkflow } from "@/app/api/github/create-repo/_lib/create-repo-workflow";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { getUserOctokit } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/token";
import { getGitHubUserProfile } from "@/lib/github/users";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// Allow up to 2 minutes for git operations
export const maxDuration = 120;

interface CreateRepoRequest {
  sessionId: string;
  repoName: string;
  description?: string;
  isPrivate?: boolean;
  sessionTitle: string;
  /** The account login to create the repo under (org name or username) */
  owner?: string;
}

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

  // 2. Parse request
  let body: CreateRepoRequest;
  try {
    body = (await req.json()) as CreateRepoRequest;
  } catch {
    return errorJson("Invalid JSON body", "invalid_request", 400);
  }

  const { sessionId, repoName, description, isPrivate, sessionTitle, owner } =
    body;

  if (!sessionId) {
    return errorJson("Session ID is required", "invalid_request", 400);
  }
  if (!repoName) {
    return errorJson("Repository name is required", "invalid_request", 400);
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["github-create-repo", userId]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  // 3. Verify session ownership and state
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return errorJson("Session not found", "not_found", 404);
  }
  if (sessionRecord.userId !== userId) {
    logEvent("create-repo.refused", "info", {
      userId,
      sessionId,
      errorKind: "forbidden",
    });
    return errorJson("Access denied", "forbidden", 403);
  }

  if (sessionRecord.cloneUrl) {
    logEvent("create-repo.refused", "info", {
      userId,
      sessionId,
      errorKind: "invalid_request",
    });
    return errorJson(
      "Session already has a repository",
      "invalid_request",
      400,
    );
  }

  if (!isSandboxActive(sessionRecord.sandboxState)) {
    logEvent("create-repo.refused", "info", {
      userId,
      sessionId,
      errorKind: "sandbox_unavailable",
    });
    return errorJson(
      "Sandbox not active. Please wait for the sandbox to start.",
      "sandbox_unavailable",
      400,
    );
  }

  // 4. Resolve the user's GitHub OAuth token. Installation tokens cannot
  // create repositories on user accounts, so the user token is required here.
  const repoToken = await getUserGitHubToken(userId);
  const octokit = repoToken ? await getUserOctokit(userId) : null;
  if (!repoToken || !octokit) {
    logEvent("create-repo.refused", "info", {
      userId,
      sessionId,
      errorKind: "github_not_connected",
    });
    return errorJson(
      "GitHub not connected. Connect GitHub before creating a repository.",
      "github_not_connected",
      401,
    );
  }

  // 5. Resolve owner type: personal account vs organization.
  const ghProfile = await getGitHubUserProfile(userId);
  const githubUsername = ghProfile?.username?.trim();
  let accountType: "User" | "Organization" | undefined;
  if (owner) {
    accountType =
      githubUsername && owner.toLowerCase() === githubUsername.toLowerCase()
        ? "User"
        : "Organization";
  }

  logEvent("create-repo.start", "info", {
    userId,
    sessionId,
    owner: owner ?? githubUsername ?? null,
    isPrivate: isPrivate === true,
  });

  // 6. Connect to the sandbox and run the create + push pipeline.
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  const workflowResult = await runCreateRepoWorkflow({
    octokit,
    sandbox,
    cwd,
    repoName,
    description,
    isPrivate,
    sessionTitle: sessionTitle ?? repoName,
    owner,
    accountType,
    repoToken,
    sessionUser: {
      id: userId,
      username: session.user.username,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    },
  });
  if (!workflowResult.ok) {
    const status = workflowResult.response.status;
    logEvent(
      status >= 500 ? "create-repo.push_failed" : "create-repo.refused",
      status >= 500 ? "error" : "info",
      { userId, sessionId, status },
    );
    return workflowResult.response;
  }

  // 7. Update the session with the new repo identity.
  await updateSession(sessionId, {
    repoOwner: workflowResult.owner,
    repoName: workflowResult.repoName,
    cloneUrl: `https://github.com/${workflowResult.owner}/${workflowResult.repoName}`,
    branch: workflowResult.branch,
    isNewBranch: false,
  });

  logEvent("create-repo.repo_created", "info", {
    userId,
    sessionId,
    owner: workflowResult.owner,
    repoName: workflowResult.repoName,
    repoUrl: workflowResult.repoUrl ?? null,
    isPrivate: isPrivate === true,
  });

  return Response.json({
    success: true,
    repoUrl: workflowResult.repoUrl,
    cloneUrl: workflowResult.cloneUrl,
    owner: workflowResult.owner,
    repoName: workflowResult.repoName,
    branch: workflowResult.branch,
  });
}
