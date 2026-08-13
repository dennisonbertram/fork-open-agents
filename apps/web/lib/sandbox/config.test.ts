import { describe, expect, test } from "bun:test";
import { resolveBackgroundAgentVcpus } from "./config";

/**
 * Vercel allocates sandbox CPU in fixed tiers (1, 2, 4, 8 — the same set the
 * repository-settings form validates against). An operator override is a
 * plain env string, so "3" and "2.5" are easy to type and are accepted by a
 * naive positive-number check. Vercel then refuses the allocation and EVERY
 * background-agent sandbox fails to connect — an override meant to give a
 * heavy repo more room would instead take the whole feature down.
 */
describe("resolveBackgroundAgentVcpus", () => {
  test("uses the profile default when unset", () => {
    expect(resolveBackgroundAgentVcpus(undefined, 2)).toBe(2);
  });

  test("accepts a supported tier", () => {
    expect(resolveBackgroundAgentVcpus("4", 2)).toBe(4);
  });

  test("falls back when the value is a positive but unsupported tier", () => {
    expect(resolveBackgroundAgentVcpus("3", 2)).toBe(2);
  });

  test("falls back on a fractional value", () => {
    expect(resolveBackgroundAgentVcpus("2.5", 2)).toBe(2);
  });

  test("falls back on junk, empty, zero and negative input", () => {
    for (const raw of ["", "  ", "two", "0", "-4"]) {
      expect(resolveBackgroundAgentVcpus(raw, 2)).toBe(2);
    }
  });
});

/**
 * #1210 defect 3 — snapshot retention.
 *
 * Stopping a `persistent` sandbox writes a snapshot so it can resume, and
 * nothing expired them: 156 snapshots / 105.1 GB accumulated before 116 were
 * deleted by hand, growing 4-11 per day. `snapshotExpiration` is the SDK's own
 * retention control and was plumbed end-to-end through packages/sandbox with
 * no caller setting it.
 */
describe("SANDBOX_SNAPSHOT_EXPIRATION_MS", () => {
  test("defaults to a bounded window rather than forever", async () => {
    const { SANDBOX_SNAPSHOT_EXPIRATION_MS } = await import("./config");
    expect(SANDBOX_SNAPSHOT_EXPIRATION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
