import { describe, expect, test } from "bun:test";
import type { CanaryConfig } from "./ops-authenticated-canary";
import {
  buildJourneyEnv,
  formatBlockedResult,
  parseJourneyKind,
  runCanaryJourneyCli,
} from "./canary-journey-gate";

const config: CanaryConfig = {
  targetUrl: "https://prod.example",
  testRepo: "owner/disposable-repo",
  testIdentity: "canary-user",
  authCookie: "better-auth.session_token=abc",
  timeoutMs: 45_000,
};

describe("canary-journey-gate", () => {
  test("parseJourneyKind accepts known kinds", () => {
    expect(parseJourneyKind(["background-agents"])).toBe("background-agents");
    expect(parseJourneyKind(["loops"])).toBe("loops");
  });

  test("parseJourneyKind rejects missing or unknown kinds", () => {
    expect(() => parseJourneyKind([])).toThrow();
    expect(() => parseJourneyKind(["bogus"])).toThrow();
  });

  test("buildJourneyEnv maps background-agents config", () => {
    expect(buildJourneyEnv(config, "background-agents")).toEqual({
      BACKGROUND_AGENT_PROOF_BASE_URL: "https://prod.example",
      BACKGROUND_AGENT_PROOF_COOKIE: "better-auth.session_token=abc",
      BACKGROUND_AGENT_JOURNEY_REPO_OWNER: "owner",
      BACKGROUND_AGENT_JOURNEY_REPO_NAME: "disposable-repo",
    });
  });

  test("buildJourneyEnv maps loops config", () => {
    expect(buildJourneyEnv(config, "loops")).toEqual({
      LOOP_JOURNEY_PROOF_BASE_URL: "https://prod.example",
      LOOP_JOURNEY_PROOF_COOKIE: "better-auth.session_token=abc",
      LOOP_JOURNEY_PROOF_REPO_OWNER: "owner",
      LOOP_JOURNEY_PROOF_REPO_NAME: "disposable-repo",
    });
  });

  test("buildJourneyEnv never sets a REQUIRE_SUCCEEDED key", () => {
    for (const kind of ["background-agents", "loops"] as const) {
      const env = buildJourneyEnv(config, kind);
      for (const key of Object.keys(env)) {
        expect(key).not.toMatch(/REQUIRE_SUCCEEDED/);
      }
    }
  });

  test("formatBlockedResult is loud and self-describing", () => {
    const output = formatBlockedResult("loops");
    expect(output).toContain("Status: blocked_by_configuration");
    expect(output).toContain("PRODUCTION_CANARY_URL");
    expect(output).toContain("PRODUCTION_CANARY_REPO");
    expect(output).toContain("PRODUCTION_CANARY_IDENTITY");
    expect(output).toContain("PRODUCTION_CANARY_AUTH_COOKIE");
    expect(output).toContain("loops");
    expect(output).toMatch(/not a failure/i);
  });

  test("runCanaryJourneyCli returns 0 without spawning when config is missing", async () => {
    const logs: string[] = [];
    let spawnCalled = false;
    const exitCode = await runCanaryJourneyCli({
      argv: ["loops"],
      env: {},
      log: (line: string) => logs.push(line),
      spawn: () => {
        spawnCalled = true;
        return Promise.resolve(0);
      },
    });
    expect(exitCode).toBe(0);
    expect(logs.join("\n")).toContain("blocked_by_configuration");
    expect(spawnCalled).toBe(false);
  });

  test("runCanaryJourneyCli spawns and propagates exit code when configured", async () => {
    const logs: string[] = [];
    let spawnArgs: { cmd: string[]; env: Record<string, string> } | null =
      null;
    const exitCode = await runCanaryJourneyCli({
      argv: ["background-agents"],
      env: {
        PRODUCTION_CANARY_URL: "https://prod.example",
        PRODUCTION_CANARY_REPO: "Owner/Repo",
        PRODUCTION_CANARY_IDENTITY: "canary-user",
        PRODUCTION_CANARY_AUTH_COOKIE: "better-auth.session_token=abc",
      },
      log: (line: string) => logs.push(line),
      spawn: (cmd: string[], env: Record<string, string>) => {
        spawnArgs = { cmd, env };
        return Promise.resolve(1);
      },
    });
    expect(exitCode).toBe(1);
    expect(spawnArgs).not.toBeNull();
    expect(spawnArgs?.cmd.join(" ")).toContain(
      "scripts/background-agent-journey-proof.ts",
    );
    expect(spawnArgs?.env.BACKGROUND_AGENT_JOURNEY_REPO_OWNER).toBe("owner");
  });
});
