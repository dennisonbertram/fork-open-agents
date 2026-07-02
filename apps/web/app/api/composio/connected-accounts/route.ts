import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getComposioClient } from "@/lib/composio/client";
import { getComposioConfig } from "@/lib/composio/config";
import {
  listComposioConnectedAccounts,
  type ComposioConnectedAccount,
} from "@/lib/composio/connected-accounts";

export type { ComposioConnectedAccount };

export interface ComposioConnectedAccountsResponse {
  accounts: ComposioConnectedAccount[];
  /**
   * True only when the Composio SDK call failed and this response could not
   * determine the user's real connected-account state. Distinguishes
   * "couldn't check right now" (unavailable: true, accounts: []) from
   * "genuinely zero connections" (unavailable absent/false, accounts: []) —
   * both would otherwise be an indistinguishable bare `{ accounts: [] }`.
   */
  unavailable?: boolean;
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
    const accounts = await listComposioConnectedAccounts({
      composio: getComposioClient(),
      userId: authResult.userId,
    });

    return Response.json({
      accounts,
    } satisfies ComposioConnectedAccountsResponse);
  } catch {
    // Connected-accounts is best-effort status — don't 500. But an SDK
    // failure must be distinguishable from a genuinely empty account list,
    // so callers don't render "no tools connected" when the real answer is
    // "couldn't check right now" (issue #800).
    return Response.json({
      accounts: [],
      unavailable: true,
    } satisfies ComposioConnectedAccountsResponse);
  }
}
