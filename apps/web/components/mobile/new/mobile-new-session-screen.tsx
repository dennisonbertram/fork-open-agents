"use client";

import { GitBranch, Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toCreateSessionErrorInfo } from "@/lib/sessions/create-session-error";
import { fetcher } from "@/lib/swr";
import { BranchSelectorCompact } from "@/components/branch-selector-compact";
import { useSession } from "@/hooks/use-session";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { useInstallationRepos } from "@/hooks/use-installation-repos";
import { useRepoDefaults } from "@/hooks/use-repo-defaults";
import { useSessions } from "@/hooks/use-sessions";
import { MobileScreenHeader } from "@/components/mobile/shell/mobile-screen-header";
import {
  buildCreateSessionInput,
  type MobileRepoSelection,
} from "./mobile-create-session-payload";
import { MobileSuggestionChips } from "./mobile-suggestion-chips";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const installationSchema = z.object({
  installationId: z.number(),
  accountLogin: z.string(),
  accountType: z.enum(["User", "Organization"]),
  repositorySelection: z.enum(["all", "selected"]),
  installationUrl: z.string().nullable(),
});

const installationsSchema = z.array(installationSchema);

type Installation = z.infer<typeof installationSchema>;

interface RepoCandidate {
  owner: string;
  name: string;
  /** Constructed clone URL (may need GitHub app URL in prod) */
  cloneUrl: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchInstallations(): Promise<Installation[]> {
  const json = await fetcher<unknown>("/api/github/installations");
  const parsed = installationsSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Mobile new-session screen.
 *
 * Form fields:
 *   1. Task textarea (pre-filled from sessionStorage if navigated via suggestion chip)
 *   2. MobileSuggestionChips row
 *   3. Mode toggle: Chat only / With repo
 *   4. When repo mode: RepoSelector (owner/name) -> BranchSelectorCompact
 *   5. Advanced switches: Auto commit & push, Auto create PR
 *   6. Create Session CTA
 *
 * On submit: buildCreateSessionInput → useSessions.createSession → push to /m/chat/[chatId]
 */
export function MobileNewSessionScreen() {
  const router = useRouter();
  const { isAuthenticated, hasGitHub } = useSession();
  const { preferences } = useUserPreferences();
  const { createSession } = useSessions();

  // Task textarea ref for prefill
  const taskRef = useRef<HTMLTextAreaElement>(null);

  // Pre-fill from sessionStorage (set by suggestion chips or activity tap)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefill = sessionStorage.getItem("mobile-new-session-task");
    if (prefill && taskRef.current) {
      taskRef.current.value = prefill;
      sessionStorage.removeItem("mobile-new-session-task");
    }
  }, []);

  // Repo mode
  const [repoMode, setRepoMode] = useState(false);

  // Repo + branch selection
  const [selectedInstallation, setSelectedInstallation] =
    useState<Installation | null>(null);
  const [repoCandidate, setRepoCandidate] = useState<RepoCandidate | null>(
    null,
  );
  const [branch, setBranch] = useState<string | null>(null);
  const [isNewBranch, setIsNewBranch] = useState(false);

  // Advanced options — tri-state. null means "not explicitly set by the user",
  // so the effective value falls back to the repository's resolved defaults and
  // then the user's global preferences (mirrors the desktop session starter, so
  // mobile never silently overrides a repository's auto-commit/PR settings).
  const [autoCommitPush, setAutoCommitPush] = useState<boolean | null>(null);
  const [autoCreatePr, setAutoCreatePr] = useState<boolean | null>(null);

  // Advanced section visibility
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Installations list
  const { data: installations } = useSWR<Installation[]>(
    hasGitHub ? "/api/github/installations" : null,
    fetchInstallations,
    { revalidateOnFocus: false },
  );

  // Auto-select first installation
  useEffect(() => {
    if (!selectedInstallation && installations && installations.length > 0) {
      setSelectedInstallation(installations[0] ?? null);
    }
  }, [installations, selectedInstallation]);

  // Repos for selected installation
  const { repos, isLoading: reposLoading } = useInstallationRepos({
    installationId: selectedInstallation?.installationId ?? null,
    limit: 50,
  });

