import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  decryptInferenceSecret,
  encryptInferenceSecret,
  fingerprintInferenceSecret,
  InferenceSecretDecryptionError,
  lastFourSecretChars,
} from "@/lib/inference/encryption";
import { normalizeInferenceBaseUrl } from "@/lib/inference/model-routing";
import type {
  CreateInferenceProfileInput,
  InferenceProfileTestResult,
  SafeInferenceProfile,
  UpdateInferenceProfileInput,
} from "@/lib/inference/types";
import { db } from "./client";
import {
  inferenceProfiles,
  type InferenceProfile,
  type NewInferenceProfile,
} from "./schema";

function toSafeInferenceProfile(
  profile: InferenceProfile,
): SafeInferenceProfile {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: normalizeInferenceBaseUrl(profile.provider, profile.baseUrl),
    modelIds: profile.modelIds ?? [],
    keyLast4: profile.keyLast4,
    keyFingerprint: profile.keyFingerprint,
    status: profile.status,
    lastTestedAt: profile.lastTestedAt,
    lastTestMessage: profile.lastTestMessage,
    enabled: profile.enabled,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function keyFieldsForSecret(apiKey: string) {
  return {
    encryptedApiKey: encryptInferenceSecret(apiKey),
    keyLast4: lastFourSecretChars(apiKey),
    keyFingerprint: fingerprintInferenceSecret(apiKey),
  };
}

export function decryptInferenceProfileApiKey(
  profile: Pick<
    InferenceProfile,
    "encryptedApiKey" | "id" | "name" | "provider"
  >,
): string {
  try {
    return decryptInferenceSecret(profile.encryptedApiKey);
  } catch (error) {
    if (error instanceof InferenceSecretDecryptionError) {
      console.error("[inference] inference_profile_decrypt_failed", {
        event: "inference_profile_decrypt_failed",
        profileId: profile.id,
        provider: profile.provider,
        errorKind: "decrypt_auth_tag_mismatch",
      });

      throw Object.assign(
        new Error(
          `The saved API key for inference profile "${profile.name}" can't be decrypted in this environment — re-enter it in Settings → Models.`,
        ),
        { name: "InferenceProfileResolutionError" },
      );
    }

    throw error;
  }
}

export async function listInferenceProfiles(
  userId: string,
): Promise<SafeInferenceProfile[]> {
  const rows = await db.query.inferenceProfiles.findMany({
    where: eq(inferenceProfiles.userId, userId),
    orderBy: [
      desc(inferenceProfiles.updatedAt),
      desc(inferenceProfiles.createdAt),
    ],
  });

  return rows.map(toSafeInferenceProfile);
}

export async function getInferenceProfileByIdForUser(
  userId: string,
  profileId: string,
): Promise<InferenceProfile | null> {
  const profile =
    (await db.query.inferenceProfiles.findFirst({
      where: and(
        eq(inferenceProfiles.id, profileId),
        eq(inferenceProfiles.userId, userId),
      ),
    })) ?? null;

  if (!profile) {
    return null;
  }

  return {
    ...profile,
    baseUrl: normalizeInferenceBaseUrl(profile.provider, profile.baseUrl),
    modelIds: profile.modelIds ?? [],
  };
}

export async function createInferenceProfile(
  userId: string,
  input: CreateInferenceProfileInput,
): Promise<SafeInferenceProfile> {
  const normalizedBaseUrl = normalizeInferenceBaseUrl(
    input.provider,
    input.baseUrl,
  );
  const now = new Date();
  const row: NewInferenceProfile = {
    id: nanoid(),
    userId,
    name: input.name,
    provider: input.provider,
    baseUrl: normalizedBaseUrl,
    modelIds: input.modelIds.length > 0 ? input.modelIds : null,
    ...keyFieldsForSecret(input.apiKey),
    status: "untested",
    lastTestedAt: null,
    lastTestMessage: null,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  };

  const [created] = await db.insert(inferenceProfiles).values(row).returning();
  if (!created) {
    throw new Error("Failed to create inference profile");
  }

  return toSafeInferenceProfile(created);
}

export async function updateInferenceProfile(
  userId: string,
  input: UpdateInferenceProfileInput,
): Promise<SafeInferenceProfile | null> {
  const existing = await getInferenceProfileByIdForUser(
    userId,
    input.profileId,
  );
  if (!existing) {
    return null;
  }

  const updates: Partial<NewInferenceProfile> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) {
    updates.name = input.name;
  }
  if (input.provider !== undefined) {
    updates.provider = input.provider;
  }
  if (input.baseUrl !== undefined) {
    const provider = input.provider ?? existing.provider;
    updates.baseUrl = normalizeInferenceBaseUrl(provider, input.baseUrl);
  } else if (input.provider !== undefined) {
    updates.baseUrl = normalizeInferenceBaseUrl(
      input.provider,
      existing.baseUrl,
    );
  }
  if (input.modelIds !== undefined) {
    updates.modelIds = input.modelIds.length > 0 ? input.modelIds : null;
  }
  if (
    input.provider !== undefined ||
    input.baseUrl !== undefined ||
    input.modelIds !== undefined
  ) {
    Object.assign(updates, {
      status: "untested",
      lastTestedAt: null,
      lastTestMessage: null,
    } satisfies Partial<NewInferenceProfile>);
  }
  if (input.enabled !== undefined) {
    updates.enabled = input.enabled;
  }
  if (input.apiKey !== undefined) {
    Object.assign(updates, keyFieldsForSecret(input.apiKey), {
      status: "untested",
      lastTestedAt: null,
      lastTestMessage: null,
    } satisfies Partial<NewInferenceProfile>);
  }

  const nextProvider = updates.provider ?? existing.provider;
  const nextBaseUrl = updates.baseUrl ?? existing.baseUrl;
  const nextModelIds = updates.modelIds ?? existing.modelIds ?? null;
  if (
    nextProvider === "openai-compatible" &&
    (!nextBaseUrl || !nextModelIds || nextModelIds.length === 0)
  ) {
    throw new Error(
      "OpenAI-compatible profiles require a base URL and at least one model ID.",
    );
  }

  const [updated] = await db
    .update(inferenceProfiles)
    .set(updates)
    .where(
      and(
        eq(inferenceProfiles.id, input.profileId),
        eq(inferenceProfiles.userId, userId),
      ),
    )
    .returning();

  return updated ? toSafeInferenceProfile(updated) : null;
}

export async function deleteInferenceProfile(
  userId: string,
  profileId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(inferenceProfiles)
    .where(
      and(
        eq(inferenceProfiles.id, profileId),
        eq(inferenceProfiles.userId, userId),
      ),
    )
    .returning({ id: inferenceProfiles.id });

  return deleted.length > 0;
}

export async function recordInferenceProfileTestResult(
  userId: string,
  profileId: string,
  result: InferenceProfileTestResult,
): Promise<SafeInferenceProfile | null> {
  const [updated] = await db
    .update(inferenceProfiles)
    .set({
      status: result.status === "passed" ? "verified" : "failed",
      lastTestedAt: new Date(),
      lastTestMessage: result.message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inferenceProfiles.id, profileId),
        eq(inferenceProfiles.userId, userId),
      ),
    )
    .returning();

  return updated ? toSafeInferenceProfile(updated) : null;
}
