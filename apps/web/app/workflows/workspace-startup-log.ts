import type { WebAgentWorkspaceStatusData } from "@/app/types";

const MAX_LOG_LINES = 120;
const MAX_LOG_LINE_LENGTH = 420;

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|token|secret|password)=([^\s&]+)/gi,
  /\b[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  // Harness-aligned token shapes (matches redactHarnessValue TOKEN_SHAPED_PATTERN)
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
];

function redactWorkspaceLogLine(value: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    value,
  );
}

function normalizeLogLine(value: string): string {
  const redacted = redactWorkspaceLogLine(value.replace(/\r/g, ""));
  if (redacted.length <= MAX_LOG_LINE_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_LOG_LINE_LENGTH - 1)}…`;
}

export function appendWorkspaceStartupLogLines(
  currentLines: string[],
  nextLines: string[],
): string[] {
  const normalizedLines = nextLines
    .flatMap((line) => line.split("\n"))
    .map((line) => normalizeLogLine(line.trimEnd()))
    .filter((line) => line.length > 0);

  return [...currentLines, ...normalizedLines].slice(-MAX_LOG_LINES);
}

export function buildWorkspaceStatusData(params: {
  message: string;
  title?: string;
  logLines: string[];
}): WebAgentWorkspaceStatusData {
  return {
    status: "setting-up",
    message: params.message,
    ...(params.title ? { title: params.title } : {}),
    ...(params.logLines.length > 0
      ? {
          logLines: params.logLines,
          logUpdatedAt: new Date().toISOString(),
        }
      : {}),
  };
}

export function getCommandOutputLogLines(params: {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): string[] {
  const output = [params.stdout, params.stderr]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join("\n");

  return [
    `exit ${params.exitCode ?? "unknown"}: ${params.command}`,
    ...output.split("\n").slice(-24),
  ];
}

type SendWorkspaceStatus = (data: WebAgentWorkspaceStatusData) => Promise<void>;

export class WorkspaceStartupReporter {
  private logLines: string[] = [];

  constructor(
    private readonly title: string,
    private readonly sendStatus: SendWorkspaceStatus,
  ) {}

  async send(message: string, nextLogLines: string[] = []): Promise<void> {
    this.logLines = appendWorkspaceStartupLogLines(this.logLines, nextLogLines);
    await this.sendStatus(
      buildWorkspaceStatusData({
        message,
        title: this.title,
        logLines: this.logLines,
      }),
    );
  }

  async appendCommandResult(params: {
    message: string;
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }): Promise<void> {
    await this.send(
      params.message,
      getCommandOutputLogLines({
        command: params.command,
        exitCode: params.exitCode,
        stdout: params.stdout,
        stderr: params.stderr,
      }),
    );
  }
}
