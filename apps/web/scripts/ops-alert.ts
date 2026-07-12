import { spawnSync } from "node:child_process";
import { redactOpsText } from "./ops-redaction";

type AlertState = "open" | "repeated" | "recovered" | "no_op" | "dry_run";

export interface AlertInput {
  source: string;
  environment: string;
  status: "failing" | "recovered";
  runUrl?: string;
  deploymentId?: string;
  commitSha?: string;
  summary: string;
  dryRun?: boolean;
}

export interface GhResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[]) => GhResult;

export function buildAlertKey(
  input: Pick<AlertInput, "source" | "environment">,
) {
  return `production-ops:${input.source}:${input.environment}`.toLowerCase();
}

export function renderAlertTitle(input: AlertInput): string {
  return `[production-ops] ${input.source} in ${input.environment}`;
}

export function renderAlertBody(input: AlertInput): string {
  const alertKey = buildAlertKey(input);
  return redactOpsText(`<!-- ${alertKey} -->
## Production Alert

- Source: ${input.source}
- Environment: ${input.environment}
- Status: ${input.status}
- Deployment: ${input.deploymentId ?? "unknown"}
- Commit SHA: ${input.commitSha ?? "unknown"}
- Run: ${input.runUrl ?? "unknown"}

## Summary

${input.summary}

## Next Diagnostic Command

\`\`\`bash
bun run ops:status -- --since 30m
vercel logs --scope <team-or-org-id> --project <project-id> --environment production --status-code 500,502,503,504 --since 30m
\`\`\`
`);
}

export function renderRecoveryComment(input: AlertInput): string {
  return redactOpsText(`Recovered ${input.source} in ${input.environment}.

- Run: ${input.runUrl ?? "unknown"}
- Deployment: ${input.deploymentId ?? "unknown"}
- Commit SHA: ${input.commitSha ?? "unknown"}
`);
}

const runGh: GhRunner = (args) => {
  return spawnSync("gh", args, { encoding: "utf8", timeout: 20_000 });
};

function parseArgs(argv: string[]): AlertInput {
  const input: Partial<AlertInput> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dry-run") {
      input.dryRun = true;
      continue;
    }
    if (
      arg === "--source" ||
      arg === "--environment" ||
      arg === "--status" ||
      arg === "--run-url" ||
      arg === "--deployment-id" ||
      arg === "--commit-sha" ||
      arg === "--summary"
    ) {
      if (!next) throw new Error(`${arg} requires a value.`);
      const key = arg
        .slice(2)
        .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      (input as Record<string, unknown>)[key] = next;
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!input.source || !input.environment || !input.status || !input.summary) {
    throw new Error(
      "--source, --environment, --status, and --summary are required.",
    );
  }
  if (input.status !== "failing" && input.status !== "recovered") {
    throw new Error("--status must be failing or recovered.");
  }
  return input as AlertInput;
}

export function upsertAlert(
  input: AlertInput,
  ghRunner: GhRunner = runGh,
): {
  state: AlertState;
  issueNumber?: string;
  output: string;
} {
  const key = buildAlertKey(input);
  const title = renderAlertTitle(input);
  const body = renderAlertBody(input);
  if (input.dryRun) {
    return { state: "dry_run", output: `${title}\n\n${body}` };
  }

  const search = ghRunner([
    "issue",
    "list",
    "--repo",
    "dennisonbertram/fork-open-agents",
    "--state",
    "open",
    "--search",
    key,
    "--json",
    "number",
    "--jq",
    ".[0].number",
  ]);
  if (search.status !== 0) throw new Error(search.stderr);
  const issueNumber = search.stdout.trim();

  if (input.status === "recovered" && issueNumber) {
    const comment = ghRunner([
      "issue",
      "comment",
      issueNumber,
      "--repo",
      "dennisonbertram/fork-open-agents",
      "--body",
      renderRecoveryComment(input),
    ]);
    if (comment.status !== 0) throw new Error(comment.stderr);
    return { state: "recovered", issueNumber, output: comment.stdout };
  }

  if (input.status === "recovered") {
    return { state: "no_op", output: "no open incident" };
  }

  if (issueNumber) {
    const comment = ghRunner([
      "issue",
      "comment",
      issueNumber,
      "--repo",
      "dennisonbertram/fork-open-agents",
      "--body",
      body,
    ]);
    if (comment.status !== 0) throw new Error(comment.stderr);
    return { state: "repeated", issueNumber, output: comment.stdout };
  }

  const create = ghRunner([
    "issue",
    "create",
    "--repo",
    "dennisonbertram/fork-open-agents",
    "--title",
    title,
    "--body",
    body,
  ]);
  if (create.status !== 0) throw new Error(create.stderr);
  return { state: "open", output: create.stdout };
}

export function runAlertCli(argv = process.argv.slice(2)): number {
  try {
    const result = upsertAlert(parseArgs(argv));
    console.log(redactOpsText(`${result.state}\n${result.output}`));
    return 0;
  } catch (error) {
    console.error(
      redactOpsText(error instanceof Error ? error.message : String(error)),
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exit(runAlertCli());
}
