import "server-only";

import type { ToolSet } from "ai";
import {
  getComposioAgentSession,
  getComposioToolProfile,
  getChatComposioSelection,
  getRepositoryComposioSettings,
  getRepositoryComposioSettingsValues,
  touchComposioAgentSession,
  upsertComposioAgentSession,
  isComposioProfileAllowedForRepository,
} from "@/lib/db/composio";
import { getChatById, getSessionById } from "@/lib/db/sessions";
import type { ComposioToolProfile } from "@/lib/db/schema";
import { type ComposioAgentKey } from "./types";
import { getComposioConfig } from "./config";
import { getComposioClient } from "./client";
import {
  buildComposioSessionConfig,
  getComposioProfileConfigHash,
} from "./session-config";
import { toComposioUserId } from "./user-id";
import { getComposioUserFacingError } from "./errors";
import { resolveComposioToolsForToolkitList } from "./resolve-toolkit-list";
import { resolveComposioSlugsForChatMain } from "./resolve-chat-with-agent-row";
import { resolveAgentForRole } from "@/lib/agents/resolve-agent";
import { getEffectiveRepoToolkitSlugs } from "./repo-toolkit-selection";
import { applyRepoToolkitPolicy } from "./repo-policy";
import {
  listComposioConnectedAccounts,
  type ComposioConnectedAccount,
} from "./connected-accounts";

export {
  buildComposioSessionConfig,
  getComposioProfileConfigHash,
} from "./session-config";
export { toComposioUserId };

export class ComposioSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioSetupError";
  }
}

export type ResolvedComposioTools =
  | {
      status: "off";
    }
  | {
      status: "ready";
      tools: ToolSet;
      profile: ComposioToolProfile | null;
      composioSessionId: string;
      configHash: string;
      reusedSession: boolean;
      /**
       * Selected direct-list toolkits that have no connected account at all.
       * Their tools are still offered but cannot authenticate, so the chat
       * surfaces a "not connected" warning. Undefined on the profile path.
       */
      disconnectedToolkits?: string[];
      /**
       * Selected direct-list toolkits whose connected account(s) exist but
       * are ALL status EXPIRED (none ACTIVE) — distinct from
       * disconnectedToolkits (zero accounts at all). Lets the chat/UI say
       * "expired — reconnect" instead of "not connected". Undefined on the
       * profile path. (#800)
       */
      expiredToolkits?: string[];
    };

/**
 * Groups the full-status connected-account list (from the shared helper) by
 * toolkit slug, so both the ACTIVE-only ids map and the expired-only slug set
 * can be derived from the SAME single SDK fetch.
 */
function groupAccountsByToolkit(
  accounts: ComposioConnectedAccount[],
): Record<string, ComposioConnectedAccount[]> {
  const result: Record<string, ComposioConnectedAccount[]> = {};
  for (const account of accounts) {
    const existing = result[account.toolkitSlug];
    if (existing) {
      existing.push(account);
    } else {
      result[account.toolkitSlug] = [account];
    }
  }
  return result;
}

/**
 * Computes, for the given toolkit slugs, the ACTIVE-only connected-account-id
 * map (existing session-building behavior) and the expired-only slug set (a
 * toolkit selected here whose accounts all exist but are status EXPIRED,
 * none ACTIVE) — from a single shared connected-accounts fetch, not two SDK
 * round-trips.
 */
async function resolveConnectedAccountState(
  composio: ReturnType<typeof getComposioClient>,
  userId: string,
): Promise<{
  connectedAccountIdsByToolkit: Record<string, string[]>;
  accountsByToolkit: Record<string, ComposioConnectedAccount[]>;
}> {
  const accounts = await listComposioConnectedAccounts({ composio, userId });
  const accountsByToolkit = groupAccountsByToolkit(accounts);

  const connectedAccountIdsByToolkit: Record<string, string[]> = {};
  for (const account of accounts) {
    if (account.status !== "ACTIVE") {
      continue;
    }
    const existing = connectedAccountIdsByToolkit[account.toolkitSlug];
    if (existing) {
      existing.push(account.id);
    } else {
      connectedAccountIdsByToolkit[account.toolkitSlug] = [account.id];
    }
  }

  return { connectedAccountIdsByToolkit, accountsByToolkit };
}

