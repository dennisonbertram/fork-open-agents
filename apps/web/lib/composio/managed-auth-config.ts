/**
 * Resolve a Composio "managed" (Composio-hosted OAuth) auth config id for a
 * toolkit, creating one if none exists yet.
 *
 * Why: Composio deprecated creating connections via the toolkit `authorize`/
 * `initiate` path for managed-OAuth auth configs (it now returns a 400 telling
 * callers to use `POST /connected_accounts/link` with an `auth_config_id`). So
 * to start a one-click OAuth connection we must first obtain a managed
 * auth_config_id, then call `connectedAccounts.link(userId, authConfigId)`.
 */

/** The managed-auth literal from @composio/core's AuthConfigTypes.COMPOSIO_MANAGED. */
export const COMPOSIO_MANAGED_AUTH = "use_composio_managed_auth" as const;

/** Minimal structural view of the Composio client methods we use here. */
export interface ManagedAuthConfigClient {
  authConfigs: {
    list(query: {
      toolkit: string;
      isComposioManaged?: boolean;
    }): Promise<{ items?: Array<{ id?: string | null }> }>;
    create(
      toolkit: string,
      options: { type: typeof COMPOSIO_MANAGED_AUTH },
    ): Promise<{ id: string }>;
  };
}

export async function resolveManagedAuthConfigId(
  client: ManagedAuthConfigClient,
  toolkitSlug: string,
): Promise<string> {
  const existing = await client.authConfigs.list({
    toolkit: toolkitSlug,
    isComposioManaged: true,
  });
  for (const item of existing.items ?? []) {
    if (item?.id) {
      return item.id;
    }
  }
  const created = await client.authConfigs.create(toolkitSlug, {
    type: COMPOSIO_MANAGED_AUTH,
  });
  return created.id;
}
