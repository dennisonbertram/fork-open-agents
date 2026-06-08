"use client";

import { CheckCircle2, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { filterToolkits } from "./composio-catalog-filter";

const COMPOSIO_DASHBOARD_URL = "https://app.composio.dev";

/** Maximum cards rendered when no search query is active. */
const UNFILTERED_LIMIT = 60;
/** Maximum cards rendered when a search query is active. */
const FILTERED_LIMIT = 100;

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

interface ToolkitCardProps {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
  managedAuth: boolean;
  noAuth: boolean;
  isConnected: boolean;
  onConnect: (slug: string) => Promise<void>;
  isConnecting: boolean;
}

function ToolkitCard({
  slug,
  name,
  description,
  logo,
  managedAuth,
  noAuth,
  isConnected,
  onConnect,
  isConnecting,
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

      <div className="mt-auto pt-1">
        {isConnected ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Connected
          </span>
        ) : noAuth ? (
          <p className="text-xs text-muted-foreground">No sign-in needed</p>
        ) : managedAuth ? (
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

export function ComposioToolCatalog() {
  const [query, setQuery] = useState("");
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);

  const { data: toolkitsData, isLoading: toolkitsLoading } =
    useSWR<ComposioToolkitsResponse>(
      "/api/composio/toolkits",
      jsonFetcher<ComposioToolkitsResponse>,
    );

  const { data: accountsData, mutate: mutateAccounts } =
    useSWR<ComposioConnectedAccountsResponse>(
      "/api/composio/connected-accounts",
      jsonFetcher<ComposioConnectedAccountsResponse>,
    );

  const allToolkits = toolkitsData?.toolkits ?? [];

  // Don't render anything if catalog is empty (Composio not configured)
  if (!toolkitsLoading && allToolkits.length === 0) {
    return null;
  }

  const connectedSlugs = new Set(
    (accountsData?.accounts ?? []).map((a) => a.toolkitSlug),
  );

  const filtered = filterToolkits(allToolkits, query);
  const isSearching = query.trim().length > 0;
  const limit = isSearching ? FILTERED_LIMIT : UNFILTERED_LIMIT;
  const visible = filtered.slice(0, limit);
  const hiddenCount = filtered.length - visible.length;

  async function handleConnect(slug: string) {
    setConnectingSlug(slug);
    try {
      const res = await fetch("/api/composio/connect", {
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

      window.open(body.redirectUrl, "_blank");
      toast.success("Finish connecting in the new tab, then refresh");
      await mutateAccounts();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start connection",
      );
    } finally {
      setConnectingSlug(null);
    }
  }

  return (
    <div className="space-y-4">
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

      {toolkitsLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <ToolkitCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 && isSearching ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No tools found matching{" "}
          <span className="font-medium text-foreground">
            &ldquo;{query}&rdquo;
          </span>
          . Try a different name or keyword.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {isSearching
              ? `Showing ${visible.length} of ${filtered.length} matching tools`
              : `Showing ${visible.length} of ${allToolkits.length} tools`}
            {hiddenCount > 0 && !isSearching
              ? " — search to find more"
              : hiddenCount > 0
                ? ` — refine your search to see all`
                : ""}
          </p>
          <div className={cn("grid gap-3 sm:grid-cols-2 md:grid-cols-3")}>
            {visible.map((toolkit) => (
              <ToolkitCard
                key={toolkit.slug}
                slug={toolkit.slug}
                name={toolkit.name}
                description={toolkit.description}
                logo={toolkit.logo}
                managedAuth={toolkit.managedAuth}
                noAuth={toolkit.noAuth}
                isConnected={connectedSlugs.has(toolkit.slug)}
                onConnect={handleConnect}
                isConnecting={connectingSlug === toolkit.slug}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