/**
 * Selected toolkit slugs whose accounts exist (at least one) but are ALL
 * status EXPIRED — i.e. none ACTIVE. A slug with zero accounts at all is NOT
 * included here (that stays in disconnectedToolkits).
 */
function computeExpiredToolkits(
  slugs: string[],
  accountsByToolkit: Record<string, ComposioConnectedAccount[]>,
): string[] {
  return slugs.filter((slug) => {
    const accountsForSlug = accountsByToolkit[slug];
    if (!accountsForSlug || accountsForSlug.length === 0) {
      return false;
    }
    return accountsForSlug.every((account) => account.status === "EXPIRED");
  });
}

function toSetupError(error: unknown): ComposioSetupError {
  if (error instanceof ComposioSetupError) {
    return error;
  }

  return new ComposioSetupError(getComposioUserFacingError(error));
}

/**
 * Resolve the repo/workspace-level toolkit slugs for a session's repo, applying
 * GitHub default-on when the repo has never been configured. Returns null when
 * there is no repo, Composio is unconfigured, or the effective list is empty.
 */
async function resolveRepoSelectedSlugs(params: {
  userId: string;
  sessionId: string;
}): Promise<string[] | null> {
  const sessionRecord = await getSessionById(params.sessionId);
  const repoOwner = sessionRecord?.repoOwner;
  const repoName = sessionRecord?.repoName;
  if (!repoOwner || !repoName) {
    return null;
  }
  if (!getComposioConfig().configured) {
    return null;
  }

  const repoSettings = await getRepositoryComposioSettings({
    userId: params.userId,
    repoOwner,
    repoName,
  });
  const stored =
    getRepositoryComposioSettingsValues(repoSettings)?.selectedToolkitSlugs;
  // `undefined` (no row) and `null` both mean "never configured".
  const selectedToolkitSlugs = stored ?? null;

  // Only resolve connected accounts when needed for the GitHub default-on
  // decision (an unconfigured repo). An explicit selection wins without it.
  let githubConnected = false;
  if (selectedToolkitSlugs === null) {
    const { connectedAccountIdsByToolkit } = await resolveConnectedAccountState(
      getComposioClient(),
      params.userId,
    );
    githubConnected = (connectedAccountIdsByToolkit.github?.length ?? 0) > 0;
  }

  const effective = getEffectiveRepoToolkitSlugs({
    selectedToolkitSlugs,
    githubConnected,
  });
  return effective.length > 0 ? effective : null;
}

