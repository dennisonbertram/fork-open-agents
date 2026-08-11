import { after } from "next/server";
import { isKnownManagedRuntimeProfileReference } from "@/lib/db/managed-runtime-saved-profiles";
import { checkBotProtection } from "@/lib/botid";
import {
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
} from "@/lib/db/sessions";
import {
  getVercelProjectLinkByRepo,
  upsertVercelProjectLink,
} from "@/lib/db/vercel-project-links";
import {
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
  parseGitHubHttpsUrl,
} from "@/lib/github/urls";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getServerSession } from "@/lib/session/get-server-session";
import { createSessionCore } from "@/lib/sessions/create-session";
import {
  isVercelInvalidTokenError,
  listMatchingVercelProjects,
} from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";
import {
  vercelProjectSelectionSchema,
  type VercelProjectSelection,
} from "@/lib/vercel/types";

interface CreateSessionRequest {
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch?: boolean;
  fullClone?: boolean;
  sandboxType?: "vercel";
  runtimeMode?: "classic" | "managed_runtime";
  managedRuntimeProfileId?: string;
  autoCommitPush?: boolean;
  autoCreatePr?: boolean;
  vercelProject?: VercelProjectSelection | null;
}

const DEFAULT_ARCHIVED_SESSIONS_LIMIT = 50;
const MAX_ARCHIVED_SESSIONS_LIMIT = 100;

