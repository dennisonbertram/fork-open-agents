import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import type { connectSandbox } from "@open-agents/sandbox";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  type NewSandboxBrowserRun,
  type SandboxBrowserRun,
  sandboxBrowserRuns,
} from "@/lib/db/schema";
import { redactSandboxLog } from "./service-logs";

type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;
const execFileAsync = promisify(execFile);

export type BrowserRunResponse = {
  id: string;
  status: SandboxBrowserRun["status"];
  targetUrl: string;
  summary: string | null;
  consoleErrors: unknown;
  networkErrors: unknown;
  steps: unknown;
  artifactRefs: unknown;
  redactionStatus: SandboxBrowserRun["redactionStatus"];
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function toResponse(run: SandboxBrowserRun): BrowserRunResponse {
  return {
    id: run.id,
    status: run.status,
    targetUrl: run.targetUrl,
    summary: run.summary,
    consoleErrors: run.consoleErrors,
    networkErrors: run.networkErrors,
    steps: run.steps,
    artifactRefs: run.artifactRefs,
    redactionStatus: run.redactionStatus,
  };
}

async function insertBrowserRun(
  run: NewSandboxBrowserRun,
): Promise<SandboxBrowserRun> {
  const [record] = await db.insert(sandboxBrowserRuns).values(run).returning();
  if (!record) {
    throw new Error("Failed to create browser run");
  }
  return record;
}

async function updateBrowserRun(
  runId: string,
  patch: Partial<Omit<NewSandboxBrowserRun, "id" | "sessionId" | "targetUrl">>,
): Promise<SandboxBrowserRun> {
  const [record] = await db
    .update(sandboxBrowserRuns)
    .set(patch)
    .where(eq(sandboxBrowserRuns.id, runId))
    .returning();
  if (!record) {
    throw new Error("Failed to update browser run");
  }
  return record;
}

function formatCommand(args: string[]): string {
  return `agent-browser ${args.map(shellQuote).join(" ")}`;
}

function getDocumentStatusFailures(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("(Document)"))
    .filter((line) => {
      const match = line.match(/\s(\d{3})$/);
      if (!match?.[1]) {
        return false;
      }
      const status = Number.parseInt(match[1], 10);
      return status >= 400;
    });
}

async function runAgentBrowserOnAppRuntime(args: string[]): Promise<{
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  try {
    const result = await execFileAsync("agent-browser", args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return {
      success: true,
      exitCode: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    const stdout =
      typeof error === "object" && error !== null && "stdout" in error
        ? String((error as { stdout?: unknown }).stdout ?? "")
        : "";
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : error instanceof Error
          ? error.message
          : String(error);
    const exitCode =
      typeof error === "object" && error !== null && "code" in error
        ? Number((error as { code?: unknown }).code)
        : null;
    return {
      success: false,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      stdout,
      stderr,
    };
  }
}

async function runAgentBrowserCommand(params: {
  sandbox: ConnectedSandbox;
  args: string[];
}): Promise<{
  success: boolean;
  exitCode: number | null;
  output: string;
}> {
  const command = formatCommand(params.args);
  const sandboxResult = await params.sandbox.exec(
    command,
    params.sandbox.workingDirectory,
    60_000,
  );
  if (sandboxResult.success) {
    return {
      success: true,
      exitCode: sandboxResult.exitCode,
      output: redactSandboxLog(
        sandboxResult.stdout || sandboxResult.stderr,
      ).slice(0, 8000),
    };
  }

  const sandboxOutput = redactSandboxLog(
    sandboxResult.stdout || sandboxResult.stderr,
  ).slice(0, 8000);
  const shouldTryAppRuntime =
    sandboxOutput.length === 0 ||
    sandboxOutput.includes("agent-browser: command not found") ||
    sandboxOutput.includes("No such file or directory");
  if (!shouldTryAppRuntime) {
    return {
      success: false,
      exitCode: sandboxResult.exitCode,
      output: sandboxOutput,
    };
  }

  const appResult = await runAgentBrowserOnAppRuntime(params.args);
  const fallbackOutput = redactSandboxLog(
    `${sandboxOutput ? `${sandboxOutput}\n\n` : ""}Sandbox agent-browser unavailable; used app runtime fallback.\n${
      appResult.stdout || appResult.stderr
    }`,
  ).slice(0, 8000);

  return {
    success: appResult.success,
    exitCode: appResult.exitCode,
    output: fallbackOutput,
  };
}

export async function listManagedBrowserRuns(params: {
  sessionId: string;
  limit?: number;
}): Promise<BrowserRunResponse[]> {
  const records = await db.query.sandboxBrowserRuns.findMany({
    where: eq(sandboxBrowserRuns.sessionId, params.sessionId),
    orderBy: [desc(sandboxBrowserRuns.createdAt)],
    limit: params.limit ?? 20,
  });
  return records.map(toResponse);
}

export async function runManagedBrowserCheck(params: {
  sessionId: string;
  chatId?: string | null;
  serviceId?: string | null;
  targetUrl: string;
  sandbox: ConnectedSandbox;
}): Promise<BrowserRunResponse> {
  const runId = nanoid();
  const screenshotPath = `/tmp/open-agents-browser-${runId}.png`;
  const startedAt = new Date();
  await insertBrowserRun({
    id: runId,
    sessionId: params.sessionId,
    chatId: params.chatId ?? null,
    serviceId: params.serviceId ?? null,
    status: "running",
    targetUrl: params.targetUrl,
    summary: null,
    consoleErrors: [],
    networkErrors: [],
    steps: [],
    artifactRefs: [],
    redactionStatus: "pending",
    startedAt,
    finishedAt: null,
  });

  const sessionName = `open-agents-${params.sessionId}-${runId}`;
  const commands: string[][] = [
    ["--session", sessionName, "open", params.targetUrl],
    ["--session", sessionName, "wait", "--load", "networkidle"],
    ["--session", sessionName, "snapshot", "-i"],
    ["--session", sessionName, "network", "requests"],
    ["--session", sessionName, "screenshot", screenshotPath],
  ];
  const steps: Array<{
    command: string;
    exitCode: number | null;
    success: boolean;
    output: string;
  }> = [];

  for (const args of commands) {
    const command = formatCommand(args);
    const result = await runAgentBrowserCommand({
      sandbox: params.sandbox,
      args,
    });
    steps.push({
      command,
      exitCode: result.exitCode,
      success: result.success,
      output: result.output,
    });
    if (!result.success) {
      const failed = await updateBrowserRun(runId, {
        status: "failed",
        summary: `Browser check failed while running: ${command}`,
        steps,
        artifactRefs: [],
        redactionStatus: "passed",
        finishedAt: new Date(),
      });
      return toResponse(failed);
    }

    const documentFailures = getDocumentStatusFailures(result.output);
    if (documentFailures.length > 0) {
      const failed = await updateBrowserRun(runId, {
        status: "failed",
        summary: `Browser check loaded an unhealthy document response: ${documentFailures[0]}`,
        steps,
        artifactRefs: [],
        redactionStatus: "passed",
        finishedAt: new Date(),
      });
      return toResponse(failed);
    }
  }

  const passed = await updateBrowserRun(runId, {
    status: "passed",
    summary: "Browser check loaded the preview and captured a snapshot.",
    steps,
    artifactRefs: [
      {
        kind: "screenshot",
        path: screenshotPath,
      },
    ],
    redactionStatus: "passed",
    finishedAt: new Date(),
  });
  return toResponse(passed);
}
