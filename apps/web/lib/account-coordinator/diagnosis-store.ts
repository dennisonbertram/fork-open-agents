import "server-only";

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentLoopEvents,
  agentLoopRuns,
  agentLoops,
  agentLoopStepRuns,
  agentLoopWatchdogRuns,
  backgroundAgentEvents,
  backgroundAgentOutputs,
  backgroundAgentRuns,
  backgroundAgents,
  backgroundAgentToolSessions,
  chats,
  managedRuntimeProfileRuns,
  sandboxBrowserRuns,
  sandboxServices,
  sessionEvents,
  sessions,
  verifiedBuildEvents,
  verifiedBuildRuns,
  workflowGoalEvents,
  workflowGoals,
  workflowInputSnapshots,
  workflowRuns,
  workflowRunSteps,
} from "@/lib/db/schema";
import { getRepoDashboardData } from "@/lib/github/repo-dashboard";
import { buildAccountDiagnosis, makeDiagnosticEvidence } from "./diagnosis";
import { redactText } from "./redaction";
import {
  normalizeAgentLoopRun,
  normalizeBackgroundAgentRun,
  normalizeChatWorkflowRun,
  normalizeSession,
  type AgentLoopRunRow,
  type BackgroundAgentRunRow,
  type ChatWorkflowRunRow,
  type SessionRow,
} from "./snapshot";
import type {
  AccountDiagnosisResponse,
  AccountDiagnosisSource,
  AccountDiagnosticEvidence,
  AccountDiagnosticSourceGap,
  AccountDiagnosticSourceStatus,
  AccountWorkItem,
} from "./types";

const DEFAULT_EVIDENCE_LIMIT = 80;
const MAX_EVIDENCE_LIMIT = 300;

type SourceResult = {
  status: AccountDiagnosticSourceStatus;
  evidence: AccountDiagnosticEvidence[];
  gap?: AccountDiagnosticSourceGap;
  gaps?: AccountDiagnosticSourceGap[];
};

type LoadedWorkflow = typeof workflowRuns.$inferSelect;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_EVIDENCE_LIMIT;
  }

  return Math.min(Math.max(Math.floor(limit), 1), MAX_EVIDENCE_LIMIT);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  ];
}

function latestDate(...values: Array<Date | null | undefined>): Date {
  return (
    values.find((value): value is Date => value instanceof Date) ?? new Date(0)
  );
}

function sourceOk(
  source: string,
  itemCount: number,
): AccountDiagnosticSourceStatus {
  return { source, status: "ok", itemCount };
}

function sourceFailed(
  source: string,
  error: unknown,
): AccountDiagnosticSourceStatus {
  const message = error instanceof Error ? error.message : String(error);
  return {
    source,
    status: "failed",
    itemCount: 0,
    error:
      redactText(message, 160) === "[redacted]"
        ? "[redacted]"
        : "Source failed",
  };
}

async function loadEvidenceSource(
  source: string,
  loader: () => Promise<AccountDiagnosticEvidence[]>,
): Promise<SourceResult> {
  try {
    const evidence = await loader();
    return {
      evidence,
      status: sourceOk(source, evidence.length),
    };
  } catch (error) {
    return {
      evidence: [],
      status: sourceFailed(source, error),
      gap: { source, reason: "Source failed" },
    };
  }
}

function compactSourceResults(results: SourceResult[]) {
  return {
    sourceStatus: results.map((result) => result.status),
    evidence: results.flatMap((result) => result.evidence),
    sourceGaps: results
      .flatMap((result) => [
        ...(result.gap ? [result.gap] : []),
        ...(result.gaps ?? []),
      ])
      .filter((gap): gap is AccountDiagnosticSourceGap => gap !== undefined),
  };
}

function workflowRunEvidence(run: LoadedWorkflow): AccountDiagnosticEvidence {
  return makeDiagnosticEvidence({
    id: run.id,
    kind: "workflow_run",
    title: `Workflow run ${run.id}`,
    status: run.status,
    summary: run.errorMessage ? "Workflow failed" : undefined,
    occurredAt: run.finishedAt,
    correlations: {
      sessionId: run.sessionId,
      chatId: run.chatId,
      workflowRunId: run.id,
      requestId: run.requestId,
      sandboxName: run.sandboxName,
    },
    metadata: {
      modelId: run.modelId,
      inferenceRoute: run.inferenceRoute,
      runtimeMode: run.runtimeMode,
      managedRuntimeProfileId: run.managedRuntimeProfileId,
      managedRuntimeProfileVersion: run.managedRuntimeProfileVersion,
      managedRuntimeProfileRunId: run.managedRuntimeProfileRunId,
      totalDurationMs: run.totalDurationMs,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt.toISOString(),
      errorMessage: run.errorMessage,
    },
  });
}

