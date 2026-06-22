import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type ChatComposioSelection,
  type ComposioAgentDefaults,
  type ComposioAgentKey,
  type ComposioToolProfileValues,
  type RepositoryComposioSettingsValues,
  normalizeComposioToolkitSlug,
  normalizeChatComposioSelection,
  normalizeComposioAgentDefaults,
  normalizeComposioToolProfilePatch,
  normalizeComposioToolProfileValues,
  normalizeRepositoryComposioSettings,
} from "@/lib/composio/types";
import { db } from "./client";
import {
  composioAgentSessions,
  composioToolProfiles,
  type ComposioAgentSession,
  type ComposioToolProfile,
  type NewComposioAgentSession,
  type RepositoryComposioSettings,
  repositoryComposioSettings,
  userPreferences,
} from "./schema";
import { getUserPreferences, updateUserPreferences } from "./user-preferences";

export type ComposioToolProfileRecord = ComposioToolProfile;
export type RepositoryComposioSettingsRecord = RepositoryComposioSettings;

export type ComposioProfileOption = ComposioToolProfileRecord & {
  available: boolean;
  disabledReason: string | null;
};

function normalizeRepositoryPart(value: string): string {
  return value.trim().toLowerCase();
}

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

export async function getRepositoryComposioSettings(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<RepositoryComposioSettingsRecord | undefined> {
  return db.query.repositoryComposioSettings.findFirst({
    where: and(
      eq(repositoryComposioSettings.userId, params.userId),
      eq(
        repositoryComposioSettings.repoOwner,
        normalizeRepositoryPart(params.repoOwner),
      ),
      eq(
        repositoryComposioSettings.repoName,
        normalizeRepositoryPart(params.repoName),
      ),
    ),
  });
}

export async function upsertRepositoryComposioSettings(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  settings: unknown;
}): Promise<RepositoryComposioSettingsRecord> {
  const settings = normalizeRepositoryComposioSettings(params.settings);
  const now = new Date();
  const repoOwner = normalizeRepositoryPart(params.repoOwner);
  const repoName = normalizeRepositoryPart(params.repoName);

  const [record] = await db
    .insert(repositoryComposioSettings)
    .values({
      id: nanoid(),
      userId: params.userId,
      repoOwner,
      repoName,
      ...settings,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        repositoryComposioSettings.userId,
        repositoryComposioSettings.repoOwner,
        repositoryComposioSettings.repoName,
      ],
      set: {
        ...settings,
        updatedAt: now,
      },
    })
    .returning();

  if (!record) {
    throw new Error("Failed to save repository Composio settings");
  }

  return record;
}

export function getRepositoryComposioSettingsValues(
  settings: RepositoryComposioSettingsRecord | undefined,
): RepositoryComposioSettingsValues | null {
  if (!settings) {
    return null;
  }

  return normalizeRepositoryComposioSettings({
    inheritGlobalDefaults: settings.inheritGlobalDefaults,
    allowedProfileIds: settings.allowedProfileIds,
    blockedToolkitSlugs: settings.blockedToolkitSlugs,
    agentDefaults: settings.agentDefaults,
  });
}

function getProfileDisabledReason(
  profile: ComposioToolProfileRecord,
  settings: RepositoryComposioSettingsValues | null,
): string | null {
  if (!settings) {
    return null;
  }

  if (
    settings.allowedProfileIds.length > 0 &&
    !settings.allowedProfileIds.includes(profile.id)
  ) {
    return "Blocked by repository policy.";
  }

  const blockedToolkits = new Set(settings.blockedToolkitSlugs);
  const blockedToolkit = profile.toolkitSlugs.find((toolkit) =>
    blockedToolkits.has(normalizeComposioToolkitSlug(toolkit) ?? toolkit),
  );

  return blockedToolkit
    ? `Blocked toolkit for this repository: ${blockedToolkit}.`
    : null;
}

function getDisconnectedToolkitReason(
  profile: ComposioToolProfileRecord,
): string | null {
  for (const toolkit of profile.toolkitSlugs) {
    const normalizedToolkit = normalizeComposioToolkitSlug(toolkit) ?? toolkit;
    const authConfigIds =
      profile.authConfigIdsByToolkit[toolkit] ??
      profile.authConfigIdsByToolkit[normalizedToolkit] ??
      [];

    if (authConfigIds.length === 0) {
      continue;
    }

    const connectedAccountIds =
      profile.connectedAccountIdsByToolkit[toolkit] ??
      profile.connectedAccountIdsByToolkit[normalizedToolkit] ??
      [];

    if (connectedAccountIds.length === 0) {
      return `Tool not connected: ${toolkit}.`;
    }
  }

  return null;
}

export function applyRepositoryComposioPolicy(params: {
  profiles: ComposioToolProfileRecord[];
  settings: RepositoryComposioSettingsRecord | undefined;
}): ComposioProfileOption[] {
  const settings = getRepositoryComposioSettingsValues(params.settings);

  return params.profiles.map((profile) => {
    const disabledReason =
      getProfileDisabledReason(profile, settings) ??
      getDisconnectedToolkitReason(profile);
    return {
      ...profile,
      available: disabledReason === null,
      disabledReason,
    };
  });
}

export async function listComposioProfileOptionsForRepository(params: {
  userId: string;
  repoOwner?: string | null;
  repoName?: string | null;
}): Promise<{
  profiles: ComposioToolProfileRecord[];
  profileOptions: ComposioProfileOption[];
  repositorySettings: RepositoryComposioSettingsRecord | null;
}> {
  const profiles = await listComposioToolProfiles(params.userId);
  const repositorySettings =
    params.repoOwner && params.repoName
      ? ((await getRepositoryComposioSettings({
          userId: params.userId,
          repoOwner: params.repoOwner,
          repoName: params.repoName,
        })) ?? null)
      : null;

  return {
    profiles,
    profileOptions: applyRepositoryComposioPolicy({
      profiles,
      settings: repositorySettings ?? undefined,
    }),
    repositorySettings,
  };
}

export async function isComposioProfileAllowedForRepository(params: {
  userId: string;
  profileId: string;
  repoOwner?: string | null;
  repoName?: string | null;
}): Promise<{ allowed: boolean; reason: string | null }> {
  const profile = await getComposioToolProfile(params.userId, params.profileId);
  if (!profile) {
    return {
      allowed: false,
      reason: "The selected Composio profile no longer exists.",
    };
  }

  if (!params.repoOwner || !params.repoName) {
    return { allowed: true, reason: null };
  }

  const settings = await getRepositoryComposioSettings({
    userId: params.userId,
    repoOwner: params.repoOwner,
    repoName: params.repoName,
  });
  const [option] = applyRepositoryComposioPolicy({
    profiles: [profile],
    settings,
  });

  return {
    allowed: option?.available ?? true,
    reason: option?.disabledReason ?? null,
  };
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
