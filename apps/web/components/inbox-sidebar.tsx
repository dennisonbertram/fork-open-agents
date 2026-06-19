"use client";

import {
  Archive,
  Bot,
  ChevronDown,
  CircleDashed,
  FolderGit2,
  LayoutDashboard,
  MessageSquare,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Loader2,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceSettings } from "@/app/sessions/workspace-settings-context";
import { BranchPickerDialog } from "@/components/branch-picker-dialog";
import {
  getCollapsedRailActions,
  getCollapsedRepoRailActions,
} from "@/components/inbox-sidebar-rail-actions";
import { getValidRenameTitle } from "@/components/inbox-sidebar-rename";
import {
  filterAgentsByRepo,
  getRepoSubGroupRailActions,
  RepoSubGroups,
} from "@/components/inbox-sidebar-repo-subgroups";
import {
  type SidebarRepoRef,
  buildRepoGroups,
  getRepoGroupContentId,
} from "@/components/inbox-sidebar-repo-groups";
import { useAllAgents } from "@/hooks/use-repo-agents";
import { useAllLoops } from "@/hooks/use-all-loops";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLeaderboardRank } from "@/hooks/use-leaderboard-rank";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { getUsageLeaderboardDomain } from "@/lib/usage/leaderboard-domain";

type InboxSidebarProps = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  sessionsLoading: boolean;
  activeSessionId: string;
  pendingSessionId: string | null;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onUnarchiveSession: (sessionId: string) => Promise<void>;
  onOpenNewSession: () => void;
  onCreateSandboxFreeChat: () => Promise<void>;
  onCreateSessionForRepo: (repoOwner: string, repoName: string) => void;
  onCreateSessionFromBranch: (
    repoOwner: string,
    repoName: string,
    branch: string,
  ) => void;
  initialUser?: AuthSession["user"];
};

type ArchivedSessionsResponse = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  pagination?: {
    hasMore: boolean;
    nextOffset: number;
  };
  error?: string;
};

const ARCHIVED_SESSIONS_PAGE_SIZE = 50;

const sessionRowPerformanceStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "2.25rem",
};

