import "server-only";

import { getComposioConfig } from "@/lib/composio/config";
import { getComposioClient } from "@/lib/composio/client";
import {
  listComposioConnectedAccounts,
  type ComposioConnectedAccount,
} from "@/lib/composio/connected-accounts";
import { applyRepoToolkitPolicy } from "@/lib/composio/repo-policy";
import { getComposioErrorKind } from "@/lib/composio/errors";
import { toolkitRequiresAuth } from "@/lib/composio/resolve-toolkit-list";
import {
  buildToolkitStatusMap,
  getToolkitConnectionState,
} from "@/app/settings/composio-connection-state";

/**
 * Agent tool preflight (#802, epic #796 T6).
 *
 * Predicts, per configured toolkit slug, what `resolveComposioToolsForBgRun`
 * (../background-agents/composio-tools.ts) will actually do on the agent's
 * NEXT run — WITHOUT creating a Composio session or minting a token. This is
 * a dry run: only list/status metadata calls are made.
 *
 * This module MUST NOT reimplement resolution or connection-state logic. It
 * composes the exact same shared resolvers the real bg-run path uses:
 *   - applyRepoToolkitPolicy (#799) — the ONE place repo allowlist/denylist
 *     filtering happens.
 *   - listComposioConnectedAccounts (#800) — the ONE place
 *     connectedAccounts.list is called, returning full-status accounts (not
 *     just ACTIVE).
 *   - buildToolkitStatusMap / getToolkitConnectionState (#800,
 *     app/settings/composio-connection-state.ts) — the four-state
 *     (active/expired/not_connected/other) connection derivation used by the
 *     honest-connection-states settings surface.
 *   - getComposioErrorKind (#800, lib/composio/errors.ts) — the 7-value
 *     errorKind taxonomy, reused rather than inventing parallel names.
 *   - toolkitRequiresAuth (lib/composio/resolve-toolkit-list.ts, finding G9,
 *     exported for this reuse per Codex review on PR #849) — the ONE place
 *     Composio's toolkit metadata is checked for NO_AUTH toolkits, so a
 *     no-auth toolkit with zero connected accounts predicts "ready" here
 *     exactly like resolveComposioToolsForToolkitList excludes it from
 *     disconnectedToolkits on the real run path.
 *
 * Runtime-mode note: background agents (the only surface this preflight
 * covers) always run in classic mode — `executor.ts` hardcodes
 * `runtimeMode: "classic"` and the `background_agents` table has no
 * runtime-mode column at all (only chat sessions can select managed_runtime,
 * per lib/composio/session.ts's classic-only throw). So
 * "runtime_mode_incompatible" can never actually be produced by this
 * function today — it exists in the predictedState union so the panel can
 * render it if a future caller (e.g. a chat-context preflight) needs it, but
 * no code path here returns it. See the PR description for the full
 * reasoning.
 */

export type AgentToolPreflightPredictedState =
  | "ready"
  | "blocked_by_repo_policy"
  | "not_connected"
  | "auth_expired"
  | "runtime_mode_incompatible"
  | "composio_unreachable";

export type AgentToolPreflightToolkitResult = {
  slug: string;
  predictedState: AgentToolPreflightPredictedState;
  /** Present only when predictedState is "blocked_by_repo_policy". */
  policyReason?: "repo_policy_blocked" | "not_in_repo_allowlist";
  /** Present only when predictedState is "composio_unreachable". */
  errorKind?: string;
};

export type ComputeAgentToolPreflightParams = {
  userId: string;
  repoOwner: string;
  repoName: string;
  /** Toolkit slugs configured on the agent. Empty → empty toolkits array. */
  slugs: string[];
};

export type ComputeAgentToolPreflightResult = {
  toolkits: AgentToolPreflightToolkitResult[];
};

/**
 * Structured, redaction-safe observability event for a single toolkit's
 * preflight evaluation (#802 Observability spec:
 * `agent_tool_preflight.evaluated`). Never logs Composio API keys, session
 * IDs, or connected-account tokens — only toolkit slugs, predicted states,
 * and errorKinds.
 */
function logToolPreflightEvaluated(params: {
  agentId: string | null;
  repoOwner: string;
  repoName: string;
  toolkitSlug: string;
  predictedState: AgentToolPreflightPredictedState;
  errorKind?: string;
}): void {
  console.info(
    JSON.stringify({
      event: "agent_tool_preflight.evaluated",
      level: "info",
      agentId: params.agentId,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      toolkitSlug: params.toolkitSlug,
      predictedState: params.predictedState,
      ...(params.errorKind ? { errorKind: params.errorKind } : {}),
    }),
  );
}

