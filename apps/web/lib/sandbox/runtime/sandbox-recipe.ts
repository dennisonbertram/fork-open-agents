import path from "node:path";

/**
 * Env vars that the launcher always owns. Recipes must not declare these —
 * if they do, parseSandboxRecipe rejects the recipe with a clear error so
 * misconfigurations fail loudly instead of silently rebinding the server to
 * an unreachable address or port.
 */
const LAUNCHER_RESERVED_ENV_KEYS = new Set(["PORT", "HOST", "BROWSER"]);

export const SANDBOX_RECIPE_PATHS = [
  ".open-agents/sandbox.json",
  ".agent/sandbox.json",
] as const;

export type SandboxRecipeCommandList = string[];

export type SandboxRecipeDevCommand = {
  command: string;
  port: number;
  healthPath: string;
  cwd: string;
  env: Record<string, string>;
};

export type SandboxRecipe = {
  recipePath: string;
  installCommands: SandboxRecipeCommandList;
  buildCommands: SandboxRecipeCommandList;
  dev: SandboxRecipeDevCommand;
  env: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toCommandList(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    const command = value.trim();
    return command ? [command] : [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (typeof entry !== "string") {
          throw new Error(`${field}[${index}] must be a string command.`);
        }
        return entry.trim();
      })
      .filter((entry) => entry.length > 0);
  }

  throw new Error(`${field} must be a command string or array of commands.`);
}

function toStringRecord(value: unknown, field: string): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error(`${field} must be an object of string values.`);
  }

  const entries = Object.entries(value).map(([key, entry]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`${field}.${key} is not a valid environment variable.`);
    }
    if (LAUNCHER_RESERVED_ENV_KEYS.has(key)) {
      throw new Error(
        `${field}.${key} is a reserved launcher env key (${[...LAUNCHER_RESERVED_ENV_KEYS].join(", ")}). Remove it from the recipe — the launcher always sets these.`,
      );
    }
    if (typeof entry !== "string") {
      throw new Error(`${field}.${key} must be a string.`);
    }
    return [key, entry] as const;
  });

  return Object.fromEntries(entries);
}

function toPositivePort(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer port.`);
  }
  return value;
}

function normalizeHealthPath(value: unknown): string {
  if (value === undefined) {
    return "/";
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("dev.health must be a non-empty path string.");
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeCwd(value: unknown): string {
  if (value === undefined) {
    return ".";
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("dev.cwd must be a non-empty relative path.");
  }
  const normalized = path.posix.normalize(value.trim());
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("dev.cwd must stay inside the repository.");
  }
  return normalized;
}

export function parseSandboxRecipe(
  content: string,
  recipePath: string,
): SandboxRecipe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`${recipePath} is not valid JSON.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`${recipePath} must contain a JSON object.`);
  }

  // Version gating: only version 1 is supported. Unknown versions fail loudly
  // so authors discover version mismatches immediately rather than getting
  // silently ignored fields.
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw new Error(
      `${recipePath} declares version ${String(parsed.version)}, but only version 1 is supported.`,
    );
  }

  const rootEnv = toStringRecord(parsed.env, "env");
  const installCommands = toCommandList(parsed.install, "install");
  const buildCommands = toCommandList(parsed.build, "build");

  if (parsed.dev === undefined) {
    throw new Error(`${recipePath} must define dev.`);
  }

  if (typeof parsed.dev === "string") {
    throw new Error(
      `${recipePath} dev must be an object with command and port.`,
    );
  }

  if (!isRecord(parsed.dev)) {
    throw new Error(`${recipePath} dev must be an object.`);
  }

  if (typeof parsed.dev.command !== "string") {
    throw new Error("dev.command must be a string.");
  }

  const command = parsed.dev.command.trim();
  if (!command) {
    throw new Error("dev.command must be a non-empty string.");
  }

  return {
    recipePath,
    installCommands,
    buildCommands,
    env: rootEnv,
    dev: {
      command,
      port: toPositivePort(parsed.dev.port, "dev.port"),
      healthPath: normalizeHealthPath(parsed.dev.health),
      cwd: normalizeCwd(parsed.dev.cwd),
      env: toStringRecord(parsed.dev.env, "dev.env"),
    },
  };
}
