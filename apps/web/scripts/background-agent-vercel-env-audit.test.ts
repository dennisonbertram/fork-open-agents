import { describe, expect, test } from "bun:test";

import {
  auditVercelEnvNames,
  parseDotenvValuePresence,
  parseVercelEnvLs,
} from "./background-agent-vercel-env-audit";

const envLsFixture = `
 name                                               value               environments (git branch)                   created
 BETTER_AUTH_SECRET                                 Encrypted           Production                                  16d ago
 BETTER_AUTH_SECRET                                 Encrypted           Preview                                     2d ago
 KV_URL                                             Encrypted           Production, Preview, Development            16d ago
 VERCEL_APP_CLIENT_SECRET                           Encrypted           Production                                  16d ago
 NEXT_PUBLIC_VERCEL_APP_CLIENT_ID                   Encrypted           Production                                  16d ago
 GITHUB_WEBHOOK_SECRET                              Encrypted           Production                                  16d ago
 NEXT_PUBLIC_GITHUB_APP_SLUG                        Encrypted           Production                                  16d ago
 GITHUB_APP_PRIVATE_KEY                             Encrypted           Production                                  16d ago
 GITHUB_APP_ID                                      Encrypted           Production                                  16d ago
 GITHUB_CLIENT_SECRET                               Encrypted           Production                                  16d ago
 NEXT_PUBLIC_GITHUB_CLIENT_ID                       Encrypted           Production                                  16d ago
 POSTGRES_URL                                       Encrypted           Production, Preview, Development            16d ago
 VERCEL_APP_CLIENT_SECRET                           Encrypted           Preview (user-inference-profiles)           2d ago
 NEXT_PUBLIC_VERCEL_APP_CLIENT_ID                   Encrypted           Preview (user-inference-profiles)           2d ago
`;

describe("background-agent-vercel-env-audit", () => {
  test("parses generic and branch-specific Vercel env scopes", () => {
    const entries = parseVercelEnvLs(envLsFixture);

    expect(entries).toContainEqual({
      name: "POSTGRES_URL",
      scopes: [
        { environment: "production" },
        { environment: "preview" },
        { environment: "development" },
      ],
    });
    expect(entries).toContainEqual({
      name: "VERCEL_APP_CLIENT_SECRET",
      scopes: [{ environment: "preview", branch: "user-inference-profiles" }],
    });
  });

  test("reports the current preview proof branch gaps without secret values", () => {
    const result = auditVercelEnvNames({
      entries: parseVercelEnvLs(envLsFixture),
      environment: "preview",
      branch: "codex/background-agents-foundation",
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toContain("BACKGROUND_AGENTS_ENABLED");
    expect(result.missing).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(result.missing).toContain("VERCEL_APP_CLIENT_SECRET");
    expect(JSON.stringify(result)).not.toContain("Encrypted");
  });

  test("reports production missing only the background-agent rollout secrets", () => {
    const result = auditVercelEnvNames({
      entries: parseVercelEnvLs(envLsFixture),
      environment: "production",
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      "BACKGROUND_AGENTS_CRON_SECRET",
      "BACKGROUND_AGENTS_ENABLED",
      "BACKGROUND_AGENTS_WEBHOOK_SECRET",
      "CRON_SECRET",
    ]);
  });

  test("can verify required value presence without exposing values", () => {
    const result = auditVercelEnvNames({
      entries: parseVercelEnvLs(envLsFixture),
      environment: "production",
      presentValues: parseDotenvValuePresence(`
POSTGRES_URL=postgres://redacted
BETTER_AUTH_SECRET=auth-secret
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=client-id
VERCEL_APP_CLIENT_SECRET=client-secret
NEXT_PUBLIC_GITHUB_CLIENT_ID=github-client-id
GITHUB_CLIENT_SECRET=github-client-secret
GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET="webhook-secret"
NEXT_PUBLIC_GITHUB_APP_SLUG=open-agents
`),
    });

    expect(result.ready).toBe(false);
    expect(result.missing).toContain("GITHUB_APP_ID");
    expect(result.missing).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(result.checks.find((check) => check.id === "github_app")).toEqual({
      id: "github_app",
      label: "GitHub App",
      status: "missing",
      detail: "Required for webhook trust and installation repo access.",
      missing: [],
      empty: ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"],
    });
    expect(JSON.stringify(result)).not.toContain("auth-secret");
    expect(JSON.stringify(result)).not.toContain("webhook-secret");
  });

  test("parses dotenv value presence without keeping blank values", () => {
    expect(
      parseDotenvValuePresence(`
# Created by Vercel CLI
PRESENT=hello
QUOTED="hello"
EMPTY=
QUOTED_EMPTY=""
`),
    ).toEqual(new Set(["PRESENT", "QUOTED"]));
  });

  test("accepts either cron secret name", () => {
    const result = auditVercelEnvNames({
      entries: parseVercelEnvLs(`
 name                                               value               environments (git branch)                   created
 BACKGROUND_AGENTS_ENABLED                         Encrypted           Preview                                     1m ago
 POSTGRES_URL                                      Encrypted           Preview                                     1m ago
 BETTER_AUTH_SECRET                                Encrypted           Preview                                     1m ago
 NEXT_PUBLIC_VERCEL_APP_CLIENT_ID                  Encrypted           Preview                                     1m ago
 VERCEL_APP_CLIENT_SECRET                          Encrypted           Preview                                     1m ago
 NEXT_PUBLIC_GITHUB_CLIENT_ID                      Encrypted           Preview                                     1m ago
 GITHUB_CLIENT_SECRET                              Encrypted           Preview                                     1m ago
 GITHUB_APP_ID                                     Encrypted           Preview                                     1m ago
 GITHUB_APP_PRIVATE_KEY                            Encrypted           Preview                                     1m ago
 GITHUB_WEBHOOK_SECRET                             Encrypted           Preview                                     1m ago
 NEXT_PUBLIC_GITHUB_APP_SLUG                       Encrypted           Preview                                     1m ago
 CRON_SECRET                                       Encrypted           Preview                                     1m ago
 BACKGROUND_AGENTS_WEBHOOK_SECRET                  Encrypted           Preview                                     1m ago
`),
      environment: "preview",
    });

    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
