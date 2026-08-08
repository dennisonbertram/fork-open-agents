import { describe, expect, test } from "bun:test";
import { decideMigrationTarget } from "./migration-target-guard";

const PROD_POOLED =
  "postgresql://u:p@ep-soft-silence-apy0v87w-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PROD_DIRECT =
  "postgresql://u:p@ep-soft-silence-apy0v87w.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PREVIEW_POOLED =
  "postgresql://u:p@ep-fancy-flower-apo5qix7-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PROD_HOST = "ep-soft-silence-apy0v87w-pooler.c-7.us-east-1.aws.neon.tech";

describe("decideMigrationTarget", () => {
  // The incident: a PR preview build applied an unmerged, unreviewed migration
  // to the production database 29 seconds after the preview deployment started.
  test("refuses a preview build pointed at the production database", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PROD_POOLED,
      productionHost: PROD_HOST,
      vercelEnv: "preview",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("preview");
  });

  // Pooled and direct hosts are the SAME database. Comparing raw hostnames
  // would let the direct variant through, which is the whole hazard again.
  test("treats the pooled and direct hosts as the same database", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PROD_DIRECT,
      productionHost: PROD_HOST,
      vercelEnv: "preview",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(false);
  });

  test("refuses a local build pointed at the production database", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PROD_POOLED,
      productionHost: PROD_HOST,
      vercelEnv: undefined,
      allowOverride: false,
    });

    expect(decision.allowed).toBe(false);
  });

  // MUST STAY GREEN: the production deploy is the one path that is supposed to
  // migrate production. Breaking this blocks every release.
  test("must stay green: a production build may migrate production", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PROD_POOLED,
      productionHost: PROD_HOST,
      vercelEnv: "production",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(true);
  });

  // MUST STAY GREEN: a correctly-isolated preview must migrate its own branch.
  test("must stay green: a preview build may migrate its own branch", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PREVIEW_POOLED,
      productionHost: PROD_HOST,
      vercelEnv: "preview",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(true);
  });

  // MUST STAY GREEN: fail OPEN when unconfigured. A guard that blocks every
  // deploy because one variable is missing is worse than the bug it prevents.
  test("must stay green: allows when the production host is not configured", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PROD_POOLED,
      productionHost: undefined,
      vercelEnv: "preview",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(true);
  });

  test("allows an explicit operator override", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PROD_POOLED,
      productionHost: PROD_HOST,
      vercelEnv: undefined,
      allowOverride: true,
    });

    expect(decision.allowed).toBe(true);
  });

  test("names the offending host and the way out", () => {
    const decision = decideMigrationTarget({
      databaseUrl: PROD_POOLED,
      productionHost: PROD_HOST,
      vercelEnv: "preview",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("ep-soft-silence-apy0v87w");
    expect(decision.reason).toContain("ALLOW_PRODUCTION_MIGRATION");
  });

  // An unparseable URL must not crash the build before migrations even start.
  test("must stay green: allows an unparseable url rather than crashing", () => {
    const decision = decideMigrationTarget({
      databaseUrl: "not-a-url",
      productionHost: PROD_HOST,
      vercelEnv: "preview",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(true);
  });

  test("never leaks credentials in the refusal reason", () => {
    const decision = decideMigrationTarget({
      databaseUrl:
        "postgresql://neondb_owner:npg_SUPERSECRET@ep-soft-silence-apy0v87w-pooler.c-7.us-east-1.aws.neon.tech/neondb",
      productionHost: PROD_HOST,
      vercelEnv: "preview",
      allowOverride: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).not.toContain("npg_SUPERSECRET");
    expect(decision.reason).not.toContain("neondb_owner");
  });
});