  // Repo defaults (auto-fill branch from repo settings)
  const { defaults: repoDefaults } = useRepoDefaults({
    enabled: !!repoCandidate,
    repoOwner: repoCandidate?.owner ?? "",
    repoName: repoCandidate?.name ?? "",
  });

  // When repo defaults arrive, seed the branch if not already set
  useEffect(() => {
    if (repoDefaults?.defaultBranch && !branch) {
      setBranch(repoDefaults.defaultBranch);
      setIsNewBranch(false);
    }
  }, [repoDefaults, branch]);

  // Handle chip pick
  const handleChipPick = useCallback((prompt: string) => {
    if (taskRef.current) {
      taskRef.current.value = prompt;
      taskRef.current.focus();
    }
  }, []);

  // Handle repo select from list
  const handleRepoSelect = useCallback(
    (owner: string, name: string) => {
      const installOwner =
        selectedInstallation?.accountLogin ?? owner.split("/")[0] ?? owner;
      setRepoCandidate({
        owner: installOwner,
        name,
        cloneUrl: `https://github.com/${installOwner}/${name}.git`,
      });
      setBranch(null);
      setIsNewBranch(false);
    },
    [selectedInstallation],
  );

  // Effective auto-commit / auto-PR: explicit user toggle wins, else the
  // repository's resolved default, else the user's global preference.
  const defaultAutoCommitPush = preferences?.autoCommitPush ?? true;
  const defaultAutoCreatePr = preferences?.autoCreatePr ?? false;
  const effectiveAutoCommitPush =
    autoCommitPush ?? repoDefaults?.autoCommitPush ?? defaultAutoCommitPush;
  const effectiveAutoCreatePr =
    autoCreatePr ?? repoDefaults?.autoCreatePr ?? defaultAutoCreatePr;

  // Build repo selection for payload.
  // A valid selection requires: repo mode on, a repo candidate, AND either:
  //   - an explicit branch string, or
  //   - isNewBranch=true (server auto-generates the branch name)
  const repoSelection = useMemo<MobileRepoSelection | null>(() => {
    if (!repoMode || !repoCandidate) {
      return null;
    }
    if (!branch && !isNewBranch) {
      // No branch mode chosen yet — not ready
      return null;
    }
    return {
      owner: repoCandidate.owner,
      name: repoCandidate.name,
      cloneUrl: repoCandidate.cloneUrl,
      branch, // null is fine when isNewBranch=true
      isNewBranch,
    };
  }, [repoMode, repoCandidate, branch, isNewBranch]);

  // Submit
  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    // Guard: in repo mode we must have a fully-resolved repo selection, else
    // buildCreateSessionInput falls back to a plain-chat session and silently
    // drops the user's repo intent.
    if (repoMode && !repoSelection) return;
    const task = taskRef.current?.value.trim() ?? "";

