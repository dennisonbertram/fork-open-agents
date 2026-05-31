// POC 4b — Docker-in-sandbox managed runtime profile.
//
// Install method: official Docker convenience script (https://get.docker.com),
// which installs the Docker Engine + CLI (dockerd, docker, containerd). This is
// the docker-in-docker (dind) pattern: a Docker daemon running INSIDE the
// sandbox so the agent can build images and run containers for repos whose dev
// loop is `docker compose up` / `docker build`.
//
// IMPORTANT — privilege requirement: dockerd needs either a privileged
// container (--privileged) or rootless mode with cgroup/user-namespace support.
// Most managed sandbox base images run UNprivileged, so the daemon may not be
// startable. This profile therefore treats "daemon reachable" as a REQUIRED
// verification that will legitimately FAIL in an unprivileged sandbox — the
// failure is the signal that this profile needs a privileged runtime tier.
//
// Conventions mirror the default web-bun-agent-browser profile.

import type { ManagedRuntimeProfile } from "./types";

const INSTALL_DOCKER_COMMAND = [
  "set -e",
  'profile_bin_dir="$HOME/.open-agents/bin"',
  'export PATH="$profile_bin_dir:/usr/local/bin:/usr/bin:/bin:$PATH"',
  'mkdir -p "$profile_bin_dir"',
  // Install Docker Engine + CLI via the official convenience script (idempotent:
  // it no-ops if docker is already present).
  'if ! command -v docker >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; fi',
  'docker_path="$(command -v docker)"',
  'ln -sf "$docker_path" "$profile_bin_dir/docker"',
  // Try to start the daemon if it is not already running. This is best-effort:
  // it only succeeds in a privileged / dind-capable environment. We force the
  // vfs storage driver: nested Docker on an overlayfs-backed container cannot
  // stack overlay-on-overlay, so the default overlay2 driver fails to mount
  // container layers (`docker run` errors with "invalid argument"). vfs is slow
  // but works without a dedicated block device.
  "if ! docker info >/dev/null 2>&1; then (dockerd --storage-driver vfs >/tmp/oa-dockerd.log 2>&1 &) ; fi",
  // Give the daemon a moment to come up (bounded).
  "for i in 1 2 3 4 5 6 7 8 9 10; do if docker info >/dev/null 2>&1; then break; fi; sleep 1; done",
  "command -v docker",
  "docker --version",
].join("\n");

export const dockerProfile: ManagedRuntimeProfile = {
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
};
