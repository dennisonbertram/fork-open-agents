import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthApplications, verification } from "@/lib/db/schema";

type StoredConsentValue = {
  clientId?: string;
  redirectURI?: string;
  scope?: string[];
  userId?: string;
  requireConsent?: boolean;
};

export type PendingMcpConsent =
  | { status: "invalid" }
  | {
      status: "ready";
      consentCode: string;
      clientId: string;
      clientName: string;
      redirectHost: string;
      scopes: string[];
    };

function parseStoredValue(raw: string): StoredConsentValue | null {
  try {
    return JSON.parse(raw) as StoredConsentValue;
  } catch {
    return null;
  }
}

function hostOf(redirectURI: string): string {
  try {
    return new URL(redirectURI).host;
  } catch {
    return redirectURI;
  }
}

/**
 * F3: the /mcp/consent page used to trust `client_id` and `scope` straight
 * off the URL, so it rendered the same "<clientId> is requesting..." text
 * for an attacker-crafted link as for a real MCP client, to signed-out
 * visitors, before checking anything against our own database. Make the
 * page authoritative: look up the pending consent by the still-valid,
 * unexpired, un-approved (requireConsent still true) verification record
 * that belongs to the calling user, and read the client identity from the
 * registered oauth_applications row it joins to — never from the URL.
 */
export async function loadPendingMcpConsent(
  consentCode: string,
  userId: string,
): Promise<PendingMcpConsent> {
  const [record] = await db
    .select({ value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, consentCode))
    .limit(1);

  if (!record || record.expiresAt.getTime() < Date.now()) {
    return { status: "invalid" };
  }

  const value = parseStoredValue(record.value);
  if (
    !(value?.requireConsent && value.clientId && value.redirectURI) ||
    value.userId !== userId
  ) {
    return { status: "invalid" };
  }

  const [client] = await db
    .select({
      name: oauthApplications.name,
      clientId: oauthApplications.clientId,
    })
    .from(oauthApplications)
    .where(eq(oauthApplications.clientId, value.clientId))
    .limit(1);

  if (!client) {
    return { status: "invalid" };
  }

  return {
    status: "ready",
    consentCode,
    clientId: client.clientId,
    clientName: client.name || client.clientId,
    redirectHost: hostOf(value.redirectURI),
    scopes: Array.isArray(value.scope) ? value.scope : [],
  };
}
