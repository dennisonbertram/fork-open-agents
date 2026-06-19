import "server-only";

import { z } from "zod";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import {
  ensureRepoLearningsAgent,
  disableRepoLearningsAgent,
  getRepoLearningsAgentStatus,
} from "@/lib/learnings/builtin-agent";
import { getGitHubAppWebhookReadinessCheck } from "@/lib/background-agents/github-app-webhooks";

// ---- Request schema ----

const learningsToggleSchema = z.object({
  repoOwner: z.string().trim().min(1).max(120),
  repoName: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
});

export type LearningsToggleInput = z.infer<typeof learningsToggleSchema>;

// ---- ReadinessVerdict shape ----

type ReadinessVerdictStatus =
  | "ready"
  | "action-needed"
  | "unavailable"
  | "error";

type ReadinessVerdict = {
  status: ReadinessVerdictStatus;
  headline: string;
  detail?: string;
  errorKind?: string;
};

// ---- Helpers ----

function buildEnabledVerdict(): ReadinessVerdict {
  return {
    status: "ready",
    headline: "Learnings agent enabled",
    detail:
      "The learnings agent will extract engineering learnings from merged pull requests.",
  };
}

function buildDisabledVerdict(): ReadinessVerdict {
  return {
    status: "action-needed",
    headline: "Learnings agent off",
    detail: "Enable it to extract learnings from pull requests.",
  };
}

function buildMissingSubscriptionVerdict(): ReadinessVerdict {
  return {
    status: "action-needed",
    headline: "GitHub App subscription missing",
    detail:
      "GitHub App is not subscribed to review events; reinstall or re-authorize the app.",
    errorKind: "event_subscription_missing",
  };
}

function buildErrorVerdict(errorKind: string): ReadinessVerdict {
  switch (errorKind) {
    case "user_no_write":
      return {
        status: "error",
        headline: "Write access required",
        detail: "You need write access to enable the learnings agent.",
        errorKind,
      };
    case "no_installation":
      return {
        status: "unavailable",
        headline: "GitHub App not connected",
        detail: "Connect the GitHub App for this repo to enable learnings.",
        errorKind,
      };
    default:
      return {
        status: "error",
        headline: "Could not enable learnings agent",
        errorKind,
      };
  }
}

// ---- POST /api/learnings ----

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = learningsToggleSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { repoOwner, repoName, enabled } = parsed.data;
  const userId = authResult.userId;

  if (!enabled) {
    // Disable path
    await disableRepoLearningsAgent(userId, repoOwner, repoName);
    return Response.json({
      enabled: false,
      verdict: buildDisabledVerdict(),
    });
  }

  // Enable path
  const result = await ensureRepoLearningsAgent(
    userId,
    repoOwner,
    repoName,
    true,
  );

  if (result.errorKind) {
    const verdict = buildErrorVerdict(result.errorKind);
    const status = result.errorKind === "no_installation" ? 404 : 403;
    return Response.json({ verdict }, { status });
  }

  return Response.json({
    enabled: true,
    agentId: result.agentId,
    verdict: buildEnabledVerdict(),
  });
}

// ---- GET /api/learnings ----

export async function GET(req: Request): Promise<Response> {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(req.url);
  const repoOwner = url.searchParams.get("repoOwner") ?? "";
  const repoName = url.searchParams.get("repoName") ?? "";
  const userId = authResult.userId;

  // Check current agent state
  const agentStatus = await getRepoLearningsAgentStatus(
    userId,
    repoOwner,
    repoName,
  );

  // Check webhook subscription readiness
  const webhookCheck = await getGitHubAppWebhookReadinessCheck();

  // Extract raw missing event names (e.g. "event:pull_request_review" → "pull_request_review")
  const missingEvents = webhookCheck.missing
    .filter((m) => m.startsWith("event:"))
    .map((m) => m.replace(/^event:/, ""));

  // Determine verdict
  let verdict: ReadinessVerdict;
  if (webhookCheck.status !== "ready" && missingEvents.length > 0) {
    verdict = buildMissingSubscriptionVerdict();
  } else if (agentStatus.enabled) {
    verdict = buildEnabledVerdict();
  } else {
    verdict = buildDisabledVerdict();
  }

  const response: Record<string, unknown> = {
    enabled: agentStatus.enabled,
    verdict,
  };

  if (agentStatus.agentId) {
    response.agentId = agentStatus.agentId;
  }

  if (missingEvents.length > 0) {
    response.missingEvents = missingEvents;
  }

  return Response.json(response);
}
