import "server-only";

import type {
  ManagedRuntimeProfile,
  ManagedRuntimeProfileCommand,
} from "@open-agents/sandbox/managed-runtime-profiles";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type ManagedRuntimeCommandObservation,
  type ManagedRuntimeProfileDraft,
  type ManagedRuntimeSavedProfile,
  managedRuntimeProfileDrafts,
  managedRuntimeSavedProfiles,
  sessions,
} from "./schema";

function normalizeCommand(
  command: ManagedRuntimeProfileCommand,
): ManagedRuntimeProfileCommand {
  return {
    id: command.id,
    label: command.label,
    description: command.description,
    command: command.command,
    timeoutMs: command.timeoutMs,
    required: command.required,
  };
}

export function savedProfileIdForDraft(draftId: string): string {
  return `session-profile-${draftId}`;
}

export function toManagedRuntimeProfile(
  profile: ManagedRuntimeSavedProfile,
): ManagedRuntimeProfile {
  return {
    id: profile.id,
    version: profile.version,
    displayName: profile.displayName,
    description: profile.description,
    setupCommands: profile.setupCommands,
    verificationCommands: profile.verificationCommands,
    expectedTools: profile.expectedTools,
    optionalTools: profile.optionalTools,
    defaultPorts: profile.defaultPorts,
  };
}

export async function getManagedRuntimeSavedProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  return db.query.managedRuntimeSavedProfiles.findFirst({
    where: and(
      eq(managedRuntimeSavedProfiles.id, params.profileId),
      eq(managedRuntimeSavedProfiles.userId, params.userId),
      eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
    ),
  });
}

export async function listManagedRuntimeSavedProfiles(params: {
  userId: string;
  sessionId: string;
}): Promise<ManagedRuntimeSavedProfile[]> {
  return db.query.managedRuntimeSavedProfiles.findMany({
    where: and(
      eq(managedRuntimeSavedProfiles.userId, params.userId),
      eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
    ),
    orderBy: [desc(managedRuntimeSavedProfiles.updatedAt)],
  });
}

export async function updateManagedRuntimeSavedProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
  profile: Pick<
    ManagedRuntimeProfile,
    | "displayName"
    | "description"
    | "setupCommands"
    | "verificationCommands"
    | "expectedTools"
    | "optionalTools"
    | "defaultPorts"
  >;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  const now = new Date();
  const [profile] = await db
    .update(managedRuntimeSavedProfiles)
    .set({
      version: `edited-${now.toISOString()}`,
      displayName: params.profile.displayName,
      description: params.profile.description,
      setupCommands: params.profile.setupCommands.map(normalizeCommand),
      verificationCommands:
        params.profile.verificationCommands.map(normalizeCommand),
      expectedTools: params.profile.expectedTools,
      optionalTools: params.profile.optionalTools,
      defaultPorts: params.profile.defaultPorts,
      latestTestRunId: null,
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(managedRuntimeSavedProfiles.id, params.profileId),
        eq(managedRuntimeSavedProfiles.userId, params.userId),
        eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
      ),
    )
    .returning();

  return profile;
}

export async function deleteManagedRuntimeSavedProfile(params: {
  userId: string;
  sessionId: string;
  profileId: string;
  fallbackProfileId: string;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .delete(managedRuntimeSavedProfiles)
      .where(
        and(
          eq(managedRuntimeSavedProfiles.id, params.profileId),
          eq(managedRuntimeSavedProfiles.userId, params.userId),
          eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
        ),
      )
      .returning();

    if (!profile) {
      return undefined;
    }

    await tx
      .update(sessions)
      .set({
        managedRuntimeProfileId: params.fallbackProfileId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sessions.id, params.sessionId),
          eq(sessions.userId, params.userId),
          eq(sessions.managedRuntimeProfileId, params.profileId),
        ),
      );

    return profile;
  });
}

