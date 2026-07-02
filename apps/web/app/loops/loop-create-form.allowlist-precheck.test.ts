/**
 * loop-create-form.allowlist-precheck.test.ts (#767)
 *
 * loop-create-form.tsx cannot easily be driven through a submit event in
 * this repo's test setup (no @testing-library/react; renderToStaticMarkup
 * cannot fire handlers) — consistent with the existing
 * run-actions.dispatch-failed.test.tsx pattern, this pins the wiring by
 * reading the compiled source: handleSubmit must call the readiness route
 * with owner/repo before creating the loop, and must use
 * getRepoAllowlistBlockMessage to decide whether to block.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(
  join(import.meta.dir, "loop-create-form.tsx"),
  "utf-8",
);

describe("LoopCreateForm allowlist precheck wiring (#767)", () => {
  test("imports and calls getRepoAllowlistBlockMessage before the create request", () => {
    expect(SOURCE).toContain(
      'import { getRepoAllowlistBlockMessage } from "./repo-allowlist-precheck"',
    );
    const precheckIdx = SOURCE.indexOf("getRepoAllowlistBlockMessage(");
    const createRequestIdx = SOURCE.indexOf('fetch("/api/agent-loops"');
    expect(precheckIdx).toBeGreaterThan(-1);
    expect(createRequestIdx).toBeGreaterThan(-1);
    expect(precheckIdx).toBeLessThan(createRequestIdx);
  });

  test("queries the readiness route with owner and repo query params", () => {
    expect(SOURCE).toContain("/api/agent-loops/readiness?owner=");
  });
});
