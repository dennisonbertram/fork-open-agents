import { describe, expect, test } from "bun:test";

import { getWorkflowRunDisplay, workflowRunDisplayByState } from "./runs";
import type { DashboardErrorKind } from "../repo-dashboard";

describe("actions-manager workflow run display", () => {
  test("maps GitHub run lifecycle states to stable labels and tones", () => {
    expect(getWorkflowRunDisplay("queued", null)).toMatchObject({
      label: "Queued",
      tone: "queued",
    });
    expect(getWorkflowRunDisplay("in_progress", null)).toMatchObject({
      label: "In progress",
      tone: "in_progress",
    });
    expect(getWorkflowRunDisplay("completed", "success")).toMatchObject({
      label: "Succeeded",
      tone: "success",
    });
    expect(getWorkflowRunDisplay("completed", "failure")).toMatchObject({
      label: "Failed",
      tone: "failure",
    });
    expect(getWorkflowRunDisplay("completed", "cancelled")).toMatchObject({
      label: "Cancelled",
      tone: "cancelled",
    });
    expect(getWorkflowRunDisplay("completed", "skipped")).toMatchObject({
      label: "Skipped",
      tone: "skipped",
    });
    expect(getWorkflowRunDisplay("completed", "timed_out")).toMatchObject({
      label: "Timed out",
      tone: "timed_out",
    });
    expect(getWorkflowRunDisplay("completed", "action_required")).toMatchObject(
      {
        label: "Action required",
        tone: "action_required",
      },
    );
    expect(getWorkflowRunDisplay("completed", "stale")).toMatchObject({
      label: "Stale",
      tone: "stale",
    });
    expect(getWorkflowRunDisplay("completed", "startup_failure")).toMatchObject(
      {
        label: "Startup failure",
        tone: "startup_failure",
      },
    );
  });

  test("keeps the run display map separate from readiness verdict taxonomy", () => {
    expect(Object.keys(workflowRunDisplayByState).sort()).toEqual([
      "action_required",
      "cancelled",
      "failure",
      "in_progress",
      "queued",
      "skipped",
      "stale",
      "startup_failure",
      "success",
      "timed_out",
      "unknown",
    ]);
  });

  test("uses the shared dashboard error taxonomy instead of a parallel enum", () => {
    const errorKind: DashboardErrorKind = "app_no_actions_permission";
    expect(errorKind).toBe("app_no_actions_permission");
  });
});
