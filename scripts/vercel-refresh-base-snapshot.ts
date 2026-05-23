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

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
  type RefreshBaseSnapshotFile,
  refreshBaseSnapshot,
} from "../packages/sandbox/vercel";
import {
  DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
  getManagedRuntimeProfile,
  getManagedRuntimeSnapshotCommands,
  MANAGED_RUNTIME_PROFILES,
} from "../packages/sandbox/managed-runtime-profiles";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "../apps/web/lib/sandbox/config";

const SANDBOX_BASE_SNAPSHOT_CONFIG_PATH = "apps/web/lib/sandbox/config.ts";

interface CliOptions {
  baseSnapshotId?: string;
  fromStandardRuntime?: boolean;
  sandboxTimeoutMs?: number;
  commandTimeoutMs?: number;
  managedRuntimeDefaults?: boolean;
  managedRuntimeProfileId?: string;
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
  --from-standard-runtime      Start from Vercel's standard runtime even when a base snapshot is configured
  --command <shell-command>    Command to run inside the sandbox. Repeat as needed.
  --managed-runtime-defaults   Install the default managed runtime profile (${DEFAULT_MANAGED_RUNTIME_PROFILE_ID})
  --managed-runtime-profile <profile-id>
                               Install a named managed runtime profile. Available: ${MANAGED_RUNTIME_PROFILES.map((profile) => profile.id).join(", ")}
  --sandbox-timeout-ms <ms>    Sandbox lifetime for the refresh run
  --command-timeout-ms <ms>    Timeout for each setup command (default: ${DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS})
  --help                       Show this message

Current configured base snapshot:
  ${DEFAULT_SANDBOX_BASE_SNAPSHOT_ID ?? "<none; standard runtime will be used>"}`);
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
  let fromStandardRuntime = false;
  let sandboxTimeoutMs: number | undefined;
  let commandTimeoutMs: number | undefined;
  let managedRuntimeDefaults = false;
  let managedRuntimeProfileId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--from") {
      baseSnapshotId = requireOptionValue(argv, index, arg);
      fromStandardRuntime = false;
      index += 1;
      continue;
    }

    if (arg === "--from-standard-runtime") {
      baseSnapshotId = undefined;
      fromStandardRuntime = true;
      continue;
    }

    if (arg === "--command") {
      commands.push(requireOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--managed-runtime-profile") {
      managedRuntimeProfileId = requireOptionValue(argv, index, arg);
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
    fromStandardRuntime,
    sandboxTimeoutMs,
    commandTimeoutMs,
    managedRuntimeDefaults,
    managedRuntimeProfileId,
    commands,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    printUsage();
    return;
  }

  const managedRuntimeProfile =
    parsed.managedRuntimeDefaults || parsed.managedRuntimeProfileId
      ? getManagedRuntimeProfile(
          parsed.managedRuntimeProfileId ?? DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
        )
      : null;
  const profileSetupFiles: RefreshBaseSnapshotFile[] =
    managedRuntimeProfile?.setupScript
      ? [
          {
            path: managedRuntimeProfile.setupScript.sandboxPath,
            content: readFileSync(
              path.join(
                process.cwd(),
                managedRuntimeProfile.setupScript.repoPath,
              ),
              "utf-8",
            ),
            executable: true,
          },
        ]
      : [];

  const result = await refreshBaseSnapshot({
    baseSnapshotId: parsed.fromStandardRuntime
      ? undefined
      : (parsed.baseSnapshotId ?? DEFAULT_SANDBOX_BASE_SNAPSHOT_ID),
    files: profileSetupFiles,
    commands: [
      ...(managedRuntimeProfile
        ? getManagedRuntimeSnapshotCommands(managedRuntimeProfile)
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
  console.log(
    `Started from snapshot: ${result.sourceSnapshotId ?? "<standard runtime>"}`,
  );
  if (managedRuntimeProfile) {
    console.log(
      `Managed runtime profile: ${managedRuntimeProfile.id}@${managedRuntimeProfile.version}`,
    );
  }
  console.log(
    `Update ${SANDBOX_BASE_SNAPSHOT_CONFIG_PATH} to use: "${result.snapshotId}"`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
