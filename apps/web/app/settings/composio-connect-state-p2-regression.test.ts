/**
 * Regression tests for isTerminalConnectFailure (Codex P2-2 on PR #847,
 * issue #801). Would fail if the implementation from 32f661a8 were
 * reverted or if a future change mis-classified a status.
 *
 * These cover an angle the BT-801-P2-2-00x behavioral tests didn't already
 * exercise directly: exhaustiveness across every status in
 * ConnectStateStatus (not just the terminal three), proving the function
 * never accidentally reports "confirmed" or "idle" as a terminal failure —
 * which would incorrectly restore a Connect button on an already-successful
 * or never-attempted card.
 */
import { describe, expect, test } from "bun:test";
import {
  isTerminalConnectFailure,
  type ConnectStateStatus,
} from "./composio-connect-state";

const ALL_STATUSES: ConnectStateStatus[] = [
  "idle",
  "connecting",
  "pending",
  "confirmed",
  "timed_out",
  "blocked",
  "failed_to_start",
];

describe("regression: isTerminalConnectFailure exhaustively classifies every status correctly", () => {
  test("exactly the three terminal-failure statuses report true; every other status reports false", () => {
    const terminalTrue: string[] = ALL_STATUSES.filter((status) =>
      isTerminalConnectFailure(status),
    );
    const expected: string[] = ["blocked", "failed_to_start", "timed_out"];
    expect(terminalTrue.sort()).toEqual(expected.sort());
  });

  test("'confirmed' (a successful connection) is never treated as a terminal failure", () => {
    // Guards against a future change that widens the terminal-failure set
    // carelessly (e.g. "anything that isn't idle/connecting/pending") and
    // would incorrectly show a Connect button on an already-connected card.
    expect(isTerminalConnectFailure("confirmed")).toBe(false);
  });

  test("'idle' (no connect attempt at all) is never treated as a terminal failure", () => {
    expect(isTerminalConnectFailure("idle")).toBe(false);
  });
});