export async function applyDraftAsSessionManagedRuntimeProfile(params: {
  userId: string;
  sessionId: string;
  draft: ManagedRuntimeProfileDraft;
}): Promise<ManagedRuntimeSavedProfile> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const profileId = savedProfileIdForDraft(params.draft.id);
    const profileValues = {
      id: profileId,
      userId: params.userId,
      sessionId: params.sessionId,
      sourceDraftId: params.draft.id,
      scope: "session" as const,
      version: `draft-${params.draft.updatedAt.toISOString()}`,
      displayName: params.draft.profileDraft.displayName,
      description: params.draft.profileDraft.description,
      setupCommands:
        params.draft.profileDraft.setupCommands.map(normalizeCommand),
      verificationCommands:
        params.draft.profileDraft.verificationCommands.map(normalizeCommand),
      expectedTools: params.draft.profileDraft.expectedTools,
      optionalTools: params.draft.profileDraft.optionalTools,
      defaultPorts: params.draft.profileDraft.defaultPorts,
      latestTestRunId: params.draft.latestTestRunId,
      testResults: params.draft.testResults,
      testFailureMessage: params.draft.testFailureMessage,
      testedAt: params.draft.testedAt,
      updatedAt: now,
    };

    const [profile] = await tx
      .insert(managedRuntimeSavedProfiles)
      .values(profileValues)
      .onConflictDoUpdate({
        target: managedRuntimeSavedProfiles.id,
        set: {
          version: profileValues.version,
          displayName: profileValues.displayName,
          description: profileValues.description,
          setupCommands: profileValues.setupCommands,
          verificationCommands: profileValues.verificationCommands,
          expectedTools: profileValues.expectedTools,
          optionalTools: profileValues.optionalTools,
          defaultPorts: profileValues.defaultPorts,
          latestTestRunId: profileValues.latestTestRunId,
          testResults: profileValues.testResults,
          testFailureMessage: profileValues.testFailureMessage,
          testedAt: profileValues.testedAt,
          updatedAt: now,
        },
      })
      .returning();

    if (!profile) {
      throw new Error("Failed to save managed runtime profile");
    }

    await tx
      .update(sessions)
      .set({
        managedRuntimeProfileId: profile.id,
        runtimeMode: "managed_runtime",
        updatedAt: now,
      })
      .where(
        and(
          eq(sessions.id, params.sessionId),
          eq(sessions.userId, params.userId),
        ),
      );

    await tx
      .update(managedRuntimeProfileDrafts)
      .set({
        status: "applied",
        userDecision: "approved",
        updatedAt: now,
      })
      .where(
        and(
          eq(managedRuntimeProfileDrafts.id, params.draft.id),
          eq(managedRuntimeProfileDrafts.userId, params.userId),
          eq(managedRuntimeProfileDrafts.sessionId, params.sessionId),
        ),
      );

    return profile;
  });
}

export async function markManagedRuntimeSavedProfileTesting(params: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  const [profile] = await db
    .update(managedRuntimeSavedProfiles)
    .set({
      latestTestRunId: nanoid(),
      testResults: [],
      testFailureMessage: null,
      testedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(managedRuntimeSavedProfiles.id, params.profileId),
        eq(managedRuntimeSavedProfiles.userId, params.userId),
        eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
      ),
    )
    .returning();

  return profile;
}

export async function finishManagedRuntimeSavedProfileTest(params: {
  userId: string;
  sessionId: string;
  profileId: string;
  testResults: ManagedRuntimeCommandObservation[];
  testFailureMessage?: string | null;
}): Promise<ManagedRuntimeSavedProfile | undefined> {
  const now = new Date();
  const [profile] = await db
    .update(managedRuntimeSavedProfiles)
    .set({
      testResults: params.testResults,
      testFailureMessage: params.testFailureMessage ?? null,
      testedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(managedRuntimeSavedProfiles.id, params.profileId),
        eq(managedRuntimeSavedProfiles.userId, params.userId),
        eq(managedRuntimeSavedProfiles.sessionId, params.sessionId),
      ),
    )
    .returning();

  return profile;
}
