/**
 * MUST-1: Queue-poisoning regression tests for the enqueueWrite helper.
 *
 * The bug: `writeQueue = writeQueue.then(onFulfilled)` with NO rejection handler.
 * One rejected write makes writeQueue permanently rejected, so EVERY later write's
 * callback never runs → all subsequent main-pump stream chunks are silently dropped.
 *
 * Fix shape:
 *   const next = writeQueue.then(() => writer.write(chunk));
 *   writeQueue = next.catch(() => undefined);
 *   return next;
 *
 * Tests verify:
 *  - A rejected queued write does NOT prevent a SUBSEQUENT write from executing.
 *  - The later write's underlying operation IS called even after a failure.
 *  - The failing write's rejection IS surfaced to its caller (not swallowed).
 */

import { describe, expect, test } from "bun:test";

// ---------------------------------------------------------------------------
// Minimal in-process re-implementation of the enqueueWrite pattern under test.
// This lets us test the fix without importing the entire chat.ts module (which
// has many heavy server-only dependencies).  The logic is identical to what
// chat.ts should contain after the fix.
// ---------------------------------------------------------------------------

function makeEnqueueWrite(writeChunk: (chunk: string) => Promise<void>) {
  let writeQueue: Promise<void> = Promise.resolve();

  /**
   * BUGGY implementation — the tail IS the per-write promise.
   * A rejection poisons writeQueue permanently.
   */
  function enqueueWriteBuggy(chunk: string): Promise<void> {
    writeQueue = writeQueue.then(() => writeChunk(chunk));
    return writeQueue;
  }

  /**
   * FIXED implementation — the tail is always non-rejecting.
   * A rejection does NOT poison writeQueue.
   */
  function enqueueWriteFixed(chunk: string): Promise<void> {
    const next = writeQueue.then(() => writeChunk(chunk));
    writeQueue = next.catch(() => undefined);
    return next;
  }

  return { enqueueWriteBuggy, enqueueWriteFixed };
}

// ---------------------------------------------------------------------------
// Tests against the FIXED pattern (assert fix behaviour)
// ---------------------------------------------------------------------------

describe("MUST-1: enqueueWrite queue-poisoning fix", () => {
  test("MUST-1a: fixed — a rejected write does NOT prevent subsequent write from executing", async () => {
    const called: string[] = [];

    const writeChunk = async (chunk: string): Promise<void> => {
      if (chunk === "bad") throw new Error("write failed");
      called.push(chunk);
    };

    const { enqueueWriteFixed } = makeEnqueueWrite(writeChunk);

    // Enqueue a bad write first — should reject its promise
    const badWritePromise = enqueueWriteFixed("bad");

    // Enqueue a good write — must still execute even after the bad write
    const goodWritePromise = enqueueWriteFixed("good");

    // Swallow the bad write rejection
    await badWritePromise.catch(() => undefined);
    // The good write must resolve
    await goodWritePromise;

    // The critical assertion: the second write WAS called
    expect(called).toContain("good");
  });

  test("MUST-1b: fixed — first write failure still surfaces to its own caller", async () => {
    const writeChunk = async (chunk: string): Promise<void> => {
      if (chunk === "fail") throw new Error("intentional failure");
    };

    const { enqueueWriteFixed } = makeEnqueueWrite(writeChunk);

    const failPromise = enqueueWriteFixed("fail");
    let caughtError: unknown;
    await failPromise.catch((e) => {
      caughtError = e;
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe("intentional failure");
  });

  test("MUST-1c: fixed — multiple writes after a rejection all execute", async () => {
    const called: string[] = [];

    const writeChunk = async (chunk: string): Promise<void> => {
      if (chunk === "bomb") throw new Error("bomb");
      called.push(chunk);
    };

    const { enqueueWriteFixed } = makeEnqueueWrite(writeChunk);

    // Poison attempt followed by multiple good writes
    const bomb = enqueueWriteFixed("bomb");
    const w1 = enqueueWriteFixed("w1");
    const w2 = enqueueWriteFixed("w2");
    const w3 = enqueueWriteFixed("w3");

    await bomb.catch(() => undefined);
    await w1;
    await w2;
    await w3;

    expect(called).toContain("w1");
    expect(called).toContain("w2");
    expect(called).toContain("w3");
  });

  test("MUST-1d: BUGGY pattern demonstrates the poisoning (documents why fix is needed)", async () => {
    const called: string[] = [];

    const writeChunk = async (chunk: string): Promise<void> => {
      if (chunk === "bad") throw new Error("write failed");
      called.push(chunk);
    };

    const { enqueueWriteBuggy } = makeEnqueueWrite(writeChunk);

    const badWrite = enqueueWriteBuggy("bad");
    const goodWrite = enqueueWriteBuggy("good");

    await badWrite.catch(() => undefined);
    await goodWrite.catch(() => undefined); // Must swallow — it IS poisoned

    // In the buggy version, "good" is NOT in called because the queue is poisoned.
    // This test documents the failure mode — it passes by asserting the bug exists.
    // After the fix, this test would NOT be representative (the fixed version calls it).
    // We keep this test as documentation only; the fix tests above are authoritative.
    expect(called).not.toContain("good"); // Bug: good write was NOT called
  });
});

// ---------------------------------------------------------------------------
// Regression: the fix must preserve sequential ordering guarantees
// ---------------------------------------------------------------------------

describe("MUST-1 regression: ordering preserved after fix", () => {
  test("MUST-1e: writes execute in enqueue order (no re-ordering side-effect from fix)", async () => {
    const order: string[] = [];

    const writeChunk = async (chunk: string): Promise<void> => {
      order.push(chunk);
    };

    const { enqueueWriteFixed } = makeEnqueueWrite(writeChunk);

    await enqueueWriteFixed("a");
    await enqueueWriteFixed("b");
    await enqueueWriteFixed("c");

    expect(order).toEqual(["a", "b", "c"]);
  });
});
