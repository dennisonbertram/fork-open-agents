"use client";

/**
 * Shared Composio data-fetching + connect hooks.
 *
 * Extracted from composio-tool-catalog.tsx and composio-toolkit-picker.tsx,
 * which previously duplicated the same two SWR fetchers (toolkits +
 * connected-accounts) and, in the catalog's case, the OAuth "connect" flow.
 * Both consumers must keep using the exact same SWR cache keys
 * ("/api/composio/toolkits", "/api/composio/connected-accounts") so that a
 * mutation from one component (e.g. connecting a tool from a popover) is
 * immediately visible to every other component reading the same cache.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate as globalMutate } from "swr";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";

export const COMPOSIO_TOOLKITS_KEY = "/api/composio/toolkits";
export const COMPOSIO_CONNECTED_ACCOUNTS_KEY =
  "/api/composio/connected-accounts";

export async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return res.json() as Promise<T>;
}

export interface ComposioCatalogResult {
  toolkits: ComposioToolkitsResponse["toolkits"];
  toolkitsLoading: boolean;
  connectedSlugs: Set<string>;
  mutateAccounts: () => Promise<unknown>;
}

/**
 * Wraps the two duplicated SWR fetchers (toolkit catalog + connected
 * accounts) that both ComposioToolCatalog and ComposioToolkitPicker need.
 */
export function useComposioCatalog(): ComposioCatalogResult {
  const { data: toolkitsData, isLoading: toolkitsLoading } =
    useSWR<ComposioToolkitsResponse>(
      COMPOSIO_TOOLKITS_KEY,
      jsonFetcher<ComposioToolkitsResponse>,
    );

  const { data: accountsData, mutate: mutateAccounts } =
    useSWR<ComposioConnectedAccountsResponse>(
      COMPOSIO_CONNECTED_ACCOUNTS_KEY,
      jsonFetcher<ComposioConnectedAccountsResponse>,
    );

  const toolkits = toolkitsData?.toolkits ?? [];
  const connectedSlugs = new Set(
    (accountsData?.accounts ?? []).map((a) => a.toolkitSlug),
  );

  return { toolkits, toolkitsLoading, connectedSlugs, mutateAccounts };
}

export interface ComposioConnectDeps {
  fetchImpl?: typeof fetch;
  openWindow?: (url: string) => void;
  onToastSuccess?: (message: string) => void;
  onToastError?: (message: string) => void;
  mutateAccounts?: () => Promise<unknown>;
}

/**
 * Pure(ish) connect flow, extracted so it can be unit-tested without a React
 * render pass. This is the exact logic that previously lived inline as
 * `handleConnect` in composio-tool-catalog.tsx: POST to start the OAuth
 * connection, open the redirect in a new tab, toast success/error, and
 * revalidate the connected-accounts cache. Returns true on success (redirect
 * opened) and false if the connect attempt failed — callers use this to
 * decide whether to fire an "onConnected" callback.
 */
export async function performComposioConnect(
  slug: string,
  deps: ComposioConnectDeps = {},
): Promise<boolean> {
  const {
    fetchImpl = fetch,
    openWindow = (url: string) => {
      window.open(url, "_blank");
    },
    onToastSuccess = (message: string) => toast.success(message),
    onToastError = (message: string) => toast.error(message),
    mutateAccounts = () => Promise.resolve(),
  } = deps;

  try {
    const res = await fetchImpl("/api/composio/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: slug }),
    });
    const body = (await res.json().catch(() => null)) as {
      redirectUrl?: string;
      error?: string;
    } | null;

    if (!res.ok || !body?.redirectUrl) {
      throw new Error(body?.error ?? "Failed to start connection");
    }

    openWindow(body.redirectUrl);
    onToastSuccess("Finish connecting in the new tab, then refresh");
    await mutateAccounts();
    return true;
  } catch (error) {
    onToastError(
      error instanceof Error ? error.message : "Failed to start connection",
    );
    return false;
  }
}

export interface ComposioConnectResult {
  connectingSlug: string | null;
  connect: (slug: string) => Promise<void>;
}

export interface UseComposioConnectOptions {
  /** Called after a successful connect attempt (redirect opened). */
  onConnected?: () => void;
}

/**
 * Holds the "which toolkit is currently connecting" state and wires
 * performComposioConnect's revalidation to the shared global
 * connected-accounts cache key, so any component using useComposioCatalog()
 * sees the update without needing mutateAccounts passed in explicitly.
 */
export function useComposioConnect(
  opts: UseComposioConnectOptions = {},
): ComposioConnectResult {
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const { onConnected } = opts;

  const connect = useCallback(
    async (slug: string) => {
      setConnectingSlug(slug);
      try {
        const ok = await performComposioConnect(slug, {
          mutateAccounts: () => globalMutate(COMPOSIO_CONNECTED_ACCOUNTS_KEY),
        });
        if (ok) {
          onConnected?.();
        }
      } finally {
        setConnectingSlug(null);
      }
    },
    [onConnected],
  );

  return { connectingSlug, connect };
}
