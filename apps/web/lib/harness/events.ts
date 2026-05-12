import type {
  VerifiedBuildGoNoGo,
  VerifiedBuildPlanApprovalState,
} from "./types";

export type HarnessSseEvent = {
  id: string;
  event: string;
  data: unknown;
  retry?: number;
};

export type VerifiedBuildEventReduction = {
  status?: string;
  planApprovalState?: VerifiedBuildPlanApprovalState;
  pendingApprovalKind?: string | null;
  finalReportArtifactId?: string | null;
  goNoGo?: VerifiedBuildGoNoGo;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getGoNoGo(value: unknown): VerifiedBuildGoNoGo | undefined {
  return value === "go" || value === "no_go" || value === "unknown"
    ? value
    : undefined;
}

export function reduceHarnessEvent(
  eventName: string,
  payload: unknown,
): VerifiedBuildEventReduction {
  const body = isRecord(payload) ? payload : {};
  const status = getString(body.status);

  if (eventName === "coordinator.plan" || eventName.includes("approval")) {
    const approvalKind = getString(body.approval_kind) ?? getString(body.kind);
    const approvalRecorded =
      eventName === "approval.recorded" ||
      eventName.includes("approved") ||
      status === "approved" ||
      status === "recorded";
    const approvalRejected =
      eventName.includes("rejected") || status === "rejected";

    return {
      ...(status ? { status } : {}),
      planApprovalState: approvalRecorded
        ? "approved"
        : approvalRejected
          ? "rejected"
          : approvalKind
            ? "pending"
            : undefined,
      pendingApprovalKind:
        approvalRecorded || approvalRejected ? null : (approvalKind ?? null),
    };
  }

  if (eventName === "run.completed") {
    return {
      status: status ?? "completed",
      finalReportArtifactId:
        getString(body.final_report_artifact_id) ??
        getString(body.finalReportArtifactId) ??
        null,
      goNoGo: getGoNoGo(body.go_no_go) ?? getGoNoGo(body.goNoGo) ?? "unknown",
    };
  }

  if (eventName === "run.failed") {
    return { status: status ?? "failed", goNoGo: "no_go" };
  }

  if (eventName === "run.cancelled" || eventName === "run.canceled") {
    return { status: status ?? "cancelled" };
  }

  if (eventName === "open_agents.run.accepted") {
    return { status: status ?? "accepted" };
  }

  if (eventName.startsWith("gate.")) {
    return {
      status: status ?? (eventName.endsWith("completed") ? "gated" : "running"),
    };
  }

  if (eventName === "ready" || eventName === "workcell.created") {
    return { status: status ?? "running" };
  }

  return status ? { status } : {};
}

export function parseSseBlock(block: string): HarnessSseEvent | null {
  const lines = block.split(/\r?\n/);
  let id = "";
  let event = "message";
  const dataLines: string[] = [];
  let retry: number | undefined;

  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "id") {
      id = value;
    } else if (field === "event") {
      event = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    } else if (field === "retry") {
      const parsedRetry = Number(value);
      if (Number.isInteger(parsedRetry) && parsedRetry >= 0) {
        retry = parsedRetry;
      }
    }
  }

  if (!id && dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join("\n");
  let data: unknown = rawData;
  if (rawData.length > 0) {
    try {
      data = JSON.parse(rawData) as unknown;
    } catch {
      data = { malformed: true, raw: rawData };
    }
  }

  return {
    id: id || crypto.randomUUID(),
    event,
    data,
    ...(retry !== undefined ? { retry } : {}),
  };
}

export function extractSseBlocks(buffer: string): {
  blocks: string[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return { blocks: parts, rest };
}