function formatDomainOrg(domain: string): string {
  const dotIndex = domain.indexOf(".");
  const name = dotIndex > 0 ? domain.slice(0, dotIndex) : domain;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getAvatarFallback(username: string): string {
  const normalized = username.trim();
  if (!normalized) {
    return "?";
  }

  return normalized.slice(0, 2).toUpperCase();
}

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;
  if (added === 0 && removed === 0) return null;

  return (
    <span className="flex items-center gap-0.5 font-mono text-[10px]">
      {added !== null ? (
        <span className="text-green-600 dark:text-green-500">+{added}</span>
      ) : null}
      {removed !== null ? (
        <span className="text-red-600 dark:text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

function getSessionStatusIcon(session: SessionWithUnread) {
  // Actively streaming / waiting for LLM
  if (session.hasStreaming) {
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
    );
  }

  // PR merged → purple merge icon
  if (session.prNumber && session.prStatus === "merged") {
    return <GitMerge className="h-3.5 w-3.5 shrink-0 text-purple-500" />;
  }

  // PR open → yellow-orange PR icon (awaiting review)
  if (session.prNumber && session.prStatus === "open") {
    return <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  }

  // PR closed (not merged)
  if (session.prNumber && session.prStatus === "closed") {
    return <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-red-500" />;
  }

  // Has a branch with code changes → needs human follow-up
  const hasDiff = session.linesAdded || session.linesRemoved;
  if (session.branch && hasDiff) {
    return <GitBranch className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  }

  // Has a branch but no changes yet → new session, still getting started
  if (session.branch) {
    return (
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
    );
  }

  // No repository — plain chat session
  const isChat = !session.repoName?.trim();
  if (isChat) {
    return (
      <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
    );
  }

  // Creating / instantiating sandbox (no branch yet)
  if (session.status === "running") {
    return (
      <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
    );
  }

  // Default: sandbox icon
  return <Monitor className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

function getSessionStatusLabel(session: SessionWithUnread): {
  text: string;
  prNumber: number | null;
} {
  if (session.hasStreaming) return { text: "Working", prNumber: null };
  if (session.prNumber && session.prStatus === "merged")
    return { text: `PR #${session.prNumber}`, prNumber: session.prNumber };
  if (session.prNumber && session.prStatus === "open")
    return { text: `PR #${session.prNumber}`, prNumber: session.prNumber };
  if (session.prNumber && session.prStatus === "closed")
    return { text: `PR #${session.prNumber}`, prNumber: session.prNumber };
  const hasDiff = session.linesAdded || session.linesRemoved;
  if (session.branch && hasDiff)
    return { text: "Needs attention", prNumber: null };
  if (session.branch) return { text: "New session", prNumber: null };
  if (session.status === "running")
    return { text: "Setting up", prNumber: null };
  if (session.status === "completed")
    return { text: "Completed", prNumber: null };
  if (session.status === "failed") return { text: "Failed", prNumber: null };
  if (session.status === "archived")
    return { text: "Archived", prNumber: null };
  return { text: "Idle", prNumber: null };
}

function getSessionBranchUrl(session: SessionWithUnread): string | null {
  // Only link if the branch is known to exist on GitHub (has a PR).
  // Local-only branches that haven't been pushed would 404.
  if (
    !session.branch ||
    !session.repoOwner ||
    !session.repoName ||
    !session.prNumber
  )
    return null;
  return `https://github.com/${session.repoOwner}/${session.repoName}/tree/${session.branch}`;
}

function getSessionPrUrl(session: SessionWithUnread): string | null {
  if (!session.prNumber || !session.repoOwner || !session.repoName) return null;
  return `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
}

function SessionPopoverContent({ session }: { session: SessionWithUnread }) {
  const lastActivityLabel = formatRelativeTime(
    session.lastActivityAt ?? session.createdAt,
  );
  const branchUrl = getSessionBranchUrl(session);
  const prUrl = getSessionPrUrl(session);
  const hasDiff = session.linesAdded !== null || session.linesRemoved !== null;
  const statusLabel = getSessionStatusLabel(session);

  return (
    <div className="space-y-2">
      {/* Title */}
      <p className="text-sm font-medium text-foreground leading-snug">
        {session.title}
      </p>

      {/* Status + branch */}
      <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
        <span className="shrink-0">{getSessionStatusIcon(session)}</span>
        {prUrl && statusLabel.prNumber ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 hover:text-foreground transition-colors"
          >
            {statusLabel.text}
          </a>
        ) : (
          <span className="shrink-0">{statusLabel.text}</span>
        )}
        {session.branch ? (
          <span className="flex min-w-0 items-center gap-1 ml-1">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            {branchUrl ? (
              <a
                href={branchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate font-mono text-[11px] hover:text-foreground transition-colors"
              >
                {session.branch}
              </a>
            ) : (
              <span className="min-w-0 truncate font-mono text-[11px]">
                {session.branch}
              </span>
            )}
          </span>
        ) : null}
      </div>

      {/* Diff stats + time ago */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {hasDiff ? (
          <DiffStats
            added={session.linesAdded}
            removed={session.linesRemoved}
          />
        ) : (
          <span />
        )}
        <span className="shrink-0">{lastActivityLabel}</span>
      </div>
    </div>
  );
}

type SessionRowProps = {
  session: SessionWithUnread;
  isActive: boolean;
  isPending: boolean;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (session: SessionWithUnread) => void;
  onUnarchiveSession: (session: SessionWithUnread) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  isActive,
  isPending,
  onSessionClick,
  onSessionPrefetch,
  onRenameSession,
  onArchiveSession,
  onUnarchiveSession,
}: SessionRowProps) {
  const isMobile = useIsMobile();
  const [isHovered, setIsHovered] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
  const [renamePending, setRenamePending] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(session.title);
    }
  }, [isRenaming, session.title]);

  useEffect(() => {
    if (!isRenaming || !renameInputRef.current) {
      return;
    }

    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [isRenaming]);

  const hasDiff = session.linesAdded !== null || session.linesRemoved !== null;
  const showActionButtons = isHovered;

  const handleMouseEnter = useCallback(() => {
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    setIsHovered(true);
    if (!isMobile && !isRenaming) {
      hoverTimeoutRef.current = setTimeout(() => {
        setPopoverOpen(true);
      }, 500);
    }
  }, [isMobile, isRenaming]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(false);
    leaveTimeoutRef.current = setTimeout(() => {
      setPopoverOpen(false);
    }, 200);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenameValue(session.title);
    setRenamePending(false);
    setIsRenaming(false);
  }, [session.title]);

  const handleFinishRename = useCallback(async () => {
    if (!onRenameSession) {
      handleCancelRename();
      return;
    }

    const nextTitle = getValidRenameTitle({
      draftTitle: renameValue,
      originalTitle: session.title,
    });
    if (!nextTitle) {
      handleCancelRename();
      return;
    }

    setRenamePending(true);
    try {
      await onRenameSession(session.id, nextTitle);
    } catch (error) {
      console.error("Failed to rename session:", error);
    } finally {
      setRenamePending(false);
      setIsRenaming(false);
    }
  }, [
    handleCancelRename,
    onRenameSession,
    renameValue,
    session.id,
    session.title,
  ]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);

  const actionButtons = showActionButtons ? (
    <>
      {onRenameSession ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              aria-label="Rename session"
              onClick={(event) => {
                event.stopPropagation();
                if (hoverTimeoutRef.current) {
                  clearTimeout(hoverTimeoutRef.current);
                  hoverTimeoutRef.current = null;
                }
                setPopoverOpen(false);
                setRenameValue(session.title);
                setIsRenaming(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            Rename session
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            aria-label={
              session.status === "archived"
                ? "Unarchive session"
                : "Archive session"
            }
            onClick={(event) => {
              event.stopPropagation();
              if (session.status === "archived") {
                onUnarchiveSession(session);
                return;
              }
              onArchiveSession(session);
            }}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {session.status === "archived"
            ? "Unarchive session"
            : "Archive session"}
        </TooltipContent>
      </Tooltip>
    </>
  ) : null;

  const actionButtonsContainer = actionButtons ? (
    <span className="absolute top-1/2 right-2 flex shrink-0 -translate-y-1/2 items-center justify-end gap-0.5">
      {actionButtons}
    </span>
  ) : null;

  const sessionButton = (
    <button
      type="button"
      className={`group relative flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,opacity] cursor-pointer ${
        isActive ? "bg-sidebar-active" : "hover:bg-muted/50"
      } ${isPending ? "opacity-80" : "opacity-100"} ${actionButtons ? "pr-12" : ""}`}
      onClick={() => onSessionClick(session)}
      onFocus={() => onSessionPrefetch(session)}
      aria-busy={isPending}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {getSessionStatusIcon(session)}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <p
          className={`truncate text-[13px] leading-5 ${
            session.hasUnread && !isActive
              ? "font-semibold text-foreground"
              : "font-normal text-foreground/75"
          }`}
        >
          {session.title}
        </p>
      </span>
      {actionButtons ? null : hasDiff ? (
        <span className="flex shrink-0 items-center justify-end gap-0.5">
          <DiffStats
            added={session.linesAdded}
            removed={session.linesRemoved}
          />
        </span>
      ) : null}
    </button>
  );

  const rowButton = isRenaming ? (
    <div
      className={`group relative flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left outline-none transition-[background-color,opacity] ${
        isActive ? "bg-sidebar-active" : "bg-muted/50"
      } ${renamePending ? "opacity-80" : "opacity-100"}`}
      style={sessionRowPerformanceStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {getSessionStatusIcon(session)}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={() => {
            void handleFinishRename();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleFinishRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              handleCancelRename();
            }
          }}
          disabled={renamePending}
          maxLength={120}
          className="h-5 w-full rounded border-0 bg-transparent p-0 text-[13px] leading-5 text-foreground outline-none"
        />
      </span>
    </div>
  ) : (
    <div
      className="relative"
      style={sessionRowPerformanceStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {sessionButton}
      {actionButtonsContainer}
    </div>
  );

  if (isMobile || isRenaming) {
    return rowButton;
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <div
        className="relative"
        style={sessionRowPerformanceStyle}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <PopoverTrigger asChild>{sessionButton}</PopoverTrigger>
        {actionButtonsContainer}
      </div>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-72 p-3"
        onMouseEnter={() => {
          if (leaveTimeoutRef.current) {
            clearTimeout(leaveTimeoutRef.current);
            leaveTimeoutRef.current = null;
          }
        }}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SessionPopoverContent session={session} />
      </PopoverContent>
    </Popover>
  );
}, areSessionRowsEqual);

function areSessionRowsEqual(
  prev: SessionRowProps,
  next: SessionRowProps,
): boolean {
  if (prev.isActive !== next.isActive || prev.isPending !== next.isPending) {
    return false;
  }

  return (
    prev.session.id === next.session.id &&
    prev.session.title === next.session.title &&
    prev.session.hasStreaming === next.session.hasStreaming &&
    prev.session.hasUnread === next.session.hasUnread &&
    prev.session.repoOwner === next.session.repoOwner &&
    prev.session.repoName === next.session.repoName &&
    prev.session.branch === next.session.branch &&
    prev.session.prNumber === next.session.prNumber &&
    prev.session.prStatus === next.session.prStatus &&
    prev.session.linesAdded === next.session.linesAdded &&
    prev.session.linesRemoved === next.session.linesRemoved &&
    String(prev.session.lastActivityAt) === String(next.session.lastActivityAt)
  );
}

export function InboxSidebar({
  sessions,
  archivedCount,
  sessionsLoading,
  activeSessionId,
  pendingSessionId,
  onSessionClick,
  onSessionPrefetch,
  onRenameSession,
  onArchiveSession,
  onUnarchiveSession,
  onOpenNewSession,
  onCreateSandboxFreeChat,
  onCreateSessionForRepo,
  onCreateSessionFromBranch,
  initialUser,
}: InboxSidebarProps) {
  const router = useRouter();
  const { session } = useSession();
  const { rank: leaderboardRank, loading: leaderboardLoading } =
    useLeaderboardRank();
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar();
  const { openWorkspaceSettings } = useWorkspaceSettings();
  const [showArchived, setShowArchived] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<SessionWithUnread[]>(
    [],
  );
  const [archivedSessionsLoading, setArchivedSessionsLoading] = useState(false);
  const [archivedSessionsError, setArchivedSessionsError] = useState<
    string | null
  >(null);
  const [hasMoreArchivedSessions, setHasMoreArchivedSessions] = useState(false);
  const archivedRequestInFlightRef = useRef(false);
  const lastLoadedArchivedCountRef = useRef(0);
  const [branchPickerRepo, setBranchPickerRepo] = useState<{
    owner: string;
    repo: string;
  } | null>(null);
  const [isCreatingFromBranch, setIsCreatingFromBranch] = useState(false);
  const [isCreatingSandboxFreeChat, setIsCreatingSandboxFreeChat] =
    useState(false);
  const [archiveConfirmSession, setArchiveConfirmSession] =
    useState<SessionWithUnread | null>(null);

  const fetchArchivedSessionsPage = useCallback(
    async ({ offset, replace }: { offset: number; replace: boolean }) => {
      if (archivedRequestInFlightRef.current) {
        return;
      }

      archivedRequestInFlightRef.current = true;
      setArchivedSessionsLoading(true);
      setArchivedSessionsError(null);

      try {
        const query = new URLSearchParams({
          status: "archived",
          limit: String(ARCHIVED_SESSIONS_PAGE_SIZE),
          offset: String(offset),
        });
        const res = await fetch(`/api/sessions?${query.toString()}`);
        const data = (await res.json()) as ArchivedSessionsResponse;

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load archived sessions");
        }

        setArchivedSessions((current) => {
          if (replace) {
            return data.sessions;
          }

          const existingIds = new Set(current.map((session) => session.id));
          const nextSessions = data.sessions.filter(
            (session) => !existingIds.has(session.id),
          );

          return [...current, ...nextSessions];
        });
        lastLoadedArchivedCountRef.current = data.archivedCount;
        setHasMoreArchivedSessions(Boolean(data.pagination?.hasMore));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load archived sessions";
        setArchivedSessionsError(message);
      } finally {
        archivedRequestInFlightRef.current = false;
        setArchivedSessionsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!showArchived) {
      return;
    }

    if (archivedCount === 0) {
      setArchivedSessions([]);
      setHasMoreArchivedSessions(false);
      setArchivedSessionsError(null);
      lastLoadedArchivedCountRef.current = 0;
      return;
    }

    if (lastLoadedArchivedCountRef.current === archivedCount) {
      return;
    }

    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [archivedCount, fetchArchivedSessionsPage, showArchived]);

  const activeSessions = sessions;
  const displayedSessions = showArchived ? archivedSessions : activeSessions;
  const showLoadingSkeleton =
    (!showArchived && sessionsLoading && sessions.length === 0) ||
    (showArchived && archivedSessionsLoading && archivedSessions.length === 0);
  const sidebarUser = session?.user ?? initialUser;

  // Repos with agents or loops keep their sidebar group even after every
  // session/branch is gone, so the repo's tooling doesn't silently disappear.
  const { agents: allAgents } = useAllAgents();
  const { loops: allLoops, featureDisabled: loopsFeatureDisabled } =
    useAllLoops();
  const anchorRepos = useMemo<SidebarRepoRef[]>(
    () => [
      ...(allAgents ?? []).map((a) => ({
        repoOwner: a.repoOwner,
        repoName: a.repoName,
      })),
      ...(allLoops ?? []).map((l) => ({
        repoOwner: l.repoOwner,
        repoName: l.repoName,
      })),
    ],
    [allAgents, allLoops],
  );

  const groupedSessions = useMemo(
    // Only union anchor repos into the active view — the archived view should
    // list archived sessions only, not empty tooling-anchored groups.
    () => buildRepoGroups(displayedSessions, showArchived ? [] : anchorRepos),
    [displayedSessions, anchorRepos, showArchived],
  );
  const activeGroupId = useMemo(
    () =>
      groupedSessions.find((group) =>
        group.sessions.some((session) => session.id === activeSessionId),
      )?.id ?? null,
    [activeSessionId, groupedSessions],
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    Record<string, boolean>
  >({});
  const showCollapsedRail = !isMobile && state === "collapsed";
  const railActions = useMemo(() => getCollapsedRailActions(), []);
  const railActionById = useMemo(
    () => new Map(railActions.map((action) => [action.id, action])),
    [railActions],
  );

  useEffect(() => {
    setCollapsedGroupIds((current) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const group of groupedSessions) {
        const nextCollapsed =
          group.id === activeGroupId ? false : (current[group.id] ?? false);

        next[group.id] = nextCollapsed;

        if (current[group.id] !== nextCollapsed) {
          changed = true;
        }
      }

      if (!changed) {
        const currentIds = Object.keys(current);
        if (currentIds.length !== groupedSessions.length) {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [activeGroupId, groupedSessions]);

  const handleSessionClick = useCallback(
    (session: SessionWithUnread) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      onSessionClick(session);
    },
    [isMobile, onSessionClick, setOpenMobile],
  );

  const handleSessionPrefetch = useCallback(
    (session: SessionWithUnread) => {
      onSessionPrefetch(session);
    },
    [onSessionPrefetch],
  );

  const handleToggleRepoGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }, []);

  const handleArchiveSession = useCallback((session: SessionWithUnread) => {
    setArchiveConfirmSession(session);
  }, []);

  const handleConfirmArchive = useCallback(async () => {
    if (!archiveConfirmSession) return;
    const session = archiveConfirmSession;
    setArchiveConfirmSession(null);
    try {
      await onArchiveSession(session.id);
      setArchivedSessions((current) => {
        const nextSessions = [
          { ...session, status: "archived" as const },
          ...current.filter(
            (existingSession) => existingSession.id !== session.id,
          ),
        ];
        const maxCachedSessions = Math.max(
          current.length,
          ARCHIVED_SESSIONS_PAGE_SIZE,
        );

        return nextSessions.slice(0, maxCachedSessions);
      });
      setHasMoreArchivedSessions(
        (currentHasMore) =>
          currentHasMore || archivedCount + 1 > ARCHIVED_SESSIONS_PAGE_SIZE,
      );
    } catch (err) {
      console.error("Failed to archive session:", err);
    }
  }, [archiveConfirmSession, archivedCount, onArchiveSession]);

  const handleUnarchiveSession = useCallback(
    async (session: SessionWithUnread) => {
      try {
        await onUnarchiveSession(session.id);
        setArchivedSessions((current) =>
          current.filter(
            (existingSession) => existingSession.id !== session.id,
          ),
        );
      } catch (err) {
        console.error("Failed to unarchive session:", err);
      }
    },
    [onUnarchiveSession],
  );

  const handleLoadMoreArchivedSessions = useCallback(() => {
    if (archivedSessionsLoading) {
      return;
    }

    void fetchArchivedSessionsPage({
      offset: archivedSessions.length,
      replace: false,
    });
  }, [
    archivedSessions.length,
    archivedSessionsLoading,
    fetchArchivedSessionsPage,
  ]);

  const handleRetryArchivedSessions = useCallback(() => {
    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [fetchArchivedSessionsPage]);

  const handleCreateSandboxFreeChat = useCallback(async () => {
    if (isCreatingSandboxFreeChat) return;
    setIsCreatingSandboxFreeChat(true);
    try {
      await onCreateSandboxFreeChat();
      if (isMobile) setOpenMobile(false);
    } finally {
      setIsCreatingSandboxFreeChat(false);
    }
  }, [
    isCreatingSandboxFreeChat,
    isMobile,
    onCreateSandboxFreeChat,
    setOpenMobile,
  ]);

  const handleCreateForRepo = useCallback(
    (owner: string, repo: string) => {
      if (isMobile) setOpenMobile(false);
      onCreateSessionForRepo(owner, repo);
    },
    [isMobile, setOpenMobile, onCreateSessionForRepo],
  );

  const handleOpenBranchPicker = useCallback((owner: string, repo: string) => {
    setBranchPickerRepo({ owner, repo });
  }, []);

  const handleOpenWorkspaceSettings = useCallback(
    (owner: string, repo: string, label: string) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      openWorkspaceSettings({ owner, repo, label });
    },
    [isMobile, setOpenMobile, openWorkspaceSettings],
  );

  const handleBranchSelected = useCallback(
    async (branch: string) => {
      if (!branchPickerRepo) return;
      setIsCreatingFromBranch(true);
      try {
        await onCreateSessionFromBranch(
          branchPickerRepo.owner,
          branchPickerRepo.repo,
          branch,
        );
        setBranchPickerRepo(null);
        if (isMobile) setOpenMobile(false);
      } catch (error) {
        console.error("Failed to create session from branch:", error);
      } finally {
        setIsCreatingFromBranch(false);
      }
    },
    [branchPickerRepo, onCreateSessionFromBranch, isMobile, setOpenMobile],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showCollapsedRail ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center bg-muted/20 py-2"
          aria-label="Collapsed sidebar navigation"
        >
          <div className="flex w-full flex-col items-center gap-1 border-b border-border/70 px-1 pb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="h-9 w-9 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={railActionById.get("expand")?.ariaLabel}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                {railActionById.get("expand")?.tooltip}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onOpenNewSession}
                  className="h-9 w-9 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={railActionById.get("new-session")?.ariaLabel}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                {railActionById.get("new-session")?.tooltip}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isCreatingSandboxFreeChat}
                  onClick={() => {
                    void handleCreateSandboxFreeChat();
                  }}
                  className="h-9 w-9 text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={railActionById.get("quick-chat")?.ariaLabel}
                >
                  {isCreatingSandboxFreeChat ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MessageSquare className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                {railActionById.get("quick-chat")?.tooltip}
              </TooltipContent>
            </Tooltip>
          </div>

          <nav
            aria-label="Sidebar rail repositories"
            className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-1 py-2"
          >
            {groupedSessions.map((group) => {
              const groupRepoOwner = group.repoOwner ?? "";
              const groupRepoName = group.repoName ?? "";
              const hasRepo = Boolean(groupRepoOwner && groupRepoName);
              const groupHasActiveSession = group.id === activeGroupId;

              if (!hasRepo) {
                return (
                  <Tooltip key={group.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={isCreatingSandboxFreeChat}
                        onClick={() => {
                          void handleCreateSandboxFreeChat();
                        }}
                        className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          groupHasActiveSession
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-background hover:text-foreground"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                        aria-label="New chat"
                      >
                        {isCreatingSandboxFreeChat ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MessageSquare className="h-4 w-4" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={6}>
                      {group.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              const repoActions = getCollapsedRepoRailActions(
                groupRepoOwner,
                groupRepoName,
              ).filter(
                (action) =>
                  action.id !== "repo-dashboard" &&
                  action.id !== "repo-agents" &&
                  action.id !== "repo-loops",
              );
              const repoAgents = filterAgentsByRepo(
                allAgents ?? [],
                groupRepoOwner,
                groupRepoName,
              );
              const repoLoops =
                allLoops?.filter(
                  (loop) =>
                    loop.repoOwner.toLowerCase() ===
                      groupRepoOwner.toLowerCase() &&
                    loop.repoName.toLowerCase() === groupRepoName.toLowerCase(),
                ) ?? null;
              const resourceActions = getRepoSubGroupRailActions({
                repoOwner: groupRepoOwner,
                repoName: groupRepoName,
                agents: repoAgents,
                loops: repoLoops,
                loopsFeatureDisabled,
              });
              const allRepoActions = [...repoActions, ...resourceActions];

              return (
                <div
                  key={group.id}
                  className="flex flex-col items-center gap-1"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`/repos/${encodeURIComponent(groupRepoOwner)}/${encodeURIComponent(groupRepoName)}`}
                        className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          groupHasActiveSession
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-background hover:text-foreground"
                        }`}
                        aria-label={`Open repo dashboard for ${group.label}`}
                      >
                        <FolderGit2 className="h-4 w-4" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={6}>
                      {group.label}
                    </TooltipContent>
                  </Tooltip>

                  <div className="flex flex-col items-center gap-1 border-l border-border/70 pl-1">
                    {allRepoActions.map((action) => {
                      const icon =
                        action.id === "repo-dashboard" ? (
                          <LayoutDashboard className="h-3.5 w-3.5" />
                        ) : action.id === "repo-branch" ? (
                          <GitBranch className="h-3.5 w-3.5" />
                        ) : action.id === "repo-settings" ? (
                          <Settings className="h-3.5 w-3.5" />
                        ) : action.id === "repo-new-session" ? (
                          <Plus className="h-3.5 w-3.5" />
                        ) : action.id === "agents" ? (
                          <Bot className="h-3.5 w-3.5" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        );
                      const badge =
                        "count" in action && action.count > 0
                          ? action.count
                          : null;

                      if (action.href) {
                        return (
                          <Tooltip key={action.id}>
                            <TooltipTrigger asChild>
                              <Link
                                href={action.href}
                                className="relative flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={action.ariaLabel}
                              >
                                {icon}
                                {badge ? (
                                  <span className="-right-0.5 -top-0.5 absolute flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground">
                                    {badge}
                                  </span>
                                ) : null}
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={6}>
                              {action.tooltip}
                            </TooltipContent>
                          </Tooltip>
                        );
                      }

                      return (
                        <Tooltip key={action.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                if (action.id === "repo-branch") {
                                  handleOpenBranchPicker(
                                    groupRepoOwner,
                                    groupRepoName,
                                  );
                                  return;
                                }

                                if (action.id === "repo-settings") {
                                  handleOpenWorkspaceSettings(
                                    groupRepoOwner,
                                    groupRepoName,
                                    group.label,
                                  );
                                  return;
                                }

                                handleCreateForRepo(
                                  groupRepoOwner,
                                  groupRepoName,
                                );
                              }}
                              className="relative flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={action.ariaLabel}
                            >
                              {icon}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={6}>
                            {action.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="flex w-full flex-col items-center border-t border-border/70 px-1 pt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() => router.push("/settings")}
                  aria-label={railActionById.get("settings")?.ariaLabel}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                {railActionById.get("settings")?.tooltip}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : (
        <>
          {/* Header — shown in expanded desktop mode and in the mobile drawer. */}
          <div className="border-b border-border p-3">
            <div className="mb-3 flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Collapse panel"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  Collapse panel
                </TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => {
                  if (isMobile) {
                    setOpenMobile(false);
                  }
                  onOpenNewSession();
                }}
                className="h-8 flex-1 justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                New session
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isCreatingSandboxFreeChat}
                    onClick={() => {
                      if (isMobile) {
                        setOpenMobile(false);
                      }
                      void handleCreateSandboxFreeChat();
                    }}
                    className="h-8 w-8 shrink-0"
                    aria-label="Quick chat (no repo)"
                  >
                    {isCreatingSandboxFreeChat ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageSquare className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  Quick chat (no repo)
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  !showArchived
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Active
                {activeSessions.length > 0 && (
                  <span className="ml-1.5 text-muted-foreground">
                    {activeSessions.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  showArchived
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Archive className="h-3 w-3" />
                Archive
                {archivedCount > 0 && (
                  <span className="ml-1 text-muted-foreground">
                    {archivedCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {showLoadingSkeleton ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="space-y-1.5 rounded-md px-3 py-2.5"
                  >
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : groupedSessions.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                {showArchived
                  ? (archivedSessionsError ?? "No archived sessions")
                  : "No sessions yet"}
                {showArchived && archivedSessionsError ? (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRetryArchivedSessions}
                    >
                      Retry
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="space-y-3 p-1.5">
                  {groupedSessions.map((group) => {
                    const isCollapsed = collapsedGroupIds[group.id] ?? false;
                    const groupHasActiveSession = group.id === activeGroupId;
                    const groupContentId = getRepoGroupContentId(group.id);

                    const groupRepoOwner = group.repoOwner ?? "";
                    const groupRepoName = group.repoName ?? "";
                    const hasRepo = Boolean(groupRepoOwner && groupRepoName);

                    return (
                      <section key={group.id} className="space-y-1.5">
                        <div
                          className={`group/repo flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                            groupHasActiveSession
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground/85"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleToggleRepoGroup(group.id)}
                            aria-controls={groupContentId}
                            aria-expanded={!isCollapsed}
                            className="flex min-w-0 flex-1 items-center gap-1.5"
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground/80">
                              {group.id === "repo:unscoped" ? (
                                <MessageSquare className="h-3.5 w-3.5 group-hover/repo:hidden" />
                              ) : (
                                <FolderGit2 className="h-3.5 w-3.5 group-hover/repo:hidden" />
                              )}
                              <ChevronDown
                                className={`hidden h-3.5 w-3.5 text-muted-foreground/70 transition-transform duration-200 group-hover/repo:block ${
                                  isCollapsed ? "-rotate-90" : "rotate-0"
                                }`}
                              />
                            </span>
                            <span className="min-w-0 truncate text-[12px] font-medium">
                              {group.label}
                            </span>
                          </button>
                          {hasRepo ? (
                            <span
                              className={`shrink-0 items-center gap-0.5 ${isMobile ? "flex" : "hidden group-hover/repo:flex"}`}
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link
                                    href={`/repos/${groupRepoOwner}/${groupRepoName}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                                    aria-label={`Open repo dashboard for ${group.label}`}
                                  >
                                    <LayoutDashboard className="h-3 w-3" />
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={4}>
                                  Repo dashboard
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenBranchPicker(
                                        groupRepoOwner,
                                        groupRepoName,
                                      );
                                    }}
                                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                                    aria-label={`Create session from branch for ${group.label}`}
                                  >
                                    <GitBranch className="h-3 w-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={4}>
                                  Create from branch
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenWorkspaceSettings(
                                        groupRepoOwner,
                                        groupRepoName,
                                        group.label,
                                      );
                                    }}
                                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                                    aria-label={`Open workspace settings for ${group.label}`}
                                  >
                                    <Settings className="h-3 w-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={4}>
                                  Workspace settings
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCreateForRepo(
                                        groupRepoOwner,
                                        groupRepoName,
                                      );
                                    }}
                                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
                                    aria-label={`Create session for ${group.label}`}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={4}>
                                  Create session
                                </TooltipContent>
                              </Tooltip>
                            </span>
                          ) : (
                            <span
                              className={`shrink-0 items-center gap-0.5 ${isMobile ? "flex" : "hidden group-hover/repo:flex"}`}
                            >
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    disabled={isCreatingSandboxFreeChat}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleCreateSandboxFreeChat();
                                    }}
                                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label="New chat"
                                  >
                                    {isCreatingSandboxFreeChat ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Plus className="h-3 w-3" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={4}>
                                  New chat
                                </TooltipContent>
                              </Tooltip>
                            </span>
                          )}
                        </div>
                        <div
                          id={groupContentId}
                          aria-hidden={isCollapsed}
                          inert={isCollapsed}
                          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                            isCollapsed
                              ? "grid-rows-[0fr] opacity-0 pointer-events-none"
                              : "grid-rows-[1fr] opacity-100"
                          }`}
                        >
                          <div className="overflow-hidden">
                            {/* Repo resources (Agents, Loops) sit ABOVE the session
                            list so the repo's tooling is the first thing under
                            the repo, not buried below its branches. */}
                            {hasRepo ? (
                              <div className="ml-4 border-l border-border/40 pl-1.5">
                                <RepoSubGroups
                                  repoOwner={groupRepoOwner}
                                  repoName={groupRepoName}
                                />
                              </div>
                            ) : null}
                            <div className="ml-4 space-y-1 border-l border-border/40 pl-1.5">
                              {group.sessions.map((session) => (
                                <SessionRow
                                  key={session.id}
                                  session={session}
                                  isActive={session.id === activeSessionId}
                                  isPending={session.id === pendingSessionId}
                                  onSessionClick={handleSessionClick}
                                  onSessionPrefetch={handleSessionPrefetch}
                                  onRenameSession={onRenameSession}
                                  onArchiveSession={handleArchiveSession}
                                  onUnarchiveSession={handleUnarchiveSession}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
                {showArchived &&
                (hasMoreArchivedSessions || archivedSessionsError) ? (
                  <div className="px-3 pb-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={
                        archivedSessionsError
                          ? handleRetryArchivedSessions
                          : handleLoadMoreArchivedSessions
                      }
                      disabled={archivedSessionsLoading}
                    >
                      {archivedSessionsLoading
                        ? "Loading..."
                        : archivedSessionsError
                          ? "Retry loading archived sessions"
                          : "Load more archived sessions"}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {sidebarUser ? (
            <div className="border-t border-border p-3">
              <div className="flex items-center gap-2 rounded-lg p-2">
                <Avatar className="h-9 w-9 shrink-0">
                  {sidebarUser.avatar ? (
                    <AvatarImage
                      src={sidebarUser.avatar}
                      alt={sidebarUser.username}
                    />
                  ) : null}
                  <AvatarFallback>
                    {getAvatarFallback(sidebarUser.username)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-none text-foreground">
                    {sidebarUser.username}
                  </p>
                  {sidebarUser.email ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {sidebarUser.email}
                    </p>
                  ) : null}
                  {leaderboardRank ? (
                    <Link
                      href="/settings/leaderboard"
                      className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground"
                    >
                      <span className="font-semibold tabular-nums text-foreground/70">
                        #{leaderboardRank.rank}
                      </span>{" "}
                      in {formatDomainOrg(leaderboardRank.domain)}
                    </Link>
                  ) : leaderboardLoading &&
                    getUsageLeaderboardDomain(sidebarUser.email) ? (
                    <span className="mt-1 block h-4 w-24 animate-pulse rounded bg-muted" />
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => router.push("/settings")}
                  aria-label="Open settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {branchPickerRepo ? (
        <BranchPickerDialog
          open={Boolean(branchPickerRepo)}
          onOpenChange={(open) => {
            if (!open) setBranchPickerRepo(null);
          }}
          owner={branchPickerRepo.owner}
          repo={branchPickerRepo.repo}
          isCreating={isCreatingFromBranch}
          onSelectBranch={handleBranchSelected}
        />
      ) : null}

      {/* Archive confirmation dialog */}
      <Dialog
        open={archiveConfirmSession !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveConfirmSession(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Archive session?</DialogTitle>
            <DialogDescription>
              This will stop the sandbox and archive the session. You can still
              view it in the archive tab.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                void handleConfirmArchive();
              }}
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
