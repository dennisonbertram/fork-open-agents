"use client";

import { ServerCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import type {
  SetupManagedRuntimeProfileInput,
  SetupManagedRuntimeProfileOutput,
} from "@open-agents/agent";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readApiError } from "@/lib/api/read-api-error";
import { ToolLayout } from "../tool-layout";

type ManagedRuntimeProfileBuilderRendererProps =
  ToolRendererProps<"tool-setup_managed_runtime_profile"> & {
    sessionId?: string;
    chatId?: string;
    onSubmitOutput?: (output: SetupManagedRuntimeProfileOutput) => void;
  };

type ProfileDraftSnapshot = {
  id: string;
  status: string;
  testResults?: CommandEvidence[];
  testFailureMessage?: string | null;
  testedAt?: string | null;
  testScope?: "verify" | "setup_and_verify" | null;
  forceApproved?: boolean;
};

/**
 * Structured test-route error surface (#814): `{ errorKind, failureMessage,
 * failedCommandLabel?, nextAction? }` returned by the draft test route
 * instead of a generic error string.
 */
type StructuredTestError = {
  errorKind: string;
  failureMessage: string;
  failedCommandLabel?: string;
  nextAction?: string;
};

type CommandEvidence = {
  commandId: string;
  label: string;
  status: "running" | "passed" | "failed" | "skipped";
  required?: boolean;
  exitCode?: number | null;
  durationMs?: number;
  summary?: string;
  startedAt: string;
  finishedAt?: string;
};

