import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let clientRow: Record<string, unknown> | undefined;

const findFirst = mock(async () => clientRow);

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      oauthApplications: {
        findFirst: () => findFirst(),
      },
    },
  },
}));

const modulePromise = import("./mcp-consent-record");

beforeEach(() => {
  clientRow = undefined;
  findFirst.mockClear();
});

describe("loadRegisteredMcpClient", () => {
  test("returns null for a client_id that was never registered", async () => {
    // The sign-in page renders before any session exists, so client_id is
    // unverified text from the URL. Returning null is what lets the page fall
    // back to neutral copy instead of echoing an attacker's chosen string —
    // e.g. ?client_id=Your+session+expired,+re-enter+your+recovery+code.
    const { loadRegisteredMcpClient } = await modulePromise;

    const result = await loadRegisteredMcpClient(
      "Your session expired, re-enter your recovery code",
    );

    expect(result).toBeNull();
  });

  test("returns null without querying when client_id is empty", async () => {
    const { loadRegisteredMcpClient } = await modulePromise;

    expect(await loadRegisteredMcpClient("")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  test("returns null for a disabled client", async () => {
    clientRow = {
      clientId: "client-1",
      name: "Retired Client",
      redirectUrls: "https://example.test/cb",
      disabled: true,
    };
    const { loadRegisteredMcpClient } = await modulePromise;

    expect(await loadRegisteredMcpClient("client-1")).toBeNull();
  });

  test("returns the registered name and de-duplicated redirect hosts", async () => {
    clientRow = {
      clientId: "client-1",
      name: "Claude Code",
      redirectUrls:
        "https://client.example/cb, https://client.example/other, https://second.example/cb",
      disabled: false,
    };
    const { loadRegisteredMcpClient } = await modulePromise;

    const result = await loadRegisteredMcpClient("client-1");

    expect(result).toEqual({
      clientName: "Claude Code",
      redirectHosts: ["client.example", "second.example"],
    });
  });

  test("falls back to the client id when the registered name is blank", async () => {
    clientRow = {
      clientId: "client-1",
      name: "",
      redirectUrls: "https://client.example/cb",
      disabled: false,
    };
    const { loadRegisteredMcpClient } = await modulePromise;

    const result = await loadRegisteredMcpClient("client-1");

    expect(result?.clientName).toBe("client-1");
  });
});
