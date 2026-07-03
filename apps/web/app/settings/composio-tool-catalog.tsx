"use client";

import { AlertTriangle, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { filterToolkits } from "./composio-catalog-filter";
import {
  POPULAR_TOOLKIT_SLUGS,
  selectSuggestedToolkits,
} from "./composio-catalog-suggested";
import {
  buildToolkitStatusMap,
  getToolkitConnectionState,
  type ComposioToolkitConnectionState,
} from "./composio-connection-state";
import { useComposioConnect } from "./use-composio-connect";
import { useComposioToolkitsCatalog } from "./use-composio-toolkits-catalog";

const COMPOSIO_DASHBOARD_URL = "https://app.composio.dev";

/** Maximum cards rendered when a search query is active. */
const FILTERED_LIMIT = 30;

/** Maximum suggested (not-yet-connected popular) toolkits to show. */
const SUGGESTED_LIMIT = 4;

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return res.json() as Promise<T>;
}

function ToolkitCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-md shrink-0" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="mt-auto h-8 w-20" />
    </div>
  );
}

/**
 * Visible error/retry state for the catalog section (C2) — replaces the
 * previous silent `null` render when /api/composio/toolkits fails.
 */
function CatalogErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load the tools catalog right now.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  );
}

/**
 * Honest connect-progress copy shown under a card while a connect attempt is
 * in flight for that toolkit (C1/W7). Renders nothing once idle/confirmed so
 * the card falls back to its normal connection-state badge/CTA.
 */
function ConnectProgress({
  connectState,
}: {
  connectState:
    | { status: "connecting" | "pending"; slug: string }
    | { status: "blocked"; slug: string }
    | { status: "timed_out"; slug: string }
    | { status: "failed_to_start"; slug: string; message: string };
}) {
  if (connectState.status === "blocked") {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Your browser blocked the connect window — allow popups for this site and
        try again.
      </p>
    );
  }
  if (connectState.status === "timed_out") {
    return (
      <p className="text-xs text-muted-foreground">
        Still waiting to confirm — refresh or check Composio if this
        doesn&apos;t resolve.
      </p>
    );
  }
  if (connectState.status === "failed_to_start") {
    return <p className="text-xs text-destructive">{connectState.message}</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      Waiting for you to finish connecting in the new tab…
    </p>
  );
}

interface ToolkitCardProps {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  managedAuth: boolean;
  noAuth: boolean;
  connectionState: ComposioToolkitConnectionState;
  onConnect: (slug: string) => Promise<void>;
  isConnecting: boolean;
  connectProgress: ConnectStateForSlug | null;
}

function ToolkitCard({
  slug,
  name,
  description,
  logo,
  managedAuth,
  noAuth,
  connectionState,
  onConnect,
  isConnecting,
  connectProgress,
}: ToolkitCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Remote Composio logos not compatible with next/image domain config
          <img
            src={logo}
            alt={`${name} logo`}
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            className="h-8 w-8 rounded-md object-contain shrink-0"
          />
        ) : (
          <div className="h-8 w-8 rounded-md bg-muted shrink-0 flex items-center justify-center">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {name.slice(0, 2)}
            </span>
          </div>
        )}
        <span className="text-sm font-medium truncate">{name}</span>
      </div>

      {description ? (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {description}
        </p>
      ) : null}

      <div className="mt-auto pt-1 space-y-1">
        {connectProgress &&
        (connectProgress.status === "connecting" ||
          connectProgress.status === "pending" ||
          connectProgress.status === "blocked" ||
          connectProgress.status === "timed_out" ||
          connectProgress.status === "failed_to_start") ? (
          <ConnectProgress connectState={connectProgress} />
        ) : connectionState === "active" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Connected
          </span>
        ) : connectionState === "expired" ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Expired — reconnect
            </span>
            {managedAuth ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onConnect(slug)}
                disabled={isConnecting}
                className="h-7 text-xs"
              >
                Reconnect
              </Button>
            ) : null}
          </div>
        ) : connectionState === "unavailable" ? (
          <p className="text-xs text-muted-foreground">
            Can&apos;t check right now
          </p>
        ) : noAuth ? (
          <p className="text-xs text-muted-foreground">No sign-in needed</p>
        ) : managedAuth ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onConnect(slug)}
              disabled={isConnecting}
              className="h-7 text-xs"
            >
              Connect
            </Button>
            <p className="text-[10px] leading-tight text-muted-foreground">
              Opens an external site to connect — come back to this tab
              afterward.
            </p>
          </>
        ) : (
          <a
            href={COMPOSIO_DASHBOARD_URL}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Set up in Composio
          </a>
        )}
      </div>
    </div>
  );
}

