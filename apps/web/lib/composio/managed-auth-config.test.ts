import { describe, expect, test } from "bun:test";
import {
  COMPOSIO_MANAGED_AUTH,
  type ManagedAuthConfigClient,
  resolveManagedAuthConfigId,
} from "./managed-auth-config";

function fakeClient(opts: {
  existing?: Array<{ id?: string | null }>;
  createdId?: string;
  onCreate?: (toolkit: string, options: { type: string }) => void;
  onList?: (query: { toolkit: string; isComposioManaged?: boolean }) => void;
}): ManagedAuthConfigClient {
  return {
    authConfigs: {
      list: (query) => {
        opts.onList?.(query);
        return Promise.resolve({ items: opts.existing ?? [] });
      },
      create: (toolkit, options) => {
        opts.onCreate?.(toolkit, options);
        return Promise.resolve({ id: opts.createdId ?? "ac_created" });
      },
    },
  };
}

describe("resolveManagedAuthConfigId", () => {
  test("reuses an existing managed auth config and does not create one", async () => {
    let created = false;
    const client = fakeClient({
      existing: [{ id: "ac_existing" }],
      onCreate: () => {
        created = true;
      },
    });
    const id = await resolveManagedAuthConfigId(client, "notion");
    expect(id).toBe("ac_existing");
    expect(created).toBe(false);
  });

  test("filters the list by toolkit + isComposioManaged", async () => {
    let seen: { toolkit: string; isComposioManaged?: boolean } | null = null;
    const client = fakeClient({
      existing: [{ id: "ac_x" }],
      onList: (q) => {
        seen = q;
      },
    });
    await resolveManagedAuthConfigId(client, "gmail");
    expect(seen as Record<string, unknown> | null).toEqual({
      toolkit: "gmail",
      isComposioManaged: true,
    });
  });

  test("creates a managed auth config when none exists", async () => {
    let createArgs: { toolkit: string; type: string } | null = null;
    const client = fakeClient({
      existing: [],
      createdId: "ac_new",
      onCreate: (toolkit, options) => {
        createArgs = { toolkit, type: options.type };
      },
    });
    const id = await resolveManagedAuthConfigId(client, "slack");
    expect(id).toBe("ac_new");
    expect(createArgs as Record<string, unknown> | null).toEqual({
      toolkit: "slack",
      type: COMPOSIO_MANAGED_AUTH,
    });
  });

  test("skips list items without an id, then creates", async () => {
    const client = fakeClient({
      existing: [{ id: null }, {}],
      createdId: "ac_fallback",
    });
    const id = await resolveManagedAuthConfigId(client, "linear");
    expect(id).toBe("ac_fallback");
  });
});
