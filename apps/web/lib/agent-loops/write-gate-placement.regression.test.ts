import { describe, expect, test } from "bun:test";

/**
 * Guards where agent loops require WRITE access to a repository.
 *
 * Background: 144 of 166 production loop runs failed with
 * `permission_missing` / `user_no_write`. Four separate gates asked for write
 * before any writing happened — two preparation gates and a per-turn liveness
 * check — so an identity that legitimately cannot write (the production
 * canary's installation-scoped service identity, which `verifyRepoAccess`
 * deliberately refuses write to) was locked out of read-only loops entirely.
 *
 * The invariant: write is required only where the code actually writes, which
 * is the commit paths, each gated on `hasChanges`. Reading, preparing,
 * checking out and per-turn liveness all need read.
 *
 * This is a source-text guard rather than a behavioural test on purpose. The
 * third gate survived a mocked test suite and a full review because reaching
 * it needs a live sandbox; a reviewer found it by reading. Counting the sites
 * catches a new one whether or not a test happens to execute that line.
 */

const WRITE_REQUIREMENT = /requiredUserPermission:\s*"write"/g;

async function countWriteGates(path: string): Promise<number> {
  const source = await Bun.file(new URL(path, import.meta.url).pathname).text();
  return source.match(WRITE_REQUIREMENT)?.length ?? 0;
}

describe("agent loops require write only where they write", () => {
  test("agent-step.ts has exactly three write gates", async () => {
    // Three, each justified:
    //   1. before attaching Composio tools — they can open a PR, comment or
    //      dispatch a workflow, and `guardToolSet` checks only loop liveness
    //      and toolkit policy, never repo write (#1315)
    //   2. the `hasChanges` commit check
    //   3. the final commit check
    //
    // A fourth means something upstream of writing started demanding write
    // again — the defect this guard exists to prevent, which cost 144 failed
    // production runs. If you are adding one deliberately, prove the identity
    // can reach it and update this count in the same commit.
    expect(await countWriteGates("./agent-step.ts")).toBe(3);
  });

  test("step-executor.ts has none", async () => {
    // Checkout is a read. The executor should never gate on write.
    expect(await countWriteGates("./step-executor.ts")).toBe(0);
  });

  test("each write gate sits at the operation it protects", async () => {
    const source = await Bun.file(
      new URL("agent-step.ts", import.meta.url).pathname,
    ).text();
    const lines = source.split("\n");
    const lineIndex = (needle: string) =>
      lines.findIndex((line) => line.includes(needle));

    const gates = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /requiredUserPermission:\s*"write"/.test(line))
      .map(({ index }) => index);
    expect(gates).toHaveLength(3);

    // Anchored to real code, not to comment wording: a comment can say
    // anything, and an earlier version of this assertion keyed on the word
    // "composio" appearing nearby — which it does regardless of where the
    // gate actually sits.
    const attachComposio = lineIndex("resolveComposioToolsForBgRun(");
    const firstHasChanges = lineIndex("if (hasChanges) {");
    expect(attachComposio).toBeGreaterThan(-1);
    expect(firstHasChanges).toBeGreaterThan(-1);

    // Exactly one gate guards Composio: before the tools are resolved.
    const beforeComposio = gates.filter((g) => g < attachComposio);
    expect(beforeComposio).toHaveLength(1);

    // The other two are the commit checks, after the hasChanges branch opens.
    const afterHasChanges = gates.filter((g) => g > firstHasChanges);
    expect(afterHasChanges).toHaveLength(2);
  });
});
