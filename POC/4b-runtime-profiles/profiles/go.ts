// POC 4b — Go managed runtime profile.
//
// Install method: official Go tarball from go.dev/dl, version auto-detected via
// https://go.dev/VERSION?m=text so the profile stays current without pinning a
// stale version. Per the official docs we wipe any existing /usr/local/go tree
// before extracting (untarring over an existing tree produces broken installs).
//
// Conventions mirror the default web-bun-agent-browser profile.

import type { ManagedRuntimeProfile } from "./types";

const INSTALL_GO_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  // Detect latest stable version (e.g. "go1.24.3" -> "1.24.3").
  'go_version="$(curl -fsSL https://go.dev/VERSION?m=text | head -1 | sed "s/^go//")"',
  'if [ -z "$go_version" ]; then echo "Could not determine latest Go version" >&2; exit 1; fi',
  // Map uname arch to Go arch label.
  'arch="$(uname -m)"',
  'case "$arch" in x86_64|amd64) go_arch="amd64" ;; arm64|aarch64) go_arch="arm64" ;; *) echo "Unsupported Go architecture: $arch" >&2; exit 1 ;; esac',
  'tarball="go${go_version}.linux-${go_arch}.tar.gz"',
  // Install fresh: remove old tree first per official guidance.
  "rm -rf /usr/local/go",
  'curl -fsSL -o "/tmp/${tarball}" "https://go.dev/dl/${tarball}"',
  'tar -C /usr/local -xzf "/tmp/${tarball}"',
  'rm -f "/tmp/${tarball}"',
  'ln -sf /usr/local/go/bin/go "$profile_bin_dir/go"',
  'ln -sf /usr/local/go/bin/gofmt "$profile_bin_dir/gofmt"',
  "ln -sf /usr/local/go/bin/go /usr/local/bin/go 2>/dev/null || true",
  "command -v go",
  "go version",
].join("\n");

export const goProfile: ManagedRuntimeProfile = {
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
};
