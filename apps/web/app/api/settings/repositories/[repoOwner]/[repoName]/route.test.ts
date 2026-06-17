/**
 * BT-ROUTE-001: GET returns 401 when unauthenticated
 * BT-ROUTE-002: GET returns 400 on invalid params
 * BT-ROUTE-003: GET returns resolved+raw when authenticated
 * BT-ROUTE-004: PATCH returns 401 when unauthenticated
 * BT-ROUTE-005: PATCH returns 400 on invalid JSON body
 * BT-ROUTE-006: PATCH returns 400 on invalid managedRuntimeProfileId
 * BT-ROUTE-007: PATCH returns 400 on out-of-range vcpus
 * BT-ROUTE-008: PATCH returns 400 on invalid runtimeMode
 * BT-ROUTE-009: PATCH with single field writes only that field (upsert called with undefined for others)
 * BT-ROUTE-010: PATCH with explicit null clears to inherit
 * BT-ROUTE-011: PATCH autoCreatePr=true with autoCommitPush=false is rejected
 * BT-ROUTE-012: PATCH success returns refreshed resolved+raw
 * BT-ROUTE-013: DELETE/reset writes all-null (resets to inherit)
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let lastUpsertParams: {
  userId: string;
  repoOwner: string;
  repoName: string;
  settings: Record<string, unknown>;
} | null = null;

const mockRawSettings = {
  id: "settings-1",
  userId: "user-1",
  repoOwner: "acme",
  repoName: "web",
  fullClone: true,
  prewarmEnabled: null,
  runtimeMode: null,
  managedRuntimeProfileId: null,
  vcpus: null,
  autoCommitPush: null,
  autoCreatePr: null,
  defaultBranch: null,
  isNewBranch: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const mockResolved = {
  fullClone: true,
  prewarmEnabled: false,
  runtimeMode: "classic" as const,
  managedRuntimeProfileId: "web-bun-agent-browser",
  vcpus: 1,
  autoCommitPush: false,
  autoCreatePr: false,
  defaultBranch: null,
  isNewBranch: false,
};

let getRepositorySettingsResult: typeof mockRawSettings | undefined =
  mockRawSettings;
let upsertRepositorySettingsResult: typeof mockRawSettings = mockRawSettings;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/db/repository-settings", () => ({
  getRepositorySettings: async () => getRepositorySettingsResult,
  upsertRepositorySettings: async (params: {
    userId: string;
    repoOwner: string;
    repoName: string;
    settings: Record<string, unknown>;
  }) => {
    lastUpsertParams = params;
    return upsertRepositorySettingsResult;
  },
}));

mock.module("@/lib/repo-settings/resolve-repo-defaults", () => ({
  resolveRepoDefaults: async () => mockResolved,
}));

mock.module("@/lib/db/user-preferences", () => ({
  // Match mockResolved (autoCommitPush=false) so the cross-field invariant tests hold.
  getUserPreferences: async () => ({
    autoCommitPush: false,
    autoCreatePr: false,
  }),
}));

mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  isManagedRuntimeProfileId: (id: unknown) =>
    id === "web-bun-agent-browser" || id === "custom-profile",
  listManagedRuntimeProfiles: () => [
    { id: "web-bun-agent-browser", displayName: "Default" },
  ],
}));

const routeModule = import("./route");

function makeRequest(
  method: string,
  body?: unknown,
  repoOwner = "acme",
  repoName = "web",
) {
  return new Request(
    `http://localhost/api/settings/repositories/${repoOwner}/${repoName}`,
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}

function makeContext(repoOwner = "acme", repoName = "web") {
  return {
    params: Promise.resolve({ repoOwner, repoName }),
  };
}

beforeEach(() => {
  authResult = { ok: true, userId: "user-1" };
  lastUpsertParams = null;
  getRepositorySettingsResult = mockRawSettings;
  upsertRepositorySettingsResult = mockRawSettings;
});

describe("GET /api/settings/repositories/[repoOwner]/[repoName]", () => {
  test("BT-ROUTE-001: returns 401 when unauthenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { GET } = await routeModule;
    const res = await GET(makeRequest("GET"), makeContext());
    expect(res.status).toBe(401);
  });

  test("BT-ROUTE-002: returns 400 on empty repoOwner param", async () => {
    const { GET } = await routeModule;
    const res = await GET(makeRequest("GET"), makeContext("", "web"));
    expect(res.status).toBe(400);
  });

  test("BT-ROUTE-003: returns resolved and raw settings when authenticated", async () => {
    const { GET } = await routeModule;
    const res = await GET(makeRequest("GET"), makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resolved: unknown;
      raw: unknown;
    };
    expect(body.resolved).toBeDefined();
    expect(body.raw).toBeDefined();
  });

  test("BT-ROUTE-003b: raw is null when no settings row exists", async () => {
    getRepositorySettingsResult = undefined;
    const { GET } = await routeModule;
    const res = await GET(makeRequest("GET"), makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { raw: unknown };
    expect(body.raw).toBeNull();
  });
});

describe("PATCH /api/settings/repositories/[repoOwner]/[repoName]", () => {
  test("BT-ROUTE-004: returns 401 when unauthenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { PATCH } = await routeModule;
    const res = await PATCH(makeRequest("PATCH", {}), makeContext());
    expect(res.status).toBe(401);
  });

  test("BT-ROUTE-005: returns 400 on invalid JSON body", async () => {
    const { PATCH } = await routeModule;
    const req = new Request(
      "http://localhost/api/settings/repositories/acme/web",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not-json{",
      },
    );
    const res = await PATCH(req, makeContext());
    expect(res.status).toBe(400);
  });

  test("BT-ROUTE-006: returns 400 on invalid managedRuntimeProfileId", async () => {
    const { PATCH } = await routeModule;
    const res = await PATCH(
      makeRequest("PATCH", { managedRuntimeProfileId: "unknown-profile" }),
      makeContext(),
    );
    expect(res.status).toBe(400);
  });

  test("BT-ROUTE-007: returns 400 on out-of-range vcpus", async () => {
    const { PATCH } = await routeModule;
    const res = await PATCH(
      makeRequest("PATCH", { vcpus: 999 }),
      makeContext(),
    );
    expect(res.status).toBe(400);
  });

  test("BT-ROUTE-008: returns 400 on invalid runtimeMode", async () => {
    const { PATCH } = await routeModule;
    const res = await PATCH(
      makeRequest("PATCH", { runtimeMode: "invalid_mode" }),
      makeContext(),
    );
    expect(res.status).toBe(400);
  });

  test("BT-ROUTE-009: PATCH with single field calls upsert with only that field", async () => {
    const { PATCH } = await routeModule;
    const res = await PATCH(
      makeRequest("PATCH", { fullClone: true }),
      makeContext(),
    );
    expect(res.status).toBe(200);
    expect(lastUpsertParams).not.toBeNull();
    expect(lastUpsertParams!.settings.fullClone).toBe(true);
    // Other fields not included in the patch
    expect("prewarmEnabled" in lastUpsertParams!.settings).toBe(false);
    expect("runtimeMode" in lastUpsertParams!.settings).toBe(false);
  });

  test("BT-ROUTE-010: PATCH with explicit null clears field to inherit", async () => {
    const { PATCH } = await routeModule;
    const res = await PATCH(
      makeRequest("PATCH", { fullClone: null }),
      makeContext(),
    );
    expect(res.status).toBe(200);
    expect(lastUpsertParams!.settings.fullClone).toBeNull();
  });

  test("BT-ROUTE-011: autoCreatePr=true with autoCommitPush=false is rejected", async () => {
    // The existing resolved values have autoCommitPush=false
    const { PATCH } = await routeModule;
    const res = await PATCH(
      makeRequest("PATCH", { autoCreatePr: true }),
      makeContext(),
    );
    expect(res.status).toBe(400);
  });

  test("BT-ROUTE-012: success returns refreshed resolved+raw", async () => {
    const { PATCH } = await routeModule;
    const res = await PATCH(
      makeRequest("PATCH", { fullClone: true }),
      makeContext(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resolved: unknown; raw: unknown };
    expect(body.resolved).toBeDefined();
    expect(body.raw).toBeDefined();
  });
});

describe("DELETE /api/settings/repositories/[repoOwner]/[repoName]", () => {
  test("BT-ROUTE-013: DELETE resets all overrides (upsert called with all-null)", async () => {
    const { DELETE } = await routeModule;
    const req = new Request(
      "http://localhost/api/settings/repositories/acme/web",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeContext());
    expect(res.status).toBe(200);
    expect(lastUpsertParams).not.toBeNull();
    const settings = lastUpsertParams!.settings;
    // All fields should be null
    expect(settings.fullClone).toBeNull();
    expect(settings.prewarmEnabled).toBeNull();
    expect(settings.runtimeMode).toBeNull();
    expect(settings.vcpus).toBeNull();
    expect(settings.autoCommitPush).toBeNull();
    expect(settings.autoCreatePr).toBeNull();
    expect(settings.defaultBranch).toBeNull();
    expect(settings.isNewBranch).toBeNull();
  });

  test("BT-ROUTE-013b: DELETE returns 401 when unauthenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { DELETE } = await routeModule;
    const req = new Request(
      "http://localhost/api/settings/repositories/acme/web",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeContext());
    expect(res.status).toBe(401);
  });
});