export async function resolveComposioToolsForChat(params: {
  userId: string;
  chatId: string;
  agentKey?: ComposioAgentKey;
  runtimeMode?: "classic" | "managed_runtime";
}): Promise<ResolvedComposioTools> {
  const chat = await getChatById(params.chatId);
  if (!chat) {
    throw new ComposioSetupError("Chat not found for Composio tool setup.");
  }

  const selection = getChatComposioSelection(chat.composioSelection);

  // ── Direct-list path ──────────────────────────────────────────────────────
  // When the chat has directToolkitSlugs (one-wins over profile), build the
  // session config from the user's active connected accounts instead of a
  // saved profile.
  const isMainAgentKey =
    params.agentKey === undefined || params.agentKey === "main";

  // ── Phase 3: resolve agent row defaults for the main agent ────────────────
  // For the main agent, consult resolveAgentForRole to get the user_default
  // composio config. The explicit per-chat selection ALWAYS wins; the agent
  // row only fills in when the chat has no explicit value.
  // PRECEDENCE:
  //   explicit per-chat directToolkitSlugs > explicit per-chat mainProfileId
  //   > agent row composioToolkitSlugs > agent row composioProfileId
  //   > null (no tools, today's behavior)
  let agentRowComposioSlugs: string[] | null = null;
  let agentRowComposioProfileId: string | null = null;

  if (isMainAgentKey) {
    try {
      const agentRow = await resolveAgentForRole({
        userId: params.userId,
        role: "main",
        sessionId: chat.sessionId,
      });
      // Only use agent row values when they differ from empty defaults
      // (composioToolkitSlugs defaults to [] in synthetic fallback, which means
      // "no row" — treat both [] and null as "no agent-row selection")
      agentRowComposioSlugs =
        agentRow.composioToolkitSlugs.length > 0
          ? agentRow.composioToolkitSlugs
          : null;
      agentRowComposioProfileId = agentRow.composioProfileId;
    } catch {
      // Graceful degradation: if agent row resolution fails, fall back to
      // today's behavior (no agent row contribution)
    }
  }

  // ── Repo/workspace-level toolkit selection (lowest precedence) ────────────
  // Governs when the chat has no explicit selection — the case that otherwise
  // yields no Composio tools and forces the model onto unauthenticated
  // web_fetch for GitHub. GitHub is default-on for an unconfigured repo.
  let repoSelectedSlugs: string[] | null = null;
  if (isMainAgentKey) {
    try {
      repoSelectedSlugs = await resolveRepoSelectedSlugs({
        userId: params.userId,
        sessionId: chat.sessionId,
      });
    } catch {
      // Non-fatal: fall back to today's behavior (no repo contribution).
    }
  }

  const resolvedForMain = isMainAgentKey
    ? resolveComposioSlugsForChatMain({
        chatDirectSlugs: selection.directToolkitSlugs ?? null,
        chatMainProfileId: selection.mainProfileId,
        agentRowComposioSlugs,
        agentRowComposioProfileId,
        repoSelectedSlugs,
      })
    : null;

  const directSlugs = isMainAgentKey
    ? (resolvedForMain?.directSlugs ?? null)
    : null;

  // directSlugs === [] is the explicit "off" sentinel (#799, finding G1) —
  // an empty array is truthy in JS, so this must be a length check, not a
  // truthiness check, or an explicit "Off" selection would still enter the
  // direct-list branch below instead of resolving to { status: "off" }.
  if (directSlugs && directSlugs.length > 0) {
    if ((params.runtimeMode ?? "classic") !== "classic") {
      throw new ComposioSetupError(
        "Composio tools are currently available only in classic runtime mode.",
      );
    }

    const config = getComposioConfig();
    if (!config.configured) {
      throw new ComposioSetupError(
        "Composio tools are selected, but COMPOSIO_API_KEY is not configured.",
      );
    }

    // Repo-policy gate (#799, finding A5): the direct-slug path previously
    // applied NO repo policy at all. Route it through the SAME shared
    // resolver background agents and loops use, so the same repo config
    // produces the same result on every surface (finding E2). When every
    // requested slug is blocked, resolve to { status: "off" } WITHOUT
    // attempting any Composio session (no SDK/connected-accounts call).
    const sessionForRepoPolicy = await getSessionById(chat.sessionId);
    const repoOwnerForPolicy = sessionForRepoPolicy?.repoOwner;
    const repoNameForPolicy = sessionForRepoPolicy?.repoName;
    let policyFilteredSlugs = directSlugs;
    if (repoOwnerForPolicy && repoNameForPolicy) {
      const policyResult = await applyRepoToolkitPolicy({
        userId: params.userId,
        repoOwner: repoOwnerForPolicy,
        repoName: repoNameForPolicy,
        requestedSlugs: directSlugs,
      });
      policyFilteredSlugs = policyResult.allowed;
    }

    if (policyFilteredSlugs.length === 0) {
      return { status: "off" };
    }

    const composio = getComposioClient();
    const syntheticProfileId = "direct";
    const agentKey = params.agentKey ?? "main";

    // Fetch the user's full-status connected accounts once, grouped both by
    // ACTIVE-only ids (for session-building, existing behavior) and by full
    // status (to compute expiredToolkits below) — one shared SDK call, not
    // two (#800).
    const { connectedAccountIdsByToolkit, accountsByToolkit } =
      await resolveConnectedAccountState(composio, params.userId);
    const expiredToolkits = computeExpiredToolkits(
      policyFilteredSlugs,
      accountsByToolkit,
    );

    try {
      const resolved = await resolveComposioToolsForToolkitList({
        userId: params.userId,
        slugs: policyFilteredSlugs,
        composio,
        connectedAccountIdsByToolkit,
        getCachedSession: (configHash) =>
          getComposioAgentSession({
            userId: params.userId,
            chatId: params.chatId,
            agentKey,
            profileId: syntheticProfileId,
            configHash,
          }),
        upsertSession: ({ composioSessionId, configHash }) =>
          upsertComposioAgentSession({
            userId: params.userId,
            chatId: params.chatId,
            agentKey,
            profileId: syntheticProfileId,
            configHash,
            composioSessionId,
          }),
        touchSession: (id) => touchComposioAgentSession(id),
      });
      if (resolved.status !== "ready") {
        return resolved;
      }
      // A toolkit with only EXPIRED accounts still has SOME account, so it
      // must not double-count in disconnectedToolkits (zero accounts at
      // all) — expiredToolkits and disconnectedToolkits are mutually
      // exclusive from the chat/UI's point of view (#800).
      const expiredSet = new Set(expiredToolkits);
      const disconnectedToolkits = (resolved.disconnectedToolkits ?? []).filter(
        (slug) => !expiredSet.has(slug),
      );
      return { ...resolved, disconnectedToolkits, expiredToolkits };
    } catch (error) {
      throw toSetupError(error);
    }
  }

  // ── Profile path ─────────────────────────────────────────────────────────
  // For the main agent, use the resolved profileId (which already applies the
  // precedence: explicit chat profile > agent row profile > null).
  // For subagents, use the existing agentProfileOverrides logic unchanged.
  const profileId = isMainAgentKey
    ? (resolvedForMain?.profileId ?? null)
    : (selection.agentProfileOverrides?.[params.agentKey!] ?? null);

  if (!profileId) {
    return { status: "off" };
  }

  const sessionRecord = await getSessionById(chat.sessionId);
  const policy = await isComposioProfileAllowedForRepository({
    userId: params.userId,
    profileId,
    repoOwner: sessionRecord?.repoOwner,
    repoName: sessionRecord?.repoName,
  });
  if (!policy.allowed) {
    throw new ComposioSetupError(
      policy.reason ??
        "Selected Composio profile is blocked by repository policy.",
    );
  }

  if ((params.runtimeMode ?? "classic") !== "classic") {
    throw new ComposioSetupError(
      "Composio tools are currently available only in classic runtime mode.",
    );
  }

  const config = getComposioConfig();
  if (!config.configured) {
    throw new ComposioSetupError(
      "Composio tools are selected, but COMPOSIO_API_KEY is not configured.",
    );
  }

  const profile = await getComposioToolProfile(params.userId, profileId);
  if (!profile) {
    throw new ComposioSetupError(
      "The selected Composio profile no longer exists.",
    );
  }

  const agentKey = params.agentKey ?? "main";
  const configHash = getComposioProfileConfigHash(profile);
  const composio = getComposioClient();
  const existingSession = await getComposioAgentSession({
    userId: params.userId,
    chatId: params.chatId,
    agentKey,
    profileId: profile.id,
    configHash,
  });

  try {
    if (existingSession) {
      const session = await composio.use(existingSession.composioSessionId);
      const tools = await session.tools();
      await touchComposioAgentSession(existingSession.id);
      return {
        status: "ready",
        tools,
        profile,
        composioSessionId: existingSession.composioSessionId,
        configHash,
        reusedSession: true,
      };
    }

    const session = await composio.create(
      toComposioUserId(params.userId),
      buildComposioSessionConfig(profile),
    );
    const tools = await session.tools();
    await upsertComposioAgentSession({
      userId: params.userId,
      chatId: params.chatId,
      agentKey,
      profileId: profile.id,
      configHash,
      composioSessionId: session.sessionId,
    });

    return {
      status: "ready",
      tools,
      profile,
      composioSessionId: session.sessionId,
      configHash,
      reusedSession: false,
    };
  } catch (error) {
    throw toSetupError(error);
  }
}
