import { isToolUIPart } from "ai";
import {
  detectRepetition,
  hashTurnToolFailures,
} from "@/lib/background-agents/action-repetition";
import type { WebAgentUIMessage } from "@/lib/types";

/**
 * Circuit breaker for a tool that keeps failing the same way (#1143, #1142).
 *
 * The reported incident: a chat turn spent 9 steps and 69.5s re-running a
 * `task` call that returned the byte-identical error every time, and stopped
 * only when it ran out of steps. In `managed_runtime` mode `task` is the
 * coordinator's *only* execution path, so a dead `task` leaves it nowhere to go
 * but retry — which is why the same guard covers both issues.
 *
 * The detection itself is `detectRepetition` from the background-agent stack
 * (#915), which already solves this shape and gives cycle detection for free.
 * Only the signature is new: that module keys on tool name + input, and this
 * needs tool name + error text, because a retrying coordinator varies its
 * instructions on every attempt while the failure does not.
 */

/**
 * First call, one retry, one confirmation. Low enough to preserve the rest of
 * the step budget, high enough that a single transient failure still gets a
 * second chance.
 *
 * A genuinely transient fault producing the *same* error three times running
 * will trip this. That is the accepted trade-off: the cost is one turn the user
 * re-sends, against the 70-second silent burn this replaces. The terminal
 * message states the retry count so re-sending is an informed choice.
 */
export const REPEATED_TOOL_FAILURE_THRESHOLD = 3;

/** Bound on the retained signature history — only the trailing run matters. */
const SIGNATURE_HISTORY_CAP = 12;

export type RepeatedToolFailureState = {
  signatures: string[];
  seenToolCallIds: Set<string>;
};

export type RepeatedToolFailureStop = {
  toolName: string;
  errorText: string;
  failureCount: number;
  reason: "repeat" | "cycle";
};

export function createRepeatedToolFailureState(): RepeatedToolFailureState {
  return { signatures: [], seenToolCallIds: new Set() };
}

type FailedToolCall = {
  toolName: string;
  errorText: string;
};

/**
 * Extracts the tool failures that are *new in this step*.
 *
 * The assistant message accumulates across steps, so the same failed part is
 * present on every later step's message. Counting parts directly would turn one
 * failure into a false streak. Tracking which tool-call ids have already been
 * counted keeps each real call counted exactly once.
 */
function newlyFailedToolCalls(
  parts: WebAgentUIMessage["parts"],
  seenToolCallIds: Set<string>,
): FailedToolCall[] {
  const failures: FailedToolCall[] = [];

  for (const part of parts) {
    if (!isToolUIPart(part) || part.state !== "output-error") {
      continue;
    }
    const toolCallId = part.toolCallId;
    if (typeof toolCallId !== "string" || seenToolCallIds.has(toolCallId)) {
      continue;
    }
    seenToolCallIds.add(toolCallId);
    failures.push({
      // `tool-task` -> `task`, matching how the tool is named everywhere else.
      toolName: part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : part.type,
      errorText: part.errorText ?? "",
    });
  }

  return failures;
}

/**
 * Folds one completed step into the running state and reports whether the turn
 * should stop.
 *
 * A step with no new failures resets the history — that is what keeps a tool
 * which fails once and then succeeds from ever tripping the breaker.
 */
export function observeStepForRepeatedFailure(
  state: RepeatedToolFailureState,
  parts: WebAgentUIMessage["parts"],
): RepeatedToolFailureStop | null {
  const failures = newlyFailedToolCalls(parts, state.seenToolCallIds);

  const signature = hashTurnToolFailures(failures);
  if (signature === null) {
    state.signatures.length = 0;
    return null;
  }

  state.signatures.push(signature);
  if (state.signatures.length > SIGNATURE_HISTORY_CAP) {
    state.signatures.shift();
  }

  const verdict = detectRepetition(state.signatures, {
    repeatThreshold: REPEATED_TOOL_FAILURE_THRESHOLD,
  });
  if (!(verdict.flagged && verdict.reason)) {
    return null;
  }

  const first = failures[0];
  return {
    toolName: first?.toolName ?? "unknown",
    errorText: first?.errorText ?? "",
    failureCount: verdict.repeatCount,
    reason: verdict.reason,
  };
}

/**
 * The message the user reads instead of a truncated turn with no explanation.
 *
 * In `managed_runtime` the coordinator has no file or shell tools by design, so
 * a dead `task` is not something it could route around. Saying so is the
 * difference between "the agent gave up" and "this tool is broken" (#1142).
 */
export function buildRepeatedToolFailureMessage(
  stop: RepeatedToolFailureStop,
  runtimeMode: "classic" | "managed_runtime" | null,
): string {
  const lines = [
    `Stopped: the \`${stop.toolName}\` tool failed ${stop.failureCount} times in a row with the same error, so retrying it again would not have helped.`,
    "",
    stop.errorText,
  ];

  if (runtimeMode === "managed_runtime" && stop.toolName === "task") {
    lines.push(
      "",
      "This session runs in managed runtime mode, where delegating to a worker is the only way the agent can reach the repository — so there was no other route to try.",
    );
  }

  return lines.join("\n");
}
