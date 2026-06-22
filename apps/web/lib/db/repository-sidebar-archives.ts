import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type RepositorySidebarArchive,
  repositorySidebarArchives,
} from "./schema";

export type RepositorySidebarArchiveRecord = RepositorySidebarArchive;

function normalizeRepositoryPart(value: string): string {
  return value.trim().toLowerCase();
}

export async function listRepositorySidebarArchives(
  userId: string,
): Promise<RepositorySidebarArchiveRecord[]> {
  return db.query.repositorySidebarArchives.findMany({
    where: eq(repositorySidebarArchives.userId, userId),
    orderBy: [desc(repositorySidebarArchives.createdAt)],
  });
}

export async function archiveRepositoryInSidebar({
  userId,
  repoOwner,
  repoName,
}: {
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<RepositorySidebarArchiveRecord> {
  const normalizedRepoOwner = normalizeRepositoryPart(repoOwner);
  const normalizedRepoName = normalizeRepositoryPart(repoName);

  const [archived] = await db
    .insert(repositorySidebarArchives)
    .values({
      id: nanoid(),
      userId,
      repoOwner: normalizedRepoOwner,
      repoName: normalizedRepoName,
    })
    .onConflictDoUpdate({
      target: [
        repositorySidebarArchives.userId,
        repositorySidebarArchives.repoOwner,
        repositorySidebarArchives.repoName,
      ],
      set: {
        createdAt: new Date(),
      },
    })
    .returning();

  if (!archived) {
    throw new Error("Failed to archive repository in sidebar");
  }

  return archived;
}

export async function unarchiveRepositoryInSidebar({
  userId,
  repoOwner,
  repoName,
}: {
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(repositorySidebarArchives)
    .where(
      and(
        eq(repositorySidebarArchives.userId, userId),
        eq(
          repositorySidebarArchives.repoOwner,
          normalizeRepositoryPart(repoOwner),
        ),
        eq(
          repositorySidebarArchives.repoName,
          normalizeRepositoryPart(repoName),
        ),
      ),
    )
    .returning({ id: repositorySidebarArchives.id });

  return deleted.length > 0;
}
