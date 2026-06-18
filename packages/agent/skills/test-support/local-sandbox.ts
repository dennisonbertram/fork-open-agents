import { exec as execCallback } from "node:child_process";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";
import type { ExecResult, Sandbox, SandboxStats } from "@open-agents/sandbox";

const execAsync = promisify(execCallback);

// Cap captured output so a runaway script can't exhaust memory. On overflow
// Node rejects with an ERR_CHILD_PROCESS_STDIO_MAXBUFFER error, which we report
// as `truncated: true` in the catch path below.
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Filesystem-backed {@link Sandbox} for the code-bearing-skill proof of concept.
 *
 * It implements the same interface as the production Vercel sandbox, but maps
 * every operation onto the real local filesystem and a real child process. That
 * lets the POC drive the *actual* `discoverSkills` + `skillTool` code paths and
 * *actually execute* a bundled skill script — the only thing that differs from
 * the cloud is where the files and process live.
 */
export class LocalSandbox implements Sandbox {
  readonly type = "cloud" as const;
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;

  constructor(workingDirectory: string, env?: Record<string, string>) {
    this.workingDirectory = workingDirectory;
    this.env = env;
  }

  readFile(path: string, _encoding: "utf-8"): Promise<string> {
    return fs.readFile(path, "utf-8");
  }

  readFileBuffer(path: string): Promise<Buffer> {
    return fs.readFile(path);
  }

  async writeFile(
    path: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    await fs.writeFile(path, content, "utf-8");
  }

  stat(path: string): Promise<SandboxStats> {
    return fs.stat(path);
  }

  async access(path: string): Promise<void> {
    await fs.access(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, options);
  }

  readdir(path: string, _options: { withFileTypes: true }): Promise<Dirent[]> {
    return fs.readdir(path, { withFileTypes: true });
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, ...this.env },
        signal: options?.signal,
      });
      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        truncated: false,
      };
    } catch (err) {
      const e = err as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const truncated = e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      return {
        success: false,
        exitCode: typeof e.code === "number" ? e.code : null,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? "",
        truncated,
      };
    }
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}
