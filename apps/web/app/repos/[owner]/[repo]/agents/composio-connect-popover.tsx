"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { filterToolkits } from "@/app/settings/composio-catalog-filter";
import {
  useComposioCatalog,
  useComposioConnect,
} from "@/app/settings/composio-shared-hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

/** Max not-yet-connected toolkits shown before a search query narrows them. */
const DEFAULT_LIMIT = 12;

interface ConnectCardProps {
  slug: string;
  name: string;
  logo: string | null;
  managedAuth: boolean;
  noAuth: boolean;
  onConnect: (slug: string) => Promise<void>;
  isConnecting: boolean;
}

function ConnectCard({
  slug,
  name,
  logo,
  managedAuth,
  noAuth,
  onConnect,
  isConnecting,
}: ConnectCardProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Remote Composio logos not compatible with next/image domain config
          <img
            src={logo}
            alt=""
            width={24}
            height={24}
            referrerPolicy="no-referrer"
            className="h-6 w-6 shrink-0 rounded-md object-contain"
          />
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted">
            <span className="text-[10px] font-medium uppercase text-muted-foreground">
              {name.slice(0, 2)}
            </span>
          </div>
        )}
        <span className="truncate text-xs font-medium">{name}</span>
      </div>
      {noAuth ? (
        <p className="text-[11px] text-muted-foreground">No sign-in needed</p>
      ) : managedAuth ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onConnect(slug)}
          disabled={isConnecting}
          className="h-6 text-[11px]"
        >
          Connect
        </Button>
      ) : (
        <p className="text-[11px] text-muted-foreground">Set up in Composio</p>
      )}
    </div>
  );
}

export interface ComposioConnectCardsProps {
  disabled?: boolean;
}

/**
 * Compact "connect a new tool" content: search + a card grid of toolkits the
 * account hasn't connected yet, one Connect button per card. Deliberately
 * has NO chip/selection state — that's ComposioToolkitPicker's job. This is
 * exported separately from ComposioConnectPopover so it can be exercised
 * with renderToStaticMarkup without needing to open the popover (Radix
 * Popover only mounts its content once opened, which static rendering
 * can't simulate).
 *
 * Because this shares useComposioCatalog()'s SWR cache keys with
 * ComposioToolkitPicker, a successful connect here revalidates the
 * connected-accounts cache and the newly connected toolkit becomes
 * immediately selectable in the picker with no extra plumbing.
 */
export function ComposioConnectCards({
  disabled = false,
}: ComposioConnectCardsProps) {
  const [query, setQuery] = useState("");
  const { toolkits, toolkitsLoading, connectedSlugs } = useComposioCatalog();
  const { connectingSlug, connect } = useComposioConnect();

  const notConnected = toolkits.filter((t) => !connectedSlugs.has(t.slug));
  const filtered = query.trim()
    ? filterToolkits(notConnected, query)
    : notConnected;
  const visible = filtered.slice(0, DEFAULT_LIMIT);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Connecting a tool here links it to your whole account — not just this
        agent.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search tools to connect…"
          disabled={disabled}
          className="pl-8"
          aria-label="Search tools to connect"
        />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {toolkitsLoading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            {query.trim()
              ? `No tools matching "${query}"`
              : "All available tools are already connected."}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {visible.map((t) => (
              <ConnectCard
                key={t.slug}
                slug={t.slug}
                name={t.name}
                logo={t.logo}
                managedAuth={t.managedAuth}
                noAuth={t.noAuth}
                onConnect={connect}
                isConnecting={connectingSlug === t.slug}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface ComposioConnectPopoverProps {
  disabled?: boolean;
}

/**
 * "Connect a new tool" trigger + popover for the agent builder's Other-tools
 * section. Deliberately does NOT render the full ComposioToolCatalog (which
 * has no selection concept and whose connect action reads as account-wide in
 * a way that's confusing inside a single agent's builder panel) — instead
 * this compact popover makes the account-wide scope explicit in its own
 * copy (see ComposioConnectCards).
 */
export function ComposioConnectPopover({
  disabled = false,
}: ComposioConnectPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-7 text-xs"
        >
          Connect a new tool
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <ComposioConnectCards disabled={disabled} />
      </PopoverContent>
    </Popover>
  );
}
