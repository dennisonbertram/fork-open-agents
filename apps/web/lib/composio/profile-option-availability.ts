export type ToolkitConnectionInfo = {
  slug: string;
  noAuth?: boolean;
};

export type ConnectedToolkitInfo = {
  toolkitSlug: string;
};

export type ProfileAvailabilityInput = {
  toolkitSlugs: string[];
  available: boolean;
  disabledReason: string | null;
};

export function getDisconnectedProfileReason(params: {
  toolkitSlugs: string[];
  toolkits: ToolkitConnectionInfo[];
  connectedAccounts: ConnectedToolkitInfo[];
}): string | null {
  const toolkitBySlug = new Map(
    params.toolkits.map((toolkit) => [toolkit.slug, toolkit]),
  );
  const connectedSlugs = new Set(
    params.connectedAccounts.map((account) => account.toolkitSlug),
  );

  const disconnectedSlug = params.toolkitSlugs.find((slug) => {
    const toolkit = toolkitBySlug.get(slug);
    if (!toolkit || toolkit.noAuth) {
      return false;
    }
    return !connectedSlugs.has(slug);
  });

  return disconnectedSlug ? `Tool not connected: ${disconnectedSlug}.` : null;
}

export function markDisconnectedProfilesUnavailable<
  T extends ProfileAvailabilityInput,
>(params: {
  profiles: T[];
  toolkits: ToolkitConnectionInfo[];
  connectedAccounts: ConnectedToolkitInfo[];
}): T[] {
  return params.profiles.map((profile) => {
    if (!profile.available || profile.disabledReason) {
      return profile;
    }

    const disconnectedReason = getDisconnectedProfileReason({
      toolkitSlugs: profile.toolkitSlugs,
      toolkits: params.toolkits,
      connectedAccounts: params.connectedAccounts,
    });

    if (!disconnectedReason) {
      return profile;
    }

    return {
      ...profile,
      available: false,
      disabledReason: disconnectedReason,
    };
  });
}
