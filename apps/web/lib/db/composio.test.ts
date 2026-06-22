import { describe, expect, mock, test } from "bun:test";
import type { ComposioToolProfile } from "./schema";

mock.module("server-only", () => ({}));

const { applyRepositoryComposioPolicy } = await import("./composio");

function makeProfile(
  overrides: Partial<ComposioToolProfile>,
): ComposioToolProfile {
  return {
    id: "profile-1",
    userId: "user-1",
    name: "Email",
    toolkitSlugs: ["gmail"],
    authConfigIdsByToolkit: {},
    connectedAccountIdsByToolkit: {},
    workbenchEnabled: false,
    allowInChatConnectionManagement: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("applyRepositoryComposioPolicy", () => {
  test("marks profiles with authenticated but disconnected toolkits unavailable", () => {
    const [option] = applyRepositoryComposioPolicy({
      profiles: [
        makeProfile({
          toolkitSlugs: ["gmail"],
          authConfigIdsByToolkit: { gmail: "auth-gmail" },
          connectedAccountIdsByToolkit: {},
        }),
      ],
      settings: undefined,
    });

    expect(option?.available).toBe(false);
    expect(option?.disabledReason).toBe("Tool not connected: gmail.");
  });

  test("keeps connected authenticated profiles available", () => {
    const [option] = applyRepositoryComposioPolicy({
      profiles: [
        makeProfile({
          toolkitSlugs: ["github"],
          authConfigIdsByToolkit: { github: "auth-github" },
          connectedAccountIdsByToolkit: { github: ["acct-github"] },
        }),
      ],
      settings: undefined,
    });

    expect(option?.available).toBe(true);
    expect(option?.disabledReason).toBeNull();
  });

  test("keeps no-auth profiles available without connected accounts", () => {
    const [option] = applyRepositoryComposioPolicy({
      profiles: [
        makeProfile({
          toolkitSlugs: ["deepwiki-mcp"],
          authConfigIdsByToolkit: {},
          connectedAccountIdsByToolkit: {},
        }),
      ],
      settings: undefined,
    });

    expect(option?.available).toBe(true);
    expect(option?.disabledReason).toBeNull();
  });
});
