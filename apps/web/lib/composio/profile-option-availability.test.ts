import { describe, expect, test } from "bun:test";
import {
  getDisconnectedProfileReason,
  markDisconnectedProfilesUnavailable,
} from "./profile-option-availability";

const toolkits = [
  { slug: "gmail", noAuth: false },
  { slug: "github", noAuth: false },
  { slug: "deepwiki-mcp", noAuth: true },
];

describe("getDisconnectedProfileReason", () => {
  test("returns a reason for auth-required tools without connected accounts", () => {
    expect(
      getDisconnectedProfileReason({
        toolkitSlugs: ["gmail"],
        toolkits,
        connectedAccounts: [],
      }),
    ).toBe("Tool not connected: gmail.");
  });

  test("does not flag connected auth-required tools", () => {
    expect(
      getDisconnectedProfileReason({
        toolkitSlugs: ["github"],
        toolkits,
        connectedAccounts: [{ toolkitSlug: "github" }],
      }),
    ).toBeNull();
  });

  test("does not flag no-auth tools", () => {
    expect(
      getDisconnectedProfileReason({
        toolkitSlugs: ["deepwiki-mcp"],
        toolkits,
        connectedAccounts: [],
      }),
    ).toBeNull();
  });
});

describe("markDisconnectedProfilesUnavailable", () => {
  test("preserves existing disabled reasons", () => {
    const [profile] = markDisconnectedProfilesUnavailable({
      profiles: [
        {
          id: "profile-1",
          toolkitSlugs: ["gmail"],
          available: false,
          disabledReason: "Blocked by repository policy.",
        },
      ],
      toolkits,
      connectedAccounts: [],
    });

    expect(profile?.available).toBe(false);
    expect(profile?.disabledReason).toBe("Blocked by repository policy.");
  });
});
