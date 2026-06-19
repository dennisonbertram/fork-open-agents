"use client";

import {
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ReadinessVerdict } from "@/components/ui/readiness-verdict";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { SecretsManagerReadinessVerdict } from "@/lib/github/secrets-manager/readiness";
import { AddSecretDialog } from "./add-secret-dialog";

type RepoSecretSummary = {
  name: string;
  createdAt: string;
  updatedAt: string;
};

type SecretsResponse =
  | {
      ok: true;
      readiness: SecretsManagerReadinessVerdict;
      secrets: RepoSecretSummary[];
    }
  | { ok: false; errorKind: string };

type RepositorySecretsClientProps = {
  owner: string;
  repo: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw Object.assign(new Error("Request failed"), {
      status: response.status,
      body,
    });
  }
  return body;
}

function mutationErrorCopy(errorKind: string | undefined) {
  if (errorKind === "github_rate_limited") {
    return "GitHub is rate-limiting requests - try again in a moment.";
  }
  if (errorKind === "app_no_secrets_permission") {
    return "Re-authorize the GitHub App to manage Secrets.";
  }
  return "Couldn't delete the secret - try again.";
}

function absoluteDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function SecretsTableSkeleton() {
  return (
    <Table aria-label="Repository secrets loading">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 3 }, (_, index) => (
          <TableRow key={index}>
            <TableCell>
              <Skeleton className="h-4 w-36" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-8 w-8 rounded-md" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function UpdatedCell({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-sm text-muted-foreground">
          {formatRelativeTime(value)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{absoluteDate(value)}</TooltipContent>
    </Tooltip>
  );
}

export function RepositorySecretsClient({
  owner,
  repo,
}: RepositorySecretsClientProps) {
  const [dialog, setDialog] = React.useState<
    { mode: "add"; name?: undefined } | { mode: "edit"; name: string } | null
  >(null);
  const [deleteName, setDeleteName] = React.useState<string | null>(null);
  const [deletePending, setDeletePending] = React.useState(false);
  const baseUrl = `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/secrets`;
  const secrets = useSWR<SecretsResponse>(baseUrl, fetchJson, {
    revalidateOnFocus: false,
  });
  const readiness: SecretsManagerReadinessVerdict = secrets.data?.ok
    ? secrets.data.readiness
    : {
        status: secrets.error ? "error" : "unavailable",
        headline: secrets.error
          ? "Could not verify Secrets access"
          : "Checking Secrets access",
        subtext: secrets.error
          ? "GitHub App permissions could not be checked right now."
          : "GitHub App permissions are being verified.",
        canRead: false,
        canWrite: false,
      };
  const rows = secrets.data?.ok ? secrets.data.secrets : [];

  async function deleteSecret() {
    if (!deleteName) {
      return;
    }
    setDeletePending(true);
    const response = await fetch(
      `${baseUrl}/${encodeURIComponent(deleteName)}`,
      {
        method: "DELETE",
      },
    );
    setDeletePending(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        errorKind?: string;
      };
      toast.error(mutationErrorCopy(body.errorKind));
      return;
    }

    toast.success(`Secret ${deleteName} deleted`);
    setDeleteName(null);
    void secrets.mutate();
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <ReadinessVerdict
          action={
            readiness.actionHref ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={readiness.actionHref}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-4 w-4" />
                  {readiness.actionLabel ?? "Open GitHub settings"}
                </Link>
              </Button>
            ) : null
          }
          headline={readiness.headline}
          onRefresh={() => void secrets.mutate()}
          refreshing={secrets.isValidating}
          status={readiness.status}
          subtext={readiness.subtext}
        />

        {secrets.isLoading ? (
          <SecretsTableSkeleton />
        ) : secrets.error || (secrets.data && !secrets.data.ok) ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.03] p-3">
            <p className="text-sm text-destructive">
              Re-authorize the GitHub App to manage Secrets.
            </p>
            <Button
              aria-label="Retry loading secrets"
              onClick={() => void secrets.mutate()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button
                disabled={!readiness.canWrite}
                onClick={() => setDialog({ mode: "add" })}
                type="button"
              >
                <Plus className="h-4 w-4" />
                Add secret
              </Button>
            </div>
            {rows.length === 0 ? (
              <Empty className="border border-dashed border-border">
                <EmptyHeader>
                  <EmptyTitle>No secrets in this repo.</EmptyTitle>
                  <EmptyDescription>
                    Add one to make it available to workflows.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table aria-label="Repository secrets">
                <TableCaption>
                  GitHub never returns secret values; this table only contains
                  names and metadata.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((secret) => (
                    <TableRow key={secret.name}>
                      <TableCell>
                        <span className="font-mono text-sm">{secret.name}</span>
                      </TableCell>
                      <TableCell>
                        <UpdatedCell value={secret.updatedAt} />
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label={`Actions for ${secret.name}`}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!readiness.canWrite}
                              onClick={() =>
                                setDialog({
                                  mode: "edit",
                                  name: secret.name,
                                })
                              }
                            >
                              Edit value
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={!readiness.canWrite}
                              onClick={() => setDeleteName(secret.name)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        <AddSecretDialog
          mode={dialog?.mode ?? "add"}
          onOpenChange={(open) => !open && setDialog(null)}
          onSaved={() => void secrets.mutate()}
          open={Boolean(dialog)}
          owner={owner}
          repo={repo}
          secretName={dialog?.mode === "edit" ? dialog.name : undefined}
        />

        <AlertDialog
          open={Boolean(deleteName)}
          onOpenChange={(open) => !open && setDeleteName(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This can break workflows that use it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletePending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={deletePending}
                onClick={(event) => {
                  event.preventDefault();
                  void deleteSecret();
                }}
              >
                Delete secret
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
