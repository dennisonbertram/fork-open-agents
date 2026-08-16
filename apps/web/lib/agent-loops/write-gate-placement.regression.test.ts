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
  test("agent-step.ts has exactly the two commit gates", async () => {
    // The two are the `hasChanges` commit check and the final commit check.
    // A third means something upstream of writing started demanding write
    // again — the defect this guard exists to prevent. If you are adding one
    // deliberately, prove the identity can reach it and update this count in
    // the same commit.
    expect(await countWriteGates("./agent-step.ts")).toBe(2);
  });

  test("step-executor.ts has none", async () => {
    // Checkout is a read. The executor should never gate on write.
    expect(await countWriteGates("./step-executor.ts")).toBe(0);
  });

  test("both commit gates sit behind a hasChanges guard", async () => {
    const source = await Bun.file(
      new URL("agent-step.ts", import.meta.url).pathname,
    ).text();
    const lines = source.split("\n");
    const gateLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /requiredUserPermission:\s*"write"/.test(line));

    expect(gateLines.length).toBe(2);
    for (const { index } of gateLines) {
      // `hasChanges` opens the block each gate lives in. Look back a bounded
      // window rather than parsing scope: this only has to notice a gate that
      // floated out of the commit path.
      const preceding = lines.slice(Math.max(0, index - 40), index).join("\n");
      expect(preceding).toContain("hasChanges");
    }
  });
});
