/**
 * run-detail.revalidation.test.ts (#767, walk-3 finding)
 *
 * After a control action (pause/resume/cancel/retry) completes, run-detail
 * must revalidate BOTH its own run SWR key and the loop's runs-list SWR key
 * (loop-detail.tsx) — otherwise the two surfaces can show contradictory
 * statuses for the same run. Pinned via source inspection, consistent with
 * this repo's existing pattern for handler wiring that isn't easily driven
 * through a DOM click event (see run-actions.dispatch-failed.test.tsx).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(join(import.meta.dir, "run-detail.tsx"), "utf-8");

describe("RunDetail SWR revalidation on control actions (#767)", () => {
  test("imports loopRunsListSwrKey and the global swr mutate", () => {
    expect(SOURCE).toContain("loopRunsListSwrKey");
    expect(SOURCE).toContain('import { mutate as globalMutate } from "swr"');
  });

  test("onActionComplete revalidates both the run key and the loop's runs-list key", () => {
    const onActionCompleteIdx = SOURCE.indexOf("onActionComplete={() => {");
    expect(onActionCompleteIdx).toBeGreaterThan(-1);
    const block = SOURCE.slice(onActionCompleteIdx, onActionCompleteIdx + 400);
    expect(block).toContain("globalMutate(");
    expect(block).toContain("/api/agent-loop-runs/");
    expect(block).toContain("globalMutate(loopRunsListSwrKey(loop.id))");
  });
});
