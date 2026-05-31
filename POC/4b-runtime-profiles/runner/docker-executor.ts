// POC 4b — Docker-backed executor.
//
// Boots a single long-lived container from a clean Linux base image and runs
// every profile command inside it via `docker exec`, persisting environment
// across commands (the same way a real sandbox session does — installs from the
// setup step are visible to the verify step). PATH is augmented with the
// profile bin dir + common toolchain dirs so freshly-installed tools resolve.

import { spawn } from "node:child_process";
import type { CommandResult, Executor } from "./runner";

export type DockerSession = {
  containerId: string;
  exec: Executor;
  cleanup: () => Promise<void>;
};

function run(
  cmd: string,
  args: string[],
  input?: string,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });
    child.on("error", (err) => {
      resolve({
        success: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${err.message}`,
      });
    });
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

const SESSION_PATH =
  '$HOME/.open-agents/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin';

export async function startDockerSession(params: {
  image: string;
  privileged?: boolean;
}): Promise<DockerSession> {
  // Pre-pull so the boot time is not counted in profile setup measurement.
  await run("docker", ["pull", params.image]);

  const args = ["run", "-d", "--rm"];
  if (params.privileged) {
    args.push("--privileged");
  }
  args.push(params.image, "sleep", "3600");
  const started = await run("docker", args);
  if (!started.success) {
    throw new Error(`Failed to start container: ${started.stderr}`);
  }
  const containerId = started.stdout.trim();

  // Ensure curl + ca-certificates are present so installers can fetch over
  // HTTPS — this surfaces the "base image deps" blind spot. On a base that
  // already ships curl (e.g. buildpack-deps:*-curl, or a real sandbox image)
  // this no-ops instantly. On a bare image it installs them via the system
  // package manager. We do NOT fail the run if this best-effort step errors;
  // the profile's own setup will surface a missing-curl failure clearly.
  await run("docker", [
    "exec",
    containerId,
    "sh",
    "-c",
    "command -v curl >/dev/null 2>&1 || (apt-get update -o Acquire::Retries=2 && apt-get install -y curl ca-certificates xz-utils) >/dev/null 2>&1 || (apk add --no-cache curl ca-certificates) >/dev/null 2>&1 || true",
  ]);

  const exec: Executor = (command: string) =>
    run("docker", [
      "exec",
      containerId,
      "bash",
      "-lc",
      `export PATH="${SESSION_PATH}:$PATH"; ${command}`,
    ]);

  const cleanup = async () => {
    await run("docker", ["rm", "-f", containerId]);
  };

  return { containerId, exec, cleanup };
}
