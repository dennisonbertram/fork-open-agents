import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  listComposioConnectedAccounts,
  listActiveConnectedAccountIdsByToolkit,
} = await import("./connected-accounts");

function fakeClient(listResult: unknown) {
  const list = mock(async (_params: Record<string, unknown>) => listResult);
  return { composio: { connectedAccounts: { list } }, list };
}

describe("listComposioConnectedAccounts", () => {
  test("parses a bare-array SDK response", async () => {
    const { composio } = fakeClient([
      { id: "ca_1", status: "ACTIVE", alias: null, toolkit: { slug: "gmail" } },
    ]);

    const accounts = await listComposioConnectedAccounts({
      composio,
      userId: "user-1",
    });

    expect(accounts).toEqual([
      { id: "ca_1", toolkitSlug: "gmail", status: "ACTIVE", alias: null },
    ]);
  });

  test("parses an { items } wrapped SDK response", async () => {
    const { composio } = fakeClient({
      items: [
        {
          id: "ca_2",
          status: "ACTIVE",
          alias: "work",
          toolkit: { slug: "slack" },
        },
      ],
    });

    const accounts = await listComposioConnectedAccounts({
      composio,
      userId: "user-1",
    });

    expect(accounts).toEqual([
      { id: "ca_2", toolkitSlug: "slack", status: "ACTIVE", alias: "work" },
    ]);
  });

  test("returns ALL statuses unfiltered — ACTIVE, EXPIRED, INITIATED, FAILED", async () => {
    const { composio } = fakeClient({
      items: [
        { id: "ca_a", status: "ACTIVE", toolkit: { slug: "gmail" } },
        { id: "ca_b", status: "EXPIRED", toolkit: { slug: "slack" } },
        { id: "ca_c", status: "INITIATED", toolkit: { slug: "notion" } },
        { id: "ca_d", status: "FAILED", toolkit: { slug: "linear" } },
      ],
    });

    const accounts = await listComposioConnectedAccounts({
      composio,
      userId: "user-1",
    });

    expect(accounts.map((a) => a.status).sort()).toEqual(
      ["ACTIVE", "EXPIRED", "FAILED", "INITIATED"].sort(),
    );
  });

  test("does not request a statuses filter from the SDK", async () => {
    const { composio, list } = fakeClient({ items: [] });

    await listComposioConnectedAccounts({ composio, userId: "user-1" });

    expect(list).toHaveBeenCalledWith({
      userIds: ["open_agents_user_user-1"],
    });
    const callArgs = list.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(callArgs?.statuses).toBeUndefined();
  });

  test("defensively skips items missing id or toolkit slug", async () => {
    const { composio } = fakeClient({
      items: [
        { status: "ACTIVE", toolkit: { slug: "github" } }, // missing id
        { id: "ca_e", status: "ACTIVE" }, // missing toolkit
        { id: "ca_f", status: "ACTIVE", toolkit: { slug: "linear" } }, // valid
      ],
    });

    const accounts = await listComposioConnectedAccounts({
      composio,
      userId: "user-1",
    });

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe("ca_f");
  });

  test("propagates (does not swallow) an SDK throw", async () => {
    const list = mock(async () => {
      throw new Error("SDK boom");
    });
    const composio = { connectedAccounts: { list } };

    await expect(
      listComposioConnectedAccounts({ composio, userId: "user-1" }),
    ).rejects.toThrow("SDK boom");
  });
});

describe("listActiveConnectedAccountIdsByToolkit", () => {
  test("groups only ACTIVE account ids by toolkit slug", async () => {
    const { composio } = fakeClient({
      items: [
        { id: "ca_a", status: "ACTIVE", toolkit: { slug: "gmail" } },
        { id: "ca_b", status: "EXPIRED", toolkit: { slug: "slack" } },
        { id: "ca_c", status: "ACTIVE", toolkit: { slug: "gmail" } },
      ],
    });

    const grouped = await listActiveConnectedAccountIdsByToolkit({
      composio,
      userId: "user-1",
    });

    expect(grouped).toEqual({ gmail: ["ca_a", "ca_c"] });
    expect(grouped.slack).toBeUndefined();
  });

  test("reuses a single underlying SDK call (not a second round-trip)", async () => {
    const { composio, list } = fakeClient({ items: [] });

    await listActiveConnectedAccountIdsByToolkit({
      composio,
      userId: "user-1",
    });

    expect(list).toHaveBeenCalledTimes(1);
  });
});
