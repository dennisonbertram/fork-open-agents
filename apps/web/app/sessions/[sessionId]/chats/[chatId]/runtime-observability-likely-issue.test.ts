import { describe, expect, test } from "bun:test";
import { selectLikelyIssueSummary } from "./runtime-observability-likely-issue";
import type { SessionEventJson } from "./hooks/use-session-observability";

function makeEvent(
  overrides: Partial<SessionEventJson> = {},
): SessionEventJson {
  return {
    id: "evt-1",
    sessionId: "session-1",
    chatId: "chat-1",
    userId: "user-1",
    source: "chat",
    actorType: "system",
    actorId: null,
    eventName: "composio.session.failed",
    status: "failed",
    summary: null,
    payload: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as SessionEventJson;
}

describe("selectLikelyIssueSummary", () => {
  test("renders an already-final composio event summary verbatim, not re-derived", () => {
    const event = makeEvent({
      summary: "Blocked toolkit for this repository: gmail.",
    });

    expect(selectLikelyIssueSummary(event, true)).toBe(
      "Blocked toolkit for this repository: gmail.",
    );
  });

  test("falls back to getComposioUserFacingError only when summary is empty/nullish", () => {
    const event = makeEvent({ summary: null });

    const result = selectLikelyIssueSummary(event, true);
    expect(result).not.toBe("");
    expect(typeof result).toBe("string");
  });

  test("non-composio issues still use normalizeEventSummary (redacted, generic)", () => {
    const event = makeEvent({
      eventName: "sandbox.setup.failed",
      status: "failed",
      summary: "Sandbox boot failed: ak_secret123",
    });

    const result = selectLikelyIssueSummary(event, false);
    expect(result).toContain("ak_[redacted]");
    expect(result).not.toContain("ak_secret123");
  });
});