/**
 * Computes the dry-run preflight prediction for a set of toolkit slugs.
 *
 * Never calls `composio.create` / never upserts a tool-session row — only
 * `applyRepoToolkitPolicy` (a DB read) and
 * `composio.connectedAccounts.list` (a metadata call) are invoked.
 */
export async function computeAgentToolPreflight(
  params: ComputeAgentToolPreflightParams & { agentId?: string | null },
): Promise<ComputeAgentToolPreflightResult> {
  const { userId, repoOwner, repoName, slugs, agentId = null } = params;

  if (slugs.length === 0) {
    return { toolkits: [] };
  }

  // Gate by repo policy (allowlist + denylist, shared resolver — #799). This
  // is the SAME function resolveComposioToolsForBgRun calls.
  const policyResult = await applyRepoToolkitPolicy({
    userId,
    repoOwner,
    repoName,
    requestedSlugs: slugs,
  });
  const blockedBySlug = new Map(
    policyResult.blocked.map((entry) => [entry.slug, entry.reason]),
  );

  const gatedSlugs = policyResult.allowed;

  // Fetch connected-account status ONCE via the shared helper (#800) — the
  // same helper session.ts and composio-tools.ts use — rather than a
  // parallel SDK call.
  let statusMap: Map<string, string> | null = null;
  let unreachableErrorKind: string | null = null;
  let composioClient: ReturnType<typeof getComposioClient> | null = null;

  if (gatedSlugs.length > 0) {
    const config = getComposioConfig();
    if (!config.configured) {
      unreachableErrorKind = getComposioErrorKind(
        new Error("COMPOSIO_API_KEY is not configured."),
      );
    } else {
      try {
        composioClient = getComposioClient();
        const accounts: ComposioConnectedAccount[] =
          await listComposioConnectedAccounts({
            composio: composioClient,
            userId,
          });
        statusMap = buildToolkitStatusMap(accounts);
      } catch (error) {
        unreachableErrorKind = getComposioErrorKind(error);
      }
    }
  }

  const toolkits: AgentToolPreflightToolkitResult[] = await Promise.all(
    slugs.map(async (slug) => {
      const blockedReason = blockedBySlug.get(slug);
      if (blockedReason) {
        const result: AgentToolPreflightToolkitResult = {
          slug,
          predictedState: "blocked_by_repo_policy",
          policyReason: blockedReason,
        };
        logToolPreflightEvaluated({
          agentId,
          repoOwner,
          repoName,
          toolkitSlug: slug,
          predictedState: result.predictedState,
        });
        return result;
      }

      if (unreachableErrorKind) {
        const result: AgentToolPreflightToolkitResult = {
          slug,
          predictedState: "composio_unreachable",
          errorKind: unreachableErrorKind,
        };
        logToolPreflightEvaluated({
          agentId,
          repoOwner,
          repoName,
          toolkitSlug: slug,
          predictedState: result.predictedState,
          errorKind: result.errorKind,
        });
        return result;
      }

      // statusMap is guaranteed non-null here: every slug that reaches this
      // branch survived the policy gate (gatedSlugs), and
      // gatedSlugs.length > 0 is exactly the condition that populates
      // statusMap above.
      const connectionState = getToolkitConnectionState({
        slug,
        statusMap: statusMap ?? new Map(),
        unavailable: false,
      });

      let predictedState: AgentToolPreflightPredictedState =
        connectionState === "active"
          ? "ready"
          : connectionState === "expired"
            ? "auth_expired"
            : "not_connected";

      // A toolkit with no ACTIVE/EXPIRED account is only "not connected" if
      // it actually requires one. Composio's toolkit metadata (finding G9)
      // marks some toolkits NO_AUTH — those never need a connected account,
      // so the real bg-run path (resolveComposioToolsForToolkitList) never
      // reports them as disconnected. Reuse that exact check here rather
      // than re-deriving it, so preflight can't silently diverge from what
      // the run will actually do.
      if (predictedState === "not_connected" && composioClient) {
        const requiresAuth = await toolkitRequiresAuth(composioClient, slug);
        if (!requiresAuth) {
          predictedState = "ready";
        }
      }

      const result: AgentToolPreflightToolkitResult = { slug, predictedState };
      logToolPreflightEvaluated({
        agentId,
        repoOwner,
        repoName,
        toolkitSlug: slug,
        predictedState: result.predictedState,
      });
      return result;
    }),
  );

  return { toolkits };
}