export function ManagedRuntimeProfileBuilderRenderer({
  part,
  state,
  sessionId,
  chatId,
  onSubmitOutput,
}: ManagedRuntimeProfileBuilderRendererProps) {
  const input = part.input;
  const output = part.state === "output-available" ? part.output : undefined;
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [persistedDraft, setPersistedDraft] =
    useState<ProfileDraftSnapshot | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [draftTestMode, setDraftTestMode] = useState<
    "verify" | "setup_and_verify" | null
  >(null);
  const [testError, setTestError] = useState<StructuredTestError | null>(null);
  const profileInput = isProfileInput(input) ? input : null;
  const draft = input?.draft;
  const repoSignals = input?.repoSignals ?? [];
  const setupCommands = (draft?.setupCommands ?? []).filter(isCommandDraft);
  const verificationCommands = (draft?.verificationCommands ?? []).filter(
    isCommandDraft,
  );
  const questionsForUser = (input?.questionsForUser ?? []).filter(
    (question): question is string => typeof question === "string",
  );
  const expectedTools = draft?.expectedTools ?? [];
  const defaultPorts = draft?.defaultPorts ?? [];

  const isWaitingForReview = part.state === "input-available";
  const canPersistDraft = Boolean(sessionId && chatId && profileInput);
  const commandCount = setupCommands.length + verificationCommands.length;
  const reviewWarning = getProfileApprovalWarning(persistedDraft);
  const summary = getSummary({
    isInputStreaming: part.state === "input-streaming",
    draftTestMode,
    outputDecision: output?.decision,
    persistenceError,
    draftStatus: persistedDraft?.status,
    isWaitingForReview,
    hasPersistedDraft: Boolean(persistedDraft),
  });

  const inputKey = useMemo(
    () => (profileInput ? JSON.stringify(profileInput) : ""),
    [profileInput],
  );

  useEffect(() => {
    if (
      !sessionId ||
      !chatId ||
      !profileInput ||
      part.state !== "input-available"
    ) {
      return;
    }

    const abortController = new AbortController();

    async function persistDraft(profileInput: SetupManagedRuntimeProfileInput) {
      setPersistenceError(null);
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/managed-runtime/profile-drafts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              toolCallId: part.toolCallId,
              input: profileInput,
            }),
            signal: abortController.signal,
          },
        );
        const body = (await response.json().catch(() => null)) as {
          draft?: ProfileDraftSnapshot;
          error?: string;
        } | null;
        if (!response.ok || !body?.draft) {
          throw new Error(
            readApiError(body, "Failed to save profile draft").message,
          );
        }
        setPersistedDraft(body.draft);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        setPersistenceError(
          error instanceof Error ? error.message : "Failed to save draft",
        );
      }
    }

    void persistDraft(profileInput);

    return () => abortController.abort();
  }, [chatId, inputKey, part.state, part.toolCallId, profileInput, sessionId]);

  const submitOutput = useCallback(
    async (decision: SetupManagedRuntimeProfileOutput) => {
      setIsSubmittingDecision(true);
      setPersistenceError(null);
      try {
        if (sessionId && persistedDraft) {
          const forceApproved =
            decision.decision === "approved" &&
            Boolean(getProfileApprovalWarning(persistedDraft));
          const response = await fetch(
            `/api/sessions/${sessionId}/managed-runtime/profile-drafts/${persistedDraft.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ output: decision, forceApproved }),
            },
          );
          const body = (await response.json().catch(() => null)) as {
            draft?: ProfileDraftSnapshot;
            savedProfileId?: string;
            appliedToSessionId?: string;
            error?: string;
          } | null;
          if (!response.ok || !body?.draft) {
            throw new Error(
              readApiError(body, "Failed to update profile draft decision")
                .message,
            );
          }
          setPersistedDraft(body.draft);
          if (decision.decision === "approved") {
            onSubmitOutput?.({
              ...decision,
              savedProfileId: body.savedProfileId,
              appliedToSessionId: body.appliedToSessionId,
            });
            return;
          }
        }
        onSubmitOutput?.(decision);
      } catch (error) {
        setPersistenceError(
          error instanceof Error
            ? error.message
            : "Failed to update profile draft",
        );
      } finally {
        setIsSubmittingDecision(false);
      }
    },
    [onSubmitOutput, persistedDraft, sessionId],
  );

  const testDraft = useCallback(
    async (mode: "verify" | "setup_and_verify") => {
      if (!sessionId || !persistedDraft) {
        return;
      }

      setDraftTestMode(mode);
      setPersistenceError(null);
      setTestError(null);
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/managed-runtime/profile-drafts/${persistedDraft.id}/test`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode }),
          },
        );
        const body = (await response
          .json()
          .catch(() => null)) as DraftTestResponseBody | null;
        const outcome = resolveDraftTestOutcome({
          responseOk: response.ok,
          body,
        });
        if (!outcome.ok) {
          throw new Error(outcome.message);
        }
        setPersistedDraft(outcome.draft);
        setTestError(outcome.testError);
      } catch (error) {
        setPersistenceError(
          error instanceof Error ? error.message : "Failed to test draft",
        );
      } finally {
        setDraftTestMode(null);
      }
    },
    [persistedDraft, sessionId],
  );

  const expandedContent = draft ? (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="font-medium text-sm">{draft.displayName}</p>
        <p className="text-muted-foreground text-sm">{draft.description}</p>
        {persistedDraft ? (
          <p className="text-muted-foreground text-xs">
            Draft saved: {persistedDraft.id}
          </p>
        ) : canPersistDraft ? (
          <p className="text-muted-foreground text-xs">Saving draft...</p>
        ) : null}
        {persistenceError ? (
          <p className="text-destructive text-xs">{persistenceError}</p>
        ) : null}
      </div>

      {repoSignals.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-xs">Repo signals</p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground text-xs">
            {repoSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {questionsForUser.length > 0 ? (
        <QuestionList questions={questionsForUser} />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <CommandList commands={setupCommands} title="Setup commands" />
        <CommandList
          commands={verificationCommands}
          title="Verification commands"
        />
      </div>

      <div className="flex flex-wrap gap-2 text-muted-foreground text-xs">
        {expectedTools.length > 0 ? (
          <span>Tools: {expectedTools.join(", ")}</span>
        ) : null}
        {defaultPorts.length > 0 ? (
          <span>Ports: {defaultPorts.join(", ")}</span>
        ) : null}
      </div>

      {persistedDraft?.testResults && persistedDraft.testResults.length > 0 ? (
        <TestEvidence draft={persistedDraft} />
      ) : persistedDraft?.status === "testing" || draftTestMode ? (
        <p className="text-muted-foreground text-xs">
          {draftTestMode === "setup_and_verify"
            ? "Running setup commands, then testing verification commands against the active workspace..."
            : "Testing verification commands against the active workspace..."}
        </p>
      ) : null}

      {formatManagedRuntimeTestError(testError ?? undefined) ? (
        <p className="whitespace-pre-line rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs">
          {formatManagedRuntimeTestError(testError ?? undefined)}
        </p>
      ) : null}

      {getForceApprovedLabel(persistedDraft) ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {getForceApprovedLabel(persistedDraft)}
        </p>
      ) : null}

      {isWaitingForReview && onSubmitOutput ? (
        <div className="space-y-2 border-t pt-3">
          {reviewWarning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              {reviewWarning}
            </p>
          ) : null}
          <Textarea
            aria-label="Managed runtime profile revision instructions"
            className="min-h-16 text-sm"
            onChange={(event) =>
              setRevisionInstructions(event.currentTarget.value)
            }
            placeholder={getRevisionPlaceholder(questionsForUser)}
            value={revisionInstructions}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void testDraft("verify")}
              disabled={
                Boolean(draftTestMode) ||
                isSubmittingDecision ||
                (canPersistDraft && !persistedDraft)
              }
            >
              {draftTestMode === "verify" ? "Testing..." : "Test draft"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void testDraft("setup_and_verify")}
              disabled={
                Boolean(draftTestMode) ||
                isSubmittingDecision ||
                (canPersistDraft && !persistedDraft)
              }
            >
              {draftTestMode === "setup_and_verify"
                ? "Running setup..."
                : "Run setup + test"}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void submitOutput({
                  decision: "approved",
                  notes: revisionInstructions.trim() || undefined,
                })
              }
              disabled={
                Boolean(draftTestMode) ||
                isSubmittingDecision ||
                (canPersistDraft && !persistedDraft)
              }
            >
              {getApproveButtonLabel(persistedDraft)}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void submitOutput({
                  decision: "revise",
                  instructions: buildManagedRuntimeProfileRevisionInstructions({
                    userInstructions: revisionInstructions,
                    draft: persistedDraft,
                  }),
                })
              }
              disabled={
                Boolean(draftTestMode) ||
                isSubmittingDecision ||
                (canPersistDraft && !persistedDraft)
              }
            >
              Request changes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void submitOutput({
                  decision: "discarded",
                  reason: revisionInstructions.trim() || undefined,
                })
              }
              disabled={
                Boolean(draftTestMode) ||
                isSubmittingDecision ||
                (canPersistDraft && !persistedDraft)
              }
            >
              Discard
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  ) : undefined;

  return (
    <ToolLayout
      name="Runtime profile"
      summary={summary}
      meta={commandCount > 0 ? `${commandCount} commands` : undefined}
      state={isWaitingForReview ? { ...state, interrupted: false } : state}
      icon={<ServerCog className="h-3.5 w-3.5" />}
      expandedContent={expandedContent}
      defaultExpanded={isWaitingForReview}
    />
  );
}

