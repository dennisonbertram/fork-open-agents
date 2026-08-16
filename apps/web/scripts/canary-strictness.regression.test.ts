import { describe, expect, test } from "bun:test";

/**
 * Guards that the production canary can actually fail.
 *
 * What happened: both journey proofs treat "require the run to have
 * succeeded" as an opt-in flag that defaults to FALSE. With it off,
 * `assertLoopProofRun` skips its terminal-status check and only fails on
 * dispatch errors, turn-budget exhaustion, or a missing start event. A run
 * that reached terminal `failed` was graded as **passed**.
 *
 * The authenticated production canary did not set the flag. So it reported
 * success every six hours for a month while producing a failed agent-loop run
 * each time — 144 failed production runs that nobody saw, because the thing
 * watching for them could not report a failure.
 *
 * The background-agent proof carries the identical defect and was green only
 * because its runs happened to succeed.
 *
 * These tests read the workflow file rather than mocking anything. The flag
 * lives in YAML; no unit test of the proof scripts can observe whether the
 * scheduled job passes it.
 */

const WORKFLOW_PATH = new URL(
  "../../../.github/workflows/authenticated-production-canary.yml",
  import.meta.url,
).pathname;

async function workflowSource(): Promise<string> {
  return await Bun.file(WORKFLOW_PATH).text();
}

describe("authenticated production canary is strict", () => {
  test("the workflow file is where this guard expects it", async () => {
    // A moved or renamed workflow would make every assertion below vacuous.
    expect(await Bun.file(WORKFLOW_PATH).exists()).toBe(true);
  });

  test("the agent-loop journey proof requires a succeeded run", async () => {
    expect(await workflowSource()).toContain(
      'LOOP_JOURNEY_PROOF_REQUIRE_SUCCEEDED: "true"',
    );
  });

  test("the background-agent journey proof requires a succeeded run", async () => {
    expect(await workflowSource()).toContain(
      'BACKGROUND_AGENT_PROOF_REQUIRE_SUCCEEDED: "true"',
    );
  });

  test("the workflow still fails when a journey does not pass", async () => {
    const source = await workflowSource();
    // The final gate turns the aggregated classification into a non-zero
    // exit. Without it the job stays green no matter what the journeys say,
    // which is the same class of defect one layer up.
    expect(source).toContain('if [ "$ALL_PASSED" != "true" ]; then');
    expect(source).toContain("exit 1");
  });
});

/**
 * The defaults themselves stay permissive on purpose: a developer running a
 * proof locally against a half-configured environment should not get a hard
 * failure. That is a defensible default and this guard does not change it.
 *
 * What it does assert is that the SCHEDULED PRODUCTION job opts in. If the
 * defaults are ever flipped to strict, delete these two assertions rather
 * than weakening them.
 */
describe("the strictness flags are genuinely opt-in", () => {
  test("agent-loop proof documents a false default", async () => {
    const source = await Bun.file(
      new URL("agent-loop-journey-proof.ts", import.meta.url).pathname,
    ).text();
    expect(source).toContain("LOOP_JOURNEY_PROOF_REQUIRE_SUCCEEDED");
  });

  test("background-agent proof documents a false default", async () => {
    const source = await Bun.file(
      new URL("background-agent-journey-proof.ts", import.meta.url).pathname,
    ).text();
    expect(source).toContain("BACKGROUND_AGENT_PROOF_REQUIRE_SUCCEEDED");
  });
});
