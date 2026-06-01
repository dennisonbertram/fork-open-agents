export type ManagedRuntimeWorkerSnapshot = {
  id: string;
  // "message" = derived from chat message parts (fallback)
  // "durable"  = read from the managed_runtime_worker_runs DB table
  source: "message" | "durable";
  taskToolCallId: string;
  workerType: string;
  status:
    | "pending"
    | "starting"
    | "running"
    | "blocked"
    | "failed"
    | "denied"
    | "completed"
    | "interrupted";
  sandboxName: string | null;
  profileId: string | null;
  profileVersion: string | null;
  profileDisplayName: string | null;
  profileRunId: string | null;
  currentToolName: string | null;
  currentToolSummary: string | null;
  toolCallCount: number;
  summary: string | null;
  updatedAt: string | null;
};

export type ManagedRuntimeWorkerMessageLike = {
  id: string;
  parts: unknown;
  createdAt?: Date | string | null;
};

export type ManagedRuntimeDirectToolUse = {
  observed: boolean;
  count: number;
  toolTypes: string[];
  toolLabels: string[];
  warning: string | null;
};

const DIRECT_COORDINATOR_REPO_TOOLS = new Map<string, string>([
  ["tool-read", "Read"],
  ["tool-write", "Write"],
  ["tool-edit", "Edit"],
  ["tool-grep", "Grep"],
  ["tool-glob", "Glob"],
  ["tool-bash", "Bash"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getMessageParts(parts: unknown): unknown[] {
  if (Array.isArray(parts)) {
    return parts;
  }

  if (isRecord(parts) && Array.isArray(parts.parts)) {
    return parts.parts;
  }

  return [];
}

function getToolSummary(name: string | null, input: unknown): string | null {
  if (!name || !isRecord(input)) {
    return null;
  }

  switch (name) {
    case "bash":
      return getString(input.command);
    case "read":
    case "write":
    case "edit":
      return getString(input.filePath);
    case "grep":
    case "glob":
      return getString(input.pattern);
    default:
      return null;
  }
}

function formatToolName(name: string | null): string | null {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
}

function getWorkerStatus(part: Record<string, unknown>) {
  switch (part.state) {
    case "output-available":
      return part.preliminary === true ? "running" : "completed";
    case "output-error":
      return "failed";
    case "output-denied":
      return "denied";
    case "approval-requested":
      return "blocked";
    case "input-streaming":
      return "starting";
    case "input-available":
      return "running";
    default:
      return "pending";
  }
}

function getRuntime(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output)) {
    return null;
  }

  const runtime = output.runtime;
  if (!isRecord(runtime) || runtime.mode !== "managed_runtime") {
    return null;
  }

  return runtime;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" ? value : null;
}

function buildDirectToolUseSummary(params: {
  count: number;
  toolTypes: string[];
}): ManagedRuntimeDirectToolUse {
  const toolLabels = params.toolTypes.map(
    (toolType) => DIRECT_COORDINATOR_REPO_TOOLS.get(toolType) ?? toolType,
  );
  const warning =
    params.count > 0
      ? `Coordinator direct repo tool use observed: ${toolLabels.join(
          ", ",
        )}. These actions did not run through a managed worker.`
      : null;

  return {
    observed: params.count > 0,
    count: params.count,
    toolTypes: params.toolTypes,
    toolLabels,
    warning,
  };
}

export function extractManagedRuntimeWorkersFromParts(
  parts: unknown,
  options: {
    fallbackMessageId?: string;
    updatedAt?: Date | string | null;
  } = {},
): ManagedRuntimeWorkerSnapshot[] {
  const workers: ManagedRuntimeWorkerSnapshot[] = [];

  for (const part of getMessageParts(parts)) {
    if (!isRecord(part) || part.type !== "tool-task") {
      continue;
    }

    const output = isRecord(part.output) ? part.output : null;
    const runtime = getRuntime(output);
    if (!runtime) {
      continue;
    }

    const taskToolCallId =
      getString(part.toolCallId) ?? options.fallbackMessageId ?? "task";
    const input = isRecord(part.input) ? part.input : {};
    const pending = isRecord(output?.pending) ? output.pending : null;
    const pendingName = getString(pending?.name);
    const workerType =
      getString(runtime.workerType) ??
      getString(input.subagentType) ??
      "worker";
    const currentToolSummary = pending
      ? getToolSummary(pendingName, pending.input)
      : null;

    workers.push({
      id: taskToolCallId,
      source: "message",
      taskToolCallId,
      workerType,
      status: getWorkerStatus(part),
      sandboxName: getString(runtime.sandboxName),
      profileId: getString(runtime.profileId),
      profileVersion: getString(runtime.profileVersion),
      profileDisplayName: getString(runtime.profileDisplayName),
      profileRunId: getString(runtime.profileRunId),
      currentToolName: formatToolName(pendingName),
      currentToolSummary: currentToolSummary
        ? currentToolSummary.slice(0, 160)
        : null,
      toolCallCount: getNumber(output?.toolCallCount) ?? 0,
      summary: getString(input.task),
      updatedAt: toIsoString(options.updatedAt),
    });
  }

  return workers;
}

export function extractManagedRuntimeWorkersFromMessages(
  messages: ManagedRuntimeWorkerMessageLike[],
): ManagedRuntimeWorkerSnapshot[] {
  const workers = new Map<string, ManagedRuntimeWorkerSnapshot>();

  for (const message of messages) {
    for (const worker of extractManagedRuntimeWorkersFromParts(message.parts, {
      fallbackMessageId: message.id,
      updatedAt: message.createdAt,
    })) {
      if (workers.has(worker.taskToolCallId)) {
        continue;
      }

      workers.set(worker.taskToolCallId, worker);
    }
  }

  return Array.from(workers.values());
}

export function summarizeManagedRuntimeDirectToolUse(
  parts: unknown,
): ManagedRuntimeDirectToolUse {
  const toolTypes: string[] = [];
  const seenToolTypes = new Set<string>();
  let count = 0;

  for (const part of getMessageParts(parts)) {
    if (!isRecord(part) || typeof part.type !== "string") {
      continue;
    }

    if (!DIRECT_COORDINATOR_REPO_TOOLS.has(part.type)) {
      continue;
    }

    count += 1;
    if (!seenToolTypes.has(part.type)) {
      seenToolTypes.add(part.type);
      toolTypes.push(part.type);
    }
  }

  return buildDirectToolUseSummary({ count, toolTypes });
}

export function summarizeManagedRuntimeDirectToolUseFromMessages(
  messages: ManagedRuntimeWorkerMessageLike[],
): ManagedRuntimeDirectToolUse {
  const toolTypes: string[] = [];
  const seenToolTypes = new Set<string>();
  let count = 0;

  for (const message of messages) {
    const summary = summarizeManagedRuntimeDirectToolUse(message.parts);
    count += summary.count;
    for (const toolType of summary.toolTypes) {
      if (seenToolTypes.has(toolType)) {
        continue;
      }

      seenToolTypes.add(toolType);
      toolTypes.push(toolType);
    }
  }

  return buildDirectToolUseSummary({ count, toolTypes });
}
