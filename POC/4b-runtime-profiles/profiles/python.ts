// POC 4b — Python managed runtime profile.
//
// Install method: Astral `uv` standalone installer (curl https://astral.sh/uv/install.sh).
// uv is the current recommended way to install a self-contained Python without
// needing a pre-existing interpreter, and it manages the interpreter itself via
// `uv python install`. This avoids assuming the sandbox base image ships python.
//
// Conventions mirror the default web-bun-agent-browser profile exactly:
//   - a `profile_bin_dir` ($HOME/.open-agents/bin) on PATH up front
//   - idempotent (command -v guards), `set -e`
//   - symlink the resolved binary into profile_bin_dir + /usr/local/bin
//   - final `command -v <tool>` + version print so the transcript proves success

import type { ManagedRuntimeProfile } from "./types";

// UV_UNMANAGED_INSTALL pins where the binary lands and stops the installer from
// rewriting shell profiles (important for non-interactive sandbox shells).
const INSTALL_UV_AND_PYTHON_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  // Install uv (self-contained, no Python prerequisite).
  'if ! command -v uv >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh; fi',
  'export PATH="$HOME/.local/bin:$PATH"',
  'uv_path="$(command -v uv)"',
  "mkdir -p /usr/local/bin 2>/dev/null || true",
  'ln -sf "$uv_path" /usr/local/bin/uv 2>/dev/null || true',
  'ln -sf "$uv_path" "$profile_bin_dir/uv"',
  // Install a managed CPython and expose `python` / `python3` on PATH.
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

export const pythonProfile: ManagedRuntimeProfile = {
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
        'uv pip install --system --dry-run requests >/dev/null 2>&1 || uv venv /tmp/oa-verify-venv >/dev/null',
      timeoutMs: 60_000,
      required: false,
    },
  ],
  expectedTools: ["uv", "python"],
  optionalTools: ["python3", "pip"],
  defaultPorts: [8000, 5000, 8080],
};
