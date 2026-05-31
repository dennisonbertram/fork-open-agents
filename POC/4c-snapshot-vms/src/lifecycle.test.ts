// State-machine guard tests — proves the lifecycle machine actually REJECTS
// illegal transitions (so "transitioned correctly" in the eval is meaningful,
// not cosmetic) and that a discarded/expired snapshot cannot be resumed.
//
//   bun test src/lifecycle.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFakeSnapshotProvider } from "./fake-provider";
import { LifecycleMachine } from "./lifecycle";

describe("LifecycleMachine guards", () => {
  test("rejects active -> hibernated (must pass through hibernating)", () => {
    const m = new LifecycleMachine("active");
    expect(() => m.transition("hibernated", "idle-timeout")).toThrow(
      /Illegal lifecycle transition: active -> hibernated/,
    );
  });

  test("rejects hibernated -> active (must pass through restoring)", () => {
    const m = new LifecycleMachine("hibernated");
    expect(() => m.transition("active", "resume-requested")).toThrow(
      /Illegal lifecycle transition: hibernated -> active/,
    );
  });

  test("rejects any transition out of archived (terminal)", () => {
    const m = new LifecycleMachine("archived");
    expect(() => m.transition("active", "reconnect")).toThrow(/Illegal/);
  });

  test("allows the full hibernate/resume happy path", () => {
    const m = new LifecycleMachine("provisioning");
    m.transition("active", "sandbox-created");
    m.transition("hibernating", "idle-timeout");
    m.transition("hibernated", "idle-timeout");
    m.transition("restoring", "resume-requested");
    m.transition("active", "snapshot-restored");
    expect(m.trail()).toBe(
      "provisioning -> active -> hibernating -> hibernated -> restoring -> active",
    );
  });

  test("allows aborting hibernation back to active (active stream arrived)", () => {
    const m = new LifecycleMachine("active");
    m.transition("hibernating", "idle-timeout");
    // mirrors lifecycle.ts restoreActiveLifecycleState when a stream appears
    expect(() => m.transition("active", "reconnect")).not.toThrow();
  });
});

describe("snapshot discard", () => {
  test("resume after discard fails (expiration/eviction is real)", async () => {
    const root = mkdtempSync(join(tmpdir(), "poc4c-test-"));
    try {
      const provider = new LocalFakeSnapshotProvider(root);
      const inst = provider.provision("s1", {});
      const ref = await provider.snapshot(inst);
      await provider.discard(ref);
      await expect(provider.resume(ref)).rejects.toThrow(
        /not found .*expired\/discarded/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
