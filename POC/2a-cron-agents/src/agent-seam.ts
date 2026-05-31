/**
 * The `runAgent` seam.
 *
 * This is the single integration point between the cron runner and the
 * agent. Its input shape is a strict subset of the real
 * `runAgentWorkflow(options)` in `apps/web/app/workflows/chat.ts`:
 *
 *   runAgentWorkflow({ messages, chatId, sessionId, userId, requestUrl,
 *                      requestId, authSession, maxSteps, ... })
 *
 * In production this seam is implemented by calling
 *   start(runAgentWorkflow, [options])
 * (the durable Workflow dispatch used by apps/web/app/api/chat/route.ts),
 * which provisions the sandbox, runs the prompt, streams/persists the
 * assistant message, and optionally auto-commits + opens a PR.
 *
 * For the POC eval we inject a deterministic FAKE implementation so the
 * scheduling/dispatch/idempotency logic can be proven end-to-end without the
 * cloud runtime. The fake writes a real assistant chat-message row (and can
 * report a PR url), exactly where the real workflow's persistAssistantMessage
 * + auto-PR steps land their output.
 */

export type AgentMessage = {
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
};

/** Subset of `runAgentWorkflow` Options that the cron path supplies. */
export type RunAgentOptions = {
  messages: AgentMessage[];
  chatId: string;
  sessionId: string;
  userId: string;
  repoOwner: string;
  repoName: string;
  branch: string | null;
  /** Mirrors the workflow's request correlation id. */
  requestId?: string;
  maxSteps?: number;
};

export type RunAgentResult = {
  /** The chat the assistant message landed in (for scheduled_job_runs.resultChatId). */
  chatId: string;
  /** Set when outputMode produced a PR (for scheduled_job_runs.prUrl). */
  prUrl?: string;
};

/** The seam type. Production binds this to the durable workflow dispatch. */
export type RunAgent = (options: RunAgentOptions) => Promise<RunAgentResult>;
