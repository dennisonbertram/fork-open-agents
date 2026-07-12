import { nanoid } from "nanoid";
import type { NormalizedBackgroundTriggerEvent } from "../background-agents/types";
import { computeDedupSignature, decideDedup, scoreOverlap } from "./dedup";
import {
  passesQualityGate,
  redactAndVerifyExcerpt,
  toEventPayload,
  type ExtractionCandidate,
} from "./extraction";
import type { LearningsStore, RepoLearningRow } from "./types";

export type RunLearningsExtractionParams = {
  event: NormalizedBackgroundTriggerEvent;
  userId: string;
  installationId: number;
  backgroundAgentRunId: string;
  octokit: unknown;
  generate: (prompt: string) => Promise<unknown>;
  store: LearningsStore;
  recordEvent: (params: unknown) => Promise<void>;
  assertLiveAuthorization?: () => Promise<void>;
};

export type RunLearningsExtractionResult = {
  candidatesExtracted: number;
  accepted: number;
  merged: number;
  rejected: number;
  errorKind?: string;
};

type GenerateResult = {
  candidates: ExtractionCandidate[];
};

function isGenerateResult(value: unknown): value is GenerateResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "candidates" in value &&
    Array.isArray((value as GenerateResult).candidates)
  );
}

type OctokitLike = {
  rest: {
    pulls: {
      get: (params: {
        owner: string;
        repo: string;
        pull_number: number;
      }) => Promise<{
        data: {
          title: string;
          body: string | null;
          head: { sha: string };
          base: { ref: string };
          user?: { login: string } | null;
          merged: boolean;
        };
      }>;
      listFiles: (params: {
        owner: string;
        repo: string;
        pull_number: number;
      }) => Promise<{
        data: Array<{
          filename: string;
          status: string;
          patch?: string;
        }>;
      }>;
    };
  };
  request: (url: string, params?: unknown) => Promise<{ data: string }>;
};

function isOctokitLike(value: unknown): value is OctokitLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "rest" in value &&
    typeof (value as OctokitLike).rest?.pulls?.get === "function"
  );
}

/**
 * Pure orchestration — all deps injected so tests can use fakes.
 *
 * Drop-before-persist: any candidate whose verifyRedaction result is not
 * "passed" is dropped without persisting a learning row or evidence excerpt.
 */
