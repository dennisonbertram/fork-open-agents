import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { repositorySettings, type RepositorySettings } from "./schema";

// ── Normalization ──────────────────────────────────────────────────────────────

/**
 * Normalize a repository owner or name to a canonical form:
 * trim whitespace and convert to lowercase.
 * Matches the normalizeRepositoryPart behavior in lib/db/composio.ts.
 */
function normalizeRepositoryPart(value: string): string {
  return value.trim().toLowerCase();
}

// ── Nullable settings type ─────────────────────────────────────────────────────

/**
 * Subset of RepositorySettings columns that callers can write.
 * All fields are optional; only fields explicitly passed are persisted.
 * Pass null to clear an override back to inherit.
 */
export type RepositorySettingsInput = Partial<{
  fullClone: boolean | null;
  prewarmEnabled: boolean | null;
  runtimeMode: "classic" | "managed_runtime" | null;
  managedRuntimeProfileId: string | null;
  vcpus: number | null;
  autoCommitPush: boolean | null;
  autoCreatePr: boolean | null;
  defaultBranch: string | null;
  isNewBranch: boolean | null;
}>;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Fetch the repository_settings row for the given (userId, repoOwner, repoName)
 * triple, or undefined if none exists.
 *
 * Inputs are normalized (trim + lowercase) before the DB lookup, matching the
 * composio.ts normalizeRepositoryPart convention.
 */
export async function getRepositorySettings(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<RepositorySettings | undefined> {
  return db.query.repositorySettings.findFirst({
    where: and(
      eq(repositorySettings.userId, params.userId),
      eq(
        repositorySettings.repoOwner,
        normalizeRepositoryPart(params.repoOwner),
      ),
      eq(repositorySettings.repoName, normalizeRepositoryPart(params.repoName)),
    ),
  });
}

/**
 * Insert or update the repository_settings row for the given triple.
 *
 * - Only fields present in `settings` are written; undefined fields are
 *   omitted from the INSERT and from the conflict UPDATE set, so previously
 *   stored values for those columns are left unchanged.
 * - An explicit null in `settings` writes NULL to the column, which signals
 *   "inherit from the layer below" to the resolver.
 * - On conflict the unique index (userId, repoOwner, repoName) triggers an
 *   UPDATE of the passed fields plus updatedAt.
 *
 * Mirrors the upsertRepositoryComposioSettings pattern in lib/db/composio.ts.
 */
export async function upsertRepositorySettings(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  settings: RepositorySettingsInput;
}): Promise<RepositorySettings> {
  const now = new Date();
  const repoOwner = normalizeRepositoryPart(params.repoOwner);
  const repoName = normalizeRepositoryPart(params.repoName);

  const [record] = await db
    .insert(repositorySettings)
    .values({
      id: nanoid(),
      userId: params.userId,
      repoOwner,
      repoName,
      ...params.settings,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        repositorySettings.userId,
        repositorySettings.repoOwner,
        repositorySettings.repoName,
      ],
      set: {
        ...params.settings,
        updatedAt: now,
      },
    })
    .returning();

  if (!record) {
    throw new Error("Failed to save repository settings");
  }

  return record;
}
