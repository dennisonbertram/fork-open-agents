"use client";

import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/swr";

type ApiToken = {
  id: string;
  name: string;
  start: string;
  last4: string;
  scopes: string[];
  repositoryPolicy: { allowedRepositories: string[] | null };
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type ApiTokensResponse = {
  tokens: ApiToken[];
};

export function ApiKeysSection() {
  const { data, isLoading, mutate } = useSWR<ApiTokensResponse>(
    "/api/settings/api-tokens",
    fetcher,
  );
  const [name, setName] = useState("");
  const [repos, setRepos] = useState("");
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function createToken() {
    setIsCreating(true);
    try {
      const allowedRepositories = repos
        .split(",")
        .map((repo) => repo.trim())
        .filter(Boolean);
      const response = await fetch("/api/settings/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Agent API key",
          scopes: ["agent_runs:create", "agent_runs:read", "agent_runs:cancel"],
          allowedRepositories:
            allowedRepositories.length > 0 ? allowedRepositories : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to create API key");
      }
      setRawToken(body.rawToken);
      setName("");
      setRepos("");
      await mutate();
      toast.success("API key created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API key failed");
    } finally {
      setIsCreating(false);
    }
  }

  async function revokeToken(tokenId: string) {
    setRevokingId(tokenId);
    try {
      const response = await fetch(
        `/api/settings/api-tokens?tokenId=${encodeURIComponent(tokenId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Failed to revoke API key");
      }
      await mutate();
      toast.success("API key revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Revoke failed");
    } finally {
      setRevokingId(null);
    }
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  return (
    <div className="space-y-4">
      {rawToken && (
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
          <div className="mb-2 text-sm font-medium">Copy this key now</div>
          <div className="flex gap-2">
            <Input readOnly value={rawToken} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={async () => {
                await navigator.clipboard.writeText(rawToken);
                toast.success("Copied");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 rounded-lg border border-border/70 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="grid gap-1.5">
          <label htmlFor="api-key-name" className="text-sm font-medium">
            Name
          </label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Local agent"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="api-key-repos" className="text-sm font-medium">
            Repositories
          </label>
          <Input
            id="api-key-repos"
            value={repos}
            onChange={(event) => setRepos(event.target.value)}
            placeholder="owner/repo, optional"
          />
        </div>
        <Button type="button" onClick={createToken} disabled={isCreating}>
          {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Plus />}
          Create
        </Button>
      </div>

      <div className="rounded-lg border border-border/70">
        {(data?.tokens ?? []).length === 0 ? (
          <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <KeyRound className="size-4" />
            No API keys yet.
          </div>
        ) : (
          data?.tokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center gap-3 border-b border-border/60 p-4 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{token.name}</div>
                <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {token.start}...{token.last4}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {token.revokedAt
                    ? "Revoked"
                    : token.lastUsedAt
                      ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}`
                      : "Never used"}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={Boolean(token.revokedAt) || revokingId === token.id}
                onClick={() => revokeToken(token.id)}
              >
                {revokingId === token.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