async function loadGitHubRepoEvidence(params: {
  userId: string;
  target: AccountWorkItem;
}): Promise<SourceResult[]> {
  const repo = params.target.repo;
  if (!repo) {
    return [];
  }

  try {
    const dashboard = await getRepoDashboardData({
      userId: params.userId,
      owner: repo.owner,
      repo: repo.name,
    });
    const evidence: AccountDiagnosticEvidence[] = [];
    const gaps: AccountDiagnosticSourceGap[] = [];
    const targetPrNumber = params.target.metadata?.prNumber;
    const targetIssueNumber = params.target.metadata?.issueNumber;

    if (dashboard.prSummary.ok) {
      evidence.push(
        ...dashboard.prSummary.prs.map((pr) =>
          makeDiagnosticEvidence({
            id: `github-pr-${repo.owner}-${repo.name}-${pr.number}`,
            kind: "github_pull_request",
            title: `PR #${pr.number}: ${pr.title}`,
            status: pr.checksStatus,
            occurredAt: pr.updatedAt,
            correlations: { prNumber: pr.number },
            metadata: {
              repoOwner: repo.owner,
              repoName: repo.name,
              isDraft: pr.isDraft,
              author: pr.author,
              baseBranch: pr.baseBranch,
              url: pr.url,
              selected: pr.number === targetPrNumber,
            },
          }),
        ),
      );
    } else {
      gaps.push({
        source: "github_pull_requests",
        reason: dashboard.prSummary.errorKind,
      });
    }

    if (dashboard.issueSummary.ok) {
      const issueSummary = dashboard.issueSummary;
      evidence.push(
        ...issueSummary.recent.map((issue) =>
          makeDiagnosticEvidence({
            id: `github-issue-${repo.owner}-${repo.name}-${issue.number}`,
            kind: "github_issue",
            title: `Issue #${issue.number}: ${issue.title}`,
            status: "open",
            occurredAt: issue.updatedAt,
            correlations: { issueNumber: issue.number },
            metadata: {
              repoOwner: repo.owner,
              repoName: repo.name,
              labels: issue.labels,
              totalOpen: issueSummary.totalOpen,
              url: issue.url,
              selected: issue.number === targetIssueNumber,
            },
          }),
        ),
      );
    } else {
      gaps.push({
        source: "github_issues",
        reason: dashboard.issueSummary.errorKind,
      });
    }

    if (dashboard.actionsSummary.ok) {
      const actionsSummary = dashboard.actionsSummary;
      evidence.push(
        ...actionsSummary.recentRuns.map((run) =>
          makeDiagnosticEvidence({
            id: `github-action-${repo.owner}-${repo.name}-${run.runId}`,
            kind: "github_action_run",
            title: run.name,
            status: run.conclusion ?? run.status,
            occurredAt: run.createdAt,
            metadata: {
              repoOwner: repo.owner,
              repoName: repo.name,
              runId: run.runId,
              conclusion: run.conclusion,
              status: run.status,
              latestStatus: actionsSummary.latestStatus,
              url: run.url,
            },
          }),
        ),
      );
    } else {
      gaps.push({
        source: "github_actions",
        reason: dashboard.actionsSummary.errorKind,
      });
    }

    const status: AccountDiagnosticSourceStatus =
      gaps.length === 0
        ? {
            source: "github_repo_dashboard",
            status: "ok",
            itemCount: evidence.length,
          }
        : {
            source: "github_repo_dashboard",
            status: evidence.length > 0 ? "partial" : "failed",
            itemCount: evidence.length,
            error: "GitHub source partially unavailable",
          };

    return [
      {
        evidence,
        gaps,
        status,
      },
    ];
  } catch (error) {
    return [
      {
        evidence: [],
        status: sourceFailed("github_repo_dashboard", error),
        gap: { source: "github_repo_dashboard", reason: "Source failed" },
      },
    ];
  }
}

function repoFromSession(session: typeof sessions.$inferSelect | null) {
  if (!session?.repoOwner || !session.repoName) {
    return undefined;
  }

  return {
    owner: session.repoOwner,
    name: session.repoName,
    ...(session.branch ? { branch: session.branch } : {}),
  };
}

async function loadWorkflowRunsForSession(params: {
  userId: string;
  sessionId: string;
  limit: number;
}): Promise<LoadedWorkflow[]> {
  return db.query.workflowRuns.findMany({
    where: and(
      eq(workflowRuns.userId, params.userId),
      eq(workflowRuns.sessionId, params.sessionId),
    ),
    orderBy: [desc(workflowRuns.createdAt)],
    limit: params.limit,
  });
}