type ConnectStateForSlug =
  | { status: "connecting" | "pending"; slug: string }
  | { status: "confirmed"; slug: string }
  | { status: "blocked"; slug: string }
  | { status: "timed_out"; slug: string }
  | { status: "failed_to_start"; slug: string; message: string };

interface ToolkitGroupProps {
  label: string;
  toolkits: Array<{
    slug: string;
    name: string;
    description: string | null;
    logo: string | null;
    managedAuth: boolean;
    noAuth: boolean;
  }>;
  toolkitStatusMap: Map<string, string>;
  accountsUnavailable: boolean;
  connectingSlug: string | null;
  connectState: ConnectStateForSlug | null;
  onConnect: (slug: string) => Promise<void>;
}

function ToolkitGroup({
  label,
  toolkits,
  toolkitStatusMap,
  accountsUnavailable,
  connectingSlug,
  connectState,
  onConnect,
}: ToolkitGroupProps) {
  if (toolkits.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {toolkits.map((toolkit) => (
          <ToolkitCard
            key={toolkit.slug}
            slug={toolkit.slug}
            name={toolkit.name}
            description={toolkit.description}
            logo={toolkit.logo}
            managedAuth={toolkit.managedAuth}
            noAuth={toolkit.noAuth}
            connectionState={
              toolkit.noAuth
                ? "active"
                : getToolkitConnectionState({
                    slug: toolkit.slug,
                    statusMap: toolkitStatusMap,
                    unavailable: accountsUnavailable,
                  })
            }
            onConnect={onConnect}
            isConnecting={connectingSlug === toolkit.slug}
            connectProgress={
              connectState?.slug === toolkit.slug ? connectState : null
            }
          />
        ))}
      </div>
    </div>
  );
}

