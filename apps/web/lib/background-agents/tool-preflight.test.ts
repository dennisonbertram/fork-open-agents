/**
 * Tests for the agent tool preflight dry-run (#802, epic #796 T6).
 *
 * computeAgentToolPreflight predicts, per configured toolkit slug, what
 * resolveComposioToolsForBgRun would actually do on the NEXT run — WITHOUT
 * creating a Composio session or minting a token. It must compose the same
 * shared resolvers the real bg-run path uses:
 *   - applyRepoToolkitPolicy (repo allowlist/denylist, #799)
 *   - listComposioConnectedAccounts (full-status connected-accounts fetch, #800)
 *   - getToolkitConnectionState / buildToolkitStatusMap (four-state derivation, #800)
 *   - getComposioErrorKind (7-value errorKind taxonomy, #800)
 *
 * Behavioral tests (BT-802-*), one per predicted state in the issue's
 * six-state contract:
 * BT-802-001: ready — ACTIVE connected account, no repo policy block.
 * BT-802-002: blocked_by_repo_policy — repo denylist blocks the slug; names
 *   the blocking rule as "repo_policy_blocked".
 * BT-802-003: not_connected — no connected account at all for the slug.
 * BT-802-004: auth_expired — connected account exists but is EXPIRED.
 * BT-802-005: not_in_repo_allowlist — a non-null allowlist drops the slug
 *   (distinct blocked reason from BT-802-002, same predictedState).
 * BT-802-006: composio_unreachable — connectedAccounts.list rejects; every
 *   requested slug reports composio_unreachable with an errorKind.
 * BT-802-007: no Composio session/token is ever created — asserts a spy on
 *   composio.create is never invoked, only list-style calls.
 * BT-802-008: mixed slugs resolve independently in one call (ready + blocked
 *   + not_connected + auth_expired all in the same request).
 * BT-802-009 (Codex review on PR #849): a NO_AUTH toolkit (per Composio's
 *   toolkit metadata, finding G9) with zero connected accounts predicts
 *   "ready", not "not_connected" — matching resolveComposioToolsForToolkitList's
 *   toolkitRequiresAuth exclusion (resolve-toolkit-list.ts), which the real
 *   bg-run path applies via resolveComposioToolsForBgRun. Preflight must
 *   reuse that same no-auth detection rather than treating every
 *   zero-account slug as disconnected.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mocks — must be at top level for Bun's module mock hoisting
// ---------------------------------------------------------------------------

type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let repoSettingsValues: RepoSettingsValues | null = null;

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: async () => ({}) as unknown,
  getRepositoryComposioSettingsValues: (
    _settings: unknown,
  ): RepoSettingsValues | null => repoSettingsValues,
}));

type FakeAccount = {
  id: string;
  toolkitSlug: string;
  status: string;
  alias: string | null;
};

let listAccountsResult: FakeAccount[] = [];
let listAccountsError: Error | null = null;
const createSessionSpy = mock(async () => {
  throw new Error("computeAgentToolPreflight must never call composio.create");
});
const listAccountsCalls: unknown[] = [];

// Per-slug toolkit metadata for the no-auth detection path (BT-802-009).
// Defaults to every slug requiring auth (real API shape: mode carries the
// scheme identifier, name is a display label — see resolve-toolkit-list.ts).
let toolkitsGetImpl: (
  slug: string,
) => Promise<{ authConfigDetails?: unknown }> = (_slug: string) =>
  Promise.resolve({ authConfigDetails: [{ name: "OAuth2", mode: "OAUTH2" }] });

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({
    connectedAccounts: {
      list: async (params: unknown) => {
        listAccountsCalls.push(params);
        if (listAccountsError) {
          throw listAccountsError;
        }
        return { items: listAccountsResult };
      },
    },
    toolkits: {
      get: (slug: string) => toolkitsGetImpl(slug),
    },
    create: createSessionSpy,
  }),
}));

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: true, apiKey: "ak_test" }),
}));

// ---------------------------------------------------------------------------
// Module import (after mocks)
// ---------------------------------------------------------------------------

const toolPreflightModulePromise = import("./tool-preflight");

beforeEach(() => {
  repoSettingsValues = null;
  listAccountsResult = [];
  listAccountsError = null;
  listAccountsCalls.length = 0;
  createSessionSpy.mockClear();
  toolkitsGetImpl = (_slug: string) =>
    Promise.resolve({
      authConfigDetails: [{ name: "OAuth2", mode: "OAUTH2" }],
    });
});

describe("computeAgentToolPreflight — predicted states (#802)", () => {
  test("BT-802-001: ready — ACTIVE connected account, no repo policy block", async () => {
    listAccountsResult = [
      { id: "acc-1", toolkitSlug: "gmail", status: "ACTIVE", alias: null },
    ];
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail"],
    });

    expect(result.toolkits).toEqual([
      { slug: "gmail", predictedState: "ready" },
    ]);
  });

  test("BT-802-002: blocked_by_repo_policy — repo denylist blocks the slug", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["slack"],
    };
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["slack"],
    });

    expect(result.toolkits).toEqual([
      {
        slug: "slack",
        predictedState: "blocked_by_repo_policy",
        policyReason: "repo_policy_blocked",
      },
    ]);
  });

  test("BT-802-003: not_connected — no connected account at all for the slug", async () => {
    listAccountsResult = [];
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail"],
    });

    expect(result.toolkits).toEqual([
      { slug: "gmail", predictedState: "not_connected" },
    ]);
  });

  test("BT-802-004: auth_expired — connected account exists but is EXPIRED", async () => {
    listAccountsResult = [
      { id: "acc-1", toolkitSlug: "linear", status: "EXPIRED", alias: null },
    ];
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["linear"],
    });

    expect(result.toolkits).toEqual([
      { slug: "linear", predictedState: "auth_expired" },
    ]);
  });

  test("BT-802-005: not_in_repo_allowlist — a non-null allowlist drops the slug", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: ["github"],
      blockedToolkitSlugs: [],
    };
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["slack"],
    });

    expect(result.toolkits).toEqual([
      {
        slug: "slack",
        predictedState: "blocked_by_repo_policy",
        policyReason: "not_in_repo_allowlist",
      },
    ]);
  });

  test("BT-802-006: composio_unreachable — connectedAccounts.list rejects for every slug", async () => {
    listAccountsError = new Error("Composio is unreachable");
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail", "linear"],
    });

    expect(result.toolkits).toEqual([
      {
        slug: "gmail",
        predictedState: "composio_unreachable",
        errorKind: "composio_unreachable",
      },
      {
        slug: "linear",
        predictedState: "composio_unreachable",
        errorKind: "composio_unreachable",
      },
    ]);
  });

  test("BT-802-007: never calls composio.create / never mints a session", async () => {
    listAccountsResult = [
      { id: "acc-1", toolkitSlug: "gmail", status: "ACTIVE", alias: null },
    ];
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail"],
    });

    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(listAccountsCalls.length).toBeGreaterThan(0);
  });

  test("BT-802-008: mixed slugs resolve independently in one call", async () => {
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["slack"],
    };
    listAccountsResult = [
      { id: "acc-1", toolkitSlug: "gmail", status: "ACTIVE", alias: null },
      { id: "acc-2", toolkitSlug: "linear", status: "EXPIRED", alias: null },
    ];
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      slugs: ["gmail", "linear", "slack", "notion"],
    });

    expect(result.toolkits).toEqual([
      { slug: "gmail", predictedState: "ready" },
      { slug: "linear", predictedState: "auth_expired" },
      {
        slug: "slack",
        predictedState: "blocked_by_repo_policy",
        policyReason: "repo_policy_blocked",
      },
      { slug: "notion", predictedState: "not_connected" },
    ]);
    expect(createSessionSpy).not.toHaveBeenCalled();
  });

  test("BT-802-009: a NO_AUTH toolkit with zero connected accounts predicts ready, not not_connected", async () => {
    listAccountsResult = [];
    toolkitsGetImpl = (slug: string) =>
      Promise.resolve(
        slug === "weather"
          ? { authConfigDetails: [{ name: "No Auth", mode: "NO_AUTH" }] }
          : { authConfigDetails: [{ name: "GitHub OAuth", mode: "OAUTH2" }] },
      );
    const { computeAgentToolPreflight } = await toolPreflightModulePromise;

    const result = await computeAgentToolPreflight({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
      // "weather" is a no-auth toolkit with no connected account; "linear"
      // requires auth and also has no connected account — must stay
      // not_connected while "weather" predicts ready.
      slugs: ["weather", "linear"],
    });

    expect(result.toolkits).toEqual([
      { slug: "weather", predictedState: "ready" },
      { slug: "linear", predictedState: "not_connected" },
    ]);
  });
});
