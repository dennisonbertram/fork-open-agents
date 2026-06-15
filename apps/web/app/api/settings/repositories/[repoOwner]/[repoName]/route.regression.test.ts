/**
 * Regression tests for the repo-settings PATCH API route.
 * These would fail if the GREEN commit (87196ac2) were reverted.
 *
 * Scenarios:
 * - REG-ROUTE-001: PATCH unauthenticated always returns 401, not 200 or 501
 * - REG-ROUTE-002: PATCH with all-null body writes all-null (inherited everywhere)
 * - REG-ROUTE-003: autoCreatePr=true is accepted when autoCommitPush is also true
 * - REG-ROUTE-004: invalid vcpus (string) is always rejected, not silently coerced
 * - REG-ROUTE-005: DELETE always sends all-null to upsert, not a partial object
 * - REG-ROUTE-006: GET raw is null when no settings row, not undefined
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
  fullClone: null,
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

let getRepositorySettingsResult: typeof mockRawSettings | undefined =
  undefined; // default: no row

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
    return { ...mockRawSettings, ...params.settings };
  },
}));

mock.module("@/lib/repo-settings/resolve-repo-defaults", () => ({
  resolveRepoDefaults: async () => ({
    fullClone: false,
    prewarmEnabled: false,
    runtimeMode: "classic" as const,
    managedRuntimeProfileId: "web-bun-agent-browser",
    vcpus: 1,
    autoCommitPush: true, // NOTE: true here so autoCreatePr=true is valid in REG-003
    autoCreatePr: false,
    defaultBranch: null,
    isNewBranch: false,
  }),
}));

mock.module("@open-agents/sandbox/managed-runtime-profiles", () => ({
  isManagedRuntimeProfileId: (id: unknown) => id === "web-bun-agent-browser",
  listManagedRuntimeProfiles: () => [
    { id: "web-bun-agent-browser", displayName: "Default" },
  ],
}));

const routeModule = import("./route");

function makeContext(repoOwner = "acme", repoName = "web") {
  return { params: Promise.resolve({ repoOwner, repoName }) };
}

beforeEach(() => {
  authResult = { ok: true, userId: "user-1" };
  lastUpsertParams = null;
  getRepositorySettingsResult = undefined;
});

describe("Regression — repo settings route", () => {
  test("REG-ROUTE-001: PATCH unauthenticated always 401, never 200 or 501", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
    const { PATCH } = await routeModule;
    const res = await PATCH(
      new Request("http://localhost/api/settings/repositories/acme/web", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullClone: true }),
      }),
      makeContext(),
    );
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(501);
  });

  test("REG-ROUTE-002: PATCH with all-null body writes all-null to upsert", async () => {
    const { PATCH } = await routeModule;
    const allNullBody = {
      fullClone: null,
      prewarmEnabled: null,
      runtimeMode: null,
      managedRuntimeProfileId: null,
      vcpus: null,
      autoCommitPush: null,
      autoCreatePr: null,
      defaultBranch: null,
      isNewBranch: null,
    };
    const res = await PATCH(
      new Request("http://localhost/api/settings/repositories/acme/web", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allNullBody),
      }),
      makeContext(),
    );
    expect(res.status).toBe(200);
    expect(lastUpsertParams!.settings.fullClone).toBeNull();
    expect(lastUpsertParams!.settings.vcpus).toBeNull();
    expect(lastUpsertParams!.settings.autoCommitPush).toBeNull();
  });

  test("REG-ROUTE-003: autoCreatePr=true accepted when autoCommitPush is resolved true", async () => {
    // resolved mock above has autoCommitPush=true, so this should succeed
    const { PATCH } = await routeModule;
    const res = await PATCH(
      new Request("http://localhost/api/settings/repositories/acme/web", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCreatePr: true }),
      }),
      makeContext(),
    );
    expect(res.status).toBe(200);
    expect(lastUpsertParams!.settings.autoCreatePr).toBe(true);
  });

  test("REG-ROUTE-004: invalid vcpus (string) always rejected", async () => {
    const { PATCH } = await routeModule;
    const res = await PATCH(
      new Request("http://localhost/api/settings/repositories/acme/web", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vcpus: "lots" }),
      }),
      makeContext(),
    );
    expect(res.status).toBe(400);
  });

  test("REG-ROUTE-005: DELETE sends all-null, never partial, to upsert", async () => {
    const { DELETE } = await routeModule;
    const res = await DELETE(
      new Request("http://localhost/api/settings/repositories/acme/web", {
        method: "DELETE",
      }),
      makeContext(),
    );
    expect(res.status).toBe(200);
    const s = lastUpsertParams!.settings;
    const allNullKeys = [
      "fullClone",
      "prewarmEnabled",
      "runtimeMode",
      "managedRuntimeProfileId",
      "vcpus",
      "autoCommitPush",
      "autoCreatePr",
      "defaultBranch",
      "isNewBranch",
    ];
    for (const key of allNullKeys) {
      expect(s[key]).toBeNull();
    }
  });

  test("REG-ROUTE-006: GET raw is null (not undefined) when no settings row exists", async () => {
    getRepositorySettingsResult = undefined;
    const { GET } = await routeModule;
    const res = await GET(
      new Request("http://localhost/api/settings/repositories/acme/web"),
      makeContext(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { raw: unknown };
    expect(body.raw).toBeNull();
    expect(body.raw).not.toBeUndefined();
  });
});
