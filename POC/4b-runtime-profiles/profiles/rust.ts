// POC 4b — Rust managed runtime profile.
//
// Install method: rustup (the official Rust toolchain installer). The
// non-interactive flags `-y --default-toolchain stable --profile minimal` give
// a reproducible, prompt-free install suitable for sandbox shells. rustup places
// binaries under $HOME/.cargo/bin which we expose on PATH.
//
// Conventions mirror the default web-bun-agent-browser profile.

import type { ManagedRuntimeProfile } from "./types";

const INSTALL_RUST_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export CARGO_HOME="$HOME/.cargo"',
  'export RUSTUP_HOME="$HOME/.rustup"',
  'export PATH="$profile_bin_dir:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  // Rust needs a system C linker (cc) to link the final binary; the minimal
  // rustup profile does NOT bundle one. Ensure a C toolchain exists before
  // building anything, mirroring how a real sandbox base must supply it.
  'if ! command -v cc >/dev/null 2>&1; then (apt-get update && apt-get install -y gcc) >/dev/null 2>&1 || (apk add --no-cache gcc musl-dev) >/dev/null 2>&1 || (dnf install -y gcc) >/dev/null 2>&1 || true; fi',
  'if ! command -v rustup >/dev/null 2>&1; then curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path; fi',
  'export PATH="$HOME/.cargo/bin:$PATH"',
  'for tool in rustc cargo rustup; do ln -sf "$HOME/.cargo/bin/$tool" "$profile_bin_dir/$tool"; ln -sf "$HOME/.cargo/bin/$tool" "/usr/local/bin/$tool" 2>/dev/null || true; done',
  "command -v rustc",
  "rustc --version",
  "command -v cargo",
  "cargo --version",
].join("\n");

export const rustProfile: ManagedRuntimeProfile = {
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
};
