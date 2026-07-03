"use client";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useGitHubConnectionStatus } from "@/hooks/use-github-connection-status";
import { useRepoDefaults } from "@/hooks/use-repo-defaults";
import { useSession } from "@/hooks/use-session";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { useVercelRepoProjects } from "@/hooks/use-vercel-repo-projects";
import type { VercelProjectSelection } from "@/lib/vercel/types";
import { cn } from "@/lib/utils";
import { BranchSelectorCompact } from "./branch-selector-compact";
import { RepoSelectorCompact } from "./repo-selector-compact";
import {
  DEFAULT_SANDBOX_TYPE,
  SANDBOX_OPTIONS,
  type SandboxType,
} from "./sandbox-selector-compact";
import {
  getButtonLabel,
  getEffectiveRuntimeSelection,
  getRuntimeModeLabel,
  getRuntimeSelectionForSubmit,
  getSessionFooter,
  isSubmitBlocked,
  type RuntimeSelection,
  type SessionMode,
  type SessionRuntimeMode,
} from "./session-starter-helpers";
import { SessionStarterVercelSyncSection } from "./session-starter-vercel-sync-section";
import { prepareSessionTitle } from "./session-starter-title";
import { Switch } from "./ui/switch";

interface SessionStarterProps {
  onSubmit: (session: {
    title?: string;
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    fullClone: boolean;
    sandboxType: SandboxType;
    runtimeMode: SessionRuntimeMode;
    managedRuntimeProfileId?: string;
    autoCommitPush: boolean;
    autoCreatePr: boolean;
    vercelProject?: VercelProjectSelection | null;
  }) => void;
  isLoading?: boolean;
  lastRepo: { owner: string; repo: string } | null;
}

