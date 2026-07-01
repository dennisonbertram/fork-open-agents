"use client";

import { CheckCircle2, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { filterToolkits } from "./composio-catalog-filter";
import {
  POPULAR_TOOLKIT_SLUGS,
  selectSuggestedToolkits,
} from "./composio-catalog-suggested";
import { useComposioCatalog, useComposioConnect } from "./composio-shared-hooks";

const COMPOSIO_DASHBOARD_URL = "https://app.composio.dev";

/** Maximum cards rendered when a search query is active. */
const FILTERED_LIMIT = 30;

/** Maximum suggested (not-yet-connected popular) toolkits to show. */
const SUGGESTED_LIMIT = 4;

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
  connectedSlugs: Set<string>;
  connectingSlug: string | null;
  onConnect: (slug: string) => Promise<void>;
}

function ToolkitGroup({
  label,
  toolkits,
  connectedSlugs,
  connectingSlug,
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
            isConnected={connectedSlugs.has(toolkit.slug)}
            onConnect={onConnect}
            isConnecting={connectingSlug === toolkit.slug}
          />
        ))}
      </div>
    </div>
  );
}

export function ComposioToolCatalog() {
  const [query, setQuery] = useState("");
  const { toolkits: allToolkits, toolkitsLoading, connectedSlugs } =
    useComposioCatalog();
  const { connectingSlug, connect: handleConnect } = useComposioConnect();

  // Don't render anything if catalog is empty (Composio not configured)
  if (!toolkitsLoading && allToolkits.length === 0) {
    return null;
  }

  const isSearching = query.trim().length > 0;

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
                  {hiddenCount > 0 ? " — refine your search to see all" : ""}
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
                      isConnected={connectedSlugs.has(toolkit.slug)}
                      onConnect={handleConnect}
                      isConnecting={connectingSlug === toolkit.slug}
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
              connectedSlugs={connectedSlugs}
              connectingSlug={connectingSlug}
              onConnect={handleConnect}
            />
            <ToolkitGroup
              label="Suggested"
              toolkits={suggestedToolkits}
              connectedSlugs={connectedSlugs}
              connectingSlug={connectingSlug}
              onConnect={handleConnect}
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