type CommandDraft = {
  id: string;
  label: string;
  description: string;
  command: string;
  required?: boolean;
};

function isCommandDraft(value: unknown): value is CommandDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const command = value as Partial<Record<keyof CommandDraft, unknown>>;
  return (
    typeof command.id === "string" &&
    typeof command.label === "string" &&
    typeof command.description === "string" &&
    typeof command.command === "string"
  );
}

function isProfileInput(
  value: unknown,
): value is SetupManagedRuntimeProfileInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const input = value as Partial<SetupManagedRuntimeProfileInput>;
  return (
    typeof input.goal === "string" &&
    Array.isArray(input.repoSignals) &&
    Boolean(input.draft) &&
    typeof input.draft?.displayName === "string" &&
    typeof input.draft.description === "string" &&
    Array.isArray(input.draft.setupCommands) &&
    Array.isArray(input.draft.verificationCommands) &&
    Array.isArray(input.draft.expectedTools) &&
    Array.isArray(input.draft.optionalTools) &&
    Array.isArray(input.draft.defaultPorts) &&
    Array.isArray(input.questionsForUser)
  );
}

function getSummary(params: {
  isInputStreaming: boolean;
  draftTestMode: "verify" | "setup_and_verify" | null;
  outputDecision?: SetupManagedRuntimeProfileOutput["decision"];
  persistenceError: string | null;
  draftStatus?: string;
  isWaitingForReview: boolean;
  hasPersistedDraft: boolean;
}): string {
  if (params.isInputStreaming) {
    return "Drafting profile";
  }
  if (params.draftTestMode === "setup_and_verify") {
    return "Running setup and test";
  }
  if (params.draftTestMode === "verify") {
    return "Testing draft";
  }
  if (params.outputDecision === "approved") {
    return "Approved";
  }
  if (params.persistenceError) {
    return "Draft persistence failed";
  }
  if (params.outputDecision === "revise") {
    return "Revision requested";
  }
  if (params.outputDecision === "discarded") {
    return "Discarded";
  }
  if (params.draftStatus === "needs_changes") {
    return "Test needs changes";
  }
  if (params.draftStatus === "tested") {
    return "Tested";
  }
  if (params.isWaitingForReview) {
    return params.hasPersistedDraft
      ? "Draft saved for review"
      : "Waiting for review";
  }
  return "Profile draft";
}

