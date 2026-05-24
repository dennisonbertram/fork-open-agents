import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type ChatComposioSelection,
  type ComposioAgentDefaults,
  type ComposioAgentKey,
  type ComposioToolProfileValues,
  normalizeChatComposioSelection,
  normalizeComposioAgentDefaults,
  normalizeComposioToolProfilePatch,
  normalizeComposioToolProfileValues,
} from "@/lib/composio/types";
import { db } from "./client";
import {
  composioAgentSessions,
  composioToolProfiles,
  type ComposioAgentSession,
  type ComposioToolProfile,
  type NewComposioAgentSession,
  userPreferences,
} from "./schema";
import { getUserPreferences, updateUserPreferences } from "./user-preferences";

export type ComposioToolProfileRecord = ComposioToolProfile;

export async function listComposioToolProfiles(
  userId: string,
): Promise<ComposioToolProfileRecord[]> {
  return db.query.composioToolProfiles.findMany({
    where: eq(composioToolProfiles.userId, userId),
    orderBy: [desc(composioToolProfiles.updatedAt)],
  });
}

export async function getComposioToolProfile(
  userId: string,
  profileId: string,
): Promise<ComposioToolProfileRecord | undefined> {
  return db.query.composioToolProfiles.findFirst({
    where: and(
      eq(composioToolProfiles.userId, userId),
      eq(composioToolProfiles.id, profileId),
    ),
  });
}

export async function createComposioToolProfile(
  userId: string,
  input: unknown,
): Promise<ComposioToolProfileRecord> {
  const profile = normalizeComposioToolProfileValues(input);
  const [created] = await db
    .insert(composioToolProfiles)
    .values({
      id: nanoid(),
      userId,
      ...profile,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create Composio profile");
  }

  return created;
}

function getProfileValues(
  profile: ComposioToolProfileRecord,
): ComposioToolProfileValues {
  return {
    name: profile.name,
    toolkitSlugs: profile.toolkitSlugs,
    authConfigIdsByToolkit: profile.authConfigIdsByToolkit,
    connectedAccountIdsByToolkit: profile.connectedAccountIdsByToolkit,
    workbenchEnabled: profile.workbenchEnabled,
    allowInChatConnectionManagement: profile.allowInChatConnectionManagement,
  };
}

export async function updateComposioToolProfile(
  userId: string,
  profileId: string,
  patch: unknown,
): Promise<ComposioToolProfileRecord | undefined> {
  const existing = await getComposioToolProfile(userId, profileId);
  if (!existing) {
    return undefined;
  }

  const nextProfile = normalizeComposioToolProfilePatch(
    getProfileValues(existing),
    patch,
  );

  const [updated] = await db
    .update(composioToolProfiles)
    .set({
      ...nextProfile,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(composioToolProfiles.userId, userId),
        eq(composioToolProfiles.id, profileId),
      ),
    )
    .returning();

  return updated;
}

export async function deleteComposioToolProfile(
  userId: string,
  profileId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(composioToolProfiles)
    .where(
      and(
        eq(composioToolProfiles.userId, userId),
        eq(composioToolProfiles.id, profileId),
      ),
    )
    .returning({ id: composioToolProfiles.id });

  return deleted.length > 0;
}

export async function getComposioAgentDefaults(
  userId: string,
): Promise<ComposioAgentDefaults> {
  const preferences = await getUserPreferences(userId);
  return preferences.composioAgentDefaults;
}

export async function updateComposioAgentDefaults(
  userId: string,
  defaults: unknown,
): Promise<ComposioAgentDefaults> {
  const normalized = normalizeComposioAgentDefaults(defaults);
  const preferences = await updateUserPreferences(userId, {
    composioAgentDefaults: normalized,
  });
  return preferences.composioAgentDefaults;
}

export async function getStoredComposioAgentDefaults(
  userId: string,
): Promise<ComposioAgentDefaults | null> {
  const [row] = await db
    .select({ composioAgentDefaults: userPreferences.composioAgentDefaults })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return row ? normalizeComposioAgentDefaults(row.composioAgentDefaults) : null;
}

export async function getComposioAgentSession(params: {
  userId: string;
  chatId: string;
  agentKey: ComposioAgentKey;
  profileId: string;
  configHash: string;
}): Promise<ComposioAgentSession | undefined> {
  return db.query.composioAgentSessions.findFirst({
    where: and(
      eq(composioAgentSessions.userId, params.userId),
      eq(composioAgentSessions.chatId, params.chatId),
      eq(composioAgentSessions.agentKey, params.agentKey),
      eq(composioAgentSessions.profileId, params.profileId),
      eq(composioAgentSessions.configHash, params.configHash),
    ),
  });
}

export async function upsertComposioAgentSession(
  data: Omit<NewComposioAgentSession, "id" | "createdAt" | "lastUsedAt">,
): Promise<ComposioAgentSession> {
  const now = new Date();
  const [session] = await db
    .insert(composioAgentSessions)
    .values({
      id: nanoid(),
      ...data,
      createdAt: now,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        composioAgentSessions.userId,
        composioAgentSessions.chatId,
        composioAgentSessions.agentKey,
        composioAgentSessions.profileId,
        composioAgentSessions.configHash,
      ],
      set: {
        composioSessionId: data.composioSessionId,
        lastUsedAt: now,
      },
    })
    .returning();

  if (!session) {
    throw new Error("Failed to persist Composio session");
  }

  return session;
}

export async function touchComposioAgentSession(
  sessionId: string,
): Promise<void> {
  await db
    .update(composioAgentSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(composioAgentSessions.id, sessionId));
}

export function getChatComposioSelection(
  value: unknown,
): ChatComposioSelection {
  return normalizeChatComposioSelection(value);
}
