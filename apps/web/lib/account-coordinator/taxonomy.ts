import type {
  AccountAttentionReason,
  AccountWorkItem,
  AccountWorkStatus,
} from "./types";

const ACTIVE_STATUSES = new Set<AccountWorkStatus>(["queued", "running"]);
const COMPLETED_STATUSES = new Set<AccountWorkStatus>(["completed", "skipped"]);
const ATTENTION_STATUSES = new Set<AccountWorkStatus>([
  "failed",
  "cancelled",
  "stale",
  "waiting_on_user",
  "unknown",
]);

export function getAttentionReasons(
  status: AccountWorkStatus,
): AccountAttentionReason[] {
  switch (status) {
    case "failed":
      return ["failed"];
    case "cancelled":
      return ["cancelled"];
    case "stale":
      return ["stale"];
    case "waiting_on_user":
      return ["waiting_on_user"];
    case "unknown":
      return ["unknown_status"];
    default:
      return [];
  }
}

export function withAttention(item: Omit<AccountWorkItem, "needsAttention">) {
  const attentionReasons =
    item.attentionReasons.length > 0
      ? item.attentionReasons
      : getAttentionReasons(item.status);

  return {
    ...item,
    attentionReasons,
    needsAttention:
      attentionReasons.length > 0 || ATTENTION_STATUSES.has(item.status),
  };
}

export function isRunning(item: AccountWorkItem): boolean {
  return ACTIVE_STATUSES.has(item.status);
}

export function isRecentlyCompleted(item: AccountWorkItem): boolean {
  return COMPLETED_STATUSES.has(item.status);
}

export function isWaitingOnUser(item: AccountWorkItem): boolean {
  return item.status === "waiting_on_user";
}

export function isStale(item: AccountWorkItem): boolean {
  return item.status === "stale";
}