export function SessionStarter({
  onSubmit,
  isLoading,
  lastRepo,
}: SessionStarterProps) {
  const [sessionTitle, setSessionTitle] = useState("");
  // Default to a lightweight sandbox-free "New Chat" — even for returning users
  // who have a lastRepo — so chats start instantly without provisioning a
  // sandbox. lastRepo still pre-fills the repo fields below for one-click opt-in
  // to repo mode.
  const [mode, setMode] = useState<SessionMode>("empty");
  const [selectedOwner, setSelectedOwner] = useState(
    () => lastRepo?.owner ?? "",
  );
  const [selectedRepo, setSelectedRepo] = useState(() => lastRepo?.repo ?? "");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isNewBranch, setIsNewBranch] = useState(!!lastRepo);
  const [vercelProjectChoice, setVercelProjectChoice] = useState<
    string | null | undefined
  >(undefined);

  const { session, loading: sessionLoading, hasGitHub } = useSession();
  const { reconnectRequired, isLoading: githubConnectionLoading } =
    useGitHubConnectionStatus({
      enabled: hasGitHub,
    });
  const { preferences, loading: preferencesLoading } = useUserPreferences();
  const defaultAutoCommitPush = preferences?.autoCommitPush ?? false;
  const defaultAutoCreatePr = preferences?.autoCreatePr ?? false;
  const [autoCommitPush, setAutoCommitPush] = useState<boolean | null>(null);
  const [autoCreatePr, setAutoCreatePr] = useState<boolean | null>(null);
  const [gitSettingsExpanded, setGitSettingsExpanded] = useState(false);
  const [fullClone, setFullClone] = useState(false);
  const sandboxType = preferences?.defaultSandboxType ?? DEFAULT_SANDBOX_TYPE;
  const sandboxName =
    SANDBOX_OPTIONS.find((s) => s.id === sandboxType)?.name ?? sandboxType;
  const isRepoModeDisabled = sessionLoading;

  // ── MR-4 (#812): New-Chat runtime picker ────────────────────────────────
  // The Preferences default is stored only as a profile id (no separate
  // "runtime mode" preference column exists), so the default mode is
  // "classic" unless a repo default says otherwise — repoDefaults precedence
  // is applied below once it loads.
  const defaultManagedRuntimeProfileId =
    preferences?.defaultManagedRuntimeProfileId ?? "web-bun-agent-browser";
  // The picker below is always visible (fixes #812's silent-discard "Change"
  // link, which used to navigate away to /settings/preferences and drop
  // whatever the user had typed into the dialog). No navigation is needed to
  // change the runtime, so nothing can be silently discarded.
  const [userRuntimeSelection, setUserRuntimeSelection] =
    useState<RuntimeSelection | null>(null);

  const shouldLoadVercelProjects =
    mode === "repo" &&
    !githubConnectionLoading &&
    !reconnectRequired &&
    !!selectedOwner &&
    !!selectedRepo &&
    session?.authProvider === "vercel";
  const {
    data: repoProjects,
    loading: repoProjectsLoading,
    error: repoProjectsError,
    refresh: refreshVercelProjects,
  } = useVercelRepoProjects({
    enabled: shouldLoadVercelProjects,
    repoOwner: selectedOwner,
    repoName: selectedRepo,
  });

  useEffect(() => {
    if (!shouldLoadVercelProjects) {
      setVercelProjectChoice(undefined);
      return;
    }
    if (!repoProjects || repoProjectsLoading) return;
    if (repoProjects.selectedProjectId) {
      setVercelProjectChoice(repoProjects.selectedProjectId);
      return;
    }
    if (repoProjects.projects.length === 0) {
      setVercelProjectChoice(null);
      return;
    }
    // Projects exist but no saved default — default to "don't sync" (null)
    // so the submit button is not blocked. The user can expand the Vercel
    // section to configure sync if they want.
    setVercelProjectChoice(null);
  }, [repoProjects, repoProjectsLoading, shouldLoadVercelProjects]);

  // ── Repo defaults pre-fill ─────────────────────────────────────────────────
  // Fetch resolved repo defaults when a repo is selected in repo mode.
  // The result is used as a fallback in the effective-value chain below;
  // state variables stay null so user edits are never clobbered.
  const repoDefaultsEnabled =
    mode === "repo" && !!selectedOwner && !!selectedRepo;
  const { defaults: repoDefaults } = useRepoDefaults({
    enabled: repoDefaultsEnabled,
    repoOwner: selectedOwner,
    repoName: selectedRepo,
  });

  // Track which repo key has already had its branch defaults applied so the
  // effect fires once per repo selection and never clobbers subsequent user edits.
  const appliedRepoDefaultsKey = useRef<string | null>(null);

  useEffect(() => {
    if (!repoDefaults) return;
    const key = `${selectedOwner}/${selectedRepo}`;
    if (appliedRepoDefaultsKey.current === key) return;
    appliedRepoDefaultsKey.current = key;
    setIsNewBranch(Boolean(repoDefaults.isNewBranch));
    if (repoDefaults.defaultBranch) {
      setSelectedBranch(repoDefaults.defaultBranch);
    }
  }, [repoDefaults, selectedOwner, selectedRepo]);

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setSelectedBranch(null);
    setIsNewBranch(false);
    setVercelProjectChoice(undefined);
  };

  const handleRepoClear = () => {
    setSelectedOwner("");
    setSelectedRepo("");
    setSelectedBranch(null);
    setIsNewBranch(false);
    setVercelProjectChoice(undefined);
  };

  const handleBranchChange = (branch: string | null, newBranch: boolean) => {
    setSelectedBranch(branch);
    setIsNewBranch(newBranch);
  };

  const handleModeChange = (newMode: SessionMode) => {
    if (isRepoModeDisabled && newMode === "repo") return;

    setMode(newMode);
    if (newMode === "empty") handleRepoClear();
  };

  const isRepoSelectionComplete =
    mode !== "repo" || (selectedOwner && selectedRepo);
  const isVercelLookupPending =
    mode === "repo" &&
    !!selectedOwner &&
    !!selectedRepo &&
    (sessionLoading || (shouldLoadVercelProjects && repoProjectsLoading));
  const requiresVercelChoice =
    shouldLoadVercelProjects &&
    !repoProjectsLoading &&
    !repoProjectsError &&
    !!repoProjects &&
    repoProjects.projects.length > 0 &&
    repoProjects.selectedProjectId === null &&
    vercelProjectChoice === undefined;
  const controlsDisabled = isLoading || preferencesLoading;

  // isSubmitBlocked is computed by the pure helper — requiresVercelChoice is
  // passed for API completeness but does NOT block submit (fixes #219).
  const submitBlocked = isSubmitBlocked({
    controlsDisabled,
    mode,
    isRepoModeDisabled,
    githubConnectionLoading,
    reconnectRequired,
    isRepoSelectionComplete: Boolean(isRepoSelectionComplete),
    isVercelLookupPending,
    requiresVercelChoice,
  });

  const effectiveAutoCommitPush =
    autoCommitPush ?? repoDefaults?.autoCommitPush ?? defaultAutoCommitPush;
  const effectiveAutoCreatePr =
    autoCreatePr ?? repoDefaults?.autoCreatePr ?? defaultAutoCreatePr;

  // Decision D1: the New-Chat picker is prefilled from the resolved default
  // (repo default takes precedence, same chain as autoCommitPush above) and
  // an explicit in-dialog choice always wins. Choosing "classic"/"managed"
  // here never flips any other, already-created session.
  const effectiveRuntimeSelection = getEffectiveRuntimeSelection({
    userSelection: userRuntimeSelection,
    defaultRuntimeMode: repoDefaults?.runtimeMode ?? "classic",
    defaultProfileId:
      repoDefaults?.managedRuntimeProfileId ?? defaultManagedRuntimeProfileId,
  });
  // Codex #834 P2: repo defaults are "resolved" once they've loaded, or are
  // simply not applicable (no repo selected yet) — there is nothing to wait
  // for in either case. While repoDefaultsEnabled is true and the fetch is
  // still loading/erroring, repoDefaults stays undefined, and
  // effectiveRuntimeSelection above is only a not-yet-resolved "classic"
  // fallback rather than a real choice.
  const repoDefaultsResolved = !repoDefaultsEnabled || !!repoDefaults;
  const activeManagedProfileId =
    effectiveRuntimeSelection.managedRuntimeProfileId ??
    defaultManagedRuntimeProfileId;
  const runtimeModeLabel = getRuntimeModeLabel(
    effectiveRuntimeSelection.runtimeMode,
    activeManagedProfileId,
  );

  const showVercelProjectSection =
    mode === "repo" &&
    !githubConnectionLoading &&
    !reconnectRequired &&
    !!selectedOwner &&
    !!selectedRepo &&
    (sessionLoading || session?.authProvider === "vercel");

  const handleSubmit = () => {
    if (submitBlocked) return;

    let vercelProject: VercelProjectSelection | null | undefined;
    if (shouldLoadVercelProjects) {
      if (repoProjectsError || !repoProjects) {
        vercelProject = undefined;
      } else if (vercelProjectChoice === null) {
        vercelProject = null;
      } else if (typeof vercelProjectChoice === "string") {
        vercelProject =
          repoProjects.projects.find(
            (project) => project.projectId === vercelProjectChoice,
          ) ?? null;
      } else {
        // Still resolving — should not reach here since submitBlocked guards it
        return;
      }
    }

    // Codex #834 P2: only send runtimeMode/managedRuntimeProfileId as an
    // explicit choice when the user actually chose it in the picker, or once
    // repo defaults have resolved. Otherwise effectiveRuntimeSelection is
    // just a not-yet-resolved "classic" fallback, and sending it explicitly
    // would win over POST /api/sessions' repo-defaults precedence (body >
    // repo defaults > system "classic"), silently overriding a saved
    // managed_runtime repo default.
    const runtimeSelectionForSubmit = getRuntimeSelectionForSubmit({
      effectiveRuntimeSelection,
      hasExplicitUserSelection: userRuntimeSelection !== null,
      repoDefaultsResolved,
    });

    const submitPayload: Parameters<typeof onSubmit>[0] = {
      title: prepareSessionTitle(sessionTitle),
      repoOwner: mode === "repo" ? selectedOwner || undefined : undefined,
      repoName: mode === "repo" ? selectedRepo || undefined : undefined,
      branch: mode === "repo" ? selectedBranch || undefined : undefined,
      cloneUrl:
        mode === "repo" && selectedOwner && selectedRepo
          ? `https://github.com/${selectedOwner}/${selectedRepo}`
          : undefined,
      isNewBranch: mode === "repo" ? isNewBranch : false,
      fullClone: mode === "repo" ? fullClone : false,
      sandboxType,
      runtimeMode: effectiveRuntimeSelection.runtimeMode,
      managedRuntimeProfileId:
        effectiveRuntimeSelection.managedRuntimeProfileId,
      autoCommitPush: effectiveAutoCommitPush,
      autoCreatePr: effectiveAutoCommitPush ? effectiveAutoCreatePr : false,
      vercelProject,
    };

    if (!("runtimeMode" in runtimeSelectionForSubmit)) {
      delete (submitPayload as { runtimeMode?: SessionRuntimeMode })
        .runtimeMode;
    }
    if (!("managedRuntimeProfileId" in runtimeSelectionForSubmit)) {
      delete submitPayload.managedRuntimeProfileId;
    }

    onSubmit(submitPayload);
  };

  const buttonLabel = getButtonLabel(mode, selectedOwner, selectedRepo);
  const footerText = getSessionFooter(mode, sandboxName);

  return (
    <div
      className={cn(
        "w-full min-w-0 max-w-2xl overflow-hidden rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/75 dark:border-white/10 dark:bg-neutral-900/60 dark:shadow-none sm:p-5",
        "transition-all duration-200",
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex rounded-lg bg-muted/70 p-1 dark:bg-white/[0.04]">
          <button
            type="button"
            onClick={() => handleModeChange("empty")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
              mode === "empty"
                ? "border border-border/70 bg-background text-foreground shadow-sm dark:border-transparent dark:bg-white/10 dark:text-neutral-100"
                : "text-muted-foreground hover:text-foreground dark:text-neutral-400 dark:hover:text-neutral-300",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            New chat
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("repo")}
            disabled={isRepoModeDisabled}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
              isRepoModeDisabled
                ? "cursor-not-allowed text-muted-foreground/50 dark:text-neutral-600"
                : mode === "repo"
                  ? "border border-border/70 bg-background text-foreground shadow-sm dark:border-transparent dark:bg-white/10 dark:text-neutral-100"
                  : "text-muted-foreground hover:text-foreground dark:text-neutral-400 dark:hover:text-neutral-300",
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Connect a repo
          </button>
        </div>

        {mode === "repo" && (
          <div className="flex flex-col gap-3">
            <RepoSelectorCompact
              selectedOwner={selectedOwner}
              selectedRepo={selectedRepo}
              onSelect={handleRepoSelect}
            />
            {selectedOwner &&
              selectedRepo &&
              !githubConnectionLoading &&
              !reconnectRequired && (
                <BranchSelectorCompact
                  owner={selectedOwner}
                  repo={selectedRepo}
                  value={selectedBranch}
                  isNewBranch={isNewBranch}
                  onChange={handleBranchChange}
                />
              )}

            {showVercelProjectSection && (
              <SessionStarterVercelSyncSection
                controlsDisabled={controlsDisabled}
                isVercelLookupPending={isVercelLookupPending}
                repoName={selectedRepo}
                repoOwner={selectedOwner}
                repoProjects={repoProjects}
                repoProjectsError={repoProjectsError}
                requiresVercelChoice={requiresVercelChoice}
                vercelProjectChoice={vercelProjectChoice}
                onVercelProjectChoiceChange={setVercelProjectChoice}
                onRetry={
                  repoProjectsError
                    ? () => void refreshVercelProjects()
                    : undefined
                }
              />
            )}
          </div>
        )}

        {mode === "empty" && (
          <p className="text-center text-sm text-muted-foreground dark:text-neutral-500">
            Start a new chat — no repository required.
          </p>
        )}

        <div
          role="radiogroup"
          aria-label="How should the agent work?"
          className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 dark:border-white/10 dark:bg-white/[0.02]"
        >
          <p className="text-xs font-medium text-muted-foreground">
            How should the agent work?
          </p>
          <button
            type="button"
            role="radio"
            aria-checked={effectiveRuntimeSelection.runtimeMode === "classic"}
            onClick={() => setUserRuntimeSelection({ runtimeMode: "classic" })}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition-colors",
              effectiveRuntimeSelection.runtimeMode === "classic"
                ? "border-foreground/40 bg-background font-medium"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {getRuntimeModeLabel("classic", activeManagedProfileId)}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={
              effectiveRuntimeSelection.runtimeMode === "managed_runtime"
            }
            onClick={() =>
              setUserRuntimeSelection({
                runtimeMode: "managed_runtime",
                managedRuntimeProfileId:
                  repoDefaults?.managedRuntimeProfileId ??
                  defaultManagedRuntimeProfileId,
              })
            }
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition-colors",
              effectiveRuntimeSelection.runtimeMode === "managed_runtime"
                ? "border-foreground/40 bg-background font-medium"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {getRuntimeModeLabel(
              "managed_runtime",
              repoDefaults?.managedRuntimeProfileId ??
                defaultManagedRuntimeProfileId,
            )}
          </button>
        </div>

        {mode === "repo" && !gitSettingsExpanded && (
          <button
            type="button"
            onClick={() => setGitSettingsExpanded(true)}
            className="flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-muted/20 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
          >
            <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {effectiveAutoCommitPush ? (
                <>
                  Auto commit{" "}
                  <span className="font-medium text-foreground/80">on</span>
                  {effectiveAutoCreatePr && (
                    <>
                      {" · "}Auto PR{" "}
                      <span className="font-medium text-foreground/80">on</span>
                    </>
                  )}
                </>
              ) : (
                "Auto commit and push disabled"
              )}
            </span>
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          </button>
        )}

        {mode === "repo" && gitSettingsExpanded && (
          <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20 dark:border-white/10 dark:bg-white/[0.02]">
            <button
              type="button"
              onClick={() => setGitSettingsExpanded(false)}
              className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left transition-colors hover:bg-muted/30"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">Auto commit and push</p>
                <p className="text-xs text-muted-foreground">
                  Automatically commit and push after each agent turn.
                </p>
              </div>
              <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            </button>
            <div className="border-t border-border/50 dark:border-white/[0.06]">
              <div className="flex items-center justify-between gap-4 px-3 py-2">
                <p className="text-sm font-medium">Commit and push</p>
                <Switch
                  checked={effectiveAutoCommitPush}
                  onCheckedChange={setAutoCommitPush}
                  disabled={controlsDisabled}
                />
              </div>
              {effectiveAutoCommitPush && (
                <div className="flex items-center justify-between gap-4 border-t border-border/30 px-3 py-2 pl-6 dark:border-white/[0.04]">
                  <p className="text-sm text-muted-foreground">
                    Create pull request
                  </p>
                  <Switch
                    checked={effectiveAutoCreatePr}
                    onCheckedChange={setAutoCreatePr}
                    disabled={controlsDisabled}
                  />
                </div>
              )}
            </div>
            <div className="border-t border-border/50 dark:border-white/[0.06]">
              <div className="flex items-center justify-between gap-4 px-3 py-2">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Full clone</p>
                  <p className="text-xs text-muted-foreground">
                    Include full git history (slower start). Off uses a fast
                    shallow clone.
                  </p>
                </div>
                <Switch
                  checked={fullClone}
                  onCheckedChange={setFullClone}
                  disabled={controlsDisabled}
                />
              </div>
            </div>
          </div>
        )}

        <input
          type="text"
          value={sessionTitle}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSessionTitle(e.target.value)
          }
          placeholder="Session name (optional)"
          disabled={controlsDisabled}
          aria-label="Session name"
          className="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-neutral-900/60"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitBlocked}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            submitBlocked
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {isLoading ? "Creating session…" : buttonLabel}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          {mode === "empty"
            ? footerText
            : `${footerText} · ${runtimeModeLabel}`}
        </p>
      </div>
    </div>
  );
}