export function buildManagedRuntimeProfileRevisionInstructions(params: {
  userInstructions: string;
  draft: ProfileDraftSnapshot | null;
}): string {
  const instructions =
    params.userInstructions.trim() ||
    "Revise the managed runtime profile based on the repo requirements.";
  const evidence = summarizeProfileTestEvidence(params.draft);

  return evidence
    ? `${instructions}\n\nLatest profile test evidence:\n${evidence}`
    : instructions;
}

export function getProfileApprovalWarning(
  draft: ProfileDraftSnapshot | null,
): string | null {
  if (!draft) {
    return null;
  }

  if (draft.status === "needs_changes") {
    return "The latest profile test failed. You can approve anyway, but requesting changes will send the failure evidence back to the agent.";
  }

  if (!draft.testedAt && draft.status !== "tested") {
    return "This profile has not been tested against the active workspace yet.";
  }

  return null;
}

export function getApproveButtonLabel(draft: ProfileDraftSnapshot | null) {
  return getProfileApprovalWarning(draft) ? "Approve anyway" : "Approve draft";
}

/**
 * Labels a draft that was approved over a failed/absent test (Decision D6 /
 * MR-1's `force_approved` column). Returns null when the draft was not
 * force-approved so the renderer shows no badge for a normal approval.
 */
export function getForceApprovedLabel(
  draft: ProfileDraftSnapshot | null,
): string | null {
  return draft?.forceApproved ? "Approved without passing test" : null;
}

/**
 * Formats the structured test-route error `{ errorKind, failureMessage,
 * failedCommandLabel?, nextAction? }` (#814) into the failed command label,
 * the first actionable failure line, and the next step — instead of a
 * generic error string.
 */
export function formatManagedRuntimeTestError(
  testError: StructuredTestError | undefined,
): string | null {
  if (!testError) {
    return null;
  }

  const lines = [
    testError.failedCommandLabel
      ? `${testError.failedCommandLabel}: ${testError.failureMessage}`
      : testError.failureMessage,
  ];
  if (testError.nextAction) {
    lines.push(testError.nextAction);
  }

  return lines.join("\n");
}

export function getRevisionPlaceholder(questions: string[]): string {
  return questions.length > 0
    ? "Answer the questions or describe what the agent should change"
    : "Optional revision notes";
}

type DraftTestResponseBody = {
  draft?: ProfileDraftSnapshot & Partial<StructuredTestError>;
  error?: string;
};

type DraftTestOutcome =
  | {
      ok: true;
      draft: ProfileDraftSnapshot & Partial<StructuredTestError>;
      testError: StructuredTestError | null;
    }
  | { ok: false; message: string };

