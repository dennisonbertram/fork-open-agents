"use client";

import { useState } from "react";
import { CheckCircle2, Search, X } from "lucide-react";
import useSWR from "swr";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { prettifyToolkitSlug } from "@/lib/composio/chat-tool-summary";
import { filterToolkits } from "./composio-catalog-filter";
import {
  mergeSelectedWithCatalog,
  toggleSlug,
} from "./composio-toolkit-picker-helpers";

/** Maximum toolkit rows shown when no query is active. */
const UNFILTERED_LIMIT = 50;

export interface ComposioToolkitPickerProps {
  /** Currently selected toolkit slugs. Parent owns persistence. */
  selectedSlugs: string[];
  /** Called with the updated slug array when the selection changes. */
  onChange: (slugs: string[]) => void;
  /** Disable all interaction while parent is saving. */
  disabled?: boolean;
  /** Reserved for future repo-level filtering. */
  repoOwner?: string | null;
  repoName?: string | null;
}

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return res.json() as Promise<T>;
}

function ToolkitRowSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5">
      <Skeleton className="h-5 w-5 rounded shrink-0" />
      <Skeleton className="h-4 w-28" />
    </div>
  );
}

export function ComposioToolkitPicker({
  selectedSlugs,
  onChange,
  disabled = false,
}: ComposioToolkitPickerProps) {
  const [query, setQuery] = useState("");

  const { data: toolkitsData, isLoading: toolkitsLoading } =
    useSWR<ComposioToolkitsResponse>(
      "/api/composio/toolkits",
      jsonFetcher<ComposioToolkitsResponse>,
    );

  const { data: accountsData } = useSWR<ComposioConnectedAccountsResponse>(
    "/api/composio/connected-accounts",
    jsonFetcher<ComposioConnectedAccountsResponse>,
  );

  const allToolkits = toolkitsData?.toolkits ?? [];
  const connectedSlugs = new Set(
    (accountsData?.accounts ?? []).map((a) => a.toolkitSlug),
  );

  // Build catalog entries filtered by search query
  const filtered = filterToolkits(allToolkits, query);
  const isSearching = query.trim().length > 0;
  const visibleCatalog = isSearching
    ? filtered
    : filtered.slice(0, UNFILTERED_LIMIT);
  const hiddenCount = filtered.length - visibleCatalog.length;

  // Merge: unknown (legacy) slugs + catalog entries
  const allEntries = mergeSelectedWithCatalog(selectedSlugs, allToolkits);

  // For the result list: use merged entries for catalog so selected state is in sync,
  // but only show unknown entries + filtered catalog entries
  const filteredSelected = new Set(
    mergeSelectedWithCatalog(selectedSlugs, filtered).map((e) => e.slug),
  );
  const unknownEntries = allEntries.filter((e) => e.unknown);
  const catalogRows = allEntries.filter(
    (e) => !e.unknown && filteredSelected.has(e.slug),
  );

  // When no search, only show the first UNFILTERED_LIMIT catalog rows
  // but always show all unknown (selected) entries first
  const catalogVisible = isSearching
    ? catalogRows
    : catalogRows.slice(0, UNFILTERED_LIMIT);

  const visibleRows = [...unknownEntries, ...catalogVisible];
  const resultCount = visibleRows.length;

  function handleToggle(slug: string) {
    if (disabled) return;
    onChange(toggleSlug(selectedSlugs, slug));
  }

  function handleRemoveChip(slug: string) {
    if (disabled) return;
    onChange(selectedSlugs.filter((s) => s !== slug));
  }

  // Build selected chips from allEntries so we always have catalog metadata
  const selectedEntries = allEntries.filter((e) => e.selected);

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {selectedEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedEntries.map((entry) => (
            <span
              key={entry.slug}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                entry.unknown
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
                  : "border-border bg-muted text-foreground",
              )}
            >
              {entry.logo && !entry.unknown ? (
                // eslint-disable-next-line @next/next/no-img-element -- Remote Composio logos not compatible with next/image domain config
                <img
                  src={entry.logo}
                  alt=""
                  width={12}
                  height={12}
                  referrerPolicy="no-referrer"
                  className="h-3 w-3 rounded-sm object-contain shrink-0"
                />
              ) : null}
              {entry.name}
              {entry.unknown && (
                <span className="opacity-60 text-[10px]">(unknown)</span>
              )}
              <button
                type="button"
                onClick={() => handleRemoveChip(entry.slug)}
                disabled={disabled}
                aria-label={`Remove ${entry.name}`}
                className="ml-0.5 rounded-full hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search tools — Gmail, Slack, Notion…"
          disabled={disabled}
          className={cn(
            "h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          aria-label="Search tools"
        />
      </div>

      {/* Result list */}
      <div
        className={cn(
          "max-h-48 overflow-y-auto rounded-md border border-border/60 bg-card",
          toolkitsLoading && "p-2",
        )}
      >
        {toolkitsLoading ? (
          <div className="space-y-1 p-1">
            {Array.from({ length: 5 }, (_, i) => (
              <ToolkitRowSkeleton key={i} />
            ))}
          </div>
        ) : visibleRows.length === 0 && isSearching ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No tools matching &ldquo;{query}&rdquo;
          </p>
        ) : visibleRows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No tools available
          </p>
        ) : (
          <div className="p-1">
            {visibleRows.map((entry) => {
              const isConnected = connectedSlugs.has(entry.slug);
              return (
                <button
                  key={entry.slug}
                  type="button"
                  onClick={() => handleToggle(entry.slug)}
                  disabled={disabled}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    entry.selected && "bg-accent/50",
                  )}
                >
                  {/* Logo or initials */}
                  {entry.logo && !entry.unknown ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Remote Composio logos not compatible with next/image domain config
                    <img
                      src={entry.logo}
                      alt=""
                      width={16}
                      height={16}
                      referrerPolicy="no-referrer"
                      className="h-4 w-4 rounded-sm object-contain shrink-0"
                    />
                  ) : (
                    <div className="h-4 w-4 rounded-sm bg-muted shrink-0 flex items-center justify-center">
                      <span className="text-[9px] font-medium text-muted-foreground uppercase">
                        {prettifyToolkitSlug(entry.slug).slice(0, 2)}
                      </span>
                    </div>
                  )}

                  {/* Name */}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>

                  {/* Unknown hint */}
                  {entry.unknown ? (
                    <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">
                      unknown
                    </span>
                  ) : null}

                  {/* Connected badge */}
                  {isConnected && !entry.unknown ? (
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  ) : null}

                  {/* Checkbox visual */}
                  <span
                    className={cn(
                      "ml-auto h-4 w-4 shrink-0 rounded border",
                      entry.selected
                        ? "border-primary bg-primary text-primary-foreground flex items-center justify-center"
                        : "border-border",
                    )}
                    aria-hidden="true"
                  >
                    {entry.selected && (
                      <svg
                        viewBox="0 0 8 8"
                        className="h-2.5 w-2.5 fill-current"
                      >
                        <path
                          d="M1 4l2 2 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                        />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Result count */}
      {!toolkitsLoading && allToolkits.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {isSearching
            ? `${resultCount} result${resultCount === 1 ? "" : "s"} for "${query}"`
            : `Showing ${resultCount} of ${allToolkits.length} tools${hiddenCount > 0 ? " — search to find more" : ""}`}
          {selectedSlugs.length > 0
            ? ` · ${selectedSlugs.length} selected`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
