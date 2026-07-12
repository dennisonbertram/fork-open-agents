import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const storeSource = readFileSync(join(import.meta.dir, "store.ts"), "utf8");

function functionBody(name: string, nextName: string): string {
  const start = storeSource.indexOf(`export async function ${name}`);
  const end = storeSource.indexOf(
    `export async function ${nextName}`,
    start + 1,
  );
  return storeSource.slice(start, end === -1 ? undefined : end);
}

describe("source deletion write guards", () => {
  test("deletion terminalizes only active step and watchdog evidence", () => {
    const body = functionBody("deleteAgentLoop", "listAgentLoops");

    expect(body).toContain(".update(agentLoopStepRuns)");
    expect(body).toContain(
      'inArray(agentLoopStepRuns.status, ["queued", "running"])',
    );
    expect(body).toContain('status: "skipped"');
    expect(body).toContain('errorKind: "source_deleted"');
    expect(body).toContain(".update(agentLoopWatchdogRuns)");
    expect(body).toContain(
      'inArray(agentLoopWatchdogRuns.status, ["pending", "running"])',
    );
    expect(body).toContain('status: "failed"');
    expect(body).toContain('diagnosis: "Source Automation deleted"');
  });

  test("run status, context, and advance writes require a live source FK", () => {
    expect(
      functionBody("updateAgentLoopRunStatus", "updateAgentLoopRunContext"),
    ).toContain("isNotNull(agentLoopRuns.loopId)");
    expect(
      functionBody("updateAgentLoopRunContext", "setInitialStepPointer"),
    ).toContain("isNotNull(agentLoopRuns.loopId)");
    expect(
      functionBody("advanceRunToNextStep", "countStepRunsForNode"),
    ).toContain("isNotNull(agentLoopRuns.loopId)");
    expect(
      functionBody(
        "conditionallyTransitionRunStatus",
        "findStalledLoopRunCandidates",
      ),
    ).toContain("isNotNull(agentLoopRuns.loopId)");
  });

  test("resume and retry reject a retained run with a typed source_deleted error", () => {
    expect(functionBody("resumeLoopRun", "retryCurrentStep")).toContain(
      '"source_deleted"',
    );
    expect(
      functionBody("retryCurrentStep", "conditionallyTransitionRunStatus"),
    ).toContain('"source_deleted"');
  });
});
