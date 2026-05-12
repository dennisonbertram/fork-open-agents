import { describe, expect, test } from "bun:test";
import { extractSseBlocks, parseSseBlock, reduceHarnessEvent } from "./events";

describe("harness events", () => {
  test("reduces terminal events", () => {
    expect(
      reduceHarnessEvent("run.completed", {
        go_no_go: "go",
        final_report_artifact_id: "artifact-1",
      }),
    ).toEqual({
      status: "completed",
      finalReportArtifactId: "artifact-1",
      goNoGo: "go",
    });

    expect(reduceHarnessEvent("run.failed", {})).toEqual({
      status: "failed",
      goNoGo: "no_go",
    });
  });

  test("clears pending approval state when approval is recorded", () => {
    expect(
      reduceHarnessEvent("approval.recorded", {
        approval_kind: "integration",
        status: "recorded",
      }),
    ).toEqual({
      status: "recorded",
      planApprovalState: "approved",
      pendingApprovalKind: null,
    });
  });

  test("parses SSE blocks and malformed payloads safely", () => {
    const parsed = parseSseBlock(
      'id: evt-1\nevent: gate.completed\ndata: {"status":"passed"}',
    );

    expect(parsed).toEqual({
      id: "evt-1",
      event: "gate.completed",
      data: { status: "passed" },
    });

    expect(parseSseBlock("id: evt-2\ndata: {bad")?.data).toEqual({
      malformed: true,
      raw: "{bad",
    });
  });

  test("extracts complete blocks and preserves rest", () => {
    expect(extractSseBlocks("id: 1\n\nid: 2")).toEqual({
      blocks: ["id: 1"],
      rest: "id: 2",
    });
  });
});
