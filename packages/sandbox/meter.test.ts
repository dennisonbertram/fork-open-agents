import { afterEach, describe, expect, test } from "bun:test";
import {
  flushSandboxMeter,
  reportSandboxClose,
  reportSandboxOpen,
  setSandboxMeter,
} from "./meter";

afterEach(() => {
  setSandboxMeter(null);
});

const OPEN = {
  sandboxName: "sandbox-1",
  vcpus: 4,
  memoryMb: 8192,
  startedAt: new Date("2026-08-22T00:00:00.000Z"),
};

describe("sandbox meter write ordering", () => {
  test("a close always observes its own open, even when the open is slow", async () => {
    // The failure this guards: both reports are fire-and-forget, so a sandbox
    // created and stopped in quick succession used to run onOpen and onClose
    // concurrently. The close read before the open insert landed, found no
    // open span, did nothing — and the span it raced stayed open forever.
    const order: string[] = [];
    setSandboxMeter({
      onOpen: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("open");
      },
      onClose: () => {
        order.push("close");
      },
    });

    reportSandboxOpen(OPEN);
    reportSandboxClose({
      sandboxName: "sandbox-1",
      endedAt: new Date(),
      reason: "stopped",
    });
    await flushSandboxMeter();

    expect(order).toEqual(["open", "close"]);
  });

  test("a failing open does not strand the close behind it", async () => {
    const order: string[] = [];
    setSandboxMeter({
      onOpen: () => {
        throw new Error("open failed");
      },
      onClose: () => {
        order.push("close");
      },
    });

    reportSandboxOpen(OPEN);
    reportSandboxClose({
      sandboxName: "sandbox-1",
      endedAt: new Date(),
      reason: "stopped",
    });
    await flushSandboxMeter();

    expect(order).toEqual(["close"]);
  });

  test("different sandboxes are not serialized behind each other", async () => {
    const finished: string[] = [];
    setSandboxMeter({
      onOpen: async (event) => {
        // The first sandbox's write is slow; the second must not wait on it.
        if (event.sandboxName === "slow") {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        finished.push(event.sandboxName ?? "?");
      },
      onClose: () => {},
    });

    reportSandboxOpen({ ...OPEN, sandboxName: "slow" });
    reportSandboxOpen({ ...OPEN, sandboxName: "fast" });
    await flushSandboxMeter();

    expect(finished).toEqual(["fast", "slow"]);
  });

  test("reporting with no meter registered is a no-op", async () => {
    setSandboxMeter(null);

    expect(() => {
      reportSandboxOpen(OPEN);
    }).not.toThrow();
    await flushSandboxMeter();
  });
});
