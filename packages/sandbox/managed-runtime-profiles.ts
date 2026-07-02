export type ManagedRuntimeProfileCommand = {
  id: string;
  label: string;
  description: string;
  command: string;
  timeoutMs?: number;
  required?: boolean;
};

export type ManagedRuntimeProfile = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  setupCommands: ManagedRuntimeProfileCommand[];
  verificationCommands: ManagedRuntimeProfileCommand[];
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
};

// Bun is intentionally scoped to this default web profile. Managed runtime
// profiles must declare their own toolchain instead of assuming Node, Bun, npm,
// Python, or any other runtime exists in every sandbox.
const INSTALL_BUN_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:$HOME/.bun/bin:$HOME/.bun/install/global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  "if ! command -v bun >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then npm install -g bun || true; fi",
  "if ! command -v bun >/dev/null 2>&1; then curl -fsSL https://bun.com/install | bash; fi",
  'export PATH="$HOME/.bun/bin:$PATH"',
  "if command -v bun >/dev/null 2>&1; then",
  '  bun_path="$(command -v bun)"',
  "  mkdir -p /usr/local/bin 2>/dev/null || true",
  '  ln -sf "$bun_path" /usr/local/bin/bun 2>/dev/null || true',
  '  ln -sf "$bun_path" "$profile_bin_dir/bun"',
  "fi",
  "command -v bun",
  "bun --version",
].join("\n");

const INSTALL_AGENT_BROWSER_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:$HOME/.bun/bin:$HOME/.bun/install/global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  'if ! command -v bun >/dev/null 2>&1; then echo "Bun is required before installing agent-browser for this profile." >&2; exit 1; fi',
  'rm -f "$profile_bin_dir/agent-browser" "$HOME/.bun/bin/agent-browser"',
  'rm -rf "$HOME/.bun/install/global/node_modules/agent-browser"',
  "bun install -g agent-browser",
  'agent_browser_bin_dir="$HOME/.bun/install/global/node_modules/agent-browser/bin"',
  "platform=\"$(uname -s | tr '[:upper:]' '[:lower:]')\"",
  'arch="$(uname -m)"',
  'case "$arch" in x86_64|amd64) agent_browser_arch="x64" ;; arm64|aarch64) agent_browser_arch="arm64" ;; *) echo "Unsupported agent-browser architecture: $arch" >&2; exit 1 ;; esac',
  'agent_browser_path="$agent_browser_bin_dir/agent-browser-$platform-$agent_browser_arch"',
  'if [ ! -x "$agent_browser_path" ]; then echo "agent-browser native binary was not found after install: $agent_browser_path" >&2; exit 1; fi',
  'rm -f "$profile_bin_dir/agent-browser"',
  'printf \'#!/usr/bin/env sh\\nexec %s "$@"\\n\' "$agent_browser_path" > "$profile_bin_dir/agent-browser"',
  'chmod +x "$profile_bin_dir/agent-browser"',
  "agent-browser --help >/dev/null",
  "agent-browser install --with-deps",
  "command -v agent-browser",
].join("\n");

export const DEFAULT_MANAGED_RUNTIME_PROFILE_ID = "web-bun-agent-browser";

export const MANAGED_RUNTIME_PROFILES = [
  {
    id: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
    version: "2026-05-23.2",
    displayName: "Web app with Bun and browser checks",
    description:
      "Baseline Open Agents managed runtime profile for JavaScript/TypeScript web repositories that need Bun scripts, exposed preview ports, and browser smoke checks.",
    setupCommands: [
      {
        id: "install-bun",
        label: "Install Bun JavaScript runtime",
        description:
          "Bun is installed first because this web profile uses it to run JavaScript/TypeScript projects and to install profile tools.",
        command: INSTALL_BUN_COMMAND,
        timeoutMs: 180_000,
      },
      {
        id: "install-agent-browser",
        label: "Install agent-browser for browser smoke checks",
        description:
          "agent-browser lets the managed runtime open preview URLs, inspect the UI, capture browser errors, and run browser smoke checks after the app starts.",
        command: INSTALL_AGENT_BROWSER_COMMAND,
        timeoutMs: 300_000,
      },
    ],
    verificationCommands: [
      {
        id: "observe-node",
        label: "Observe Node.js availability",
        description:
          "Node.js is optional for this profile; this check records whether it is already present in the sandbox.",
        command:
          'if command -v node >/dev/null 2>&1; then node --version; else echo "node unavailable"; fi',
        timeoutMs: 30_000,
        required: false,
      },
      {
        id: "observe-npm",
        label: "Observe npm availability",
        description:
          "npm is optional for this profile; this check records whether it is already present in the sandbox.",
        command:
          'if command -v npm >/dev/null 2>&1; then npm --version; else echo "npm unavailable"; fi',
        timeoutMs: 30_000,
        required: false,
      },
      {
        id: "verify-bun",
        label: "Verify Bun",
        description:
          "Confirms the Bun executable is on PATH before the agent relies on Bun commands.",
        command: "command -v bun && bun --version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-agent-browser",
        label: "Verify agent-browser",
        description:
          "Confirms agent-browser and its browser dependencies are installed before browser checks are offered.",
        command:
          'command -v agent-browser && agent-browser --help >/dev/null && test -d "$HOME/.agent-browser/browsers"',
        timeoutMs: 60_000,
        required: true,
      },
    ],
    expectedTools: ["bun", "agent-browser"],
    optionalTools: ["node", "npm"],
    defaultPorts: [3000, 5173, 4321, 8000],
  },
] as const satisfies ManagedRuntimeProfile[];

export function getManagedRuntimeProfile(
  profileId = DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
): ManagedRuntimeProfile {
  const profile = MANAGED_RUNTIME_PROFILES.find(
    (candidate) => candidate.id === profileId,
  );

  if (!profile) {
    throw new Error(`Unknown managed runtime profile: ${profileId}`);
  }

  return profile;
}

export function listManagedRuntimeProfiles(): ManagedRuntimeProfile[] {
  return MANAGED_RUNTIME_PROFILES.map((profile) => profile);
}

export function isManagedRuntimeProfileId(
  profileId: unknown,
): profileId is ManagedRuntimeProfile["id"] {
  return (
    typeof profileId === "string" &&
    MANAGED_RUNTIME_PROFILES.some((profile) => profile.id === profileId)
  );
}

export function normalizeManagedRuntimeProfileId(
  profileId: unknown,
): ManagedRuntimeProfile["id"] {
  return isManagedRuntimeProfileId(profileId)
    ? profileId
    : DEFAULT_MANAGED_RUNTIME_PROFILE_ID;
}

export function getManagedRuntimeSnapshotCommands(
  profile: ManagedRuntimeProfile,
): string[] {
  return [
    ...profile.setupCommands.map((command) => command.command),
    ...profile.verificationCommands.map((command) => command.command),
  ];
}
