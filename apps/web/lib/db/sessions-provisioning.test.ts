import { beforeEach, describe, expect, mock, test } from "bun:test";

// In-memory model of the sessions row's provisioning lease + archive guard.
let leaseOwner: string | null = null;
let isArchived = false;

function makeUpdateChain() {
  let payload: Record<string, unknown> = {};
  const chain = {
    set(input: Record<string, unknown>) {
      payload = input;
      return chain;
    },
    where() {
      return chain;
    },
    returning(_cols?: unknown) {
      const hasProvisioningKey = "sandboxProvisioningRunId" in payload;
      if (hasProvisioningKey && payload.sandboxProvisioningRunId !== null) {
        // claimSessionSandboxProvisioningRunId: atomic first-claim-wins.
        if (leaseOwner === null) {
          leaseOwner = String(payload.sandboxProvisioningRunId);
          return Promise.resolve([{ id: "session-1" }]);
        }
        return Promise.resolve([]);
      }
      if (hasProvisioningKey && payload.sandboxProvisioningRunId === null) {
        // clearSessionSandboxProvisioningRunIdIfOwned: clears only when owned.
        if (leaseOwner !== null) {
          leaseOwner = null;
          return Promise.resolve([{ id: "session-1" }]);
        }
        return Promise.resolve([]);
      }
      // updateSessionIfNotArchived: no row when archived.
      if (isArchived) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        { id: "session-1", sandboxState: { type: "vercel" }, ...payload },
      ]);
    },
  };
  return chain;
}

mock.module("./client", () => ({
  db: {
    update: () => makeUpdateChain(),
  },
}));

const modulePromise = import("./sessions");

describe("sandbox provisioning lease helpers", () => {
  beforeEach(() => {
    leaseOwner = null;
    isArchived = false;
  });

  test("claim is idempotent: only the first of two racing claims wins", async () => {
    const { claimSessionSandboxProvisioningRunId } = await modulePromise;

    const [a, b] = await Promise.all([
      claimSessionSandboxProvisioningRunId("session-1", "run-A"),
      claimSessionSandboxProvisioningRunId("session-1", "run-B"),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    // A subsequent claim while the lease is held is a no-op.
    expect(
      await claimSessionSandboxProvisioningRunId("session-1", "run-C"),
    ).toBe(false);
  });

  test("clearIfOwned releases a held lease and is a no-op when unowned", async () => {
    const {
      claimSessionSandboxProvisioningRunId,
      clearSessionSandboxProvisioningRunIdIfOwned,
    } = await modulePromise;

    await claimSessionSandboxProvisioningRunId("session-1", "run-A");
    expect(
      await clearSessionSandboxProvisioningRunIdIfOwned("session-1", "run-A"),
    ).toBe(true);
    // Already cleared -> nothing to release.
    expect(
      await clearSessionSandboxProvisioningRunIdIfOwned("session-1", "run-A"),
    ).toBe(false);
  });

  test("updateSessionIfNotArchived returns null for an archived session", async () => {
    const { updateSessionIfNotArchived } = await modulePromise;

    isArchived = true;
    const archivedResult = await updateSessionIfNotArchived("session-1", {
      lifecycleState: "active",
    });
    expect(archivedResult).toBeFalsy();

    isArchived = false;
    const liveResult = await updateSessionIfNotArchived("session-1", {
      lifecycleState: "active",
    });
    expect(liveResult).toMatchObject({ id: "session-1" });
  });
});
