/**
 * run-detail.revalidation.test.ts (#767, walk-3 finding)
 *
 * After a control action (pause/resume/cancel/retry) completes, run-detail
 * must revalidate its own run SWR resource and the loop's runs-list SWR key
 * (loop-detail.tsx) — otherwise the two surfaces can show contradictory
 * statuses for the same run. The run resource is refreshed through the
 * polling hook's mutate function so the detail page receives the new status
 * before the action reports success.
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

  test("onActionComplete awaits the run refresh and revalidates the loop's runs-list key", () => {
    const onActionCompleteIdx = SOURCE.indexOf(
      "onActionComplete={async () => {",
    );
    expect(onActionCompleteIdx).toBeGreaterThan(-1);
    const block = SOURCE.slice(onActionCompleteIdx, onActionCompleteIdx + 400);
    expect(block).toContain("await refreshRun()");
    expect(block).toContain("globalMutate(loopRunsListSwrKey(loop.id))");
  });
});
