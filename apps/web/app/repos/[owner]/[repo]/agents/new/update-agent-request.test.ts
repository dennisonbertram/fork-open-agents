import { describe, expect, test } from "bun:test";
import { submitAgentUpdate } from "./update-agent-request";

function jsonResponse(
  body: unknown,
  ok = true,
  status = ok ? 200 : 400,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("submitAgentUpdate", () => {
  test("PATCHes the existing agent and returns its id on success", async () => {
    const calls: [string, { method: string }][] = [];
    const fetchImpl = (async (
      url: string | URL | Request,
      opts?: { method: string },
    ) => {
      calls.push([String(url), opts as { method: string }]);
      return jsonResponse({ agent: { id: "agent-1" } });
    }) as unknown as typeof fetch;

    const result = await submitAgentUpdate("agent-1", { name: "x" }, fetchImpl);

    expect(result).toEqual({ ok: true, agentId: "agent-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("/api/background-agents/agent-1");
    expect(calls[0][1].method).toBe("PATCH");
  });

  test("surfaces a field-level validation error on failure", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { details: { fieldErrors: { name: ["Required"] } } },
        false,
      )) as unknown as typeof fetch;

    const result = await submitAgentUpdate("agent-1", {}, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.error).toContain("name");
    }
  });

  test("surfaces a bare error message when there are no field details (404)", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: "Background agent not found" }, false, 404)) as unknown as typeof fetch;

    const result = await submitAgentUpdate("agent-1", {}, fetchImpl);

    expect(result).toEqual({ ok: false, error: "Background agent not found" });
  });

  test("falls back to a generic error when the body has no details or error", async () => {
    const fetchImpl = (async () =>
      jsonResponse({}, false)) as unknown as typeof fetch;
    const result = await submitAgentUpdate("agent-1", {}, fetchImpl);
    expect(result).toEqual({
      ok: false,
      error: "Failed to update background agent",
    });
  });
});