async function loadWorkflowRunById(params: {
  userId: string;
  workflowRunId: string;
}): Promise<{
  workflowRun: LoadedWorkflow;
  session: typeof sessions.$inferSelect | null;
  chat: typeof chats.$inferSelect | null;
} | null> {
  const [row] = await db
    .select({
      workflowRun: workflowRuns,
      session: sessions,
      chat: chats,
    })
    .from(workflowRuns)
    .leftJoin(sessions, eq(sessions.id, workflowRuns.sessionId))
    .leftJoin(chats, eq(chats.id, workflowRuns.chatId))
    .where(
      and(
        eq(workflowRuns.id, params.workflowRunId),
        eq(workflowRuns.userId, params.userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function loadWorkflowEvidence(params: {
  userId: string;
  workflowRunIds: string[];
  limit: number;
  includeRuns?: boolean;
}): Promise<SourceResult[]> {
  const workflowRunIds = uniqueStrings(params.workflowRunIds);
  if (workflowRunIds.length === 0) {
    return [];
  }

  const workflowEvidence =
    params.includeRuns === false
      ? undefined
      : await loadEvidenceSource("workflow_runs", async () => {
          const runs = await db.query.workflowRuns.findMany({
            where: and(
              eq(workflowRuns.userId, params.userId),
              inArray(workflowRuns.id, workflowRunIds),
            ),
            orderBy: [desc(workflowRuns.createdAt)],
            limit: params.limit,
          });
          return runs.map(workflowRunEvidence);
        });

  const stepEvidence = await loadEvidenceSource(
    "workflow_run_steps",
    async () => {
      const steps = await db.query.workflowRunSteps.findMany({
        where: inArray(workflowRunSteps.workflowRunId, workflowRunIds),
        orderBy: [asc(workflowRunSteps.startedAt)],
        limit: params.limit,
      });
      return steps.map((step) =>
        makeDiagnosticEvidence({
          id: step.id,
          kind: "workflow_step",
          title: `Workflow step ${step.stepNumber}`,
          status: step.finishReason ?? step.rawFinishReason ?? undefined,
          occurredAt: step.finishedAt,
          correlations: { workflowRunId: step.workflowRunId },
          metadata: {
            stepNumber: step.stepNumber,
            durationMs: step.durationMs,
            finishReason: step.finishReason,
            rawFinishReason: step.rawFinishReason,
            startedAt: step.startedAt.toISOString(),
            finishedAt: step.finishedAt.toISOString(),
          },
        }),
      );
    },
  );

  const inputSnapshotEvidence = await loadEvidenceSource(
    "workflow_input_snapshots",
    async () => {
      const snapshots = await db.query.workflowInputSnapshots.findMany({
        where: inArray(workflowInputSnapshots.workflowRunId, workflowRunIds),
        orderBy: [desc(workflowInputSnapshots.persistedAt)],
        limit: params.limit,
      });
      return snapshots.map((snapshot) =>
        makeDiagnosticEvidence({
          id: snapshot.id,
          kind: "workflow_input_snapshot",
          title: `Workflow input snapshot ${snapshot.workflowRunId}`,
          occurredAt: snapshot.persistedAt,
          redactionStatus: "passed",
          correlations: { workflowRunId: snapshot.workflowRunId },
          metadata: {
            workflowId: snapshot.workflowId,
            schemaVersion: snapshot.schemaVersion,
            inputValues: snapshot.inputValues,
            persistedAt: snapshot.persistedAt.toISOString(),
          },
        }),
      );
    },
  );

  return [
    ...(workflowEvidence ? [workflowEvidence] : []),
    stepEvidence,
    inputSnapshotEvidence,
  ];
}

async function loadSessionChildEvidence(params: {
  userId: string;
  sessionId: string;
  workflowRunIds: string[];
  limit: number;
}): Promise<SourceResult[]> {
  const sessionEventsEvidence = loadEvidenceSource(
    "session_events",
    async () => {
      const rows = await db.query.sessionEvents.findMany({
        where: and(
          eq(sessionEvents.userId, params.userId),
          eq(sessionEvents.sessionId, params.sessionId),
        ),
        orderBy: [desc(sessionEvents.createdAt)],
        limit: params.limit,
      });
      return rows.map((event) =>
        makeDiagnosticEvidence({
          id: event.id,
          kind: "session_event",
          title: event.eventName,
          status: event.status,
          summary: event.summary,
          occurredAt: event.createdAt,
          redactionStatus: event.redactionStatus,
          correlations: {
            sessionId: event.sessionId,
            chatId: event.chatId,
            workflowRunId: event.workflowRunId,
            requestId: event.requestId,
            harnessRunId: event.harnessRunId,
            sandboxName: event.sandboxName,
            serviceId: event.serviceId,
            browserRunId: event.browserRunId,
          },
          metadata: {
            source: event.source,
            actorType: event.actorType,
            actorId: event.actorId,
            managedRuntimeProfileRunId: event.managedRuntimeProfileRunId,
            payload: event.payload,
          },
        }),
      );
    },
  );

  const profileRunEvidence = loadEvidenceSource(
    "managed_runtime_profile_runs",
    async () => {
      const rows = await db.query.managedRuntimeProfileRuns.findMany({
        where: and(
          eq(managedRuntimeProfileRuns.userId, params.userId),
          eq(managedRuntimeProfileRuns.sessionId, params.sessionId),
        ),
        orderBy: [desc(managedRuntimeProfileRuns.createdAt)],
        limit: params.limit,
      });
      return rows.map((run) =>
        makeDiagnosticEvidence({
          id: run.id,
          kind: "managed_runtime_profile_run",
          title: run.profileDisplayName,
          status: run.status,
          summary: run.failureMessage ?? run.summary,
          occurredAt: run.finishedAt ?? run.startedAt,
          correlations: {
            sessionId: run.sessionId,
            chatId: run.chatId,
            workflowRunId: run.workflowRunId,
            sandboxName: run.sandboxName,
          },
          metadata: {
            profileId: run.profileId,
            profileVersion: run.profileVersion,
            expectedTools: run.expectedTools,
            optionalTools: run.optionalTools,
            setupResults: run.setupResults,
            verificationResults: run.verificationResults,
          },
        }),
      );
    },
  );

  const serviceEvidence = loadEvidenceSource("sandbox_services", async () => {
    const rows = await db.query.sandboxServices.findMany({
      where: and(
        eq(sandboxServices.userId, params.userId),
        eq(sandboxServices.sessionId, params.sessionId),
      ),
      orderBy: [desc(sandboxServices.updatedAt)],
      limit: params.limit,
    });
    return rows.map((service) =>
      makeDiagnosticEvidence({
        id: service.id,
        kind: "sandbox_service",
        title: `${service.kind} service on ${service.port}`,
        status: service.status,
        summary: service.failureMessage,
        occurredAt: latestDate(
          service.lastSeenAt,
          service.lastStartedAt,
          service.updatedAt,
        ),
        correlations: {
          sessionId: service.sessionId,
          serviceId: service.id,
        },
        metadata: {
          kind: service.kind,
          packageDir: service.packageDir,
          command: service.command,
          port: service.port,
          url: service.url,
          pid: service.pid,
          commandId: service.commandId,
          logPath: service.logPath,
          healthPath: service.healthPath,
          lastHealthStatus: service.lastHealthStatus,
        },
      }),
    );
  });

  const browserRunEvidence = loadEvidenceSource(
    "sandbox_browser_runs",
    async () => {
      const rows = await db
        .select({ browserRun: sandboxBrowserRuns })
        .from(sandboxBrowserRuns)
        .innerJoin(sessions, eq(sessions.id, sandboxBrowserRuns.sessionId))
        .where(
          and(
            eq(sessions.userId, params.userId),
            eq(sandboxBrowserRuns.sessionId, params.sessionId),
          ),
        )
        .orderBy(desc(sandboxBrowserRuns.createdAt))
        .limit(params.limit);

      return rows.map(({ browserRun }) =>
        makeDiagnosticEvidence({
          id: browserRun.id,
          kind: "browser_run",
          title: `Browser check ${browserRun.targetUrl}`,
          status: browserRun.status,
          summary: browserRun.summary,
          occurredAt: browserRun.finishedAt ?? browserRun.startedAt,
          redactionStatus: browserRun.redactionStatus,
          correlations: {
            sessionId: browserRun.sessionId,
            chatId: browserRun.chatId,
            serviceId: browserRun.serviceId,
            browserRunId: browserRun.id,
          },
          metadata: {
            targetUrl: browserRun.targetUrl,
            consoleErrors: browserRun.consoleErrors,
            networkErrors: browserRun.networkErrors,
            steps: browserRun.steps,
            artifactRefs: browserRun.artifactRefs,
          },
        }),
      );
    },
  );

  const workflowGoalEvidence = loadEvidenceSource(
    "workflow_goals",
    async () => {
      const workflowRunIds = uniqueStrings(params.workflowRunIds);
      const conditions = [
        eq(workflowGoals.sessionId, params.sessionId),
        ...(workflowRunIds.length > 0
          ? [inArray(workflowGoals.workflowRunId, workflowRunIds)]
          : []),
      ];
      const goals = await db.query.workflowGoals.findMany({
        where: and(eq(workflowGoals.userId, params.userId), or(...conditions)),
        orderBy: [desc(workflowGoals.updatedAt)],
        limit: params.limit,
      });
      const goalIds = goals.map((goal) => goal.id);
      const goalEvents =
        goalIds.length > 0
          ? await db.query.workflowGoalEvents.findMany({
              where: and(
                eq(workflowGoalEvents.userId, params.userId),
                inArray(workflowGoalEvents.goalId, goalIds),
              ),
              orderBy: [asc(workflowGoalEvents.createdAt)],
              limit: params.limit,
            })
          : [];

      return [
        ...goals.map((goal) =>
          makeDiagnosticEvidence({
            id: goal.id,
            kind: "workflow_goal",
            title: goal.objective,
            status: goal.status,
            summary: goal.blockedReason,
            occurredAt: goal.updatedAt,
            correlations: {
              sessionId: goal.sessionId,
              chatId: goal.chatId,
              workflowRunId: goal.workflowRunId,
            },
            metadata: {
              plan: goal.plan,
              evidenceRefs: goal.evidenceRefs,
            },
          }),
        ),
        ...goalEvents.map((event) =>
          makeDiagnosticEvidence({
            id: event.id,
            kind: "workflow_goal_event",
            title: event.eventType,
            summary: event.summary,
            occurredAt: event.createdAt,
            metadata: {
              goalId: event.goalId,
              sequence: event.sequence,
              payload: event.payload,
            },
          }),
        ),
      ];
    },
  );

  const verifiedBuildEvidence = loadEvidenceSource(
    "verified_build",
    async () => {
      const runs = await db.query.verifiedBuildRuns.findMany({
        where: and(
          eq(verifiedBuildRuns.userId, params.userId),
          eq(verifiedBuildRuns.sessionId, params.sessionId),
        ),
        orderBy: [desc(verifiedBuildRuns.updatedAt)],
        limit: params.limit,
      });
      const runIds = runs.map((run) => run.id);
      const events =
        runIds.length > 0
          ? await db.query.verifiedBuildEvents.findMany({
              where: inArray(verifiedBuildEvents.verifiedBuildRunId, runIds),
              orderBy: [asc(verifiedBuildEvents.receivedAt)],
              limit: params.limit,
            })
          : [];

      return [
        ...runs.map((run) =>
          makeDiagnosticEvidence({
            id: run.id,
            kind: "verified_build_run",
            title: `Verified Build ${run.harnessRunId}`,
            status: run.status,
            summary: run.intentSummary,
            occurredAt: run.updatedAt,
            correlations: {
              sessionId: run.sessionId,
              chatId: run.chatId,
              harnessRunId: run.harnessRunId,
            },
            metadata: {
              mode: run.mode,
              tenantId: run.tenantId,
              projectId: run.projectId,
              actorId: run.actorId,
              selectionReason: run.selectionReason,
              lastEventId: run.lastEventId,
              lastEventName: run.lastEventName,
              planApprovalState: run.planApprovalState,
              pendingApprovalKind: run.pendingApprovalKind,
              finalReportArtifactId: run.finalReportArtifactId,
              goNoGo: run.goNoGo,
            },
          }),
        ),
        ...events.map((event) =>
          makeDiagnosticEvidence({
            id: event.id,
            kind: "verified_build_event",
            title: event.eventName,
            occurredAt: event.eventAt ?? event.receivedAt,
            correlations: { requestId: event.requestId },
            metadata: {
              verifiedBuildRunId: event.verifiedBuildRunId,
              harnessEventId: event.harnessEventId,
              eventPayload: event.eventPayload,
            },
          }),
        ),
      ];
    },
  );

  return Promise.all([
    sessionEventsEvidence,
    profileRunEvidence,
    serviceEvidence,
    browserRunEvidence,
    workflowGoalEvidence,
    verifiedBuildEvidence,
  ]);
}

async function loadSessionDiagnosis(params: {
  userId: string;
  id: string;
  now: Date;
  limit: number;
}): Promise<AccountDiagnosisResponse | null> {
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, params.id), eq(sessions.userId, params.userId)),
  });
  if (!session) {
    return null;
  }

  const workflows = await loadWorkflowRunsForSession({
    userId: params.userId,
    sessionId: session.id,
    limit: params.limit,
  });
  const workflowRunIds = workflows.map((run) => run.id);
  const target = normalizeSession(session satisfies SessionRow, params.now);
  const sourceResults = compactSourceResults([
    {
      status: sourceOk("target", 1),
      evidence: [
        makeDiagnosticEvidence({
          id: session.id,
          kind: "target",
          title: session.title,
          status: session.status,
          summary: session.lifecycleError ? "Session failed" : undefined,
          occurredAt: session.updatedAt,
          correlations: {
            sessionId: session.id,
            prNumber: session.prNumber,
          },
          metadata: {
            lifecycleState: session.lifecycleState,
            runtimeMode: session.runtimeMode,
            repoOwner: session.repoOwner,
            repoName: session.repoName,
            branch: session.branch,
            prStatus: session.prStatus,
          },
        }),
      ],
    },
    {
      status: sourceOk("workflow_runs", workflows.length),
      evidence: workflows.map(workflowRunEvidence),
    },
    ...(await loadWorkflowEvidence({
      userId: params.userId,
      workflowRunIds,
      limit: params.limit,
      includeRuns: false,
    })),
    ...(await loadSessionChildEvidence({
      userId: params.userId,
      sessionId: session.id,
      workflowRunIds,
      limit: params.limit,
    })),
    ...(await loadGitHubRepoEvidence({
      userId: params.userId,
      target,
    })),
  ]);

  return buildAccountDiagnosis({
    source: "session",
    id: session.id,
    target,
    ...sourceResults,
    now: params.now,
  });
}

