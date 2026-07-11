import { beforeAll, describe, expect, test } from "bun:test";

let workflow = "";

beforeAll(async () => {
  workflow = await Bun.file(
    new URL(
      "../../../.github/workflows/authenticated-production-canary.yml",
      import.meta.url,
    ),
  ).text();
});

function stepBlock(name: string): string {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

describe("authenticated production canary workflow", () => {
  test("all three journey legs always require configuration", () => {
    expect(workflow.match(/PRODUCTION_CANARY_REQUIRE_CONFIG: "true"/g)).toHaveLength(
      3,
    );
  });

  test("each leg captures the real pipeline exit and exports a classification", () => {
    expect(workflow.match(/PIPESTATUS\[0\]/g)).toHaveLength(3);
    expect(workflow.match(/classification=.*GITHUB_OUTPUT/g)).toHaveLength(3);
    expect(workflow.match(/exit_code=.*GITHUB_OUTPUT/g)).toHaveLength(3);
  });

  test("always aggregates safe per-journey classifications into the step summary", () => {
    const aggregate = stepBlock("Aggregate authenticated canary results");
    expect(aggregate).toContain("id: aggregate");
    expect(aggregate).toContain("if: always()");
    expect(aggregate).toContain("GITHUB_STEP_SUMMARY");
    expect(aggregate).toContain("account-status");
    expect(aggregate).toContain("background-agents-journey");
    expect(aggregate).toContain("loops-journey");
    expect(aggregate).toContain("workflowRunUrl");
    expect(workflow).not.toContain("tail -n");
  });

  test("recovers only when all three classifications passed", () => {
    const recovery = stepBlock("Mark canary recovery");
    expect(recovery).toContain("steps.aggregate.outputs.all_passed == 'true'");
    expect(recovery).toContain(
      "All three authenticated production canary journeys passed.",
    );
    expect(recovery.toLowerCase()).not.toContain("blocked");
  });

  test("always runs a final red gate for failed, blocked, or missing classifications", () => {
    const finalGate = stepBlock(
      "Fail workflow unless all authenticated journeys passed",
    );
    expect(finalGate).toContain("if: always()");
    expect(finalGate).toContain("steps.aggregate.outputs.all_passed");
    expect(finalGate).toContain("exit 1");
  });
});