export function ComposioToolCatalog() {
  const [query, setQuery] = useState("");

  const { loadState: toolkitsLoadState, error: toolkitsError } =
    useComposioToolkitsCatalog();

  const {
    data: accountsData,
    mutate: mutateAccounts,
    error: accountsFetchError,
  } = useSWR<ComposioConnectedAccountsResponse>(
    "/api/composio/connected-accounts",
    jsonFetcher<ComposioConnectedAccountsResponse>,
  );

  const { connectState, connect } = useComposioConnect({
    onConfirmed: () => {
      void mutateAccounts();
    },
  });

  // Surface the underlying fetch error to the console (not swallow it) so
  // agent-browser console/errors evidence during QA shows the real failure.
  if (toolkitsError) {
    // eslint-disable-next-line no-console -- intentional: surface real catalog fetch failures for debugging (issue #801)
    console.error("Composio toolkits catalog failed to load", toolkitsError);
  }
  if (accountsFetchError) {
    // eslint-disable-next-line no-console -- intentional: surface real connected-accounts fetch failures for debugging (issue #801)
    console.error(
      "Composio connected-accounts failed to load",
      accountsFetchError,
    );
  }

  if (toolkitsLoadState.status === "error") {
    return (
      <div className="space-y-3">
        <CatalogErrorState onRetry={() => void mutateAccounts()} />
      </div>
    );
  }

  const allToolkits =
    toolkitsLoadState.status === "loaded" ? toolkitsLoadState.toolkits : [];
  const toolkitsLoading = toolkitsLoadState.status === "loading";

  // Don't render anything if catalog is empty (Composio not configured)
  if (!toolkitsLoading && allToolkits.length === 0) {
    return null;
  }

  const toolkitStatusMap = buildToolkitStatusMap(accountsData?.accounts ?? []);
  const accountsUnavailable = accountsData?.unavailable === true;
  // "has been connected" (any status, including expired) — used to decide
  // group membership (pinned "Connected" group, excluded from "Suggested").
  // The badge/CTA rendered for each card still distinguishes active vs
  // expired vs other via connectionState (#800).
  const connectedSlugs = new Set(toolkitStatusMap.keys());

  const isSearching = query.trim().length > 0;

  const connectingSlug =
    connectState.status === "connecting" || connectState.status === "pending"
      ? connectState.slug
      : null;
  const connectStateForSlug: ConnectStateForSlug | null =
    connectState.status === "idle" ? null : connectState;

  // Build the "connected" (pinned) group: cross-reference catalog by slug
  const catalogBySlug = new Map(allToolkits.map((t) => [t.slug, t]));
  const connectedToolkits = Array.from(connectedSlugs).flatMap((slug) => {
    const entry = catalogBySlug.get(slug);
    return entry ? [entry] : [];
  });

  // Build the "suggested" group: at most SUGGESTED_LIMIT popular, not-yet-connected
  const suggestedToolkits = selectSuggestedToolkits(
    allToolkits,
    connectedSlugs,
    POPULAR_TOOLKIT_SLUGS,
    SUGGESTED_LIMIT,
  );

  // Search view
  const filtered = isSearching ? filterToolkits(allToolkits, query) : [];
  const visible = filtered.slice(0, FILTERED_LIMIT);
  const hiddenCount = filtered.length - visible.length;

  return (
    <div className="space-y-3">
      {/* Search input — stays fixed above the scroll area */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search tools — e.g. Gmail, Slack, Notion"
          className="pl-9"
          aria-label="Search tools"
        />
      </div>

      {/* Scrollable tool list — capped at ~10 rows so the section never grows the page */}
      <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border/60 p-3">
        {toolkitsLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <ToolkitCardSkeleton key={i} />
            ))}
          </div>
        ) : isSearching ? (
          /* Search view */
          <>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No tools found matching{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{query}&rdquo;
                </span>
                . Try a different name or keyword.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {`Showing ${visible.length} of ${filtered.length} matching tools`}
                  {hiddenCount > 0
                    ? ` — +${hiddenCount} more hidden, refine your search to see them`
                    : ""}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {visible.map((toolkit) => (
                    <ToolkitCard
                      key={toolkit.slug}
                      slug={toolkit.slug}
                      name={toolkit.name}
                      description={toolkit.description}
                      logo={toolkit.logo}
                      managedAuth={toolkit.managedAuth}
                      noAuth={toolkit.noAuth}
                      connectionState={
                        toolkit.noAuth
                          ? "active"
                          : getToolkitConnectionState({
                              slug: toolkit.slug,
                              statusMap: toolkitStatusMap,
                              unavailable: accountsUnavailable,
                            })
                      }
                      onConnect={connect}
                      isConnecting={connectingSlug === toolkit.slug}
                      connectProgress={
                        connectStateForSlug?.slug === toolkit.slug
                          ? connectStateForSlug
                          : null
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Default view: pinned connected + suggestions */
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Showing your connected tools and a few suggestions — search to
              find any of 1000+.
            </p>
            <ToolkitGroup
              label="Connected"
              toolkits={connectedToolkits}
              toolkitStatusMap={toolkitStatusMap}
              accountsUnavailable={accountsUnavailable}
              connectingSlug={connectingSlug}
              connectState={connectStateForSlug}
              onConnect={connect}
            />
            <ToolkitGroup
              label="Suggested"
              toolkits={suggestedToolkits}
              toolkitStatusMap={toolkitStatusMap}
              accountsUnavailable={accountsUnavailable}
              connectingSlug={connectingSlug}
              connectState={connectStateForSlug}
              onConnect={connect}
            />
            {connectedToolkits.length === 0 &&
            suggestedToolkits.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No tools found. Search above to connect an app.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
