export type FetchEventContext = {
  sessionId?: string;
  chatId?: string;
  runId?: string;
};

export type UnattendedMutatingFetchBlockedEvent = {
  service: "agent-fetch-tool";
  event: "unattended-mutating-fetch-blocked";
  level: "warn";
  sessionId: string | undefined;
  chatId: string | undefined;
  runId: string | undefined;
  method: string;
  host: string;
  errorKind: "unattended_write_blocked";
};

export type FetchEventRecorder = (
  event: UnattendedMutatingFetchBlockedEvent,
) => void;

let recorder: FetchEventRecorder | null = null;

/**
 * Test/injection hook for structured fetch events. Production default logs a
 * single-line JSON warn via console.warn.
 */
export function setFetchEventRecorder(next: FetchEventRecorder | null): void {
  recorder = next;
}

function fetchEventContext(experimental_context: unknown): FetchEventContext {
  if (
    typeof experimental_context !== "object" ||
    experimental_context === null
  ) {
    return {};
  }
  const ctx = experimental_context as Record<string, unknown>;
  return {
    sessionId:
      typeof ctx["sessionId"] === "string" ? ctx["sessionId"] : undefined,
    chatId: typeof ctx["chatId"] === "string" ? ctx["chatId"] : undefined,
    runId: typeof ctx["runId"] === "string" ? ctx["runId"] : undefined,
  };
}

export function emitUnattendedMutatingFetchBlocked(params: {
  method: string;
  host: string;
  experimental_context: unknown;
}): void {
  const ids = fetchEventContext(params.experimental_context);
  const event: UnattendedMutatingFetchBlockedEvent = {
    service: "agent-fetch-tool",
    event: "unattended-mutating-fetch-blocked",
    level: "warn",
    sessionId: ids.sessionId,
    chatId: ids.chatId,
    runId: ids.runId,
    method: params.method,
    host: params.host,
    errorKind: "unattended_write_blocked",
  };

  if (recorder) {
    recorder(event);
    return;
  }

  console.warn(JSON.stringify(event));
}
