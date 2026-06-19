import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getComposioClient } from "@/lib/composio/client";
import { getComposioConfig } from "@/lib/composio/config";
import { toComposioUserId } from "@/lib/composio/user-id";

export interface ComposioConnectedAccount {
  toolkitSlug: string;
  status: string;
  alias: string | null;
  id: string;
}

export interface ComposioConnectedAccountsResponse {
  accounts: ComposioConnectedAccount[];
}

/**
 * Structural view of a Composio connected account item (avoids `any`).
 * The SDK types vary across versions; we narrow defensively.
 */
interface RawConnectedAccount {
  id?: string;
  status?: string;
  alias?: string | null;
  toolkit?: {
    slug?: string;
  };
  /** Some SDK versions expose slug directly on the item */
  toolkitSlug?: string;
}

function normalizeConnectedAccount(
  raw: unknown,
): ComposioConnectedAccount | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as RawConnectedAccount;

  const id = typeof item.id === "string" ? item.id : null;
  if (!id) return null;

  const toolkitSlug =
    typeof item.toolkit?.slug === "string"
      ? item.toolkit.slug
      : typeof item.toolkitSlug === "string"
        ? item.toolkitSlug
        : null;

  if (!toolkitSlug) return null;

  return {
    id,
    toolkitSlug,
    status: typeof item.status === "string" ? item.status : "UNKNOWN",
    alias: typeof item.alias === "string" ? item.alias : null,
  };
}

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  if (!getComposioConfig().configured) {
    return Response.json({
      accounts: [],
    } satisfies ComposioConnectedAccountsResponse);
  }

  try {
    const client = getComposioClient();
    const response = await client.connectedAccounts.list({
      userIds: [toComposioUserId(authResult.userId)],
      statuses: ["ACTIVE"],
    });

    // SDK response shape varies; narrow from unknown
    const rawItems: unknown[] = Array.isArray(response)
      ? response
      : Array.isArray((response as { items?: unknown[] }).items)
        ? ((response as { items: unknown[] }).items ?? [])
        : [];

    const accounts = rawItems
      .map(normalizeConnectedAccount)
      .filter(
        (account): account is ComposioConnectedAccount => account !== null,
      );

    return Response.json({
      accounts,
    } satisfies ComposioConnectedAccountsResponse);
  } catch {
    // Connected-accounts is best-effort status — don't 500
    return Response.json({
      accounts: [],
    } satisfies ComposioConnectedAccountsResponse);
  }
}
