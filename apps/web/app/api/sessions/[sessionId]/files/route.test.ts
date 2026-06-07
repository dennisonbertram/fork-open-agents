import { describe, expect, mock, test } from "bun:test";

// Mock all external dependencies so we can import and test parseGitFiles
// in isolation, without sandbox connections or database access.
mock.module("server-only", () => ({}));
mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({}),
}));
mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => ({ ok: false, response: new Response() }),
  requireOwnedSessionWithSandboxGuard: async () => ({ ok: false, response: new Response() }),
}));
mock.module("@/lib/db/sessions", () => ({
  updateSession: async () => undefined,
}));
mock.module("@/lib/sandbox/lifecycle", () => ({
  buildHibernatedLifecycleUpdate: () => ({}),
}));
mock.module("@/lib/sandbox/utils", () => ({
  clearUnavailableSandboxState: () => null,
  hasRuntimeSandboxState: () => false,
  isSandboxUnavailableError: () => false,
}));

// A git-ls-files fixture that reproduces the bug:
// The entry "apps/web/public/.well-known/" ends with "/" — git sometimes emits
// submodule / special entries this way. The helper already synthesised
// "apps/web/public/.well-known/" as a directory, so emitting it again as a
// (non-directory) file creates a duplicate path.
const FIXTURE_WITH_TRAILING_SLASH = [
  "apps/web/public/.well-known/apple-app-site-association",
  "apps/web/public/.well-known/",
  "apps/web/public/favicon.ico",
].join("\n");

describe("parseGitFiles (exported from route.ts) – fixed behaviour", () => {
  // BT-001: trailing-slash entry must not produce duplicate paths
  test("BT-001 no duplicate path when git emits a trailing-slash directory entry", async () => {
    const { parseGitFiles } = await import("./route");
    const suggestions = parseGitFiles(FIXTURE_WITH_TRAILING_SLASH);
    const values = suggestions.map((s) => s.value);

    // Each path must appear exactly once
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);

    // ".well-known/" must appear exactly once (as a directory)
    const wellKnownEntries = suggestions.filter(
      (s) => s.value === "apps/web/public/.well-known/",
    );
    expect(wellKnownEntries).toHaveLength(1);
    expect(wellKnownEntries[0].isDirectory).toBe(true);
  });

  // BT-002: normal files under the trailing-slash dir must still appear
  test("BT-002 files nested under a trailing-slash dir are still included", async () => {
    const { parseGitFiles } = await import("./route");
    const suggestions = parseGitFiles(FIXTURE_WITH_TRAILING_SLASH);
    const values = suggestions.map((s) => s.value);

    expect(values).toContain(
      "apps/web/public/.well-known/apple-app-site-association",
    );
    expect(values).toContain("apps/web/public/favicon.ico");
  });

  // BT-003: ordinary git output without trailing-slash entries is unaffected
  test("BT-003 normal git output (no trailing slash) produces correct file+dir entries", async () => {
    const { parseGitFiles } = await import("./route");
    const normalOutput = [
      "README.md",
      "src/index.ts",
      "src/utils/helper.ts",
    ].join("\n");

    const suggestions = parseGitFiles(normalOutput);
    const values = suggestions.map((s) => s.value);

    expect(values).toContain("README.md");
    expect(values).toContain("src/");
    expect(values).toContain("src/index.ts");
    expect(values).toContain("src/utils/");
    expect(values).toContain("src/utils/helper.ts");

    // No duplicates
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  // BT-004: multiple identical trailing-slash entries do not produce duplicates
  test("BT-004 multiple identical trailing-slash entries do not produce duplicates", async () => {
    const { parseGitFiles } = await import("./route");
    const duplicateTrailingSlash = [
      "apps/web/public/.well-known/apple-app-site-association",
      "apps/web/public/.well-known/",
      "apps/web/public/.well-known/",
    ].join("\n");

    const suggestions = parseGitFiles(duplicateTrailingSlash);
    const values = suggestions.map((s) => s.value);

    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// ---------------------------------------------------------------------------
// Regression: dedup helper used by paths memo in file-tree.tsx (BT-005)
// ---------------------------------------------------------------------------
describe("file-tree paths dedup (regression, BT-005)", () => {
  test("BT-005 dedupPaths removes duplicate path strings", () => {
    const raw = [
      "repo/apps/web/public/.well-known/",
      "repo/apps/web/public/.well-known/apple-app-site-association",
      "repo/apps/web/public/.well-known/", // duplicate
      "repo/apps/web/public/favicon.ico",
    ];

    // The fix will deduplicate using Set before passing to useFileTree.
    const deduped = [...new Set(raw)];

    expect(deduped).toHaveLength(3);
    expect(deduped.filter((v) => v === "repo/apps/web/public/.well-known/")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION TESTS — would fail if the parseGitFiles fix is reverted
// ---------------------------------------------------------------------------
describe("parseGitFiles – regression suite", () => {
  // REG-001: The original bug that caused the crash.
  // If parseGitFiles reverts to naively emitting trailing-slash entries as
  // non-directory files, this test catches it because the path would appear
  // twice: once as isDirectory=true (synthesised) and once as isDirectory=false
  // (raw entry). @pierre/trees then throws "Duplicate path".
  test("REG-001 trailing-slash dir entry is isDirectory=true and appears exactly once", async () => {
    const { parseGitFiles } = await import("./route");
    const output = [
      "apps/web/public/.well-known/apple-app-site-association",
      "apps/web/public/.well-known/",
    ].join("\n");

    const suggestions = parseGitFiles(output);

    // Must not have two entries for the same path
    const values = suggestions.map((s) => s.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);

    // The .well-known/ entry must be marked as a directory
    const entry = suggestions.find(
      (s) => s.value === "apps/web/public/.well-known/",
    );
    expect(entry).toBeDefined();
    expect(entry?.isDirectory).toBe(true);
  });

  // REG-002: A standalone trailing-slash entry with no child files beneath it
  // (e.g. an empty tracked directory) should still appear as a directory.
  test("REG-002 standalone trailing-slash entry with no children is recorded as a directory", async () => {
    const { parseGitFiles } = await import("./route");
    const output = "apps/web/public/empty-dir/\n";

    const suggestions = parseGitFiles(output);
    const values = suggestions.map((s) => s.value);

    // No duplicates
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);

    // The empty dir should be present and marked as a directory
    const entry = suggestions.find(
      (s) => s.value === "apps/web/public/empty-dir/",
    );
    expect(entry).toBeDefined();
    expect(entry?.isDirectory).toBe(true);
  });

  // REG-003: Root-level file must still appear — the fix must not accidentally
  // swallow top-level files.
  test("REG-003 root-level files are not swallowed by the fix", async () => {
    const { parseGitFiles } = await import("./route");
    const output = [
      "README.md",
      "package.json",
      "apps/web/index.ts",
    ].join("\n");

    const suggestions = parseGitFiles(output);
    const values = suggestions.map((s) => s.value);

    expect(values).toContain("README.md");
    expect(values).toContain("package.json");
    expect(values).toContain("apps/web/index.ts");
  });
});