/**
 * Resolves the draft test route's response into either a structured success
 * outcome (draft snapshot + error, when present) or a thrown-error-equivalent
 * message — without throwing before the structured `draft` fields can be
 * read (Codex #833 P2: the route returns HTTP 500 with
 * `{ draft: { errorKind, failureMessage, nextAction, ... } }` on its
 * catch-path exec error; a 500 status alone must not discard that draft).
 */
export function resolveDraftTestOutcome(params: {
  responseOk: boolean;
  body: DraftTestResponseBody | null;
}): DraftTestOutcome {
  const { body } = params;
  if (!body?.draft) {
    return {
      ok: false,
      message: readApiError(body, "Failed to test profile draft").message,
    };
  }

  const testError =
    body.draft.errorKind && body.draft.failureMessage
      ? {
          errorKind: body.draft.errorKind,
          failureMessage: body.draft.failureMessage,
          failedCommandLabel: body.draft.failedCommandLabel,
          nextAction: body.draft.nextAction,
        }
      : null;

  return { ok: true, draft: body.draft, testError };
}

function summarizeProfileTestEvidence(
  draft: ProfileDraftSnapshot | null,
): string | null {
  const results = draft?.testResults ?? [];
  if (results.length === 0) {
    return draft?.testFailureMessage
      ? `Overall failure: ${draft.testFailureMessage}`
      : null;
  }

  const failedResults = results.filter((result) => result.status !== "passed");
  const relevantResults = failedResults.length > 0 ? failedResults : results;
  const lines = relevantResults.slice(0, 6).map((result) => {
    const requiredLabel = result.required === false ? "optional" : "required";
    const exitCode =
      typeof result.exitCode === "number" ? `, exit ${result.exitCode}` : "";
    const summary = result.summary ? `: ${result.summary.slice(0, 600)}` : "";
    return `- ${result.label} (${requiredLabel}) ${result.status}${exitCode}${summary}`;
  });

  if (draft?.testFailureMessage) {
    lines.unshift(`Overall failure: ${draft.testFailureMessage}`);
  }

  return lines.join("\n");
}

function CommandList({
  commands,
  title,
}: {
  commands: CommandDraft[];
  title: string;
}) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-xs">{title}</p>
      <div className="space-y-2">
        {commands.map((command) => (
          <div key={command.id} className="space-y-1 rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-xs">{command.label}</p>
              <span className="text-muted-foreground text-xs">
                {command.required === false ? "Optional" : "Required"}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {command.description}
            </p>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              {command.command}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestionList({ questions }: { questions: string[] }) {
  return (
    <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
      <p className="font-medium text-xs">Questions for review</p>
      <ul className="list-disc space-y-1 pl-4 text-xs">
        {questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ul>
    </div>
  );
}

function TestEvidence({ draft }: { draft: ProfileDraftSnapshot }) {
  const results = draft.testResults ?? [];

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-xs">Latest test</p>
        <span className="text-muted-foreground text-xs">
          {draft.status === "needs_changes"
            ? "Needs changes"
            : draft.status === "tested"
              ? "Tested"
              : draft.status}
          {draft.testedAt ? ` at ${formatTestTime(draft.testedAt)}` : ""}
        </span>
      </div>
      {draft.testFailureMessage ? (
        <p className="text-destructive text-xs">{draft.testFailureMessage}</p>
      ) : null}
      <div className="space-y-2">
        {results.map((result) => (
          <div
            key={result.commandId}
            className="space-y-1 rounded bg-muted p-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-xs">{result.label}</p>
              <span className={testStatusClassName(result.status)}>
                {result.status}
                {typeof result.exitCode === "number"
                  ? ` (${result.exitCode})`
                  : ""}
                {typeof result.durationMs === "number"
                  ? ` · ${formatDuration(result.durationMs)}`
                  : ""}
              </span>
            </div>
            {result.summary ? (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">
                {result.summary}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function testStatusClassName(status: CommandEvidence["status"]): string {
  if (status === "passed") {
    return "text-emerald-600 text-xs";
  }
  if (status === "failed") {
    return "text-destructive text-xs";
  }
  return "text-muted-foreground text-xs";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatTestTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
