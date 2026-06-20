"use client";

import {
  Archive,
  ArrowDownUp,
  Bug,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  Lightbulb,
  MoreHorizontal,
  Network,
  Palette,
  Workflow,
} from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import type {
  LearningConfidence,
  LearningStatus,
  LearningType,
} from "@/lib/learnings/types";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  confidenceLabels,
  learningTypeLabels,
  statusLabels,
  type LearningFeedItem,
} from "./types";

const typeIcons: Record<LearningType, typeof Bug> = {
  bug: Bug,
  convention: Lightbulb,
  architecture: Network,
  anti_pattern: FileCode2,
  design: Palette,
  workflow: Workflow,
};

const typeBadgeClass: Record<LearningType, string> = {
  bug: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  convention:
    "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  architecture:
    "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  anti_pattern:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  design: "border-border bg-muted/50 text-muted-foreground",
  workflow: "border-border bg-muted/50 text-muted-foreground",
};

const confidenceBadgeClass: Record<LearningConfidence, string> = {
  proven:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  high: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "border-border bg-muted/50 text-muted-foreground",
  speculative: "border-border bg-muted/50 text-muted-foreground",
};

const typeOptions: Array<"all" | LearningType> = [
  "all",
  "bug",
  "convention",
  "architecture",
  "anti_pattern",
  "design",
  "workflow",
];

const confidenceOptions: Array<"all" | LearningConfidence> = [
  "all",
  "proven",
  "high",
  "medium",
  "low",
  "speculative",
];

const statusOptions: Array<LearningStatus> = [
  "active",
  "consolidation_review",
  "archived",
  "superseded",
];

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isSafeExternalUrl(value: string | null) {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function FilterPill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      className="h-7 px-2 text-xs"
    >
      {children}
    </Button>
  );
}

export function LearningFeedTable({
  learnings,
  onOpenLearning,
  onArchiveLearning,
  onOverrideConfidence,
  archiving,
}: {
  learnings: LearningFeedItem[];
  onOpenLearning: (learning: LearningFeedItem) => void;
  onArchiveLearning: (learningId: string) => void;
  onOverrideConfidence: (
    learningId: string,
    confidence: LearningConfidence,
  ) => void;
  archiving?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LearningType>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<
    "all" | LearningConfidence
  >("all");
  const [statusFilter, setStatusFilter] = useState<LearningStatus>("active");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [archiveTarget, setArchiveTarget] = useState<LearningFeedItem | null>(
    null,
  );

  const filteredLearnings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return learnings
      .filter((learning) => learning.status === statusFilter)
      .filter((learning) =>
        typeFilter === "all" ? true : learning.type === typeFilter,
      )
      .filter((learning) =>
        confidenceFilter === "all"
          ? true
          : learning.confidence === confidenceFilter,
      )
      .filter((learning) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [
          learning.title,
          learning.description,
          learning.repoOwner,
          learning.repoName,
          ...learning.affectedPaths,
          ...learning.tags,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .toSorted((a, b) => {
        const left = new Date(a.updatedAt).getTime();
        const right = new Date(b.updatedAt).getTime();
        return sortDirection === "desc" ? right - left : left - right;
      });
  }, [
    confidenceFilter,
    learnings,
    query,
    sortDirection,
    statusFilter,
    typeFilter,
  ]);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Input
          aria-label="Filter learnings"
          placeholder="Filter learnings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {statusOptions.map((status) => (
            <FilterPill
              key={status}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            >
              {statusLabels[status]}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {typeOptions.map((type) => (
            <FilterPill
              key={type}
              active={typeFilter === type}
              onClick={() => setTypeFilter(type)}
            >
              {type === "all" ? "All types" : learningTypeLabels[type]}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {confidenceOptions.map((confidence) => (
            <FilterPill
              key={confidence}
              active={confidenceFilter === confidence}
              onClick={() => setConfidenceFilter(confidence)}
            >
              {confidence === "all"
                ? "All confidence"
                : confidenceLabels[confidence]}
            </FilterPill>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Affected paths</TableHead>
            <TableHead>Evidence</TableHead>
            <TableHead
              aria-sort={sortDirection === "desc" ? "descending" : "ascending"}
            >
              <button
                type="button"
                onClick={() =>
                  setSortDirection((value) =>
                    value === "desc" ? "asc" : "desc",
                  )
                }
                className="inline-flex items-center gap-1"
              >
                Updated <ArrowDownUp className="size-3.5" />
              </button>
            </TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredLearnings.length > 0 ? (
            filteredLearnings.map((learning) => {
              const TypeIcon = typeIcons[learning.type];
              const evidenceHref =
                learning.sourcePrUrl ??
                learning.evidence.find((evidence) =>
                  isSafeExternalUrl(evidence.ref),
                )?.ref ??
                null;
              return (
                <TableRow key={learning.id}>
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    <button
                      type="button"
                      onClick={() => onOpenLearning(learning)}
                      className="flex min-w-0 items-start gap-2 text-left hover:text-foreground"
                    >
                      <TypeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {learning.title}
                        </span>
                        <span className="line-clamp-2 text-pretty text-xs text-muted-foreground">
                          {learning.description}
                        </span>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(typeBadgeClass[learning.type])}
                    >
                      {learningTypeLabels[learning.type]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(confidenceBadgeClass[learning.confidence])}
                    >
                      {confidenceLabels[learning.confidence]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[12rem]">
                    {learning.affectedPaths.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex max-w-full gap-1 overflow-hidden">
                            {learning.affectedPaths.slice(0, 2).map((path) => (
                              <Badge
                                key={path}
                                variant="outline"
                                className="max-w-[8rem] truncate font-mono text-[10px]"
                              >
                                {path}
                              </Badge>
                            ))}
                            {learning.affectedPaths.length > 2 ? (
                              <Badge variant="outline">
                                +{learning.affectedPaths.length - 2}
                              </Badge>
                            ) : null}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="max-w-xs space-y-1">
                            {learning.affectedPaths.map((path) => (
                              <p key={path} className="font-mono text-xs">
                                {path}
                              </p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Repo
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {learning.evidence.length}
                      </Badge>
                      {isSafeExternalUrl(evidenceHref) ? (
                        <a
                          href={evidenceHref ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open source PR"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatUpdated(learning.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${learning.title}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => onOpenLearning(learning)}
                        >
                          Open details
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            Override confidence
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup
                              value={learning.confidence}
                              onValueChange={(value) =>
                                onOverrideConfidence(
                                  learning.id,
                                  value as LearningConfidence,
                                )
                              }
                            >
                              {confidenceOptions
                                .filter(
                                  (
                                    confidence,
                                  ): confidence is LearningConfidence =>
                                    confidence !== "all",
                                )
                                .map((confidence) => (
                                  <DropdownMenuRadioItem
                                    key={confidence}
                                    value={confidence}
                                  >
                                    {confidenceLabels[confidence]}
                                  </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        {isSafeExternalUrl(evidenceHref) ? (
                          <DropdownMenuItem asChild>
                            <a
                              href={evidenceHref ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <GitPullRequest className="size-4" />
                              Open source PR
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setArchiveTarget(learning)}
                        >
                          <Archive className="size-4" />
                          Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell
                colSpan={7}
                className="h-28 text-center text-sm text-muted-foreground"
              >
                No learnings match the current filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setArchiveTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive learning?</AlertDialogTitle>
            <AlertDialogDescription>
              This keeps the learning for audit history but removes it from the
              active feed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
              disabled={archiving}
              onClick={() => {
                if (archiveTarget) {
                  onArchiveLearning(archiveTarget.id);
                }
                setArchiveTarget(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
