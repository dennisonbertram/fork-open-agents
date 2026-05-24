import { describe, expect, test } from "bun:test";

const { buildComposioSessionConfig, getComposioProfileConfigHash } =
  await import("./session-config");
const { toComposioUserId } = await import("./user-id");

function createProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "user-1",
    name: "GitHub",
    toolkitSlugs: ["github", "gmail"],
    authConfigIdsByToolkit: {
      github: "auth-github",
      gmail: null,
    },
    connectedAccountIdsByToolkit: {
      github: ["account-github"],
      gmail: [],
    },
    workbenchEnabled: false,
    allowInChatConnectionManagement: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("Composio session helpers", () => {
  test("builds a bounded Composio session config from a profile", () => {
    expect(buildComposioSessionConfig(createProfile())).toEqual({
      toolkits: ["github", "gmail"],
      authConfigs: {
        github: "auth-github",
      },
      connectedAccounts: {
        github: ["account-github"],
      },
      manageConnections: {
        enable: true,
      },
      workbench: {
        enable: false,
      },
    });
  });

  test("hashes only profile tool configuration, not database metadata", () => {
    const firstHash = getComposioProfileConfigHash(createProfile());
    const secondHash = getComposioProfileConfigHash(
      createProfile({
        id: "profile-2",
        name: "Renamed",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
    );
    const changedHash = getComposioProfileConfigHash(
      createProfile({
        toolkitSlugs: ["github"],
      }),
    );

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBe(changedHash);
  });

  test("uses a stable application-scoped user id", () => {
    expect(toComposioUserId("user-1")).toBe("open_agents_user_user-1");
  });
});
