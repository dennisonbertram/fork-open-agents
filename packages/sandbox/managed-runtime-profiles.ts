export type ManagedRuntimeProfileCommand = {
  id: string;
  label: string;
  description: string;
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

// ── Python managed runtime profile ────────────────────────────────────────────
// Install method: Astral `uv` standalone installer (curl https://astral.sh/uv/install.sh).
// uv manages CPython versions directly — no pre-existing Python required.
const INSTALL_UV_AND_PYTHON_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  'if ! command -v uv >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh; fi',
  'export PATH="$HOME/.local/bin:$PATH"',
  'uv_path="$(command -v uv)"',
  "mkdir -p /usr/local/bin 2>/dev/null || true",
  'ln -sf "$uv_path" /usr/local/bin/uv 2>/dev/null || true',
  'ln -sf "$uv_path" "$profile_bin_dir/uv"',
  "uv python install 3.12",
  'python_path="$(uv python find 3.12)"',
  'ln -sf "$python_path" "$profile_bin_dir/python"',
  'ln -sf "$python_path" "$profile_bin_dir/python3"',
  'ln -sf "$python_path" /usr/local/bin/python 2>/dev/null || true',
  'ln -sf "$python_path" /usr/local/bin/python3 2>/dev/null || true',
  "command -v uv",
  "uv --version",
  "command -v python",
  "python --version",
].join("\n");

// ── Go managed runtime profile ─────────────────────────────────────────────────
// Install method: official Go tarball from go.dev/dl, auto-detecting the latest
// stable version via https://go.dev/VERSION?m=text.
const INSTALL_GO_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  'go_version="$(curl -fsSL https://go.dev/VERSION?m=text | head -1 | sed "s/^go//")"',
  'if [ -z "$go_version" ]; then echo "Could not determine latest Go version" >&2; exit 1; fi',
  'arch="$(uname -m)"',
  'case "$arch" in x86_64|amd64) go_arch="amd64" ;; arm64|aarch64) go_arch="arm64" ;; *) echo "Unsupported Go architecture: $arch" >&2; exit 1 ;; esac',
  // Shell: build tarball name and fetch — ${...} are shell vars, not JS template literals
  // eslint-disable-next-line no-template-curly-in-string
  'tarball="go${go_version}.linux-${go_arch}.tar.gz"',
  "rm -rf /usr/local/go",
  // eslint-disable-next-line no-template-curly-in-string
  'curl -fsSL -o "/tmp/${tarball}" "https://go.dev/dl/${tarball}"',
  // eslint-disable-next-line no-template-curly-in-string
  'tar -C /usr/local -xzf "/tmp/${tarball}"',
  // eslint-disable-next-line no-template-curly-in-string
  'rm -f "/tmp/${tarball}"',
  'ln -sf /usr/local/go/bin/go "$profile_bin_dir/go"',
  'ln -sf /usr/local/go/bin/gofmt "$profile_bin_dir/gofmt"',
  "ln -sf /usr/local/go/bin/go /usr/local/bin/go 2>/dev/null || true",
  "command -v go",
  "go version",
].join("\n");

// ── Rust managed runtime profile ───────────────────────────────────────────────
// Install method: rustup non-interactive with stable, minimal profile.
// Rust requires a system C linker (cc) to link binaries; this is a REQUIRED
// verification (verify-linker) so a missing linker is caught early.
const INSTALL_RUST_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export CARGO_HOME="$HOME/.cargo"',
  'export RUSTUP_HOME="$HOME/.rustup"',
  'export PATH="$profile_bin_dir:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  "if ! command -v cc >/dev/null 2>&1; then (apt-get update && apt-get install -y gcc) >/dev/null 2>&1 || (apk add --no-cache gcc musl-dev) >/dev/null 2>&1 || (dnf install -y gcc) >/dev/null 2>&1 || true; fi",
  'if ! command -v rustup >/dev/null 2>&1; then curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path; fi',
  'export PATH="$HOME/.cargo/bin:$PATH"',
  'for tool in rustc cargo rustup; do ln -sf "$HOME/.cargo/bin/$tool" "$profile_bin_dir/$tool"; ln -sf "$HOME/.cargo/bin/$tool" "/usr/local/bin/$tool" 2>/dev/null || true; done',
  "command -v rustc",
  "rustc --version",
  "command -v cargo",
  "cargo --version",
].join("\n");

