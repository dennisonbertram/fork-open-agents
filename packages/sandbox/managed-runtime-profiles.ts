export type ManagedRuntimeProfileCommand = {
  id: string;
  label: string;
  command: string;
  timeoutMs?: number;
  required?: boolean;
};

export type ManagedRuntimeProfileSetupScript = {
  repoPath: string;
  sandboxPath: string;
  command: string;
  timeoutMs?: number;
};

export type ManagedRuntimeProfile = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  setupScript?: ManagedRuntimeProfileSetupScript;
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
  "if command -v agent-browser >/dev/null 2>&1; then command -v agent-browser;",
  "elif command -v bun >/dev/null 2>&1; then bun install -g agent-browser;",
  "elif command -v npm >/dev/null 2>&1; then npm install -g agent-browser;",
  'else echo "No package manager is available to install agent-browser." >&2; exit 1; fi',
  "command -v agent-browser",
  'agent_browser_path="$(command -v agent-browser)"',
  'ln -sf "$agent_browser_path" "$profile_bin_dir/agent-browser"',
].join("\n");

export const DEFAULT_MANAGED_RUNTIME_PROFILE_ID = "web-bun-agent-browser";

export const MANAGED_RUNTIME_PROFILES = [
  {
    id: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
    version: "2026-05-23.1",
    displayName: "Web app with Bun and browser checks",
    description:
      "Baseline Open Agents managed runtime profile for JavaScript/TypeScript web repositories that need Bun scripts, exposed preview ports, and browser smoke checks.",
    setupScript: {
      repoPath: "packages/sandbox/profiles/web-bun-agent-browser/setup.sh",
      sandboxPath: "/tmp/open-agents/profiles/web-bun-agent-browser/setup.sh",
      command: "bash /tmp/open-agents/profiles/web-bun-agent-browser/setup.sh",
      timeoutMs: 180_000,
    },
    setupCommands: [
      {
        id: "install-bun",
        label: "Install Bun",
        command: INSTALL_BUN_COMMAND,
        timeoutMs: 180_000,
      },
      {
        id: "install-agent-browser",
        label: "Install agent-browser",
        command: INSTALL_AGENT_BROWSER_COMMAND,
        timeoutMs: 180_000,
      },
    ],
    verificationCommands: [
      {
        id: "observe-node",
        label: "Observe Node.js availability",
        command:
          'if command -v node >/dev/null 2>&1; then node --version; else echo "node unavailable"; fi',
        timeoutMs: 30_000,
        required: false,
      },
      {
        id: "observe-npm",
        label: "Observe npm availability",
        command:
          'if command -v npm >/dev/null 2>&1; then npm --version; else echo "npm unavailable"; fi',
        timeoutMs: 30_000,
        required: false,
      },
      {
        id: "verify-bun",
        label: "Verify Bun",
        command: "command -v bun && bun --version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-agent-browser",
        label: "Verify agent-browser",
        command: "command -v agent-browser",
        timeoutMs: 30_000,
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

export function getManagedRuntimeSnapshotCommands(
  profile: ManagedRuntimeProfile,
): string[] {
  return [
    ...(profile.setupScript
      ? [profile.setupScript.command]
      : profile.setupCommands.map((command) => command.command)),
    ...profile.verificationCommands.map((command) => command.command),
  ];
}
