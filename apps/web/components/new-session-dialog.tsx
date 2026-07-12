"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { SessionStarter } from "@/components/session-starter";
import type { SessionRuntimeMode } from "@/components/session-starter-helpers";
import {
  toCreateSessionErrorInfo,
  type CreateSessionErrorInfo,
} from "@/lib/sessions/create-session-error";
import type { VercelProjectSelection } from "@/lib/vercel/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CreateSessionInput = {
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch: boolean;
  sandboxType: SandboxType;
  runtimeMode: SessionRuntimeMode;
  managedRuntimeProfileId?: string;
  autoCommitPush: boolean;
  autoCreatePr: boolean;
  vercelProject?: VercelProjectSelection | null;
};

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastRepo: { owner: string; repo: string } | null;
  initialRepository?: { owner: string; repo: string } | null;
  createSession: (input: CreateSessionInput) => Promise<{
    session: { id: string };
    chat: { id: string };
  }>;
  /**
   * Pre-seeds the create-session error state. Used only in tests to verify
   * the role="alert" inline error rendering without a live DOM re-render
   * cycle (mirrors AgentEditForm's `_testSaveError` pattern).
   */
  _testCreateSessionError?: CreateSessionErrorInfo;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  lastRepo,
  initialRepository,
  createSession,
  _testCreateSessionError,
}: NewSessionDialogProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [createSessionError, setCreateSessionError] =
    useState<CreateSessionErrorInfo | null>(_testCreateSessionError ?? null);

  const handleCreateSession = async (input: CreateSessionInput) => {
    setIsCreating(true);
    setCreateSessionError(null);
    try {
      const { session: createdSession, chat } = await createSession(input);
      onOpenChange(false);
      router.push(`/sessions/${createdSession.id}/chats/${chat.id}`);
    } catch (error) {
      // Ownership decision (#784): the New Session dialog has a persistent
      // form surface, so it renders the failure inline instead of toasting
      // (the hook no longer toasts — see use-sessions.ts).
      setCreateSessionError(toCreateSessionErrorInfo(error));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-none gap-0 overflow-hidden border-none bg-transparent p-0 shadow-none [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Start a standalone or repository session.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 rounded-2xl sm:rounded-[28px] border border-border/60 bg-card shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <SessionStarter
            onSubmit={handleCreateSession}
            isLoading={isCreating}
            lastRepo={lastRepo}
            initialRepository={initialRepository}
          />
          {createSessionError ? (
            <div
              role="alert"
              className="flex flex-col gap-1 border-t border-border/60 px-4 py-3 text-sm text-destructive sm:px-6"
            >
              <span>{createSessionError.message}</span>
              {createSessionError.actionUrl ? (
                <Link
                  href={createSessionError.actionUrl}
                  className="w-fit font-medium underline underline-offset-2"
                >
                  {createSessionError.actionLabel ?? "Learn more"}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