async function loadWorkflowDiagnosis(params: {
  userId: string;
  id: string;
  now: Date;
  limit: number;
}): Promise<AccountDiagnosisResponse | null> {
  const row = await loadWorkflowRunById({
    userId: params.userId,
    workflowRunId: params.id,
  });
  if (!row) {
    return null;
  }

  const targetRepo = repoFromSession(row.session);
  const target: AccountWorkItem = {
    ...normalizeChatWorkflowRun({
      id: row.workflowRun.id,
      chatId: row.workflowRun.chatId,
      chatTitle: row.chat?.title ?? null,
      sessionId: row.workflowRun.sessionId,
      sessionTitle: row.session?.title ?? null,
      status: row.workflowRun.status,
      runtimeMode: row.workflowRun.runtimeMode,
      errorMessage: row.workflowRun.errorMessage,
      startedAt: row.workflowRun.startedAt,
      finishedAt: row.workflowRun.finishedAt,
      createdAt: row.workflowRun.createdAt,
    } satisfies ChatWorkflowRunRow),
    ...(targetRepo ? { repo: targetRepo } : {}),
    metadata: {
      chatId: row.workflowRun.chatId,
      sessionId: row.workflowRun.sessionId,
      runtimeMode: row.workflowRun.runtimeMode,
      prNumber: row.session?.prNumber ?? null,
      prStatus: row.session?.prStatus ?? null,
    },
  };

  const sessionResults = row.session
    ? await loadSessionChildEvidence({
        userId: params.userId,
        sessionId: row.session.id,
        workflowRunIds: [row.workflowRun.id],
        limit: params.limit,
      })
    : [];
  const sourceResults = compactSourceResults([
    {
      status: sourceOk("target", 1),
      evidence: [workflowRunEvidence(row.workflowRun)],
    },
    ...(await loadWorkflowEvidence({
      userId: params.userId,
      workflowRunIds: [row.workflowRun.id],
      limit: params.limit,
      includeRuns: false,
    })),
    ...sessionResults,
    ...(await loadGitHubRepoEvidence({
      userId: params.userId,
      target,
    })),
  ]);

  return buildAccountDiagnosis({
    source: "chat_workflow",
    id: row.workflowRun.id,
    target,
    ...sourceResults,
    now: params.now,
  });
}

