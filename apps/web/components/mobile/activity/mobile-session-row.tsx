"use client";

import { GitBranch, GitPullRequest, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileStatusPill } from "@/components/mobile/shell/mobile-status-pill";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type {
  MobileStatusDescriptor,
  SessionWithUnread,
} from "@/components/mobile/lib/types";

interface MobileSessionRowProps {
  session: SessionWithUnread;
  descriptor: MobileStatusDescriptor;
  onOpen: (session: SessionWithUnread) => void;
}

/**
 * A single tappable row in the Activity list.
 *
 * Layout (left to right):
 *   [glyph] | [title + repo/branch meta] | [status pill + time]
 *
 * - Glyph: PR icon for sessions with a PR, branch icon for branch sessions,
 *   chat bubble for plain-chat sessions.
 * - Diff stat (±N lines) shown when linesAdded or linesRemoved are present.
 * - Relative time derived from lastActivityAt falling back to createdAt.
 * - Unread dot when session.hasUnread is true.
 */
export function MobileSessionRow({
  session,
  descriptor,
  onOpen,
}: MobileSessionRowProps) {
  const {
    title,
    repoOwner,
    repoName,
    branch,
    prNumber,
    linesAdded,
    linesRemoved,
    hasUnread,
    lastActivityAt,
    createdAt,
  } = session;

  const timeValue = lastActivityAt ?? createdAt;
  const relativeTime = formatRelativeTime(timeValue);

  const hasPr = Boolean(prNumber);
  const hasBranch = Boolean(branch);
  const isPlainChat = !repoName?.trim();

  const repoLabel =
    repoOwner && repoName ? `${repoOwner}/${repoName}` : (repoName ?? null);

  const hasDiff = linesAdded || linesRemoved;

  return (
    <button
      type="button"
      onClick={() => onOpen(session)}
      aria-label={`Open session: ${title ?? "Untitled"}`}
      className={cn(
        "flex w-full min-h-[64px] items-start gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      {/* Glyph column */}
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
          hasPr
            ? "border-warning/30 bg-warning/10 text-warning-foreground"
            : hasBranch
              ? "border-border bg-muted text-muted-foreground"
              : "border-border bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {hasPr ? (
          <GitPullRequest className="h-4 w-4" />
        ) : hasBranch ? (
          <GitBranch className="h-4 w-4" />
        ) : (
          <MessageSquare className="h-4 w-4" />
        )}
      </span>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        {/* Title row */}
        <div className="flex items-center gap-1.5">
          {hasUnread ? (
            <span
              className="mt-px h-2 w-2 shrink-0 rounded-full bg-primary"
              aria-label="Unread"
            />
          ) : null}
          <span
            className={cn(
              "truncate text-sm leading-snug",
              hasUnread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground",
            )}
          >
            {title ?? "Untitled"}
          </span>
        </div>

        {/* Meta row: repo/branch and diff stat */}
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {isPlainChat ? (
            <span className="truncate text-xs text-muted-foreground">Chat</span>
          ) : (
            <>
              {repoLabel ? (
                <span className="truncate text-xs text-muted-foreground">
                  {repoLabel}
                </span>
              ) : null}
              {branch ? (
                <span className="truncate text-xs font-mono text-muted-foreground/80">
                  {branch}
                </span>
              ) : null}
            </>
          )}

          {hasDiff ? (
            <span className="shrink-0 text-xs text-muted-foreground font-mono">
              {linesAdded ? (
                <span className="text-success-foreground">+{linesAdded}</span>
              ) : null}
              {linesAdded && linesRemoved ? (
                <span className="text-muted-foreground/60">/</span>
              ) : null}
              {linesRemoved ? (
                <span className="text-destructive">-{linesRemoved}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {/* Trailing: pill + time */}
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        <MobileStatusPill descriptor={descriptor} size="sm" />
        <span className="text-[10px] text-muted-foreground leading-none">
          {relativeTime}
        </span>
      </div>
    </button>
  );
}
