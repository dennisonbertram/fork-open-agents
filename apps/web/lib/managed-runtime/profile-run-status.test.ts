import { describe, expect, mock, test } from "bun:test";
import type { ManagedRuntimeCommandObservation } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

// RED: this module does not exist yet.
const {
  MANAGED_RUNTIME_RUN_STATUSES,
  MANAGED_RUNTIME_COMMAND_STATUSES,
  MANAGED_RUNTIME_ERROR_KINDS,
  rollupFromObservations,
  nextActionFor,
} = await import("./profile-run-status");

function observation(
  overrides: Partial<ManagedRuntimeCommandObservation> = {},
): ManagedRuntimeCommandObservation {
  return {
    commandId: "cmd-1",
    label: "Command",
    status: "passed",
    required: true,
    startedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("canonical vocabulary", () => {
  test("run statuses reconcile schema.ts:541-543", () => {
    expect(MANAGED_RUNTIME_RUN_STATUSES).toEqual([
      "running",
      "passed",
      "failed",
      "blocked",
    ]);
  });

  test("command statuses reconcile schema.ts:29-32", () => {
    expect(MANAGED_RUNTIME_COMMAND_STATUSES).toEqual([
      "running",
      "passed",
      "failed",
      "skipped",
    ]);
  });

  test("error kinds cover every typed failure surface", () => {
    expect(MANAGED_RUNTIME_ERROR_KINDS).toEqual([
      "profile_not_found",
      "setup_command_failed",
      "verification_failed",
      "setup_exec_error",
      "evidence_write_failed",
    ]);
  });
});

describe("rollupFromObservations", () => {
  test("returns 'running' when any observation is still running", () => {
    const status = rollupFromObservations([
      observation({ status: "passed" }),
      observation({ commandId: "cmd-2", status: "running" }),
    ]);
    expect(status).toBe("running");
  });

  test("returns 'failed' when a required observation failed", () => {
    const status = rollupFromObservations([
      observation({ status: "passed" }),
      observation({ commandId: "cmd-2", status: "failed", required: true }),
    ]);
    expect(status).toBe("failed");
  });

  test("returns 'passed' when a non-required observation failed but all required observations passed", () => {
    const status = rollupFromObservations([
      observation({ status: "passed" }),
      observation({ commandId: "cmd-2", status: "failed", required: false }),
    ]);
    expect(status).toBe("passed");
  });

  test("returns 'passed' when every observation passed", () => {
    const status = rollupFromObservations([
      observation({ status: "passed" }),
      observation({ commandId: "cmd-2", status: "passed" }),
    ]);
    expect(status).toBe("passed");
  });

  test("returns 'blocked' when there are no observations", () => {
    const status = rollupFromObservations([]);
    expect(status).toBe("blocked");
  });
});

describe("nextActionFor", () => {
  test("gives an actionable message for profile_not_found", () => {
    const action = nextActionFor("profile_not_found");
    expect(action).toContain("profile");
    expect(action.length).toBeGreaterThan(0);
  });

  test("gives an actionable message for setup_command_failed", () => {
    const action = nextActionFor("setup_command_failed");
    expect(action.length).toBeGreaterThan(0);
  });

  test("gives an actionable message for verification_failed", () => {
    const action = nextActionFor("verification_failed");
    expect(action.length).toBeGreaterThan(0);
  });

  test("gives an actionable message for setup_exec_error", () => {
    const action = nextActionFor("setup_exec_error");
    expect(action.length).toBeGreaterThan(0);
  });

  test("gives an actionable message for evidence_write_failed", () => {
    const action = nextActionFor("evidence_write_failed");
    expect(action.length).toBeGreaterThan(0);
  });

  test("distinct error kinds map to distinct next-action copy", () => {
    const actions = new Set(
      MANAGED_RUNTIME_ERROR_KINDS.map((kind) => nextActionFor(kind)),
    );
    expect(actions.size).toBe(MANAGED_RUNTIME_ERROR_KINDS.length);
  });
});
