import { nanoid } from "nanoid";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import { runAgentWorkflow } from "@/app/workflows/chat";
import {
  hashIdempotencyKey,
  verifyBearerApiToken,
} from "@/lib/api-auth/tokens";
import {
  agentRunCreateSchema,
  listAgentRunsQuerySchema,
} from "@/lib/agent-api-runs/schemas";
import { normalizeRepository } from "@/lib/agent-api-runs/repositories";
import {
  attachAgentApiRunWorkflow,
  createAgentApiRun,
  createApiRunId,
  createSessionChatAndMessageForApiRun,
  listAgentApiRunsForToken,
  markAgentApiRunFailed,
  recordApiRunEvent,
} from "@/lib/agent-api-runs/runs";
import { getAgentRunSnapshot } from "@/lib/agent-api-runs/snapshots";
import { isComposioProfileAllowedForRepository } from "@/lib/db/composio";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

function getRequestId(headers: Headers): string {
  return headers.get("x-request-id")?.trim() || `req_${nanoid()}`;
}

function generateBranchName(): string {
  return `api/${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function isApiEnabled() {
  return process.env.AGENT_API_ENABLED !== "false";
}

export async function GET(req: Request) {
  if (!isApiEnabled()) {
    return Response.json({ error: "Agent API is disabled" }, { status: 404 });
  }

  const auth = await verifyBearerApiToken({
    authorization: req.headers.get("authorization"),
    requiredScopes: ["agent_runs:read"],
    userAgent: req.headers.get("user-agent"),
  });
  if (!auth.ok) {
    return Response.json(
      { error: auth.message, code: auth.code },
      { status: auth.status },
    );
  }

  const parsedQuery = listAgentRunsQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsedQuery.success) {
    return Response.json(
      { error: "Invalid query", issues: parsedQuery.error.issues },
      { status: 400 },
    );
  }

  const runs = await listAgentApiRunsForToken({
    userId: auth.userId,
    tokenId: auth.token.id,
    limit: parsedQuery.data.limit,
    status: parsedQuery.data.status,
  });
  const snapshots = await Promise.all(runs.map(getAgentRunSnapshot));
  return Response.json({ agentRuns: snapshots });
}

export async function POST(req: Request) {
  if (!isApiEnabled()) {
    return Response.json({ error: "Agent API is disabled" }, { status: 404 });
  }

  const auth = await verifyBearerApiToken({
    authorization: req.headers.get("authorization"),
    requiredScopes: ["agent_runs:create"],
    userAgent: req.headers.get("user-agent"),
  });
  if (!auth.ok) {
    return Response.json(
      { error: auth.message, code: auth.code },
      { status: auth.status },
    );
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["agent-api-runs-create", auth.token.id]),
    limit: auth.token.rateLimitMax,
    windowMs: auth.token.rateLimitWindowMs,
  });
  if (limited) {
    return limited;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = agentRunCreateSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid agent run request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const repository = normalizeRepository(
    parsed.data.repository,
    auth.repositoryPolicy,
  );
  if (!repository.ok) {
    return Response.json(
      { error: repository.message, code: repository.code },
      { status: repository.status },
    );
  }

  const requestId = getRequestId(req.headers);
  const idempotencyKey =
    req.headers.get("idempotency-key")?.trim() ||
    parsed.data.idempotencyKey?.trim() ||
    null;
  const preferences = await getUserPreferences(auth.userId);
  const sessionId = `session_${nanoid()}`;
  const chatId = `chat_${nanoid()}`;
  const messageId = `msg_${nanoid()}`;
  const title =
    parsed.data.title ??
    (parsed.data.prompt.length > 80
      ? `${parsed.data.prompt.slice(0, 80)}...`
      : parsed.data.prompt);
  const repo = repository.repository;
  const branch = repo?.newBranch ? generateBranchName() : repo?.branch;
  const defaultComposioProfileId =
    preferences.composioAgentDefaults.main.defaultProfileId;
  const composioPolicy =
    defaultComposioProfileId && repo
      ? await isComposioProfileAllowedForRepository({
          userId: auth.userId,
          profileId: defaultComposioProfileId,
          repoOwner: repo.owner,
          repoName: repo.name,
        })
      : { allowed: true };
  const message: WebAgentUIMessage = {
    id: messageId,
    role: "user",
    parts: [{ type: "text", text: parsed.data.prompt }],
  };

  // Resolve all config values once so that DB writes and workflow args
  // are always consistent (MEDIUM-7: stored config vs workflow args diverge).
  const resolvedModelId = parsed.data.modelId ?? preferences.defaultModelId;
  const resolvedAutoCommitPush =
    parsed.data.autoCommitPush ?? preferences.autoCommitPush;
  const resolvedAutoCreatePr =
    parsed.data.autoCreatePr ?? preferences.autoCreatePr;
  const resolvedManagedRuntimeProfileId =
    parsed.data.managedRuntimeProfileId ??
    preferences.defaultManagedRuntimeProfileId;

  const { run, replayed } = await createAgentApiRun({
    id: await createApiRunId(),
    userId: auth.userId,
    tokenId: auth.token.id,
    status: "accepted",
    idempotencyKeyHash: idempotencyKey
      ? hashIdempotencyKey(idempotencyKey)
      : null,
    requestId,
    promptMessageId: messageId,
    title,
    repository: repo
      ? {
          owner: repo.owner,
          name: repo.name,
          branch: branch ?? null,
          cloneUrl: repo.cloneUrl,
          newBranch: repo.newBranch,
        }
      : null,
    runtimeMode: parsed.data.runtimeMode,
    managedRuntimeProfileId: resolvedManagedRuntimeProfileId,
    modelId: resolvedModelId,
    metadata: parsed.data.metadata,
  });

  if (replayed) {
    const snapshot = await getAgentRunSnapshot(run);
    return Response.json(
      { agentRun: snapshot, idempotentReplay: true },
      { status: 200 },
    );
  }

  try {
    await createSessionChatAndMessageForApiRun({
      session: {
        id: sessionId,
        userId: auth.userId,
        title,
        status: "running",
        repoOwner: repo?.owner ?? null,
        repoName: repo?.name ?? null,
        branch: branch ?? null,
        cloneUrl: repo?.cloneUrl ?? null,
        isNewBranch: repo?.newBranch ?? false,
        autoCommitPushOverride: resolvedAutoCommitPush,
        autoCreatePrOverride: resolvedAutoCreatePr,
        runtimeMode: parsed.data.runtimeMode,
        managedRuntimeProfileId: resolvedManagedRuntimeProfileId,
        inferenceProfileId: preferences.defaultInferenceProfileId,
        globalSkillRefs: preferences.globalSkillRefs,
        sandboxState: { type: preferences.defaultSandboxType },
        lifecycleState: "provisioning",
        lifecycleVersion: 0,
      },
      chat: {
        id: chatId,
        sessionId,
        title: "API run",
        modelId: resolvedModelId,
        inferenceProfileId: preferences.defaultInferenceProfileId,
        composioSelection: {
          mainProfileId:
            defaultComposioProfileId && composioPolicy.allowed
              ? defaultComposioProfileId
              : null,
        },
      },
      message: {
        id: messageId,
        chatId,
        role: "user",
        parts: message,
      },
    });

    const workflow = await start(runAgentWorkflow, [
      {
        messages: [message],
        chatId,
        sessionId,
        userId: auth.userId,
        requestUrl: req.url,
        requestId,
        authSession: null,
        selectedModelId: resolvedModelId,
        modelId: resolvedModelId,
        maxSteps: 500,
        autoCommitEnabled: resolvedAutoCommitPush,
        autoCreatePrEnabled: resolvedAutoCreatePr,
        agentApiRunId: run.id,
      },
    ]);

    const attachedRun = await attachAgentApiRunWorkflow({
      runId: run.id,
      sessionId,
      chatId,
      workflowRunId: workflow.runId,
    });
    await recordApiRunEvent({
      sessionId,
      chatId,
      userId: auth.userId,
      requestId,
      workflowRunId: workflow.runId,
      eventName: "agent_api.run.accepted",
      status: "started",
      summary: "Agent API run accepted and workflow started.",
      payload: {
        apiRunId: run.id,
        tokenId: auth.token.id,
        idempotencyKeyPresent: Boolean(idempotencyKey),
      },
    });

    const snapshot = await getAgentRunSnapshot(attachedRun);
    return Response.json({ agentRun: snapshot }, { status: 202 });
  } catch (error) {
    // Store only a stable operator-visible error code/kind as failureMessage.
    // The raw error.message may contain secrets or internal paths and must
    // not be surfaced verbatim to callers (MEDIUM-10).
    await markAgentApiRunFailed({
      runId: run.id,
      kind: "startup_failed",
      message: "startup_failed",
      retryable: true,
    });
    // Log the raw error for internal observability without exposing it to callers.
    console.error("[agent-api] startup failure for run", run.id, error);
    return Response.json(
      { error: "Failed to start agent run", code: "startup_failed" },
      { status: 500 },
    );
  }
}