export async function runLearningsExtraction(
  params: RunLearningsExtractionParams,
): Promise<RunLearningsExtractionResult> {
  const {
    event,
    userId,
    installationId,
    backgroundAgentRunId,
    octokit,
    generate,
    store,
    recordEvent,
  } = params;
  const assertLiveAuthorization =
    params.assertLiveAuthorization ?? (async () => undefined);

  // Only process merged PRs
  if (event.merged !== true) {
    // Record a zero-learning run summary
    await assertLiveAuthorization();
    await store.recordExtractionRun({
      id: nanoid(),
      userId,
      backgroundAgentRunId,
      repoOwner: event.repoOwner,
      repoName: event.repoName,
      prNumber: event.prNumber ?? null,
      triggerKind: event.kind,
      candidatesExtracted: 0,
      accepted: 0,
      merged: 0,
      rejected: 0,
      errorKind: null,
    });
    await assertLiveAuthorization();
    return {
      candidatesExtracted: 0,
      accepted: 0,
      merged: 0,
      rejected: 0,
    };
  }

  await assertLiveAuthorization();
  await recordEvent({
    eventName: "learnings-extraction.run_started",
    level: "info",
    status: "info",
    runId: backgroundAgentRunId,
    userId,
    payload: {
      repoOwner: event.repoOwner,
      repoName: event.repoName,
      prNumber: event.prNumber,
      triggerKind: event.kind,
      backgroundAgentRunId,
      installationId,
    },
    redactionStatus: "passed",
  });

  // Fetch PR diff + files via injected octokit
  let diffText = "";
  let filesInfo = "";
  let prMeta = {
    title: "",
    body: "",
    author: "",
    headSha: "",
    baseBranch: "",
  };

  if (isOctokitLike(octokit) && event.prNumber) {
    try {
      await assertLiveAuthorization();
      const prResp = await octokit.rest.pulls.get({
        owner: event.repoOwner,
        repo: event.repoName,
        pull_number: event.prNumber,
      });
      const pr = prResp.data;
      prMeta = {
        title: pr.title,
        body: pr.body ?? "",
        author: pr.user?.login ?? "",
        headSha: pr.head.sha,
        baseBranch: pr.base.ref,
      };

      await assertLiveAuthorization();
      const filesResp = await octokit.rest.pulls.listFiles({
        owner: event.repoOwner,
        repo: event.repoName,
        pull_number: event.prNumber,
      });
      filesInfo = filesResp.data
        .map(
          (f) => `${f.status}: ${f.filename}${f.patch ? `\n${f.patch}` : ""}`,
        )
        .join("\n---\n");

      // Fetch diff
      await assertLiveAuthorization();
      const diffResp = await octokit.request(
        `GET /repos/${event.repoOwner}/${event.repoName}/pulls/${event.prNumber}`,
        { headers: { accept: "application/vnd.github.v3.diff" } },
      );
      diffText = typeof diffResp.data === "string" ? diffResp.data : "";
    } catch {
      await assertLiveAuthorization();
      // Treat fetch errors as empty diff — still record a run summary
    }
  }

  // Build the extraction prompt (untrusted text as DATA, not instructions)
  const prompt = `
You are extracting engineering learnings from a merged pull request.

PR Title: ${prMeta.title}
PR Author: ${prMeta.author}
Base branch: ${prMeta.baseBranch}

<DATA>
PR Body:
${prMeta.body}

Changed files:
${filesInfo}

Diff (truncated to 8000 chars):
${diffText.slice(0, 8000)}
</DATA>

Extract up to 5 actionable engineering learnings from the above DATA.
For each learning provide: title, description, rootCause, solution, prevention,
type (bug|convention|architecture|design|workflow|anti_pattern), scope (file|module|repo),
affectedPaths, tags, severity, confidence, actionable (boolean), qualityScore (0-5),
reviewerSourced (false for PR-based extraction).
`;

  let rawResult: unknown;
  await assertLiveAuthorization();
  try {
    rawResult = await generate(prompt);
  } catch {
    const errorKind = "extraction_parse_failed";
    await assertLiveAuthorization();
    await store.recordExtractionRun({
      id: nanoid(),
      userId,
      backgroundAgentRunId,
      repoOwner: event.repoOwner,
      repoName: event.repoName,
      prNumber: event.prNumber ?? null,
      triggerKind: event.kind,
      candidatesExtracted: 0,
      accepted: 0,
      merged: 0,
      rejected: 0,
      errorKind,
    });
    await assertLiveAuthorization();
    return {
      candidatesExtracted: 0,
      accepted: 0,
      merged: 0,
      rejected: 0,
      errorKind,
    };
  }

  if (!isGenerateResult(rawResult)) {
    const errorKind = "extraction_parse_failed";
    await assertLiveAuthorization();
    await store.recordExtractionRun({
      id: nanoid(),
      userId,
      backgroundAgentRunId,
      repoOwner: event.repoOwner,
      repoName: event.repoName,
      prNumber: event.prNumber ?? null,
      triggerKind: event.kind,
      candidatesExtracted: 0,
      accepted: 0,
      merged: 0,
      rejected: 0,
      errorKind,
    });
    await assertLiveAuthorization();
    return {
      candidatesExtracted: 0,
      accepted: 0,
      merged: 0,
      rejected: 0,
      errorKind,
    };
  }

  const candidates = rawResult.candidates;
  const candidatesExtracted = candidates.length;
  let accepted = 0;
  let mergedCount = 0;
  let rejected = 0;
  let runErrorKind: string | undefined;

  await assertLiveAuthorization();
  await recordEvent({
    eventName: "learnings-extraction.candidates_parsed",
    level: "info",
    status: "info",
    runId: backgroundAgentRunId,
    userId,
    payload: {
      backgroundAgentRunId,
      candidatesExtracted,
      redactionStatus: "passed",
    },
    redactionStatus: "passed",
  });

  // Fetch existing learnings for dedup
  await assertLiveAuthorization();
  const existing = await store.findForDedup({
    userId,
    repoOwner: event.repoOwner,
    repoName: event.repoName,
  });

  for (const candidate of candidates) {
    // Quality + actionability gate
    if (!passesQualityGate(candidate)) {
      rejected += 1;
      await assertLiveAuthorization();
      await recordEvent({
        eventName: "learnings-extraction.candidate_rejected",
        level: "info",
        status: "info",
        runId: backgroundAgentRunId,
        userId,
        payload: {
          backgroundAgentRunId,
          reason: "quality_gate",
          ...toEventPayload({
            title: candidate.title,
            description: candidate.description,
          }),
        },
        redactionStatus: "passed",
      });
      continue;
    }

    // Drop-before-persist: redact and verify the excerpt
    const excerptResult = redactAndVerifyExcerpt(candidate.excerpt);
    if ("drop" in excerptResult) {
      rejected += 1;
      runErrorKind = "redaction_blocked";
      await assertLiveAuthorization();
      await recordEvent({
        eventName: "learnings-extraction.redaction_blocked",
        level: "warn",
        status: "blocked",
        runId: backgroundAgentRunId,
        userId,
        payload: {
          backgroundAgentRunId,
          redactionStatus: "blocked",
          detector: excerptResult.detector,
          // NO excerpt — must not leak the secret
        },
        redactionStatus: "blocked",
      });
      continue;
    }

    // Determine initial confidence
    const confidence = candidate.reviewerSourced ? "low" : "medium";

    // Compute dedup signature
    const dedupSignature = computeDedupSignature({
      title: candidate.title,
      rootCause: candidate.rootCause,
      solution: candidate.solution,
      affectedPaths: candidate.affectedPaths,
      prevention: candidate.prevention,
    });

    // Find best overlap match
    let bestScore = 0;
    let bestMatch: (typeof existing)[number] | undefined;
    for (const row of existing) {
      const score = scoreOverlap(
        {
          title: row.title,
          rootCause: row.rootCause ?? undefined,
          solution: row.solution ?? undefined,
          affectedPaths: row.affectedPaths,
          prevention: row.prevention ?? undefined,
        },
        {
          title: candidate.title,
          rootCause: candidate.rootCause,
          solution: candidate.solution,
          affectedPaths: candidate.affectedPaths,
          prevention: candidate.prevention,
        },
      );
      if (score > bestScore) {
        bestScore = score;
        bestMatch = row;
      }
    }

    const decision = decideDedup(bestScore);

    if (decision === "update" && bestMatch) {
      // Merge into existing row
      await assertLiveAuthorization();
      await store.updateLearning(bestMatch.id, {
        description: candidate.description,
        solution: candidate.solution ?? undefined,
        prevention: candidate.prevention ?? undefined,
        confidence,
        status: "active",
      });
      mergedCount += 1;
      accepted += 1;
      await assertLiveAuthorization();
      await recordEvent({
        eventName: "learnings-extraction.learning_persisted",
        level: "info",
        status: "info",
        runId: backgroundAgentRunId,
        userId,
        payload: {
          backgroundAgentRunId,
          learningId: bestMatch.id,
          type: candidate.type,
          confidence,
          dedupDecision: "update",
          ...toEventPayload({
            title: candidate.title,
            description: candidate.description,
          }),
        },
        redactionStatus: "passed",
      });
    } else {
      // Create a new row
      const status =
        decision === "consolidation_review" ? "consolidation_review" : "active";
      const newRow: Omit<RepoLearningRow, "createdAt" | "updatedAt"> = {
        id: nanoid(),
        userId,
        repoOwner: event.repoOwner,
        repoName: event.repoName,
        installationId: installationId ?? null,
        type: candidate.type as RepoLearningRow["type"],
        scope: (candidate.scope ?? "repo") as RepoLearningRow["scope"],
        title: candidate.title,
        description: candidate.description,
        rootCause: candidate.rootCause ?? null,
        solution: candidate.solution ?? null,
        prevention: candidate.prevention ?? null,
        affectedPaths: candidate.affectedPaths ?? [],
        tags: candidate.tags ?? [],
        severity: (candidate.severity ?? "info") as RepoLearningRow["severity"],
        confidence,
        status,
        dedupSignature,
        supersedesLearningId: null,
        usageCount: 0,
        lastUsedAt: null,
        sourcePrNumber: event.prNumber ?? null,
        sourcePrUrl: event.url ?? null,
        committedFilePath: null,
        createdBy: "pr_review_learnings_agent",
      };
      await assertLiveAuthorization();
      await store.createLearning(newRow);
      accepted += 1;
      await assertLiveAuthorization();
      await recordEvent({
        eventName: "learnings-extraction.learning_persisted",
        level: "info",
        status: "info",
        runId: backgroundAgentRunId,
        userId,
        payload: {
          backgroundAgentRunId,
          learningId: newRow.id,
          type: candidate.type,
          confidence,
          dedupDecision: decision,
          ...toEventPayload({
            title: candidate.title,
            description: candidate.description,
          }),
        },
        redactionStatus: "passed",
      });
    }
  }

  // Record per-run extraction summary
  await assertLiveAuthorization();
  await store.recordExtractionRun({
    id: nanoid(),
    userId,
    backgroundAgentRunId,
    repoOwner: event.repoOwner,
    repoName: event.repoName,
    prNumber: event.prNumber ?? null,
    triggerKind: event.kind,
    candidatesExtracted,
    accepted,
    merged: mergedCount,
    rejected,
    errorKind: runErrorKind ?? null,
  });

  await assertLiveAuthorization();
  return {
    candidatesExtracted,
    accepted,
    merged: mergedCount,
    rejected,
    errorKind: runErrorKind,
  };
}
