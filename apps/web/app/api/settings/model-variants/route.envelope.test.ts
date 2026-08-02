import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => null,
}));

const { GET } = await import("./route");

describe("model-variants route error envelope (#1054)", () => {
  test("unauthenticated GET returns both error and errorKind", async () => {
    const res = await GET(
      new Request("http://localhost/api/settings/model-variants"),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Not authenticated",
      errorKind: "unauthorized",
    });
  });
});
