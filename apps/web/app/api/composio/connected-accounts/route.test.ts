import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-42" };
let listResult: unknown = {
  items: [
    {
      id: "ca_001",
      status: "ACTIVE",
      alias: "work-gmail",
      toolkit: { slug: "gmail" },
    },
    {
      id: "ca_002",
      status: "ACTIVE",
      alias: null,
      toolkit: { slug: "slack" },
    },
  ],
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "test-key" }),
}));

const listMock = mock(async () => listResult);

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    connectedAccounts: { list: listMock },
  }),
}));

const routePromise = import("./route");

describe("GET /api/composio/connected-accounts", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-42" };
    listResult = {
      items: [
        {
          id: "ca_001",
          status: "ACTIVE",
          alias: "work-gmail",
          toolkit: { slug: "gmail" },
        },
        {
          id: "ca_002",
          status: "ACTIVE",
          alias: null,
          toolkit: { slug: "slack" },
        },
      ],
    };
    listMock.mockClear();
  });

  test("returns 401 when not authenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routePromise;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  test("returns mapped accounts with toolkitSlug, status, alias, id", async () => {
    const { GET } = await routePromise;
    const res = await GET();
    const body = (await res.json()) as {
      accounts: {
        toolkitSlug: string;
        status: string;
        alias: string | null;
        id: string;
      }[];
    };

    expect(res.status).toBe(200);
    expect(body.accounts).toHaveLength(2);

    const gmail = body.accounts.find((a) => a.toolkitSlug === "gmail");
    expect(gmail).toBeDefined();
    expect(gmail?.id).toBe("ca_001");
    expect(gmail?.alias).toBe("work-gmail");
    expect(gmail?.status).toBe("ACTIVE");

    const slack = body.accounts.find((a) => a.toolkitSlug === "slack");
    expect(slack?.alias).toBeNull();
  });

  test("calls list with userIds namespaced as open_agents_user_<userId>", async () => {
    const { GET } = await routePromise;
    await GET();
    expect(listMock).toHaveBeenCalledWith({
      userIds: ["open_agents_user_user-42"],
      statuses: ["ACTIVE"],
    });
  });

  test("returns empty accounts on SDK error (never 500)", async () => {
    listMock.mockImplementationOnce(() => {
      throw new Error("SDK boom");
    });
    const { GET } = await routePromise;
    const res = await GET();
    const body = (await res.json()) as { accounts: unknown[] };

    // Must not 500 — connected accounts are best-effort status
    expect(res.status).toBe(200);
    expect(body.accounts).toHaveLength(0);
  });

  test("handles SDK response as plain array (not items-wrapped object)", async () => {
    listResult = [
      {
        id: "ca_003",
        status: "ACTIVE",
        alias: "personal",
        toolkit: { slug: "notion" },
      },
    ];
    const { GET } = await routePromise;
    const res = await GET();
    const body = (await res.json()) as { accounts: { toolkitSlug: string }[] };

    expect(res.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]?.toolkitSlug).toBe("notion");
  });

  test("skips items missing id or toolkitSlug defensively", async () => {
    listResult = {
      items: [
        // Missing id — should be dropped
        { status: "ACTIVE", toolkit: { slug: "github" } },
        // Missing toolkit — should be dropped
        { id: "ca_005", status: "ACTIVE" },
        // Valid
        { id: "ca_006", status: "ACTIVE", toolkit: { slug: "linear" } },
      ],
    };
    const { GET } = await routePromise;
    const res = await GET();
    const body = (await res.json()) as { accounts: { id: string }[] };

    expect(res.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]?.id).toBe("ca_006");
  });
});
