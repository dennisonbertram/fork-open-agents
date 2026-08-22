import { describe, expect, test } from "bun:test";
import { buildCreateConfig } from "./connect";

/**
 * Guard against silent option dropping.
 *
 * `meter` has to survive three hops to be worth anything: the public
 * `ConnectOptions` in factory.ts, the local `ConnectOptions` in connect.ts, and
 * `buildCreateConfig`'s hand-written object literal. Every field in that
 * literal is copied by name, so a new option that is declared but never copied
 * type-checks perfectly and reaches `VercelSandbox.create` as `undefined` —
 * which is exactly how this one was first written. The result is metering that
 * looks wired, passes its own unit tests, and records nothing.
 */
describe("buildCreateConfig meter forwarding", () => {
  const state = { sandboxName: "sandbox-under-test" };

  test("forwards meter attribution through to the create config", () => {
    const config = buildCreateConfig(state, {
      meter: { userId: "user_123", sessionId: "sess_456", source: "web" },
      vcpus: 4,
    });

    expect(config.meter).toEqual({
      userId: "user_123",
      sessionId: "sess_456",
      source: "web",
    });
  });

  test("omits meter entirely when the caller supplies none", () => {
    const config = buildCreateConfig(state, { vcpus: 4 });

    expect(config.meter).toBeUndefined();
  });

  test("still forwards attribution with no session, as background runs have", () => {
    const config = buildCreateConfig(state, {
      meter: { userId: "user_123", source: "background-agent" },
    });

    expect(config.meter?.userId).toBe("user_123");
    expect(config.meter?.sessionId).toBeUndefined();
  });
});
