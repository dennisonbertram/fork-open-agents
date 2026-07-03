import "server-only";

import type {
  SetupManagedRuntimeProfileInput,
  SetupManagedRuntimeProfileOutput,
} from "@open-agents/agent";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type ManagedRuntimeCommandObservation,
  type ManagedRuntimeProfileDraft,
  managedRuntimeProfileDrafts,
} from "./schema";

export type ManagedRuntimeProfileDraftSnapshot = Omit<
  ManagedRuntimeProfileDraft,
  "createdAt" | "testedAt" | "updatedAt"
> & {
  createdAt: string;
  testedAt: string | null;
  updatedAt: string;
};

export function toManagedRuntimeProfileDraftSnapshot(
  draft: ManagedRuntimeProfileDraft,
): ManagedRuntimeProfileDraftSnapshot {
  return {
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    testedAt: draft.testedAt?.toISOString() ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export async function upsertManagedRuntimeProfileDraftForToolCall(params: {
  userId: string;
  sessionId: string;
  chatId?: string | null;
  toolCallId: string;
  input: SetupManagedRuntimeProfileInput;
}): Promise<ManagedRuntimeProfileDraft> {
  const now = new Date();
  const [draft] = await db
    .insert(managedRuntimeProfileDrafts)
    .values({
      id: nanoid(),
      userId: params.userId,
      sessionId: params.sessionId,
      chatId: params.chatId ?? null,
      toolCallId: params.toolCallId,
      status: "draft_ready",
      targetScope: "session",
      goal: params.input.goal,
      repoSignals: params.input.repoSignals,
      profileDraft: params.input.draft,
      questionsForUser: params.input.questionsForUser,
      latestTestRunId: null,
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      userInstructions: null,
      userDecision: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        managedRuntimeProfileDrafts.sessionId,
        managedRuntimeProfileDrafts.toolCallId,
      ],
      set: {
        chatId: params.chatId ?? null,
        status: "draft_ready",
        goal: params.input.goal,
        repoSignals: params.input.repoSignals,
        profileDraft: params.input.draft,
        questionsForUser: params.input.questionsForUser,
        testResults: [],
        testFailureMessage: null,
        testedAt: null,
        userInstructions: null,
        userDecision: null,
        updatedAt: now,
      },
    })
    .returning();

  if (!draft) {
    throw new Error("Failed to upsert managed runtime profile draft");
  }

  return draft;
}

export async function listManagedRuntimeProfileDrafts(params: {
  userId: string;
  sessionId: string;
  chatId?: string | null;
  limit?: number;
}): Promise<ManagedRuntimeProfileDraft[]> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const where =
    params.chatId == null
      ? and(
          eq(managedRuntimeProfileDrafts.userId, params.userId),
          eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
        )
      : and(
          eq(managedRuntimeProfileDrafts.userId, params.userId),
          eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
          eq(managedRuntimeProfileDrafts.chatId, params.chatId),
        );

  return db.query.managedRuntimeProfileDrafts.findMany({
    where,
    orderBy: [desc(managedRuntimeProfileDrafts.createdAt)],
    limit,
  });
}

export async function getManagedRuntimeProfileDraft(params: {
  userId: string;
  sessionId: string;
  draftId: string;
}): Promise<ManagedRuntimeProfileDraft | undefined> {
  return db.query.managedRuntimeProfileDrafts.findFirst({
    where: and(
      eq(managedRuntimeProfileDrafts.id, params.draftId),
      eq(managedRuntimeProfileDrafts.userId, params.userId),
      eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
    ),
  });
}

export async function updateManagedRuntimeProfileDraftDecision(params: {
  userId: string;
  sessionId: string;
  draftId: string;
  output: SetupManagedRuntimeProfileOutput;
  /**
   * Persists `force_approved` (MR-1 column) when a draft is approved over a
   * failed/absent test (Decision D6). Kept as its own param instead of a
   * field on `output` because the output schema is owned by
   * packages/agent, outside this ticket's file territory.
   */
  forceApproved?: boolean;
}): Promise<ManagedRuntimeProfileDraft | undefined> {
  const now = new Date();
  const status =
    params.output.decision === "approved"
      ? "approved"
      : params.output.decision === "revise"
        ? "revision_requested"
        : "discarded";
  const userInstructions =
    params.output.decision === "revise"
      ? params.output.instructions
      : params.output.decision === "discarded"
        ? (params.output.reason ?? null)
        : (params.output.notes ?? null);

  const [draft] = await db
    .update(managedRuntimeProfileDrafts)
    .set({
      status,
      userDecision: params.output.decision,
      userInstructions,
      ...(params.forceApproved === undefined
        ? {}
        : { forceApproved: params.forceApproved }),
      updatedAt: now,
    })
    .where(
      and(
        eq(managedRuntimeProfileDrafts.id, params.draftId),
        eq(managedRuntimeProfileDrafts.userId, params.userId),
        eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
      ),
    )
    .returning();

  return draft;
}

export async function markManagedRuntimeProfileDraftTesting(params: {
  userId: string;
  sessionId: string;
  draftId: string;
}): Promise<ManagedRuntimeProfileDraft | undefined> {
  const [draft] = await db
    .update(managedRuntimeProfileDrafts)
    .set({
      status: "testing",
      testResults: [],
      testFailureMessage: null,
      latestTestRunId: nanoid(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(managedRuntimeProfileDrafts.id, params.draftId),
        eq(managedRuntimeProfileDrafts.userId, params.userId),
        eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
      ),
    )
    .returning();

  return draft;
}

export async function finishManagedRuntimeProfileDraftTest(params: {
  userId: string;
  sessionId: string;
  draftId: string;
  status: "tested" | "needs_changes";
  testResults: ManagedRuntimeCommandObservation[];
  testFailureMessage?: string | null;
  /**
   * The scope actually executed (verify vs setup_and_verify — Decision D6),
   * mirroring managedRuntimeSavedProfiles.lastTestScope for drafts.
   */
  testScope?: "verify" | "setup_and_verify" | null;
}): Promise<ManagedRuntimeProfileDraft | undefined> {
  const now = new Date();
  const [draft] = await db
    .update(managedRuntimeProfileDrafts)
    .set({
      status: params.status,
      testResults: params.testResults,
      testFailureMessage: params.testFailureMessage ?? null,
      lastTestScope: params.testScope ?? null,
      testedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(managedRuntimeProfileDrafts.id, params.draftId),
        eq(managedRuntimeProfileDrafts.userId, params.userId),
        eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
      ),
    )
    .returning();

  return draft;
}
