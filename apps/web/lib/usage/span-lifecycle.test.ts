import { describe, expect, test } from "bun:test";
import { decideOpenSpan, MAX_SANDBOX_LIFETIME_MS } from "./span-lifecycle";

const START = new Date("2026-08-22T00:00:00.000Z");
const at = (msAfter: number) => new Date(START.getTime() + msAfter);

describe("decideOpenSpan", () => {
  test("ignores a reconnect to a sandbox that is still running", () => {
    // One live VM is one span; a reconnect must not record a second.
    expect(decideOpenSpan(START, at(30 * 60 * 1000))).toBe("ignore");
  });

  test("ignores a reconnect right up to the provider ceiling", () => {
    expect(decideOpenSpan(START, at(MAX_SANDBOX_LIFETIME_MS - 1))).toBe(
      "ignore",
    );
  });

  test("expires a span older than any sandbox can live", () => {
    // Nothing closed it, so the provider reclaimed the VM at its hard timeout.
    // Left in place it would suppress every future lifetime for this sandbox.
    expect(decideOpenSpan(START, at(MAX_SANDBOX_LIFETIME_MS))).toBe(
      "expire-and-reopen",
    );
  });

  test("expires a long-abandoned span", () => {
    expect(decideOpenSpan(START, at(48 * 60 * 60 * 1000))).toBe(
      "expire-and-reopen",
    );
  });

  test("treats a clock that went backwards as still running", () => {
    // A negative age is nonsense, but suppressing is the safe reading: it
    // records one span rather than inventing a second for the same VM.
    expect(decideOpenSpan(START, at(-60_000))).toBe("ignore");
  });
});
