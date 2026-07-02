import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ManagedRuntimeCommandObservation } from "@/lib/db/schema";

let authenticatedUser:
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    } = { ok: true, userId: "user-1" };
let ownedSession:
  | {
      ok: true;
      sessionRecord: { id: string; userId: string };
    }
  | {
      ok: false;
      response: Response;
    } = {
  ok: true,
  sessionRecord: { id: "session-1", userId: "user-1" },
};
const savedProfiles = [
  {
    id: "session-profile-draft-1",
    sourceDraftId: "draft-1",
    version: "draft-2026-05-24T00:00:00.000Z",
    displayName: "Repo Bun profile",
    description: "Generated profile for this repository",
    setupCommands: [
      {
        id: "install-bun",
        label: "Install Bun",
        description: "Install Bun",
        command: "bun --version",
      },
    ],
    verificationCommands: [
      {
        id: "verify-bun",
        label: "Verify Bun",
        description: "Verify Bun",
        command: "bun --version",
      },
    ],
    expectedTools: ["bun"],
    optionalTools: [],
    defaultPorts: [3000],
    testResults: [] as ManagedRuntimeCommandObservation[],
    testFailureMessage: null as string | null,
    testedAt: null as Date | null,
    lastTestScope: null as "verify" | "setup_and_verify" | null,
  },
];
let sourceDraftResult:
  | {
      id: string;
      status: string;
      testFailureMessage: string | null;
      testResults: Array<{
        commandId: string;
        label: string;
        status: string;
        startedAt: string;
      }>;
      testedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      lastTestScope?: "verify" | "setup_and_verify" | null;
    }
  | undefined = {
  id: "draft-1",
  status: "applied",
  testFailureMessage: null,
  testResults: [
    {
      commandId: "verify-bun",
      label: "Verify Bun",
      status: "passed",
      startedAt: "2026-05-24T00:00:00.000Z",
    },
  ],
  testedAt: new Date("2026-05-24T00:01:00.000Z"),
  createdAt: new Date("2026-05-24T00:00:00.000Z"),
  updatedAt: new Date("2026-05-24T00:01:00.000Z"),
  lastTestScope: "setup_and_verify",
};

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authenticatedUser,
  requireOwnedSession: async () => ownedSession,
  requireOwnedSessionWithSandboxGuard: async () =>
    ownedSession.ok
      ? {
          ok: true,
          sessionRecord: {
            ...ownedSession.sessionRecord,
            sandboxState: {
              type: "vercel",
              sandboxName: "session_session-1",
              expiresAt: Date.now() + 60_000,
            },
          },
        }
      : ownedSession,
}));

mock.module("@/lib/db/managed-runtime-saved-profiles", () => ({
  deleteManagedRuntimeSavedProfile: async () => savedProfiles[0],
  finishManagedRuntimeSavedProfileTest: async () => savedProfiles[0],
  getManagedRuntimeSavedProfile: async () => savedProfiles[0],
  listManagedRuntimeSavedProfiles: async () => savedProfiles,
  markManagedRuntimeSavedProfileTesting: async () => savedProfiles[0],
  toManagedRuntimeProfile: (profile: (typeof savedProfiles)[number]) => profile,
  updateManagedRuntimeSavedProfile: async () => savedProfiles[0],
}));

mock.module("@/lib/db/managed-runtime-profile-drafts", () => ({
  getManagedRuntimeProfileDraft: async () => sourceDraftResult,
  toManagedRuntimeProfileDraftSnapshot: (
    draft: NonNullable<typeof sourceDraftResult>,
  ) => ({
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    testedAt: draft.testedAt?.toISOString() ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  }),
}));

const routeModulePromise = import("./route");

function routeContext() {
  return {
    params: Promise.resolve({
      sessionId: "session-1",
    }),
  };
}

