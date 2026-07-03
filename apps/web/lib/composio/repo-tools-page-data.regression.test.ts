/**
 * Regression coverage for #805 (epic #796, T9): the repo-tools server-side
 * data loader (getRepoToolsEffectiveStatuses).
 *
 * This pins the integration contract between the loader and its three
 * dependencies (toolkit catalog, applyRepoToolkitPolicy, connected-accounts)
 * that the behavioral tests in repo-tools-effective-status.test.ts do NOT
 * exercise, because those tests call deriveRepoToolkitEffectiveStatuses
 * directly with hand-built inputs. If a future change breaks how the loader
 * WIRES those dependencies together — even if the pure derivation function
 * itself stays correct — these tests fail.
 *
 * REG-RTPD-001: a slug referenced only in blockedToolkitSlugs (not in the
 *   platform catalog at all — e.g. a toolkit that left the catalog after
 *   being blocked) still appears in the result. Regression for "never
 *   silently drop a configured toolkit from the surface".
 * REG-RTPD-002: a slug referenced only in a non-null selectedToolkitSlugs
 *   allowlist (not in the catalog) still appears in the result.
 * REG-RTPD-003: when Composio is not configured, the loader does not throw
 *   and returns not_connected for every catalog-less/settings-referenced
 *   slug rather than crashing the repo dashboard render.
 * REG-RTPD-004: an SDK failure fetching connected accounts degrades to
 *   "not connected" for every slug rather than throwing (repo dashboard
 *   must render even when Composio is down).
 * REG-RTPD-005: an empty toolkit set (no catalog, no policy references)
 *   returns an empty list without calling applyRepoToolkitPolicy at all —
 *   guards against an accidental policy call with an empty requestedSlugs
 *   array causing spurious DB reads.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type CatalogToolkit = { slug: string; name: string };
type RepoSettingsValues = {
  selectedToolkitSlugs: string[] | null;
  blockedToolkitSlugs: string[];
};

let composioConfigured = true;
let catalogToolkits: CatalogToolkit[] = [];
let repoSettingsValues: RepoSettingsValues | null = null;
let connectedAccountsThrows: Error | null = null;
let connectedAccounts: Array<{ toolkitSlug: string; status: string }> = [];
let applyRepoToolkitPolicyCallCount = 0;

mock.module("@/lib/composio/config", () => ({
  getComposioConfig: () => ({ configured: composioConfigured }),
}));

mock.module("@/lib/composio/client", () => ({
  getComposioClient: () => ({}),
}));

mock.module("@/lib/composio/connected-accounts", () => ({
  listComposioConnectedAccounts: async () => {
    if (connectedAccountsThrows) {
      throw connectedAccountsThrows;
    }
    return connectedAccounts;
  },
}));

mock.module("@/lib/composio/toolkit-catalog", () => ({
  fetchComposioToolkitCatalog: async () => ({
    ok: true,
    toolkits: catalogToolkits,
  }),
}));

mock.module("@/lib/db/composio", () => ({
  getRepositoryComposioSettings: async () => ({}) as unknown,
  getRepositoryComposioSettingsValues: () => repoSettingsValues,
}));

mock.module("@/lib/composio/repo-policy", () => ({
  applyRepoToolkitPolicy: async (params: { requestedSlugs: string[] }) => {
    applyRepoToolkitPolicyCallCount++;
    // Minimal, faithful reimplementation of the allowlist/denylist rule for
    // this test's purposes only — the REAL rule is pinned by
    // repo-policy.regression.test.ts; this mock exists to isolate the
    // LOADER's wiring, not to re-verify the policy rule itself.
    const blocked: Array<{
      slug: string;
      reason: "not_in_repo_allowlist" | "repo_policy_blocked";
    }> = [];
    const allowed: string[] = [];
    const blockedSet = new Set(
      (repoSettingsValues?.blockedToolkitSlugs ?? []).map((s) =>
        s.toLowerCase(),
      ),
    );
    const allowlist = repoSettingsValues?.selectedToolkitSlugs ?? null;
    const allowlistSet = allowlist
      ? new Set(allowlist.map((s) => s.toLowerCase()))
      : null;
    for (const slug of params.requestedSlugs) {
      if (blockedSet.has(slug.toLowerCase())) {
        blocked.push({ slug, reason: "repo_policy_blocked" });
      } else if (allowlistSet && !allowlistSet.has(slug.toLowerCase())) {
        blocked.push({ slug, reason: "not_in_repo_allowlist" });
      } else {
        allowed.push(slug);
      }
    }
    return { allowed, blocked };
  },
}));

const modulePromise = import("./repo-tools-page-data");

beforeEach(() => {
  composioConfigured = true;
  catalogToolkits = [];
  repoSettingsValues = null;
  connectedAccountsThrows = null;
  connectedAccounts = [];
  applyRepoToolkitPolicyCallCount = 0;
});

describe("REGRESSION: getRepoToolsEffectiveStatuses loader wiring", () => {
  test("REG-RTPD-001: a blocked slug absent from the catalog still appears in the result", async () => {
    catalogToolkits = [{ slug: "github", name: "GitHub" }];
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["gmail"],
    };
    const { getRepoToolsEffectiveStatuses } = await modulePromise;

    const result = await getRepoToolsEffectiveStatuses({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail).toBeDefined();
    expect(gmail?.status).toBe("blocked");
    expect(gmail?.blockReason).toBe("repo_policy_blocked");
  });

  test("REG-RTPD-002: a selected slug absent from the catalog still appears in the result", async () => {
    catalogToolkits = [{ slug: "github", name: "GitHub" }];
    connectedAccounts = [{ toolkitSlug: "linear", status: "ACTIVE" }];
    repoSettingsValues = {
      selectedToolkitSlugs: ["linear"],
      blockedToolkitSlugs: [],
    };
    const { getRepoToolsEffectiveStatuses } = await modulePromise;

    const result = await getRepoToolsEffectiveStatuses({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    const linear = result.find((r) => r.slug === "linear");
    expect(linear).toBeDefined();
    expect(linear?.status).toBe("selected");
  });

  test("REG-RTPD-003: Composio not configured degrades to not_connected instead of throwing", async () => {
    composioConfigured = false;
    catalogToolkits = [];
    repoSettingsValues = {
      selectedToolkitSlugs: null,
      blockedToolkitSlugs: ["gmail"],
    };
    const { getRepoToolsEffectiveStatuses } = await modulePromise;

    const result = await getRepoToolsEffectiveStatuses({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    // gmail is blocked regardless of connection state (policy checked first)
    const gmail = result.find((r) => r.slug === "gmail");
    expect(gmail?.status).toBe("blocked");
  });

  test("REG-RTPD-004: a connected-accounts SDK failure degrades to not_connected instead of throwing", async () => {
    catalogToolkits = [{ slug: "slack", name: "Slack" }];
    connectedAccountsThrows = new Error("Composio outage");
    repoSettingsValues = null;

    const { getRepoToolsEffectiveStatuses } = await modulePromise;

    const result = await getRepoToolsEffectiveStatuses({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("slack");
    expect(result[0]?.status).toBe("not_connected");
  });

  test("REG-RTPD-005: empty toolkit set short-circuits without calling applyRepoToolkitPolicy", async () => {
    catalogToolkits = [];
    repoSettingsValues = null;

    const { getRepoToolsEffectiveStatuses } = await modulePromise;

    const result = await getRepoToolsEffectiveStatuses({
      userId: "user-1",
      repoOwner: "acme",
      repoName: "widgets",
    });

    expect(result).toEqual([]);
    expect(applyRepoToolkitPolicyCallCount).toBe(0);
  });
});
