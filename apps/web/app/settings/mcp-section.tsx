"use client";

import { useRef, useState } from "react";
import { Loader2, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { readApiError } from "@/lib/api/read-api-error";
import type { McpServerSummary } from "@/lib/mcp/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSection } from "@/components/ui/settings-section";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type ApiResponse = { servers: McpServerSummary[] };

// ── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchServers(url: string): Promise<ApiResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load MCP servers");
  return res.json() as Promise<ApiResponse>;
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export function McpSectionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}

// ── Header key/value pair editor ─────────────────────────────────────────────

interface HeaderRowProps {
  index: number;
  headerKey: string;
  headerValue: string;
  onKeyChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}

function HeaderRow({
  index,
  headerKey,
  headerValue,
  onKeyChange,
  onValueChange,
  onRemove,
  disabled,
}: HeaderRowProps) {
  return (
    <div className="flex gap-2 items-center">
      <Input
        placeholder="Header name"
        value={headerKey}
        onChange={(e) => onKeyChange(e.currentTarget.value)}
        disabled={disabled}
        className="h-7 text-xs font-mono flex-1"
        aria-label={`Header ${index + 1} name`}
      />
      <Input
        placeholder="Value"
        type="password"
        value={headerValue}
        onChange={(e) => onValueChange(e.currentTarget.value)}
        disabled={disabled}
        className="h-7 text-xs font-mono flex-1"
        aria-label={`Header ${index + 1} value`}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove header ${index + 1}`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Inline server editor ──────────────────────────────────────────────────────

interface ServerEditorProps {
  server?: McpServerSummary;
  isNew?: boolean;
  onSaved: () => void;
  onCanceled: () => void;
}

function ServerEditor({
  server,
  isNew = false,
  onSaved,
  onCanceled,
}: ServerEditorProps) {
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [transport, setTransport] = useState<"http" | "sse">(
    server?.transport ?? "http",
  );
  // Header rows as array of [key, value] pairs.
  // For existing servers, rows are pre-filled with [key, ""] — values are write-only.
  const [headerRows, setHeaderRows] = useState<[string, string][]>(
    () => server?.headerKeys.map((k) => [k, ""] as [string, string]) ?? [],
  );
  // Track whether the user actually changed the header rows so we only PATCH
  // headers when intentionally modified. An unmodified edit must not send
  // headers: [key, ""] pairs — that would overwrite stored secrets with "".
  const [headersModified, setHeadersModified] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const canSave = name.trim().length > 0 && url.trim().length > 0 && !isSaving;

  function addHeaderRow() {
    setHeaderRows((rows) => [...rows, ["", ""]]);
    setHeadersModified(true);
  }

  function updateHeaderKey(index: number, value: string) {
    setHeaderRows((rows) =>
      rows.map((row, i) => (i === index ? [value, row[1]] : row)),
    );
    setHeadersModified(true);
  }

  function updateHeaderValue(index: number, value: string) {
    setHeaderRows((rows) =>
      rows.map((row, i) => (i === index ? [row[0], value] : row)),
    );
    setHeadersModified(true);
  }

  function removeHeaderRow(index: number) {
    setHeaderRows((rows) => rows.filter((_, i) => i !== index));
    setHeadersModified(true);
  }

  /** Build headers record from non-empty key rows. */
  function buildHeaders(): Record<string, string> | undefined {
    const result: Record<string, string> = {};
    for (const [key, value] of headerRows) {
      const trimKey = key.trim();
      if (trimKey) result[trimKey] = value;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  async function handleSave() {
    setIsSaving(true);
    setFieldErrors({});
    setGeneralError(null);

    const body: Record<string, unknown> = {
      name: name.trim(),
      url: url.trim(),
      transport,
    };

    const headers = buildHeaders();
    if (isNew) {
      // For new servers: only include headers if any were provided
      if (headers) {
        body.headers = headers;
      }
    } else if (headersModified) {
      // For edits: only send headers when the user actually changed them.
      // Sending unmodified pre-filled rows ([key, ""]) would overwrite stored
      // secrets with empty strings. null means "clear all headers".
      body.headers = headers ?? null;
    }
    // If headersModified is false (edit opened but headers not touched), omit
    // the headers field entirely — the store will leave existing values intact.

    const endpoint = isNew
      ? "/api/settings/mcp-servers"
      : `/api/settings/mcp-servers/${server!.id}`;
    const method = isNew ? "POST" : "PATCH";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          details?: { fieldErrors?: Record<string, string[]> };
        } | null;

        if (res.status === 400 && data?.details?.fieldErrors) {
          setFieldErrors(data.details.fieldErrors);
          return;
        }

        throw new Error(readApiError(data, "Failed to save server").message);
      }

      toast.success(isNew ? "Server registered" : "Server updated");
      onSaved();
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : "Failed to save server",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="px-3 pb-3 pt-2 grid gap-3">
      {/* Name */}
      <div className="grid gap-1">
        <Label htmlFor="mcp-name" className="text-xs">
          Name
        </Label>
        <Input
          id="mcp-name"
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. internal-tools"
          disabled={isSaving}
          className="h-7 text-sm max-w-xs"
          aria-label="Server name"
        />
        {fieldErrors.name ? (
          <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
        ) : null}
      </div>

      {/* URL */}
      <div className="grid gap-1">
        <Label htmlFor="mcp-url" className="text-xs">
          URL
        </Label>
        <Input
          id="mcp-url"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          placeholder="https://mcp.example.com/mcp"
          disabled={isSaving}
          className="h-7 text-sm"
          aria-label="Server URL"
        />
        {fieldErrors.url ? (
          <p className="text-xs text-destructive">{fieldErrors.url[0]}</p>
        ) : null}
      </div>

      {/* Transport */}
      <div className="grid gap-1">
        <Label htmlFor="mcp-transport" className="text-xs">
          Transport
        </Label>
        <Select
          value={transport}
          onValueChange={(v) => setTransport(v as "http" | "sse")}
          disabled={isSaving}
        >
          <SelectTrigger id="mcp-transport" className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="http">HTTP (Streamable)</SelectItem>
            <SelectItem value="sse">SSE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Auth headers */}
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Auth headers</Label>
          <button
            type="button"
            onClick={addHeaderRow}
            disabled={isSaving || headerRows.length >= 10}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Add header
          </button>
        </div>

        {headerRows.length > 0 ? (
          <div className="grid gap-1.5">
            {headerRows.map(([key, value], index) => (
              <HeaderRow
                key={index}
                index={index}
                headerKey={key}
                headerValue={value}
                onKeyChange={(v) => updateHeaderKey(index, v)}
                onValueChange={(v) => updateHeaderValue(index, v)}
                onRemove={() => removeHeaderRow(index)}
                disabled={isSaving}
              />
            ))}
          </div>
        ) : null}

        {server?.hasHeaders && !isNew ? (
          <p className="text-xs text-muted-foreground">
            Header values are write-only; re-enter to replace.
          </p>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/60">
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!canSave}
          className="h-7 text-xs"
        >
          {isSaving ? <Loader2 className="animate-spin" /> : null}
          {isNew ? "Register" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCanceled}
          disabled={isSaving}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
      </div>

      {generalError ? (
        <p className="text-sm text-destructive">{generalError}</p>
      ) : null}
    </div>
  );
}

// ── Delete confirm button ─────────────────────────────────────────────────────

interface DeleteServerButtonProps {
  server: McpServerSummary;
  onDeleted: () => void;
}

function DeleteServerButton({ server, onDeleted }: DeleteServerButtonProps) {
  const [confirmPending, setConfirmPending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleConfirmedDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/settings/mcp-servers/${server.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(readApiError(body, "Failed to delete server").message);
      }
      toast.success("Server removed");
      onDeleted();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete server",
      );
    } finally {
      setIsDeleting(false);
      setConfirmPending(false);
    }
  }

  if (confirmPending) {
    return (
      <span className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleConfirmedDelete}
          disabled={isDeleting}
          className="text-xs text-destructive font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeleting ? (
            <Loader2 className="h-3 w-3 animate-spin inline" />
          ) : (
            "Confirm"
          )}
        </button>
        <button
          type="button"
          onClick={() => setConfirmPending(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Delete ${server.name}`}
      onClick={(e) => {
        e.stopPropagation();
        setConfirmPending(true);
      }}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

// ── Server row ────────────────────────────────────────────────────────────────

interface ServerRowProps {
  server: McpServerSummary;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

function ServerRow({
  server,
  isExpanded,
  onExpand,
  onCollapse,
  onSaved,
  onDeleted,
}: ServerRowProps) {
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false);

  async function handleToggleEnabled(enabled: boolean) {
    setIsTogglingEnabled(true);
    try {
      const res = await fetch(`/api/settings/mcp-servers/${server.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update server");
      onSaved();
    } catch {
      toast.error("Failed to update server");
    } finally {
      setIsTogglingEnabled(false);
    }
  }

  // Show just the host for brevity
  let urlHost = server.url;
  try {
    urlHost = new URL(server.url).host;
  } catch {
    // fallback to full url
  }

  if (isExpanded) {
    return (
      <div>
        <div className="px-3 py-2 bg-muted/20 border-b border-border/60 flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground">
            {server.name}
          </span>
        </div>
        <ServerEditor
          server={server}
          onSaved={() => {
            onSaved();
            onCollapse();
          }}
          onCanceled={onCollapse}
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center hover:bg-muted/30">
      {/* Main row — expand button */}
      <button
        type="button"
        className="flex flex-1 min-w-0 items-center gap-3 px-3 py-2.5 text-left"
        onClick={onExpand}
        aria-expanded={false}
        aria-label={`Edit server ${server.name}`}
      >
        <Server className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Name */}
        <span className="text-sm font-medium shrink-0">{server.name}</span>

        {/* Host */}
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
          {urlHost}
        </span>

        {/* Badges */}
        <span className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {server.transport.toUpperCase()}
          </Badge>
          {server.hasHeaders ? (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 text-muted-foreground"
            >
              {server.headerKeys.length === 1
                ? "1 header"
                : `${server.headerKeys.length} headers`}
            </Badge>
          ) : null}
        </span>
      </button>

      {/* Action area — visible on hover */}
      <span className="flex items-center gap-2 pr-3 shrink-0">
        {/* Enabled switch */}
        <Switch
          checked={server.enabled}
          disabled={isTogglingEnabled}
          onCheckedChange={handleToggleEnabled}
          aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
          className="scale-75"
        />

        {/* Edit / Delete — appear on hover */}
        <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            aria-label={`Edit ${server.name}`}
            onClick={onExpand}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <DeleteServerButton server={server} onDeleted={onDeleted} />
        </span>
      </span>
    </div>
  );
}

// ── Main McpSection ───────────────────────────────────────────────────────────

export function McpSection() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/settings/mcp-servers",
    fetchServers,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const servers = data?.servers ?? [];
  const isAddingNew = expandedId === "__new__";

  if (isLoading) {
    return <McpSectionSkeleton />;
  }

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
        Failed to load MCP servers.
      </p>
    );
  }

  return (
    <SettingsSection
      title="Registered servers"
      description="Each server can supply tools to your agents in chats."
    >
      <div className="rounded-lg border border-border/70 overflow-hidden">
        {servers.length > 0 || isAddingNew ? (
          <div className="divide-y divide-border/60">
            {servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                isExpanded={expandedId === server.id}
                onExpand={() =>
                  setExpandedId((prev) =>
                    prev === server.id ? null : server.id,
                  )
                }
                onCollapse={() => setExpandedId(null)}
                onSaved={() => {
                  void mutate();
                  setExpandedId(null);
                }}
                onDeleted={() => {
                  void mutate();
                  setExpandedId(null);
                }}
              />
            ))}

            {isAddingNew ? (
              <div>
                <div className="px-3 py-2 bg-muted/20 border-b border-border/60">
                  <span className="text-xs font-medium text-muted-foreground">
                    New server
                  </span>
                </div>
                <ServerEditor
                  isNew
                  onSaved={() => {
                    void mutate();
                    setExpandedId(null);
                  }}
                  onCanceled={() => setExpandedId(null)}
                />
              </div>
            ) : null}
          </div>
        ) : (
          /* Empty state */
          <div className="px-4 py-6 text-center space-y-1">
            <p className="text-sm text-muted-foreground">
              Register an MCP server to bring its tools to your agents.
            </p>
            <p className="text-xs text-muted-foreground">
              Tools become available in chats in an upcoming update.{" "}
              <a
                href="https://github.com/dennisonbertram/fork-open-agents/issues/371"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Track progress
              </a>
            </p>
          </div>
        )}

        {/* Add server button */}
        {!isAddingNew ? (
          <div
            className={cn(
              "border-t border-border/60",
              servers.length === 0 && "border-t-0",
            )}
          >
            <button
              type="button"
              onClick={() => setExpandedId("__new__")}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add server
            </button>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
