import { nanoid } from "nanoid";
import { isComposioProfileAllowedForRepository } from "@/lib/db/composio";
import {
  createSessionWithInitialChat,
  getUsedSessionTitles,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { splitModelSelection } from "@/lib/inference/model-option-id";
import { getRandomCityName } from "@/lib/random-city";
import { resolveRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";
import { kickSandboxPrewarmWorkflow } from "@/lib/sandbox/prewarm-kick";
import type { VercelProjectSelection } from "@/lib/vercel/types";

export interface CreateSessionCoreInput {
  userId: string;
  username: string;
  name?: string;
  title?: string;
  // Free-text tag the calling agent supplies to group a fan-out batch of
  // sessions. Not a state, not a status, carries no behavior — persisted
  // as-is and returned by the read tools. Omitted/undefined persists as
  // null; every existing caller keeps working unchanged.
  label?: string;
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
  // Callers that already resolved a Vercel project link (the browser route)
  // pass it through; callers that don't have Vercel project selection at all
  // (an MCP caller) can omit it and get a no-Vercel-project session.
  resolvedVercelProject?: VercelProjectSelection | null;
  // Injectable so a non-request caller (e.g. an MCP tool, which has no
  // next/server `after`) can pass its own scheduler. This module must never
  // import next/server.
  scheduleBackgroundWork?: (callback: () => Promise<void>) => void;
}

export type CreateSessionCoreResult = Awaited<
  ReturnType<typeof createSessionWithInitialChat>
>;

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

/**
 * Resolves the session's working branch and, for a new-branch session, the
 * base it was cut from (#1251).
 *
 * Before this existed, the new-branch path called generateBranchName() and
 * never read `inputBranch` at all — a session created with isNewBranch: true
 * and branch: "develop" silently discarded "develop" and was cloned from the
 * repository's default branch instead.
 */
export function resolveSessionBranches(params: {
  isNewBranch: boolean;
  inputBranch?: string;
  repoDefaultBranch?: string | null;
  username: string;
  name?: string | null;
}): { branch: string | undefined; baseBranch: string | null } {
  if (params.isNewBranch) {
    return {
      branch: generateBranchName(params.username, params.name),
      // The caller's branch (or, absent that, the repo's own default) becomes
      // the base the new working branch is cut from — never itself the
      // working branch, which is always the freshly generated name above.
      baseBranch: params.inputBranch ?? params.repoDefaultBranch ?? null,
    };
  }
  return {
    branch: params.inputBranch ?? params.repoDefaultBranch ?? undefined,
    baseBranch: null,
  };
}

async function resolveSessionTitle(
  explicitTitle: string | undefined,
  userId: string,
): Promise<string> {
  if (explicitTitle && explicitTitle.trim()) {
    return explicitTitle.trim();
  }
  const usedNames = await getUsedSessionTitles(userId);
  return getRandomCityName(usedNames);
}

/**
 * The session-creation core: resolves defaults precedence (request body >
 * repo defaults > user preferences), resolves the branch, checks the
 * Composio policy, creates the session + initial chat, and kicks the sandbox
 * prewarm workflow for repo-backed sessions.
 *
 * Callers own everything upstream of this: auth, bot protection, rate
 * limiting, body validation, and (for callers that have one) Vercel project
 * resolution. A caller with no Vercel project concept (an MCP tool) can omit
 * `resolvedVercelProject`, `managedRuntimeProfileId`, and any Composio
 * override — this function's existing precedence logic already falls back to
 * repo defaults / user preferences for those.
 */
export async function createSessionCore(
  input: CreateSessionCoreInput,
): Promise<CreateSessionCoreResult> {
  const hasRepo = Boolean(input.repoOwner && input.repoName);
  const sandboxType = input.sandboxType ?? "vercel";

  const titlePromise = resolveSessionTitle(input.title, input.userId);
  const preferencesPromise = getUserPreferences(input.userId);
  const repoDefaultsPromise =
    hasRepo && input.repoOwner && input.repoName
      ? resolveRepoDefaults({
          userId: input.userId,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
        })
      : null;

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
    input.autoCommitPush ??
    repoDefaults?.autoCommitPush ??
    preferences.autoCommitPush;

  const effectiveAutoCreatePr =
    input.autoCreatePr ??
    repoDefaults?.autoCreatePr ??
    preferences.autoCreatePr;

  // Effective isNewBranch: body > repo defaults > false
  const effectiveIsNewBranch =
    input.isNewBranch ?? repoDefaults?.isNewBranch ?? false;

  const { branch: finalBranch, baseBranch } = resolveSessionBranches({
    isNewBranch: effectiveIsNewBranch,
    inputBranch: input.branch,
    repoDefaultBranch: repoDefaults?.defaultBranch,
    username: input.username,
    name: input.name,
  });

  // runtimeMode precedence: body (explicit New-Chat picker choice) > repo
  // defaults > system "classic". A default-profile preference change never
  // auto-flips existing sessions — this only affects sessions created here.
  const effectiveRuntimeMode =
    input.runtimeMode ?? repoDefaults?.runtimeMode ?? "classic";

  // managedRuntimeProfileId: body > repo defaults > user prefs
  const effectiveManagedRuntimeProfileId =
    input.managedRuntimeProfileId ??
    repoDefaults?.managedRuntimeProfileId ??
    preferences.defaultManagedRuntimeProfileId;

  const resolvedVercelProject = input.resolvedVercelProject ?? null;

  const defaultComposioProfileId =
    preferences.composioAgentDefaults.main.defaultProfileId;
  const composioPolicy = defaultComposioProfileId
    ? await isComposioProfileAllowedForRepository({
        userId: input.userId,
        profileId: defaultComposioProfileId,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      })
    : { allowed: true };

  const result = await createSessionWithInitialChat({
    session: {
      id: nanoid(),
      userId: input.userId,
      title,
      label: input.label ?? null,
      status: "running",
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      branch: finalBranch,
      baseBranch,
      cloneUrl: input.cloneUrl,
      vercelProjectId: resolvedVercelProject?.projectId ?? null,
      vercelProjectName: resolvedVercelProject?.projectName ?? null,
      vercelTeamId: resolvedVercelProject?.teamId ?? null,
      vercelTeamSlug: resolvedVercelProject?.teamSlug ?? null,
      isNewBranch: effectiveIsNewBranch,
      // Full clone only applies to repo-backed sessions.
      fullClone: hasRepo ? (input.fullClone ?? false) : false,
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
      ...splitModelSelection(
        preferences.defaultModelId,
        preferences.defaultInferenceProfileId,
      ),
      composioSelection: {
        mainProfileId:
          defaultComposioProfileId && composioPolicy.allowed
            ? defaultComposioProfileId
            : null,
      },
    },
  });

  if (hasRepo) {
    kickSandboxPrewarmWorkflow({
      sessionId: result.session.id,
      userId: input.userId,
      scheduleBackgroundWork: input.scheduleBackgroundWork,
    });
  }

  return result;
}
