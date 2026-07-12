import { describe, expect, test } from "bun:test";
import {
  getAttentionReasons,
  isRecentlyCompleted,
  isRunning,
  isStale,
  isWaitingOnUser,
  withAttention,
} from "./taxonomy";
import type { AccountWorkItem } from "./types";

function item(status: AccountWorkItem["status"]): AccountWorkItem {
  return withAttention({
    id: `item-${status}`,
    source: "session",
    title: status,
    status,
    attentionReasons: [],
    updatedAt: "2026-06-20T12:00:00.000Z",
  });
}

describe("account coordinator taxonomy", () => {
  test("maps deterministic attention reasons from status", () => {
    expect(getAttentionReasons("failed")).toEqual(["failed"]);
    expect(getAttentionReasons("cancelled")).toEqual(["cancelled"]);
    expect(getAttentionReasons("stale")).toEqual(["stale"]);
    expect(getAttentionReasons("waiting_on_user")).toEqual(["waiting_on_user"]);
    expect(getAttentionReasons("unknown")).toEqual(["unknown_status"]);
    expect(getAttentionReasons("running")).toEqual([]);
  });

  test("classifies section buckets without proposals or model state", () => {
    expect(isRunning(item("queued"))).toBe(true);
    expect(isRunning(item("running"))).toBe(true);
    expect(isRecentlyCompleted(item("completed"))).toBe(true);
    expect(isRecentlyCompleted(item("skipped"))).toBe(true);
    expect(isRecentlyCompleted(item("failed"))).toBe(false);
    expect(isWaitingOnUser(item("waiting_on_user"))).toBe(true);
    expect(isStale(item("stale"))).toBe(true);
  });
});
