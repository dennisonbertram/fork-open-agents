import { nanoid } from "nanoid";
import { isManagedRuntimeProfileId } from "@open-agents/sandbox/managed-runtime-profiles";
import { checkBotProtection } from "@/lib/botid";
import {
  createSessionWithInitialChat,
  getArchivedSessionCountByUserId,
  getSessionsWithUnreadByUserId,
  getUsedSessionTitles,
} from "@/lib/db/sessions";
import {
  getVercelProjectLinkByRepo,
  upsertVercelProjectLink,
} from "@/lib/db/vercel-project-links";
import { isComposioProfileAllowedForRepository } from "@/lib/db/composio";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { resolveRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";
import {
  isValidGitHubRepoName,
  isValidGitHubRepoOwner,
  parseGitHubHttpsUrl,
} from "@/lib/github/urls";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getRandomCityName } from "@/lib/random-city";
import { getServerSession } from "@/lib/session/get-server-session";
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
  managedRuntimeProfileId?: string;
  autoCommitPush?: boolean;
  autoCreatePr?: boolean;
  vercelProject?: VercelProjectSelection | null;
}

function generateBranchName(username: string, name?: string | null): string {
  let initials = "nb";
  if (name) {
    initials =
      name
        .split(" ")
        .map((n) => n[0]?.toLowerCase() ?? "")
        .join("")
        .slice(0, 2) || "nb";
  } else if (username) {
    initials = username.slice(0, 2).toLowerCase();
  }
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${initials}/${randomSuffix}`;
}

async function resolveSessionTitle(
  input: CreateSessionRequest,
  userId: string,
): Promise<string> {
  if (input.title && input.title.trim()) {
    return input.title.trim();
  }
  const usedNames = await getUsedSessionTitles(userId);
  return getRandomCityName(usedNames);
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
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get("status");
  if (
    rawStatus !== null &&
    rawStatus !== "all" &&
    rawStatus !== "active" &&
    rawStatus !== "archived"
  ) {
    return Response.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const statusParam: SessionsStatusFilter = rawStatus ?? "all";

  if (statusParam === "archived") {
    const rawLimit = parseNonNegativeInteger(searchParams.get("limit"));
    const rawOffset = parseNonNegativeInteger(searchParams.get("offset"));

    if (searchParams.get("limit") !== null && rawLimit === null) {
      return Response.json(
        { error: "Invalid archived limit" },
        { status: 400 },
      );
    }

    if (searchParams.get("offset") !== null && rawOffset === null) {
      return Response.json(
        { error: "Invalid archived offset" },
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
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.sandboxType && body.sandboxType !== "vercel") {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
  }

  if (
    body.managedRuntimeProfileId !== undefined &&
    !isManagedRuntimeProfileId(body.managedRuntimeProfileId)
  ) {
    return Response.json(
      { error: "Invalid managed runtime profile" },
      { status: 400 },
    );
  }

  if (
    body.autoCommitPush !== undefined &&
    typeof body.autoCommitPush !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCommitPush value" },
      { status: 400 },
    );
  }

  if (
    body.autoCreatePr !== undefined &&
    typeof body.autoCreatePr !== "boolean"
  ) {
    return Response.json(
      { error: "Invalid autoCreatePr value" },
      { status: 400 },
    );
  }

  if (
    body.repoOwner !== undefined &&
    (typeof body.repoOwner !== "string" ||
      !isValidGitHubRepoOwner(body.repoOwner))
  ) {
    return Response.json(
      { error: "Invalid repository owner" },
      { status: 400 },
    );
  }

  if (
    body.repoName !== undefined &&
    (typeof body.repoName !== "string" || !isValidGitHubRepoName(body.repoName))
  ) {
    return Response.json({ error: "Invalid repository name" }, { status: 400 });
  }

  if (body.cloneUrl !== undefined) {
    if (typeof body.cloneUrl !== "string") {
      return Response.json({ error: "Invalid clone URL" }, { status: 400 });
    }

    const parsedCloneUrl = parseGitHubHttpsUrl(body.cloneUrl);
    if (
      !parsedCloneUrl ||
      parsedCloneUrl.owner !== body.repoOwner ||
      parsedCloneUrl.repo !== body.repoName
    ) {
      return Response.json(
        { error: "Clone URL must match repository owner and name" },
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
        { error: "Invalid Vercel project" },
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
    managedRuntimeProfileId,
    autoCommitPush,
    autoCreatePr,
  } = body;

  const hasRepo = Boolean(repoOwner && repoName);

  try {
    const titlePromise = resolveSessionTitle(body, session.user.id);
    const preferencesPromise = getUserPreferences(session.user.id);

    // For repo-backed sessions, resolve per-repo defaults in parallel with prefs.
    const repoDefaultsPromise =
      hasRepo && repoOwner && repoName
        ? resolveRepoDefaults({ userId: session.user.id, repoOwner, repoName })
        : null;

    let resolvedVercelProject: VercelProjectSelection | null = null;
    if (hasRepo && repoOwner && repoName) {
      if (explicitVercelProject) {
        const vercelToken = await getUserVercelToken(session.user.id);
        if (!vercelToken) {
          return Response.json(
            { error: "Connect Vercel to select a Vercel project" },
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

    const [title, preferences, repoDefaults] = await Promise.all([
      titlePromise,
      preferencesPromise,
      repoDefaultsPromise,
    ]);

    // Precedence: request body > repo defaults > user preferences > system default.
    // For repo-backed sessions, repoDefaults is non-null and provides the
    // second layer. For no-repo sessions, repoDefaults is null and we fall
    // straight through to user preferences.
    const effectiveAutoCommitPush =
      autoCommitPush ??
      repoDefaults?.autoCommitPush ??
      preferences.autoCommitPush;

    const effectiveAutoCreatePr =
      autoCreatePr ?? repoDefaults?.autoCreatePr ?? preferences.autoCreatePr;

    // Effective isNewBranch: body > repo defaults > false
    const effectiveIsNewBranch =
      bodyIsNewBranch ?? repoDefaults?.isNewBranch ?? false;

    // Branch: if effectiveIsNewBranch, generate a new branch name;
    // otherwise use the explicit body branch or resolved default branch.
    let finalBranch: string | undefined;
    if (effectiveIsNewBranch) {
      finalBranch = generateBranchName(
        session.user.username,
        session.user.name,
      );
    } else {
      finalBranch = branch ?? repoDefaults?.defaultBranch ?? undefined;
    }

    // runtimeMode: body has no field today; use repo default (falls through to
    // system "classic" when repo has no override).
    const effectiveRuntimeMode = repoDefaults?.runtimeMode ?? "classic";

    // managedRuntimeProfileId: body > repo defaults > user prefs
    const effectiveManagedRuntimeProfileId =
      managedRuntimeProfileId ??
      repoDefaults?.managedRuntimeProfileId ??
      preferences.defaultManagedRuntimeProfileId;

    const defaultComposioProfileId =
      preferences.composioAgentDefaults.main.defaultProfileId;
    const composioPolicy = defaultComposioProfileId
      ? await isComposioProfileAllowedForRepository({
          userId: session.user.id,
          profileId: defaultComposioProfileId,
          repoOwner,
          repoName,
        })
      : { allowed: true };
    const result = await createSessionWithInitialChat({
      session: {
        id: nanoid(),
        userId: session.user.id,
        title,
        status: "running",
        repoOwner,
        repoName,
        branch: finalBranch,
        cloneUrl,
        vercelProjectId: resolvedVercelProject?.projectId ?? null,
        vercelProjectName: resolvedVercelProject?.projectName ?? null,
        vercelTeamId: resolvedVercelProject?.teamId ?? null,
        vercelTeamSlug: resolvedVercelProject?.teamSlug ?? null,
        isNewBranch: effectiveIsNewBranch,
        // Full clone only applies to repo-backed sessions.
        fullClone: hasRepo ? (fullClone ?? false) : false,
        autoCommitPushOverride: effectiveAutoCommitPush,
        autoCreatePrOverride: effectiveAutoCommitPush
          ? effectiveAutoCreatePr
          : false,
        managedRuntimeProfileId: effectiveManagedRuntimeProfileId,
        runtimeMode: effectiveRuntimeMode,
        inferenceProfileId: preferences.defaultInferenceProfileId,
        globalSkillRefs: preferences.globalSkillRefs,
        // No-repo (New Chat) sessions skip sandbox provisioning entirely.
        // Repo-backed sessions still enter the provisioning lifecycle.
        sandboxState: hasRepo ? { type: sandboxType } : null,
        lifecycleState: hasRepo ? "provisioning" : null,
        lifecycleVersion: 0,
      },
      initialChat: {
        id: nanoid(),
        title: "New chat",
        modelId: preferences.defaultModelId,
        inferenceProfileId: preferences.defaultInferenceProfileId,
        composioSelection: {
          mainProfileId:
            defaultComposioProfileId && composioPolicy.allowed
              ? defaultComposioProfileId
              : null,
        },
      },
    });

    return Response.json(result);
  } catch (error) {
    if (isVercelInvalidTokenError(error)) {
      console.warn(
        `Vercel token is invalid for user ${session.user.id}; reconnect required to create a session with env sync.`,
      );
      return Response.json(
        { error: "Reconnect Vercel to select a Vercel project" },
        { status: 403 },
      );
    }

    console.error("Failed to create session:", error);
    return Response.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
