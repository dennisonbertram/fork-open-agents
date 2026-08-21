import { afterEach, describe, expect, test } from "bun:test";
import { webFetchTool } from "./fetch";
import {
  type UnattendedMutatingFetchBlockedEvent,
  setFetchEventRecorder,
} from "./fetch-events";

type NeedsApprovalFn = (
  input: { url: string; method?: string },
  options: { experimental_context?: unknown },
) => boolean | Promise<boolean>;

const needsApproval = (
  webFetchTool as unknown as {
    needsApproval: NeedsApprovalFn;
  }
).needsApproval;

async function needsApprovalResult(
  input: { url: string; method?: string },
  experimental_context: unknown,
): Promise<boolean> {
  return await Promise.resolve(needsApproval(input, { experimental_context }));
}

describe("unattended-mutating-fetch-blocked event (#1394)", () => {
  afterEach(() => {
    setFetchEventRecorder(null);
  });

  test("denial path emits warn event with typed fields", async () => {
    const events: UnattendedMutatingFetchBlockedEvent[] = [];
    setFetchEventRecorder((event) => events.push(event));

    const requires = await needsApprovalResult(
      { url: "https://example.com/api?key=secret", method: "POST" },
      { unattended: true, sessionId: "sess-1" },
    );

    expect(requires).toBe(true);
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) {
      throw new Error("expected one event");
    }
    expect(event.service).toBe("agent-fetch-tool");
    expect(event.event).toBe("unattended-mutating-fetch-blocked");
    expect(event.level).toBe("warn");
    expect(event.sessionId).toBe("sess-1");
    expect(event.chatId).toBeUndefined();
    expect(event.runId).toBeUndefined();
    expect(event.method).toBe("POST");
    expect(event.host).toBe("example.com");
    expect(event.errorKind).toBe("unattended_write_blocked");
  });

  test("emits nothing for unattended safe reads", async () => {
    const events: UnattendedMutatingFetchBlockedEvent[] = [];
    setFetchEventRecorder((event) => events.push(event));

    for (const method of ["GET", "HEAD"] as const) {
      expect(
        await needsApprovalResult(
          { url: "https://example.com", method },
          { unattended: true },
        ),
      ).toBe(false);
    }
    expect(events).toHaveLength(0);
  });

  test("emits nothing for attended mutating methods", async () => {
    const events: UnattendedMutatingFetchBlockedEvent[] = [];
    setFetchEventRecorder((event) => events.push(event));

    expect(
      await needsApprovalResult(
        { url: "https://example.com", method: "DELETE" },
        {},
      ),
    ).toBe(true);
    expect(events).toHaveLength(0);
  });

  test("default recorder logs single-line JSON without crashing", async () => {
    const requires = await needsApprovalResult(
      { url: "https://example.com", method: "PUT" },
      { unattended: true },
    );
    expect(requires).toBe(true);
  });
});
