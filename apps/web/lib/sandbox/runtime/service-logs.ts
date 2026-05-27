import "server-only";

import type { connectSandbox } from "@open-agents/sandbox";
import type { SandboxService } from "@/lib/db/schema";

type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;

const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 1000;
const MAX_LOG_BYTES = 64 * 1024;

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|token|secret|password)=([^\s&]+)/gi,
  /\b[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function redactSandboxLog(content: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    content,
  );
}

export async function readServiceLogs(params: {
  sandbox: ConnectedSandbox;
  service: SandboxService;
  lines?: number;
}): Promise<{ content: string; truncated: boolean; lines: number }> {
  const logPath = params.service.logPath;
  if (!logPath) {
    return { content: "", truncated: false, lines: 0 };
  }

  return readSandboxLogs({
    sandbox: params.sandbox,
    logPath,
    lines: params.lines,
  });
}

export async function readSandboxLogs(params: {
  sandbox: ConnectedSandbox;
  logPath: string;
  lines?: number;
}): Promise<{ content: string; truncated: boolean; lines: number }> {
  const lines = Math.min(
    Math.max(Math.floor(params.lines ?? DEFAULT_LOG_LINES), 1),
    MAX_LOG_LINES,
  );
  const result = await params.sandbox.exec(
    `tail -n ${lines} ${shellQuote(params.logPath)}`,
    params.sandbox.workingDirectory,
    10_000,
  );
  if (!result.success) {
    return { content: "", truncated: false, lines };
  }

  const redacted = redactSandboxLog(result.stdout);
  if (redacted.length <= MAX_LOG_BYTES) {
    return { content: redacted, truncated: result.truncated, lines };
  }

  return {
    content: redacted.slice(redacted.length - MAX_LOG_BYTES),
    truncated: true,
    lines,
  };
}