    setIsSubmitting(true);
    try {
      const payload = buildCreateSessionInput({
        title: task || undefined,
        repo: repoSelection,
        autoCommitPush: effectiveAutoCommitPush,
        autoCreatePr: effectiveAutoCreatePr,
      });

      const { chat } = await createSession(payload);

      // Carry the task prompt to the chat screen, keyed per chat so a stale
      // prefill can never be sent into the wrong conversation. The chat screen
      // reads and clears it on mount and sends it as the first message.
      if (task) {
        sessionStorage.setItem(`mobile-chat-prefill:${chat.id}`, task);
      }

      router.push(`/m/chat/${chat.id}`);
    } catch (err) {
      // Ownership decision (#784): useSessions().createSession no longer
      // toasts on failure — this screen has no persistent form surface, so
      // it toasts the mapped failure exactly once.
      const info = toCreateSessionErrorInfo(err);
      toast.error(info.message);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    repoMode,
    repoSelection,
    effectiveAutoCommitPush,
    effectiveAutoCreatePr,
    createSession,
    router,
  ]);

  // Auth gate
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <MobileScreenHeader title="New session" />
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-muted-foreground">
            Sign in to create sessions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <MobileScreenHeader title="New session" />

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-8 pt-4">
        {/* Task textarea */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="mobile-task"
            className="text-sm font-medium text-foreground"
          >
            Task
          </label>
          <Textarea
            id="mobile-task"
            ref={taskRef}
            placeholder="What should the agent do?"
            rows={4}
            className="w-full resize-none text-base"
            aria-label="Describe the task for the agent"
          />
        </div>

        {/* Suggestion chips */}
        <MobileSuggestionChips onPick={handleChipPick} />

        {/* Mode toggle */}
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">Session type</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setRepoMode(false);
                setRepoCandidate(null);
                setBranch(null);
              }}
              className={cn(
                "flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                !repoMode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
              Chat only
            </button>
            <button
              type="button"
              onClick={() => setRepoMode(true)}
              className={cn(
                "flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                repoMode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              <GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" />
              With repo
            </button>
          </div>
        </div>

        {/* Repo / branch picker (only when repo mode) */}
        {repoMode && (
          <div className="flex flex-col gap-4">
            {/* Account / installation selector — only when more than one */}
            {hasGitHub && installations && installations.length > 1 ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">
                  Account
                </span>
                <div className="flex flex-wrap gap-2">
                  {installations.map((inst) => {
                    const active =
                      selectedInstallation?.installationId ===
                      inst.installationId;
                    return (
                      <button
                        key={inst.installationId}
                        type="button"
                        onClick={() => {
                          setSelectedInstallation(inst);
                          setRepoCandidate(null);
                          setBranch(null);
                          setIsNewBranch(false);
                        }}
                        className={cn(
                          "min-h-[36px] rounded-full border px-3 py-1.5 text-sm transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-muted/30 text-muted-foreground",
                        )}
                      >
                        {inst.accountLogin}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Repo list */}
            {!hasGitHub ? (
              <p className="text-sm text-muted-foreground">
                Connect GitHub in Settings to use repositories.
              </p>
            ) : reposLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading repositories…
              </p>
            ) : repos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No repositories found for this installation.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">
                  Repository
                </span>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                  {repos.map((repo) => {
                    const isSelected =
                      repoCandidate?.name === repo.name &&
                      repoCandidate?.owner ===
                        (selectedInstallation?.accountLogin ?? "");
                    return (
                      <button
                        key={repo.full_name}
                        type="button"
                        onClick={() =>
                          handleRepoSelect(
                            selectedInstallation?.accountLogin ?? "",
                            repo.name,
                          )
                        }
                        className={cn(
                          "flex w-full min-h-[44px] items-center gap-2 px-4 py-3 text-left text-sm transition-colors",
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted/50",
                          "border-b border-border/40 last:border-b-0",
                        )}
                      >
                        {repo.private ? (
                          <span
                            aria-label="Private"
                            className="shrink-0 text-[10px] text-muted-foreground"
                          >
                            🔒
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {repo.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Branch selector */}
            {repoCandidate && (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">
                  Branch
                </span>
                <BranchSelectorCompact
                  owner={repoCandidate.owner}
                  repo={repoCandidate.name}
                  value={branch}
                  isNewBranch={isNewBranch}
                  onChange={(b, isNew) => {
                    setBranch(b);
                    setIsNewBranch(isNew);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Advanced options */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex min-h-[44px] items-center justify-between py-1 text-sm font-medium text-muted-foreground"
          >
            Advanced
            <span className="text-xs">{showAdvanced ? "▲" : "▼"}</span>
          </button>

          {showAdvanced && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/20 px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    Auto commit &amp; push
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Automatically commit and push changes
                  </span>
                </div>
                <Switch
                  checked={effectiveAutoCommitPush}
                  onCheckedChange={setAutoCommitPush}
                  disabled={!repoMode}
                  aria-label="Auto commit and push"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    Auto create PR
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Open a pull request when done
                  </span>
                </div>
                <Switch
                  checked={effectiveAutoCreatePr}
                  onCheckedChange={setAutoCreatePr}
                  disabled={!repoMode || !effectiveAutoCommitPush}
                  aria-label="Auto create pull request"
                />
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        <Button
          className="min-h-[44px] w-full text-base"
          size="lg"
          onClick={handleSubmit}
          disabled={
            isSubmitting ||
            // In repo mode, require a fully-resolved repo selection (a repo AND
            // a branch mode) — otherwise submit would silently fall back to a
            // repo-less plain-chat session.
            (repoMode && !repoSelection)
          }
          aria-label="Create session"
        >
          {isSubmitting ? "Creating…" : "Start session"}
        </Button>
      </div>
    </div>
  );
}
