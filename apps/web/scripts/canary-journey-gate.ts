/**
 * Canary journey gating wrapper.
 *
 * Wraps the background-agent and loop journey harnesses so the
 * authenticated production canary can invoke them without ever crashing on
 * missing env: while `PRODUCTION_CANARY_*` configuration is unset the
 * journey is deliberately skipped (blocked, not failed) — mirroring
 * ops-authenticated-canary.ts's own blocked_by_configuration semantics.
 * Once configured, the wrapper maps the shared canary config into each
 * harness's own env var names and spawns it, propagating its exit code.
 *
 * Exit codes:
 *   0 = journey passed OR blocked_by_configuration (not a failure)
 *   1 = journey failed
 */
import { readCanaryConfig } from "./ops-authenticated-canary";
import type { CanaryConfig } from "./ops-authenticated-canary";

export type CanaryJourneyKind = "background-agents" | "loops";

export class CanaryJourneyGateError extends Error {}

export function parseJourneyKind(argv: string[]): CanaryJourneyKind {
  const [kind] = argv;
  if (kind === "background-agents" || kind === "loops") {
    return kind;
  }
  throw new CanaryJourneyGateError(
    `Expected a journey kind of "background-agents" or "loops", got ${JSON.stringify(kind)}`,
  );
}

export function splitCanaryRepo(repo: string): {
  owner: string;
  name: string;
} {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new CanaryJourneyGateError(
      `Expected an owner/repo shaped value, got ${JSON.stringify(repo)}`,
    );
  }
  return { owner, name };
}

export function buildJourneyEnv(
  config: CanaryConfig,
  kind: CanaryJourneyKind,
): Record<string, string> {
  const { owner, name } = splitCanaryRepo(config.testRepo);
  if (kind === "background-agents") {
    return {
      BACKGROUND_AGENT_PROOF_BASE_URL: config.targetUrl,
      BACKGROUND_AGENT_PROOF_COOKIE: config.authCookie,
      BACKGROUND_AGENT_JOURNEY_REPO_OWNER: owner,
      BACKGROUND_AGENT_JOURNEY_REPO_NAME: name,
    };
  }
  return {
    LOOP_JOURNEY_PROOF_BASE_URL: config.targetUrl,
    LOOP_JOURNEY_PROOF_COOKIE: config.authCookie,
    LOOP_JOURNEY_PROOF_REPO_OWNER: owner,
    LOOP_JOURNEY_PROOF_REPO_NAME: name,
  };
}

export function journeyScriptPath(kind: CanaryJourneyKind): string {
  return kind === "background-agents"
    ? "scripts/background-agent-journey-proof.ts"
    : "scripts/agent-loop-journey-proof.ts";
}

export function formatBlockedResult(kind: CanaryJourneyKind): string {
  return [
    "Canary journey gate",
    `Journey: ${kind}`,
    "Status: blocked_by_configuration",
    "",
    "Set PRODUCTION_CANARY_URL, PRODUCTION_CANARY_REPO, PRODUCTION_CANARY_IDENTITY, and PRODUCTION_CANARY_AUTH_COOKIE for the disposable test identity.",
    "",
    `This is NOT a failure — the ${kind} journey was skipped because the canary configuration is unset.`,
    "See docs/process/production-release-runbook.md for provisioning steps.",
  ].join("\n");
}

type SpawnFn = (
  cmd: string[],
  env: Record<string, string>,
) => Promise<number>;

async function defaultSpawn(
  cmd: string[],
  env: Record<string, string>,
): Promise<number> {
  const child = Bun.spawn(cmd, {
    cwd: new URL("..", import.meta.url).pathname,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

export async function runCanaryJourneyCli(deps?: {
  env?: Record<string, string | undefined>;
  argv?: string[];
  log?: (line: string) => void;
  spawn?: SpawnFn;
}): Promise<number> {
  const env = deps?.env ?? process.env;
  const argv = deps?.argv ?? process.argv.slice(2);
  const log = deps?.log ?? console.log;
  const spawn = deps?.spawn ?? defaultSpawn;

  const kind = parseJourneyKind(argv);
  const config = readCanaryConfig(env);
  if (!config) {
    log(formatBlockedResult(kind));
    return 0;
  }

  const journeyEnv = buildJourneyEnv(config, kind);
  return await spawn(["bun", "run", journeyScriptPath(kind)], {
    ...(env as Record<string, string>),
    ...journeyEnv,
  });
}

if (import.meta.main) {
  process.exit(await runCanaryJourneyCli());
}
