/**
 * Create a new sandbox base snapshot from the currently configured snapshot.
 * Defaults (snapshot id, ports, timeouts) come from the web app sandbox config so
 * this matches production; `refreshBaseSnapshot` skips workspace git bootstrap
 * so the new image stays clone-ready (see `@open-agents/sandbox` snapshot-refresh).
 *
 * Usage:
 *   bun run scripts/vercel-refresh-base-snapshot.ts --command "apt-get update"
 *   bun run scripts/vercel-refresh-base-snapshot.ts --from snap_123 --command "apt-get install -y ripgrep"
 */

import {
  DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
  refreshBaseSnapshot,
} from "@open-agents/sandbox/vercel";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "../apps/web/lib/sandbox/config";

const SANDBOX_BASE_SNAPSHOT_CONFIG_PATH = "apps/web/lib/sandbox/config.ts";
const MANAGED_RUNTIME_BUN_INSTALL_COMMAND = [
  "if command -v bun >/dev/null 2>&1; then command -v bun; exit 0; fi",
  "if command -v npm >/dev/null 2>&1; then npm install -g bun || true; fi",
  "if ! command -v bun >/dev/null 2>&1; then curl -fsSL https://bun.sh/install | bash; fi",
  'export PATH="$HOME/.bun/bin:$PATH"',
  "if command -v bun >/dev/null 2>&1; then",
  '  bun_path="$(command -v bun)"',
  "  mkdir -p /usr/local/bin 2>/dev/null || true",
  '  ln -sf "$bun_path" /usr/local/bin/bun 2>/dev/null || true',
  "fi",
  "command -v bun",
].join("\n");
const MANAGED_RUNTIME_SNAPSHOT_COMMANDS = [
  MANAGED_RUNTIME_BUN_INSTALL_COMMAND,
  "npm install -g agent-browser",
  "command -v bun",
  "command -v agent-browser",
] as const;

interface CliOptions {
  baseSnapshotId?: string;
  sandboxTimeoutMs?: number;
  commandTimeoutMs?: number;
  managedRuntimeDefaults?: boolean;
  commands: string[];
}

interface HelpResult {
  help: true;
}

function printUsage() {
  console.log(`Usage:
  bun run sandbox:snapshot-base -- --command "apt-get update"
  bun run sandbox:snapshot-base -- --from snap_123 --command "apt-get install -y ripgrep"

Options:
  --from <snapshot-id>         Override the starting snapshot id
  --command <shell-command>    Command to run inside the sandbox. Repeat as needed.
  --managed-runtime-defaults   Install the default managed runtime toolchain (Bun and agent-browser)
  --sandbox-timeout-ms <ms>    Sandbox lifetime for the refresh run
  --command-timeout-ms <ms>    Timeout for each setup command (default: ${DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS})
  --help                       Show this message

Current configured base snapshot:
  ${DEFAULT_SANDBOX_BASE_SNAPSHOT_ID}`);
}

function requireOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }

  return value;
}

function parsePositiveNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive number.`);
  }

  return parsed;
}

function parseArgs(argv: string[]): CliOptions | HelpResult {
  const commands: string[] = [];
  let baseSnapshotId: string | undefined;
  let sandboxTimeoutMs: number | undefined;
  let commandTimeoutMs: number | undefined;
  let managedRuntimeDefaults = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--from") {
      baseSnapshotId = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--command") {
      commands.push(requireOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--managed-runtime-defaults") {
      managedRuntimeDefaults = true;
      continue;
    }

    if (arg === "--sandbox-timeout-ms") {
      sandboxTimeoutMs = parsePositiveNumber(
        requireOptionValue(argv, index, arg),
        arg,
      );
      index += 1;
      continue;
    }

    if (arg === "--command-timeout-ms") {
      commandTimeoutMs = parsePositiveNumber(
        requireOptionValue(argv, index, arg),
        arg,
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    baseSnapshotId,
    sandboxTimeoutMs,
    commandTimeoutMs,
    managedRuntimeDefaults,
    commands,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    printUsage();
    return;
  }

  const result = await refreshBaseSnapshot({
    baseSnapshotId: parsed.baseSnapshotId ?? DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
    commands: [
      ...(parsed.managedRuntimeDefaults
        ? MANAGED_RUNTIME_SNAPSHOT_COMMANDS
        : []),
      ...parsed.commands,
    ],
    sandboxTimeoutMs: parsed.sandboxTimeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    commandTimeoutMs: parsed.commandTimeoutMs,
    ports: DEFAULT_SANDBOX_PORTS,
    log: (message) => console.log(message),
  });

  console.log("");
  console.log(`New snapshot id: ${result.snapshotId}`);
  console.log(`Started from snapshot: ${result.sourceSnapshotId}`);
  console.log(
    `Update ${SANDBOX_BASE_SNAPSHOT_CONFIG_PATH} to use: "${result.snapshotId}"`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