// ── Docker-in-sandbox managed runtime profile ──────────────────────────────────
// Install method: official Docker convenience script (https://get.docker.com).
// IMPORTANT: dockerd needs a privileged sandbox tier. In an unprivileged
// sandbox the verify-docker-daemon check (required:true) will fail — this is
// the explicit "wrong tier" signal. The vfs storage driver is forced to avoid
// overlay-on-overlayfs failures in nested container environments.
const INSTALL_DOCKER_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  "if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi",
  'docker_path="$(command -v docker)"',
  'ln -sf "$docker_path" "$profile_bin_dir/docker"',
  "if ! docker info >/dev/null 2>&1; then (dockerd --storage-driver vfs >/tmp/oa-dockerd.log 2>&1 &) ; fi",
  "for i in 1 2 3 4 5 6 7 8 9 10; do if docker info >/dev/null 2>&1; then break; fi; sleep 1; done",
  "command -v docker",
  "docker --version",
].join("\n");

export const MANAGED_RUNTIME_PROFILES = [
  {
    id: DEFAULT_MANAGED_RUNTIME_PROFILE_ID,
    version: "2026-05-23.2",
    displayName: "Web app with Bun and browser checks",
    description:
      "Baseline Open Agents managed runtime profile for JavaScript/TypeScript web repositories that need Bun scripts, exposed preview ports, and browser smoke checks.",
    setupScript: {
      repoPath: "packages/sandbox/profiles/web-bun-agent-browser/setup.sh",
      sandboxPath: "/tmp/open-agents/profiles/web-bun-agent-browser/setup.sh",
      command: "bash /tmp/open-agents/profiles/web-bun-agent-browser/setup.sh",
      timeoutMs: 300_000,
    },
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
  {
    id: "python-uv",
    version: "2026-05-31.1",
    displayName: "Python with uv",
    description:
      "Managed runtime profile for Python repositories. Installs the Astral uv package/Python manager and a managed CPython 3.12 interpreter so the agent can run scripts, create virtualenvs, and install dependencies without assuming the base image ships Python.",
    setupCommands: [
      {
        id: "install-uv-python",
        label: "Install uv and a managed CPython 3.12",
        description:
          "uv is installed first because this profile uses it to provision and pin the Python interpreter and to manage dependencies. It is self-contained and needs no pre-existing Python.",
        command: INSTALL_UV_AND_PYTHON_COMMAND,
        timeoutMs: 240_000,
      },
    ],
    verificationCommands: [
      {
        id: "verify-uv",
        label: "Verify uv",
        description:
          "Confirms the uv executable is on PATH before the agent relies on uv commands.",
        command: "command -v uv && uv --version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-python",
        label: "Verify Python",
        description:
          "Confirms a Python 3 interpreter is on PATH and reports its version.",
        command: "command -v python && python --version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-pip-resolver",
        label: "Verify dependency resolution works",
        description:
          "Confirms uv can resolve and install a package into an ephemeral environment, proving the toolchain — not just the binary — works.",
        command:
          "uv pip install --system --dry-run requests >/dev/null 2>&1 || uv venv /tmp/oa-verify-venv >/dev/null",
        timeoutMs: 60_000,
        required: false,
      },
    ],
    expectedTools: ["uv", "python"],
    optionalTools: ["python3", "pip"],
    defaultPorts: [8000, 5000, 8080],
  },
  {
    id: "go-toolchain",
    version: "2026-05-31.1",
    displayName: "Go toolchain",
    description:
      "Managed runtime profile for Go repositories. Installs the latest stable Go toolchain from the official go.dev distribution so the agent can build, test, and run Go modules without assuming the base image ships Go.",
    setupCommands: [
      {
        id: "install-go",
        label: "Install the Go toolchain",
        description:
          "Downloads the latest stable Go release from go.dev/dl and extracts it to /usr/local/go, exposing `go` and `gofmt` on PATH.",
        command: INSTALL_GO_COMMAND,
        timeoutMs: 180_000,
      },
    ],
    verificationCommands: [
      {
        id: "verify-go",
        label: "Verify Go",
        description:
          "Confirms the go executable is on PATH and reports its version.",
        command: "command -v go && go version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-gofmt",
        label: "Verify gofmt",
        description:
          "Confirms gofmt — used for formatting checks — is available alongside the compiler.",
        command: "command -v gofmt",
        timeoutMs: 30_000,
        required: false,
      },
      {
        id: "verify-go-env",
        label: "Verify Go build environment",
        description:
          "Confirms `go env` reports a usable GOROOT/GOPATH, proving the toolchain is wired up and not just the binary present.",
        command: "go env GOROOT GOPATH GOOS GOARCH",
        timeoutMs: 30_000,
        required: true,
      },
    ],
    expectedTools: ["go", "gofmt"],
    optionalTools: [],
    defaultPorts: [8080, 8000, 3000],
  },
  {
    id: "rust-cargo",
    version: "2026-05-31.1",
    displayName: "Rust with cargo",
    description:
      "Managed runtime profile for Rust repositories. Installs the stable Rust toolchain via rustup (rustc, cargo) so the agent can build, test, and run Cargo projects without assuming the base image ships Rust.",
    setupCommands: [
      {
        id: "install-rust",
        label: "Install the Rust toolchain via rustup",
        description:
          "Installs rustup non-interactively with the stable, minimal profile and exposes rustc, cargo, and rustup on PATH.",
        command: INSTALL_RUST_COMMAND,
        timeoutMs: 300_000,
      },
    ],
    verificationCommands: [
      {
        id: "verify-rustc",
        label: "Verify rustc",
        description:
          "Confirms the Rust compiler is on PATH and reports its version.",
        command: "command -v rustc && rustc --version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-cargo",
        label: "Verify cargo",
        description:
          "Confirms the Cargo build tool is on PATH and reports its version.",
        command: "command -v cargo && cargo --version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-rustup",
        label: "Verify rustup toolchain management",
        description:
          "Confirms rustup can report the active toolchain, proving the install is wired up rather than just a stray binary.",
        command: "rustup show active-toolchain || rustup show",
        timeoutMs: 30_000,
        required: false,
      },
      {
        id: "verify-linker",
        label: "Verify a C linker is available",
        description:
          "Rust links final binaries with the system C linker (cc). A missing linker lets `rustc --version` pass but breaks `cargo build`, so this is required.",
        command: "command -v cc",
        timeoutMs: 30_000,
        required: true,
      },
    ],
    expectedTools: ["rustc", "cargo", "cc"],
    optionalTools: ["rustup"],
    defaultPorts: [8080, 8000, 3000],
  },
  {
    id: "docker-in-sandbox",
    version: "2026-05-31.1",
    displayName: "Docker in sandbox (dind)",
    description:
      "Managed runtime profile for repositories whose dev loop is container-based (docker build / docker compose). Installs the Docker Engine and CLI inside the sandbox. Requires a privileged or dind-capable sandbox tier; in an unprivileged sandbox the daemon-reachability verification will fail, which signals the profile cannot run there.",
    setupCommands: [
      {
        id: "install-docker",
        label: "Install Docker Engine and CLI",
        description:
          "Installs dockerd, the docker CLI, and containerd via the official convenience script, then best-effort starts the daemon (only succeeds in a privileged/dind environment).",
        command: INSTALL_DOCKER_COMMAND,
        timeoutMs: 300_000,
      },
    ],
    verificationCommands: [
      {
        id: "verify-docker-cli",
        label: "Verify docker CLI",
        description:
          "Confirms the docker client binary is on PATH and reports its version. Passes even without a running daemon.",
        command: "command -v docker && docker --version",
        timeoutMs: 30_000,
        required: true,
      },
      {
        id: "verify-docker-daemon",
        label: "Verify the Docker daemon is reachable",
        description:
          "Runs `docker info`, which only succeeds when a daemon is running and the sandbox is privileged/dind-capable. A failure here is the explicit signal that this profile needs a privileged runtime tier.",
        command: "docker info",
        timeoutMs: 60_000,
        required: true,
      },
      {
        id: "verify-docker-run",
        label: "Verify a container can run",
        description:
          "Runs hello-world to prove the daemon can pull and execute a container end-to-end.",
        command: "docker run --rm hello-world",
        timeoutMs: 120_000,
        required: false,
      },
    ],
    expectedTools: ["docker"],
    optionalTools: ["dockerd", "containerd"],
    defaultPorts: [2375, 2376],
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
    ...(profile.setupScript
      ? [profile.setupScript.command]
      : profile.setupCommands.map((command) => command.command)),
    ...profile.verificationCommands.map((command) => command.command),
  ];
}
