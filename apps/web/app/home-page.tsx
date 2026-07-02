"use client";

import { History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SignedOutHero } from "@/components/auth/signed-out-hero";
import { HomeSkeleton } from "@/components/home-skeleton";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { SessionDrawer } from "@/components/session-drawer";
import { SessionStarter } from "@/components/session-starter";
import { UserAvatarDropdown } from "@/components/user-avatar-dropdown";
import { useSession } from "@/hooks/use-session";
import { useSessions } from "@/hooks/use-sessions";
import { toCreateSessionErrorInfo } from "@/lib/sessions/create-session-error";
import type { VercelProjectSelection } from "@/lib/vercel/types";

interface HomePageProps {
  hasSessionCookie: boolean;
  lastRepo: { owner: string; repo: string } | null;
}

export function HomePage({ hasSessionCookie, lastRepo }: HomePageProps) {
  const router = useRouter();
  const { loading: sessionLoading, isAuthenticated } = useSession();
  const { sessions, loading, createSession } = useSessions({
    enabled: isAuthenticated,
  });

  const activeSessionCount = sessions.filter(
    (s) => s.status !== "archived",
  ).length;
  const [isCreating, setIsCreating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleCreateSession = async (input: {
    title?: string;
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    fullClone: boolean;
    sandboxType: SandboxType;
    autoCommitPush: boolean;
    autoCreatePr: boolean;
    vercelProject?: VercelProjectSelection | null;
  }) => {
    setIsCreating(true);
    try {
      const { session: createdSession, chat } = await createSession({
        title: input.title,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        branch: input.branch,
        cloneUrl: input.cloneUrl,
        isNewBranch: input.isNewBranch,
        fullClone: input.fullClone,
        sandboxType: input.sandboxType,
        autoCommitPush: input.autoCommitPush,
        autoCreatePr: input.autoCreatePr,
        vercelProject: input.vercelProject,
      });

      router.push(`/sessions/${createdSession.id}/chats/${chat.id}`);
    } catch (error) {
      // Ownership decision (#784): the home page has no persistent form
      // surface, so it toasts the mapped failure exactly once (the hook no
      // longer toasts — see use-sessions.ts).
      const info = toCreateSessionErrorInfo(error);
      toast.error(info.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSessionClick = (sessionId: string) => {
    router.push(`/sessions/${sessionId}`);
  };

  if (sessionLoading && hasSessionCookie) {
    return <HomeSkeleton lastRepo={lastRepo} />;
  }

  if (!isAuthenticated) {
    return <SignedOutHero />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 sm:justify-self-start">
          <span className="text-lg font-semibold">Open Agents</span>
        </div>
        <div className="flex items-center gap-2 sm:justify-self-end">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {loading ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-transparent">
                0
              </span>
            ) : activeSessionCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {activeSessionCount}
              </span>
            ) : null}
            <History className="h-4 w-4" />
            <span>Sessions</span>
          </button>
          <UserAvatarDropdown />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pt-8 sm:pt-16">
        <h1 className="mb-8 text-3xl font-light text-foreground">
          What should we ship next?
        </h1>

        <SessionStarter
          onSubmit={handleCreateSession}
          isLoading={isCreating}
          lastRepo={lastRepo}
        />
      </main>

      <SessionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        sessions={sessions}
        loading={loading}
        onSessionClick={handleSessionClick}
      />
    </div>
  );
}
