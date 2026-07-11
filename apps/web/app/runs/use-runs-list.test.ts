import { describe, expect, test } from "bun:test";
import {
  computeRunsRefreshInterval,
  fetchRunsWithTimeout,
  shouldShowRunsPollingPaused,
} from "./use-runs-list";

describe("Runs list polling", () => {
  test("polls only while a queued or running row is visible and before the deadline", () => {
    const now = 1_000;
    expect(
      computeRunsRefreshInterval(
        [{ state: "running" }, { state: "finished" }],
        now,
        now + 60_000,
      ),
    ).toBeGreaterThan(0);
    expect(
      computeRunsRefreshInterval(
        [{ state: "waiting" }, { state: "finished" }],
        now,
        now + 60_000,
      ),
    ).toBe(0);
    expect(
      computeRunsRefreshInterval(
        [{ state: "queued" }],
        now + 60_001,
        now + 60_000,
      ),
    ).toBe(0);
  });

  test("aborts a wedged fetch instead of claiming live updates", async () => {
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });

    await expect(
      fetchRunsWithTimeout("/api/runs", { fetchImpl, timeoutMs: 5 }),
    ).rejects.toThrow();
  });

  test("never shows a paused-live-updates claim for waiting or completed data", () => {
    expect(
      shouldShowRunsPollingPaused(
        [{ state: "waiting" }, { state: "finished" }],
        true,
      ),
    ).toBe(false);
    expect(shouldShowRunsPollingPaused([{ state: "running" }], true)).toBe(
      true,
    );
  });
});
