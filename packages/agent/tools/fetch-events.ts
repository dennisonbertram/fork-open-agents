export type FetchEventContext = {
  sessionId?: string;
  chatId?: string;
  runId?: string;
};

export type FetchHostResolvedEvent = {
  service: "agent-fetch-tool";
  event: "fetch-host-resolved";
  level: "info";
  sessionId: string | undefined;
  chatId: string | undefined;
  runId: string | undefined;
  host: string;
  resolvedIps: string[];
  outcome: "allowed";
};

export type FetchPrivateTargetBlockedEvent = {
  service: "agent-fetch-tool";
  event: "fetch-private-target-blocked";
  level: "warn";
  sessionId: string | undefined;
  chatId: string | undefined;
  runId: string | undefined;
  host: string;
  errorKind:
    | "private_target_blocked"
    | "dns-resolution-failed"
    | "empty_resolution";
};

export type FetchEvent =
  | FetchHostResolvedEvent
  | FetchPrivateTargetBlockedEvent;

export type FetchEventRecorder = (event: FetchEvent) => void;

let recorder: FetchEventRecorder | null = null;

/**
 * Test/injection hook for structured fetch events. Production default logs a
 * single-line JSON line via console.info/console.warn.
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

function emit(event: FetchEvent, level: "info" | "warn"): void {
  if (recorder) {
    recorder(event);
    return;
  }
  const line = JSON.stringify(event);
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function emitFetchHostResolved(params: {
  host: string;
  resolvedIps: string[];
  experimental_context: unknown;
}): void {
  const ids = fetchEventContext(params.experimental_context);
  emit(
    {
      service: "agent-fetch-tool",
      event: "fetch-host-resolved",
      level: "info",
      sessionId: ids.sessionId,
      chatId: ids.chatId,
      runId: ids.runId,
      host: params.host,
      resolvedIps: params.resolvedIps,
      outcome: "allowed",
    },
    "info",
  );
}

export function emitFetchPrivateTargetBlocked(params: {
  host: string;
  errorKind: FetchPrivateTargetBlockedEvent["errorKind"];
  experimental_context: unknown;
}): void {
  const ids = fetchEventContext(params.experimental_context);
  emit(
    {
      service: "agent-fetch-tool",
      event: "fetch-private-target-blocked",
      level: "warn",
      sessionId: ids.sessionId,
      chatId: ids.chatId,
      runId: ids.runId,
      host: params.host,
      errorKind: params.errorKind,
    },
    "warn",
  );
}
