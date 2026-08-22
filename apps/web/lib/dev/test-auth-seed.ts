import { db } from "@/lib/db/client";
import { upsertInstallation } from "@/lib/db/installations";
import { accounts, users } from "@/lib/db/schema";
import { TEST_AUTH_USER_ID } from "@/lib/session/test-auth";

export const TEST_AUTH_GITHUB_ACCOUNT_ID = "test-auth-github-account";
export const TEST_AUTH_GITHUB_ACCOUNT_EXTERNAL_ID = "test-auth-github";
export const TEST_AUTH_GITHUB_INSTALLATION_ID = 1;
export const TEST_AUTH_GITHUB_LOGIN = "managed-runtime-demo";

/**
 * Idempotent rows for the demo test-auth user.
 *
 * Seeds a GitHub `accounts` row **without** a usable token so other
 * GitHub callers fail closed. `/api/github/connection-status` short-circuits
 * this user while test-auth is enabled so `GitHubReconnectGate` cannot brick
 * a cookie-only walk.
 */
export async function seedTestAuthUser(): Promise<{ userId: string }> {
  const now = new Date();

  await db
    .insert(users)
    .values({
      id: TEST_AUTH_USER_ID,
      username: TEST_AUTH_GITHUB_LOGIN,
      email: "managed-runtime-demo@example.test",
      emailVerified: true,
      name: "Managed Runtime Demo",
      avatarUrl: null,
      isAdmin: false,
      lastLoginAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        username: TEST_AUTH_GITHUB_LOGIN,
        email: "managed-runtime-demo@example.test",
        name: "Managed Runtime Demo",
        lastLoginAt: now,
        updatedAt: now,
      },
    });

  await db
    .insert(accounts)
    .values({
      id: TEST_AUTH_GITHUB_ACCOUNT_ID,
      accountId: TEST_AUTH_GITHUB_ACCOUNT_EXTERNAL_ID,
      providerId: "github",
      userId: TEST_AUTH_USER_ID,
      accessToken: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        accountId: TEST_AUTH_GITHUB_ACCOUNT_EXTERNAL_ID,
        providerId: "github",
        userId: TEST_AUTH_USER_ID,
        accessToken: null,
        updatedAt: now,
      },
    });

  await upsertInstallation({
    userId: TEST_AUTH_USER_ID,
    installationId: TEST_AUTH_GITHUB_INSTALLATION_ID,
    accountLogin: TEST_AUTH_GITHUB_LOGIN,
    accountType: "User",
    repositorySelection: "selected",
  });

  return { userId: TEST_AUTH_USER_ID };
}