describe("/api/sessions/[sessionId]/managed-runtime/profiles", () => {
  beforeEach(() => {
    authenticatedUser = { ok: true, userId: "user-1" };
    ownedSession = {
      ok: true,
      sessionRecord: { id: "session-1", userId: "user-1" },
    };
    savedProfiles[0].version = "draft-2026-05-24T00:00:00.000Z";
    savedProfiles[0].testResults = [];
    savedProfiles[0].testFailureMessage = null;
    savedProfiles[0].testedAt = null;
    savedProfiles[0].lastTestScope = null;
    sourceDraftResult = {
      id: "draft-1",
      status: "applied",
      testFailureMessage: null,
      testResults: [
        {
          commandId: "verify-bun",
          label: "Verify Bun",
          status: "passed",
          startedAt: "2026-05-24T00:00:00.000Z",
        },
      ],
      testedAt: new Date("2026-05-24T00:01:00.000Z"),
      createdAt: new Date("2026-05-24T00:00:00.000Z"),
      updatedAt: new Date("2026-05-24T00:01:00.000Z"),
      lastTestScope: "setup_and_verify",
    };
  });

  test("GET returns saved session profiles before built-in profiles", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/managed-runtime/profiles",
      ),
      routeContext(),
    );
    const body = (await response.json()) as {
      profiles: Array<{
        id: string;
        source: string;
        setupCommandCount: number;
        testStatus?: string;
        testedAt?: string | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.profiles[0]).toMatchObject({
      id: "session-profile-draft-1",
      source: "session",
      setupCommandCount: 1,
      testStatus: "passed",
      testedAt: "2026-05-24T00:01:00.000Z",
    });
    expect(body.profiles.some((profile) => profile.source === "built_in")).toBe(
      true,
    );
  });

  test("GET surfaces failed source draft evidence for saved profiles", async () => {
    sourceDraftResult = {
      id: "draft-1",
      status: "applied",
      testFailureMessage: "Verify Bun failed",
      testResults: [
        {
          commandId: "verify-bun",
          label: "Verify Bun",
          status: "failed",
          startedAt: "2026-05-24T00:00:00.000Z",
        },
      ],
      testedAt: new Date("2026-05-24T00:01:00.000Z"),
      createdAt: new Date("2026-05-24T00:00:00.000Z"),
      updatedAt: new Date("2026-05-24T00:01:00.000Z"),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/managed-runtime/profiles",
      ),
      routeContext(),
    );
    const body = (await response.json()) as {
      profiles: Array<{
        id: string;
        testStatus?: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.profiles[0]).toMatchObject({
      id: "session-profile-draft-1",
      testStatus: "failed",
    });
  });

  test("GET treats edited saved profiles as untested because source draft evidence is stale", async () => {
    savedProfiles[0].version = "edited-2026-05-24T00:02:00.000Z";
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/managed-runtime/profiles",
      ),
      routeContext(),
    );
    const body = (await response.json()) as {
      profiles: Array<{
        id: string;
        testStatus?: string;
        testedAt?: string | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.profiles[0]).toMatchObject({
      id: "session-profile-draft-1",
      testStatus: "untested",
      testedAt: null,
    });
  });

  test("GET uses saved profile evidence after an edited profile is re-tested", async () => {
    savedProfiles[0].version = "edited-2026-05-24T00:02:00.000Z";
    savedProfiles[0].testResults = [
      {
        commandId: "verify-bun",
        label: "Verify Bun",
        status: "passed",
        required: true,
        startedAt: "2026-05-24T00:03:00.000Z",
      },
    ];
    savedProfiles[0].testedAt = new Date("2026-05-24T00:04:00.000Z");
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/managed-runtime/profiles",
      ),
      routeContext(),
    );
    const body = (await response.json()) as {
      profiles: Array<{
        id: string;
        testStatus?: string;
        testedAt?: string | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.profiles[0]).toMatchObject({
      id: "session-profile-draft-1",
      testStatus: "passed",
      testedAt: "2026-05-24T00:04:00.000Z",
    });
  });

  // RED: today toProfileOption only copies testStatus/testedAt from
  // getSavedProfileTestEvidence, so a passing verify-only saved profile
  // reports no lastTestScope in the list payload. The evidence badge (which
  // already reads profile.lastTestScope) then falls through to its "Tested"
  // branch for a profile whose setup commands were never run (Decision D6).
  test("GET surfaces the persisted verify-only test scope for saved profiles", async () => {
    savedProfiles[0].testResults = [
      {
        commandId: "verify-bun",
        label: "Verify Bun",
        status: "passed",
        required: true,
        startedAt: "2026-05-24T00:03:00.000Z",
      },
    ];
    savedProfiles[0].testedAt = new Date("2026-05-24T00:04:00.000Z");
    savedProfiles[0].lastTestScope = "verify";
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/managed-runtime/profiles",
      ),
      routeContext(),
    );
    const body = (await response.json()) as {
      profiles: Array<{
        id: string;
        testStatus?: string;
        lastTestScope?: "verify" | "setup_and_verify" | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.profiles[0]).toMatchObject({
      id: "session-profile-draft-1",
      testStatus: "passed",
      lastTestScope: "verify",
    });
  });

  // Regression: this is a distinct code path from the direct-evidence test
  // above — a saved profile with NO evidence of its own (never re-tested
  // since being applied from a draft) falls back to the source draft
  // snapshot's testStatus/testedAt. That fallback must also carry
  // lastTestScope, or a profile applied straight from a verify-only-tested
  // draft would still over-promise "Tested" via the badge. If a future
  // change reverts the sourceDraftSnapshot?.lastTestScope fallback (or only
  // wires the savedEvidence branch), this test fails.
  test("GET surfaces the source draft's test scope when the saved profile has no evidence of its own", async () => {
    sourceDraftResult = {
      id: "draft-1",
      status: "tested",
      testFailureMessage: null,
      testResults: [
        {
          commandId: "verify-bun",
          label: "Verify Bun",
          status: "passed",
          startedAt: "2026-05-24T00:00:00.000Z",
        },
      ],
      testedAt: new Date("2026-05-24T00:01:00.000Z"),
      createdAt: new Date("2026-05-24T00:00:00.000Z"),
      updatedAt: new Date("2026-05-24T00:01:00.000Z"),
      lastTestScope: "verify",
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/managed-runtime/profiles",
      ),
      routeContext(),
    );
    const body = (await response.json()) as {
      profiles: Array<{
        id: string;
        testStatus?: string;
        lastTestScope?: "verify" | "setup_and_verify" | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.profiles[0]).toMatchObject({
      id: "session-profile-draft-1",
      testStatus: "passed",
      lastTestScope: "verify",
    });
  });

  test("GET requires authentication", async () => {
    authenticatedUser = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/managed-runtime/profiles",
      ),
      routeContext(),
    );

    expect(response.status).toBe(401);
  });
});
