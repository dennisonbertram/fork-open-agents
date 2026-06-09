import { beforeAll, describe, expect, test } from "bun:test";
import { apiFetch, apiJson, contractEnabled } from "./_client";

/**
 * Contract for the git/GitHub HTTP routes. Read/validation/gating paths only —
 * no real git mutations (a sandbox-less session 409s before any git work), so
 * this is safe to run anywhere.
 */
describe.skipIf(!contractEnabled)("contract / git routes", () => {
  let ownedSessionId: string | null = null;

  beforeAll(async () => {
    const { data } = await apiJson<{ sessions: Array<{ id: string }> }>(
      "/api/sessions",
    );
    ownedSessionId = data.sessions[0]?.id ?? null;
  });

  test("GET git/status without auth -> 401", async () => {
    const res = await apiFetch("/api/sessions/contract-smoke/git/status", {
      auth: false,
    });
    expect(res.status).toBe(401);
  });

  test("GET git/status on a non-existent session -> 404", async () => {
    const res = await apiFetch(
      "/api/sessions/does-not-exist-contract/git/status",
    );
    expect(res.status).toBe(404);
  });

  test("POST git/branch with an invalid body -> 400 (owned session)", async () => {
    if (!ownedSessionId) {
      return;
    }
    const res = await apiFetch(`/api/sessions/${ownedSessionId}/git/branch`, {
      method: "POST",
      body: { sessionTitle: "x" },
    });
    expect(res.status).toBe(400);
  });

  test("GET git/status on an owned session -> 200 or 409 (no sandbox)", async () => {
    if (!ownedSessionId) {
      return;
    }
    const res = await apiFetch(`/api/sessions/${ownedSessionId}/git/status`);
    expect([200, 409]).toContain(res.status);
  });

  test("GET git/pr (check) on an owned session -> 200 or 409", async () => {
    if (!ownedSessionId) {
      return;
    }
    const res = await apiFetch(`/api/sessions/${ownedSessionId}/git/pr`);
    expect([200, 409]).toContain(res.status);
  });
});
