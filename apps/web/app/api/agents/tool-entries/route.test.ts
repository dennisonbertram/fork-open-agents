/**
 * Tests for /api/agents/tool-entries route.
 *
 * BT-012: GET returns 401 when not authenticated
 * BT-013: GET returns the list of tool entries for the authenticated user's agent
 * BT-014: POST (approve) returns 404 when entry doesn't belong to user (owner scoping)
 * BT-015: POST (approve) returns 200 and approved=true when entry belongs to user
 * BT-016: POST (reject) sets rejected status
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";

// ── Mock server-only ──────────────────────────────────────────────────────────
mock.module("server-only", () => ({}));

// ── Shared state ──────────────────────────────────────────────────────────────
let mockAuthResult: { ok: boolean; userId?: string; response?: Response } = {
  ok: true,
  userId: "user-abc",
};
let mockListResult: unknown[] = [];
let mockApproveResult = false;
let mockRejectResult = false;

// ── Mock auth ─────────────────────────────────────────────────────────────────
mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => mockAuthResult,
}));

// ── Mock data layer ───────────────────────────────────────────────────────────
mock.module("@/lib/db/agent-tool-entries", () => ({
  listToolEntriesForAgent: async (_userId: string, _agentId: string) =>
    mockListResult,
  approveToolEntry: async (_userId: string, _entryId: string) =>
    mockApproveResult,
  rejectToolEntry: async (_userId: string, _entryId: string) =>
    mockRejectResult,
}));

const { GET, POST } = await import("./route");

function resetState() {
  mockAuthResult = { ok: true, userId: "user-abc" };
  mockListResult = [];
  mockApproveResult = false;
  mockRejectResult = false;
}

describe("GET /api/agents/tool-entries", () => {
  beforeEach(resetState);

  // BT-012: unauthenticated returns 401
  it("returns 401 when not authenticated", async () => {
    mockAuthResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      }),
    };

    const req = new Request(
      "http://localhost/api/agents/tool-entries?agentId=agent-abc",
    );
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  // BT-013: returns entries for the authenticated user
  it("returns 200 with entries for the authenticated user's agent", async () => {
    mockListResult = [
      {
        id: "e1",
        agentId: "agent-abc",
        toolkitSlug: "github",
        status: "proposed",
      },
    ];

    const req = new Request(
      "http://localhost/api/agents/tool-entries?agentId=agent-abc",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("returns 400 when agentId query param is missing", async () => {
    const req = new Request("http://localhost/api/agents/tool-entries");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/agents/tool-entries (approve/reject)", () => {
  beforeEach(resetState);

  // BT-015: approve succeeds for owner
  it("returns 200 when approve succeeds for owner", async () => {
    mockApproveResult = true;

    const req = new Request("http://localhost/api/agents/tool-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", entryId: "entry-001" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  // BT-014: approve returns 404 when entry not found for user
  it("returns 404 when approve returns false (entry not owned by user)", async () => {
    mockApproveResult = false;

    const req = new Request("http://localhost/api/agents/tool-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", entryId: "entry-999" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  // BT-016: reject sets rejected status
  it("returns 200 when reject succeeds", async () => {
    mockRejectResult = true;

    const req = new Request("http://localhost/api/agents/tool-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", entryId: "entry-001" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuthResult = {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      }),
    };

    const req = new Request("http://localhost/api/agents/tool-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", entryId: "entry-001" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid action", async () => {
    const req = new Request("http://localhost/api/agents/tool-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", entryId: "entry-001" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});