async function loadBackgroundAgentDiagnosis(params: {
  userId: string;
  id: string;
  now: Date;
  limit: number;
}): Promise<AccountDiagnosisResponse | null> {
  const [row] = await db
    .select({ run: backgroundAgentRuns, agent: backgroundAgents })
    .from(backgroundAgentRuns)
    .leftJoin(
      backgroundAgents,
      eq(backgroundAgents.id, backgroundAgentRuns.agentId),
    )
    .where(
      and(
        eq(backgroundAgentRuns.id, params.id),
        eq(backgroundAgentRuns.userId, params.userId),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }

  const run = row.run;
  const target = normalizeBackgroundAgentRun(
    {
      id: run.id,
      agentName: row.agent?.name ?? null,
      status: run.status,
      source: run.source,
      triggerKind: run.triggerKind,
      repoOwner: run.repoOwner,
      repoName: run.repoName,
      branch: run.branch,
      prNumber: run.prNumber,
      issueNumber: run.issueNumber,
      errorKind: run.errorKind,
      errorMessage: run.errorMessage,
      outputUrl: run.outputUrl,
      payloadSummary: run.payloadSummary,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    } satisfies BackgroundAgentRunRow,
    params.now,
  );

  const runEvidence = loadEvidenceSource("background_agent_run", async () => [
    makeDiagnosticEvidence({
      id: run.id,
      kind: "target",
      title: row.agent?.name ?? "Background agent run",
      status: run.status,
      summary: run.errorMessage ? "Background agent run failed" : undefined,
      occurredAt: run.updatedAt,
      correlations: {
        workflowRunId: run.workflowRunId,
        requestId: run.requestId,
        sandboxName: run.sandboxName,
        prNumber: run.prNumber,
        issueNumber: run.issueNumber,
      },
      metadata: {
        agentId: run.agentId,
        triggerId: run.triggerId,
        source: run.source,
        triggerKind: run.triggerKind,
        externalId: run.externalId,
        idempotencyKey: run.idempotencyKey,
        repoOwner: run.repoOwner,
        repoName: run.repoName,
        ref: run.ref,
        sha: run.sha,
        branch: run.branch,
        deploymentUrl: run.deploymentUrl,
        outputUrl: run.outputUrl,
        errorKind: run.errorKind,
        errorMessage: run.errorMessage,
        payloadSummary: run.payloadSummary,
        resultSummary: run.resultSummary,
        agent: row.agent
          ? {
              id: row.agent.id,
              name: row.agent.name,
              status: row.agent.status,
              repoOwner: row.agent.repoOwner,
              repoName: row.agent.repoName,
              permissions: row.agent.permissions,
              checkCommand: row.agent.checkCommand,
              composioToolkitSlugs: row.agent.composioToolkitSlugs,
            }
          : null,
      },
    }),
  ]);

  const eventEvidence = loadEvidenceSource(
    "background_agent_events",
    async () => {
      const events = await db.query.backgroundAgentEvents.findMany({
        where: and(
          eq(backgroundAgentEvents.userId, params.userId),
          eq(backgroundAgentEvents.runId, run.id),
        ),
        orderBy: [asc(backgroundAgentEvents.createdAt)],
        limit: params.limit,
      });
      return events.map((event) =>
        makeDiagnosticEvidence({
          id: event.id,
          kind: "background_agent_event",
          title: event.eventName,
          status: event.status,
          level: event.level,
          summary: event.summary,
          occurredAt: event.createdAt,
          redactionStatus: event.redactionStatus,
          correlations: {
            workflowRunId: event.workflowRunId,
            requestId: event.requestId,
            sandboxName: event.sandboxName,
          },
          metadata: {
            sequence: event.sequence,
            errorKind: event.errorKind,
            payload: event.payload,
          },
        }),
      );
    },
  );

  const outputEvidence = loadEvidenceSource(
    "background_agent_outputs",
    async () => {
      const outputs = await db.query.backgroundAgentOutputs.findMany({
        where: and(
          eq(backgroundAgentOutputs.userId, params.userId),
          eq(backgroundAgentOutputs.runId, run.id),
        ),
        orderBy: [asc(backgroundAgentOutputs.createdAt)],
        limit: params.limit,
      });
      return outputs.map((output) =>
        makeDiagnosticEvidence({
          id: output.id,
          kind: "background_agent_output",
          title: `${output.kind} output`,
          status: output.status,
          occurredAt: output.createdAt,
          correlations: { prNumber: output.prNumber },
          metadata: {
            url: output.url,
            payload: output.payload,
          },
        }),
      );
    },
  );

  const toolSessionEvidence = loadEvidenceSource(
    "background_agent_tool_sessions",
    async () => {
      const sessions = await db.query.backgroundAgentToolSessions.findMany({
        where: and(
          eq(backgroundAgentToolSessions.userId, params.userId),
          eq(backgroundAgentToolSessions.runId, run.id),
        ),
        orderBy: [desc(backgroundAgentToolSessions.createdAt)],
        limit: params.limit,
      });
      return sessions.map((session) =>
        makeDiagnosticEvidence({
          id: session.id,
          kind: "background_agent_tool_session",
          title: `${session.provider} ${session.agentRole} tools`,
          status: session.status,
          occurredAt: session.lastUsedAt,
          metadata: {
            agentId: session.agentId,
            provider: session.provider,
            profileId: session.profileId,
            agentRole: session.agentRole,
            phase: session.phase,
            providerSessionId: session.providerSessionId,
            configHash: session.configHash,
          },
        }),
      );
    },
  );

  const sourceResults = compactSourceResults([
    await runEvidence,
    await eventEvidence,
    await outputEvidence,
    await toolSessionEvidence,
    ...(await loadWorkflowEvidence({
      userId: params.userId,
      workflowRunIds: uniqueStrings([run.workflowRunId]),
      limit: params.limit,
    })),
    ...(await loadGitHubRepoEvidence({
      userId: params.userId,
      target,
    })),
  ]);

  return buildAccountDiagnosis({
    source: "background_agent",
    id: run.id,
    target,
    ...sourceResults,
    now: params.now,
  });
}

async function loadAgentLoopDiagnosis(params: {
  userId: string;
  id: string;
  now: Date;
  limit: number;
}): Promise<AccountDiagnosisResponse | null> {
  const [row] = await db
    .select({ run: agentLoopRuns, loop: agentLoops })
    .from(agentLoopRuns)
    .leftJoin(agentLoops, eq(agentLoops.id, agentLoopRuns.loopId))
    .where(
      and(
        eq(agentLoopRuns.id, params.id),
        eq(agentLoopRuns.userId, params.userId),
      ),
    )
    .limit(1);
  if (!row?.loop) {
    return null;
  }

  const run = row.run;
  const loop = row.loop;
  const target = normalizeAgentLoopRun(
    {
      id: run.id,
      loopName: loop.name,
      status: run.status,
      source: run.source,
      repoOwner: loop.repoOwner,
      repoName: loop.repoName,
      currentNodeId: run.currentNodeId,
      stepCount: run.stepCount,
      errorKind: run.errorKind,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    } satisfies AgentLoopRunRow,
    params.now,
  );

  const stepRows = await db.query.agentLoopStepRuns.findMany({
    where: eq(agentLoopStepRuns.loopRunId, run.id),
    orderBy: [asc(agentLoopStepRuns.createdAt)],
    limit: params.limit,
  });
  const workflowRunIds = uniqueStrings([
    run.workflowRunId,
    ...stepRows.map((step) => step.workflowRunId),
  ]);

  const targetEvidence = loadEvidenceSource("agent_loop_run", async () => [
    makeDiagnosticEvidence({
      id: run.id,
      kind: "target",
      title: loop.name,
      status: run.status,
      summary: run.errorMessage ? "Agent loop run failed" : undefined,
      occurredAt: run.updatedAt,
      correlations: {
        workflowRunId: run.workflowRunId,
        requestId: run.requestId,
      },
      metadata: {
        loopId: run.loopId,
        currentNodeId: run.currentNodeId,
        currentStepRunId: run.currentStepRunId,
        iterationCount: run.iterationCount,
        stepCount: run.stepCount,
        source: run.source,
        triggerId: run.triggerId,
        idempotencyKey: run.idempotencyKey,
        errorKind: run.errorKind,
        errorMessage: run.errorMessage,
        definitionSnapshot: run.definitionSnapshot,
        context: run.context,
        loop: {
          id: loop.id,
          name: loop.name,
          description: loop.description,
          repoOwner: loop.repoOwner,
          repoName: loop.repoName,
          status: loop.status,
          guardrails: loop.guardrails,
          permissions: loop.permissions,
          watchdogEnabled: loop.watchdogEnabled,
          watchdogRetryBudget: loop.watchdogRetryBudget,
        },
      },
    }),
  ]);

  const stepEvidence = loadEvidenceSource("agent_loop_step_runs", async () =>
    stepRows.map((step) =>
      makeDiagnosticEvidence({
        id: step.id,
        kind: "agent_loop_step",
        title: `${step.nodeKind} ${step.nodeId}`,
        status: step.status,
        summary: step.errorMessage ? "Agent loop step failed" : undefined,
        occurredAt: step.finishedAt ?? step.startedAt ?? step.createdAt,
        correlations: {
          workflowRunId: step.workflowRunId,
          sandboxName: step.sandboxName,
        },
        metadata: {
          nodeId: step.nodeId,
          nodeKind: step.nodeKind,
          attempt: step.attempt,
          stepInput: step.stepInput,
          stepOutput: step.stepOutput,
          errorKind: step.errorKind,
          errorMessage: step.errorMessage,
          durationMs: step.durationMs,
        },
      }),
    ),
  );

  const eventEvidence = loadEvidenceSource("agent_loop_events", async () => {
    const events = await db.query.agentLoopEvents.findMany({
      where: eq(agentLoopEvents.loopRunId, run.id),
      orderBy: [asc(agentLoopEvents.createdAt)],
      limit: params.limit,
    });
    return events.map((event) =>
      makeDiagnosticEvidence({
        id: event.id,
        kind: "agent_loop_event",
        title: event.eventName,
        status: event.status,
        level: event.level,
        summary: event.summary,
        occurredAt: event.createdAt,
        redactionStatus: event.redactionStatus,
        correlations: {
          workflowRunId: event.workflowRunId,
          requestId: event.requestId,
        },
        metadata: {
          stepRunId: event.stepRunId,
          nodeId: event.nodeId,
          payload: event.payload,
        },
      }),
    );
  });

  const watchdogEvidence = loadEvidenceSource(
    "agent_loop_watchdog_runs",
    async () => {
      const watchdogs = await db.query.agentLoopWatchdogRuns.findMany({
        where: eq(agentLoopWatchdogRuns.loopRunId, run.id),
        orderBy: [asc(agentLoopWatchdogRuns.createdAt)],
        limit: params.limit,
      });
      return watchdogs.map((watchdog) =>
        makeDiagnosticEvidence({
          id: watchdog.id,
          kind: "agent_loop_watchdog",
          title: `Watchdog ${watchdog.nodeId}`,
          status: watchdog.status,
          summary: watchdog.diagnosis,
          occurredAt:
            watchdog.finishedAt ?? watchdog.startedAt ?? watchdog.createdAt,
          metadata: {
            stepRunId: watchdog.stepRunId,
            nodeId: watchdog.nodeId,
            decision: watchdog.decision,
            decisionPayload: watchdog.decisionPayload,
            attempt: watchdog.attempt,
            budgetRemaining: watchdog.budgetRemaining,
          },
        }),
      );
    },
  );

  const sourceResults = compactSourceResults([
    await targetEvidence,
    await stepEvidence,
    await eventEvidence,
    await watchdogEvidence,
    ...(await loadWorkflowEvidence({
      userId: params.userId,
      workflowRunIds,
      limit: params.limit,
    })),
    ...(await loadGitHubRepoEvidence({
      userId: params.userId,
      target,
    })),
  ]);

  return buildAccountDiagnosis({
    source: "agent_loop",
    id: run.id,
    target,
    ...sourceResults,
    now: params.now,
  });
}

export async function buildDbBackedAccountDiagnosis(params: {
  userId: string;
  source: AccountDiagnosisSource;
  id: string;
  now?: Date;
  limit?: number;
}): Promise<AccountDiagnosisResponse | null> {
  const now = params.now ?? new Date();
  const limit = clampLimit(params.limit);

  switch (params.source) {
    case "session":
      return loadSessionDiagnosis({ ...params, now, limit });
    case "chat_workflow":
      return loadWorkflowDiagnosis({ ...params, now, limit });
    case "background_agent":
      return loadBackgroundAgentDiagnosis({ ...params, now, limit });
    case "agent_loop":
      return loadAgentLoopDiagnosis({ ...params, now, limit });
  }
}
