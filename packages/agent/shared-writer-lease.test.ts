import { describe, expect, test } from "bun:test";
import { SharedWriterLeaseManager } from "./shared-writer-lease";

describe("shared writer lease manager", () => {
  test("allows one active writer per session workspace", () => {
    const manager = new SharedWriterLeaseManager();
    const first = manager.acquire({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-1",
      now: 1000,
    });
    const second = manager.acquire({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-2",
      now: 1001,
    });

    expect(first).toMatchObject({
      status: "acquired",
      workerId: "worker-1",
      events: [{ type: "shared_writer_lock_acquired" }],
    });
    expect(second).toMatchObject({
      status: "denied",
      activeWorkerId: "worker-1",
      reasonCode: "shared_writer_already_active",
      events: [{ type: "shared_writer_lock_denied" }],
    });
  });

  test("releases terminal workers and allows the next writer", () => {
    const manager = new SharedWriterLeaseManager();
    manager.acquire({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-1",
      now: 1000,
    });

    const release = manager.release({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-1",
      reasonCode: "worker_terminal",
      now: 1005,
    });
    const next = manager.acquire({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-2",
      now: 1006,
    });

    expect(release).toMatchObject({
      status: "released",
      events: [
        {
          type: "shared_writer_lock_released",
          reasonCode: "worker_terminal",
        },
      ],
    });
    expect(next).toMatchObject({
      status: "acquired",
      workerId: "worker-2",
    });
  });

  test("expires stale leases before acquiring a replacement", () => {
    const manager = new SharedWriterLeaseManager();
    manager.acquire({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-1",
      now: 1000,
      ttlMs: 10,
    });

    const recovered = manager.acquire({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-2",
      now: 1011,
      ttlMs: 10,
    });

    expect(recovered).toMatchObject({
      status: "acquired",
      workerId: "worker-2",
      events: [
        { type: "shared_writer_lock_expired", workerId: "worker-1" },
        { type: "shared_writer_lock_acquired", workerId: "worker-2" },
      ],
    });
  });

  test("scopes leases by session and workspace", () => {
    const manager = new SharedWriterLeaseManager();
    manager.acquire({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workerId: "worker-1",
      now: 1000,
    });

    expect(
      manager.acquire({
        sessionId: "session-2",
        workspaceId: "workspace-1",
        workerId: "worker-2",
        now: 1001,
      }),
    ).toMatchObject({ status: "acquired" });
    expect(
      manager.acquire({
        sessionId: "session-1",
        workspaceId: "workspace-2",
        workerId: "worker-3",
        now: 1002,
      }),
    ).toMatchObject({ status: "acquired" });
  });
});