type SessionsStatusFilter = "all" | "active" | "archived";

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  return Number(value);
}

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json(
      { error: "Not authenticated", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get("status");
  if (
    rawStatus !== null &&
    rawStatus !== "all" &&
    rawStatus !== "active" &&
    rawStatus !== "archived"
  ) {
    return Response.json(
      { error: "Invalid status filter", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  const statusParam: SessionsStatusFilter = rawStatus ?? "all";

  if (statusParam === "archived") {
    const rawLimit = parseNonNegativeInteger(searchParams.get("limit"));
    const rawOffset = parseNonNegativeInteger(searchParams.get("offset"));

    if (searchParams.get("limit") !== null && rawLimit === null) {
      return Response.json(
        { error: "Invalid archived limit", errorKind: "invalid_request" },
        { status: 400 },
      );
    }

    if (searchParams.get("offset") !== null && rawOffset === null) {
      return Response.json(
        { error: "Invalid archived offset", errorKind: "invalid_request" },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Math.max(rawLimit ?? DEFAULT_ARCHIVED_SESSIONS_LIMIT, 1),
      MAX_ARCHIVED_SESSIONS_LIMIT,
    );
    const offset = rawOffset ?? 0;

    const [sessions, archivedCount] = await Promise.all([
      getSessionsWithUnreadByUserId(session.user.id, {
        status: "archived",
        limit,
        offset,
      }),
      getArchivedSessionCountByUserId(session.user.id),
    ]);

    return Response.json({
      sessions,
      archivedCount,
      pagination: {
        limit,
        offset,
        hasMore: offset + sessions.length < archivedCount,
        nextOffset: offset + sessions.length,
      },
    });
  }

  if (statusParam === "active") {
    const [sessions, archivedCount] = await Promise.all([
      getSessionsWithUnreadByUserId(session.user.id, {
        status: "active",
      }),
      getArchivedSessionCountByUserId(session.user.id),
    ]);

    return Response.json({ sessions, archivedCount });
  }

  const sessions = await getSessionsWithUnreadByUserId(session.user.id);
  return Response.json({ sessions });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json(
      { error: "Not authenticated", errorKind: "unauthorized" },
      { status: 401 },
    );
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json(
      { error: "Access denied", errorKind: "forbidden" },
      { status: 403 },
    );
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["sessions-create", session.user.id]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  let body: CreateSessionRequest;
  try {
    body = (await req.json()) as CreateSessionRequest;
  } catch {
    return Response.json(
      { error: "Invalid JSON body", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json(
      { error: "Invalid sandbox type", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (
    body.runtimeMode !== undefined &&
    body.runtimeMode !== "classic" &&
    body.runtimeMode !== "managed_runtime"
  ) {
    return Response.json(
      { error: "Invalid runtime mode", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (body.managedRuntimeProfileId !== undefined) {
    // Codex #834 P2: a non-string value here (null, object, array) must be
    // rejected with the same structured 400 before it ever reaches
    // isKnownManagedRuntimeProfileReference, which expects a string —
    // passing a malformed value straight through could otherwise surface as
    // a 500 instead of a clean 400.
    if (typeof body.managedRuntimeProfileId !== "string") {
      return Response.json(
        {
          error: "Invalid managed runtime profile",
          errorKind: "profile_not_found",
          nextAction:
            "This profile no longer exists. Choose another profile or recreate it.",
        },
        { status: 400 },
      );
    }

    // A brand-new session has no session-scope saved profiles yet, so only
    // the built-in and owned user_default arms of the reference check are
    // reachable here — the sessionId is a placeholder for that reason.
    const isKnown = await isKnownManagedRuntimeProfileReference({
      userId: session.user.id,
      sessionId: "__new_session__",
      profileId: body.managedRuntimeProfileId,
    });
    if (!isKnown) {
      return Response.json(
        {
          error: "Invalid managed runtime profile",
          errorKind: "profile_not_found",
          nextAction:
            "This profile no longer exists. Choose another profile or recreate it.",
        },
        { status: 400 },
      );
    }
  }

  if (
    body.autoCommitPush !== undefined &&
    typeof body.autoCommitPush !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCommitPush value", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (
    body.autoCreatePr !== undefined &&
    typeof body.autoCreatePr !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCreatePr value", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (
    body.repoOwner !== undefined &&
    (typeof body.repoOwner !== "string" ||
      !isValidGitHubRepoOwner(body.repoOwner))
  ) {
    return Response.json(
      { error: "Invalid repository owner", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (
    body.repoName !== undefined &&
    (typeof body.repoName !== "string" || !isValidGitHubRepoName(body.repoName))
  ) {
    return Response.json(
      { error: "Invalid repository name", errorKind: "invalid_request" },
      { status: 400 },
    );
  }

  if (body.cloneUrl !== undefined) {
    if (typeof body.cloneUrl !== "string") {
      return Response.json(
        { error: "Invalid clone URL", errorKind: "invalid_request" },
        { status: 400 },
      );
    }

    const parsedCloneUrl = parseGitHubHttpsUrl(body.cloneUrl);
    if (
      !parsedCloneUrl ||
      parsedCloneUrl.owner !== body.repoOwner ||
      parsedCloneUrl.repo !== body.repoName
    ) {
      return Response.json(
        {
          error: "Clone URL must match repository owner and name",
          errorKind: "invalid_request",
        },
        { status: 400 },
      );
    }
  }

  let explicitVercelProject: VercelProjectSelection | null | undefined;
  if (body.vercelProject === null) {
    explicitVercelProject = null;
  } else if (body.vercelProject !== undefined) {
    const parsedProject = vercelProjectSelectionSchema.safeParse(
      body.vercelProject,
    );
    if (!parsedProject.success) {
      return Response.json(
        { error: "Invalid Vercel project", errorKind: "invalid_request" },
        { status: 400 },
      );
    }
    explicitVercelProject = parsedProject.data;
  }

  const {
    repoOwner,
    repoName,
    branch,
    cloneUrl,
    isNewBranch: bodyIsNewBranch,
    fullClone,
    sandboxType = "vercel",
    runtimeMode: bodyRuntimeMode,
    managedRuntimeProfileId,
    autoCommitPush,
    autoCreatePr,
  } = body;

  const hasRepo = Boolean(repoOwner && repoName);

  try {
    let resolvedVercelProject: VercelProjectSelection | null = null;
    if (hasRepo && repoOwner && repoName) {
      if (explicitVercelProject) {
        const vercelToken = await getUserVercelToken(session.user.id);
        if (!vercelToken) {
          return Response.json(
            {
              error: "Connect Vercel to select a Vercel project",
              errorKind: "forbidden",
            },
            { status: 403 },
          );
        }

        const matchingProjects = await listMatchingVercelProjects({
          token: vercelToken,
          repoOwner,
          repoName,
        });
        const matchedProject =
          matchingProjects.find(
            (project) => project.projectId === explicitVercelProject.projectId,
          ) ?? null;
        if (!matchedProject) {
          return Response.json(
            {
              error:
                "Selected Vercel project no longer matches this repository",
              errorKind: "invalid_request",
            },
            { status: 400 },
          );
        }

        await upsertVercelProjectLink({
          userId: session.user.id,
          repoOwner,
          repoName,
          project: matchedProject,
        });
        resolvedVercelProject = matchedProject;
      } else if (explicitVercelProject === undefined) {
        resolvedVercelProject = await getVercelProjectLinkByRepo(
          session.user.id,
          repoOwner,
          repoName,
        );
      }
    }

    const result = await createSessionCore({
      userId: session.user.id,
      username: session.user.username,
      name: session.user.name,
      title: body.title,
      repoOwner,
      repoName,
      branch,
      cloneUrl,
      isNewBranch: bodyIsNewBranch,
      fullClone,
      sandboxType,
      runtimeMode: bodyRuntimeMode,
      managedRuntimeProfileId,
      autoCommitPush,
      autoCreatePr,
      resolvedVercelProject,
      scheduleBackgroundWork: after,
    });

    return Response.json(result);
  } catch (error) {
    if (isVercelInvalidTokenError(error)) {
      console.warn(
        JSON.stringify({
          event: "create_session_failed",
          userId: session.user.id,
          errorKind: "vercel_reauth_required",
          message:
            "Vercel token is invalid; reconnect required to create a session with env sync.",
        }),
      );
      return Response.json(
        {
          error: "Reconnect Vercel to select a Vercel project",
          kind: "vercel_reauth_required",
          actionUrl: "/settings",
          errorKind: "forbidden",
        },
        { status: 403 },
      );
    }

    // Redaction: never log the raw error object (may contain provider
    // tokens or stack traces with secrets) — log only error.message.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "create_session_failed",
        userId: session.user.id,
        errorKind: "unknown",
        message,
      }),
    );
    return Response.json(
      {
        error: "Failed to create session",
        kind: "unknown",
        errorKind: "internal_error",
      },
      { status: 500 },
    );
  }
}
