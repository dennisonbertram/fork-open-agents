"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isProviderRejectionMessage } from "@/lib/chat/provider-error";

type ProviderRejectionActionsProps = {
  chatId: string;
  sessionId: string;
  text: string;
};

type StripState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; updatedMessages: number }
  | { kind: "error"; message: string };

/**
 * Recovery controls shown under a provider-rejection message.
 *
 * The message itself names both ways out; this turns the one that needs a
 * server round-trip into a button. Switching model is already a first-class
 * control in the composer, so it stays a pointer rather than a duplicate
 * affordance here.
 */
export function ProviderRejectionActions({
  chatId,
  sessionId,
  text,
}: ProviderRejectionActionsProps) {
  const router = useRouter();
  const [state, setState] = useState<StripState>({ kind: "idle" });

  if (!isProviderRejectionMessage(text)) {
    return null;
  }

  const stripReasoning = async () => {
    setState({ kind: "working" });
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/chats/${chatId}/strip-reasoning`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setState({
          kind: "error",
          message: body?.error ?? "Could not remove the earlier thinking.",
        });
        return;
      }
      const body = (await response.json()) as { updatedMessages: number };
      setState({ kind: "done", updatedMessages: body.updatedMessages });
      router.refresh();
    } catch {
      setState({
        kind: "error",
        message: "Could not remove the earlier thinking.",
      });
    }
  };

  if (state.kind === "done") {
    return (
      <p className="mt-2 text-muted-foreground text-sm">
        {state.updatedMessages === 0
          ? "No earlier thinking left to remove — try switching the model instead."
          : `Removed earlier thinking from ${state.updatedMessages} message${
              state.updatedMessages === 1 ? "" : "s"
            }. Send your message again.`}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void stripReasoning()}
        disabled={state.kind === "working"}
        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-medium text-sm transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.kind === "working" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        Remove earlier thinking
      </button>
      <span className="text-muted-foreground text-sm">
        or switch the model back in the composer.
      </span>
      {state.kind === "error" && (
        <span className="text-destructive text-sm">{state.message}</span>
      )}
    </div>
  );
}
