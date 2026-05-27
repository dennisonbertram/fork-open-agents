import "server-only";

import path from "node:path";
import { nanoid } from "nanoid";
import type { connectSandbox } from "@open-agents/sandbox";
import type {
  NewSandboxService,
  SandboxService,
  Session,
} from "@/lib/db/schema";
import { emitSessionEvent } from "@/lib/observability/events";
import { DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import {
  detectJavaScriptPackageManager,
  INSTALL_COMMANDS,
  type JavaScriptPackageManager,
} from "@/lib/sandbox/runtime/js-package-manager";
import {
  parseSandboxRecipe,
  SANDBOX_RECIPE_PATHS,
  type SandboxRecipe,
} from "@/lib/sandbox/runtime/sandbox-recipe";
import {
  getSandboxService,
  listSandboxServices,
  updateSandboxService,
  upsertSandboxService,
} from "./service-records";

export type ManagedServiceResponse = {
  id: string;
  kind: SandboxService["kind"];
  status: SandboxService["status"];
  packagePath: string;
  port: number;
  url: string | null;
  logPath: string | null;
  lastHealthStatus: number | null;
  failureMessage: string | null;
};

type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;

type DevFramework =
  | "next"
  | "vite"
  | "astro"
  | "react-scripts"
  | "remix"
  | "nuxt"
  | "custom";

interface PackageManifest {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DevServerCandidate {
  packagePath: string;
  packageDir: string;
  port: number;
  script: string;
  framework: DevFramework;
  score: number;
  packageManagerField?: string;
}

interface LaunchableDevServerTarget {
  packagePath: string;
  packageDir: string;
  packageDirAbs: string;
  port: number;
  healthPath: string;
  recipe?: SandboxRecipe;
  candidate?: DevServerCandidate;
}

const SUPPORTED_PORTS = new Set(DEFAULT_SANDBOX_PORTS);
const DEV_SERVER_FILE_PREFIX = ".open-agents-managed-dev-server";
const PACKAGE_JSON_FIND_COMMAND =
  "find . \\( -path '*/node_modules/*' -o -path '*/.git/*' -o -path '*/.next/*' -o -path '*/dist/*' -o -path '*/build/*' -o -path '*/coverage/*' -o -path '*/.turbo/*' \\) -prune -o -name package.json -print | sort";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getSandboxName(sandbox: ConnectedSandbox): string | null {
  const state = sandbox.getState?.();
  return isRecord(state) && typeof state.sandboxName === "string"
    ? state.sandboxName
    : null;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseManifest(content: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    return {
      packageManager:
        typeof parsed.packageManager === "string"
          ? parsed.packageManager
          : undefined,
      scripts: toStringRecord(parsed.scripts),
      dependencies: toStringRecord(parsed.dependencies),
      devDependencies: toStringRecord(parsed.devDependencies),
    };
  } catch {
    return null;
  }
}

function normalizePackageJsonPath(packageJsonPath: string): string {
  return packageJsonPath.replace(/^\.\//, "");
}

function normalizePackageDir(packageJsonPath: string): string {
  const packageDir = path.posix.dirname(packageJsonPath);
  return packageDir === "." ? "." : packageDir;
}

function formatPackagePath(packageDir: string | null): string {
  if (!packageDir || packageDir === ".") {
    return "root";
  }
  return packageDir;
}

function resolvePackageDirAbs(
  workingDirectory: string,
  packageDir: string,
): string {
  return packageDir === "."
    ? workingDirectory
    : path.posix.join(workingDirectory, packageDir);
}

function extractExplicitPort(script: string): number | null {
  const patterns = [
    /--port(?:=|\s+)(\d{2,5})/i,
    /(?:^|\s)-p(?:=|\s+)(\d{2,5})(?=$|\s)/i,
    /\bPORT=(\d{2,5})\b/i,
  ];

  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const parsed = Number.parseInt(match[1], 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function getDependencyNames(manifest: PackageManifest): Set<string> {
  return new Set<string>([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

function detectFramework(
  manifest: PackageManifest,
  script: string,
): DevFramework {
  const normalizedScript = script.toLowerCase();
  const dependencyNames = getDependencyNames(manifest);

  if (normalizedScript.includes("next dev") || dependencyNames.has("next")) {
    return "next";
  }
  if (normalizedScript.includes("astro") || dependencyNames.has("astro")) {
    return "astro";
  }
  if (
    normalizedScript.includes("vite") ||
    dependencyNames.has("vite") ||
    dependencyNames.has("@sveltejs/kit")
  ) {
    return "vite";
  }
  if (
    normalizedScript.includes("react-scripts") ||
    dependencyNames.has("react-scripts")
  ) {
    return "react-scripts";
  }
  if (
    normalizedScript.includes("remix") ||
    dependencyNames.has("@remix-run/dev")
  ) {
    return "remix";
  }
  if (normalizedScript.includes("nuxt") || dependencyNames.has("nuxt")) {
    return "nuxt";
  }

  return "custom";
}

function getDefaultPortForFramework(framework: DevFramework): number | null {
  switch (framework) {
    case "next":
    case "react-scripts":
    case "remix":
    case "nuxt":
      return 3000;
    case "vite":
      return 5173;
    case "astro":
      return 4321;
    default:
      return null;
  }
}

function toSupportedPort(port: number | null | undefined): number | null {
  if (typeof port !== "number") {
    return null;
  }

  return SUPPORTED_PORTS.has(port) ? port : null;
}

function isWorkspaceOrchestratorScript(script: string): boolean {
  const normalized = script.toLowerCase();
  const patterns = [
    "turbo",
    " nx ",
    "nx ",
    "lerna",
    "concurrently",
    "npm-run-all",
    "wireit",
    "yarn workspaces",
    "pnpm -r",
    "pnpm --recursive",
    "npm -w",
    "npm --workspace",
  ];

  return patterns.some((pattern) => normalized.includes(pattern));
}

function scoreCandidate(candidate: {
  packageDir: string;
  framework: DevFramework;
  port: number;
  script: string;
}): number {
  let score = 0;
  if (candidate.framework !== "custom") {
    score += 100;
  }
  if (SUPPORTED_PORTS.has(candidate.port)) {
    score += 60;
  }
  if (candidate.packageDir.startsWith("apps/")) {
    score += 30;
  }
  if (candidate.packageDir.startsWith("app/")) {
    score += 20;
  }
  if (isWorkspaceOrchestratorScript(candidate.script)) {
    score -= 120;
  }
  if (candidate.packageDir === ".") {
    score -= 10;
  }

  return score - candidate.packageDir.split("/").length;
}

function buildCandidate(
  manifest: PackageManifest,
  packageJsonPath: string,
): DevServerCandidate | null {
  const script = manifest.scripts?.dev?.trim();
  if (!script) {
    return null;
  }

  const framework = detectFramework(manifest, script);
  const explicitPort = toSupportedPort(extractExplicitPort(script));
  const frameworkPort = toSupportedPort(getDefaultPortForFramework(framework));
  const port = explicitPort ?? frameworkPort;
  if (port === null) {
    return null;
  }

  const packageDir = normalizePackageDir(packageJsonPath);
  return {
    packagePath: formatPackagePath(packageDir),
    packageDir,
    port,
    script,
    framework,
    score: scoreCandidate({ packageDir, framework, port, script }),
    packageManagerField: manifest.packageManager,
  };
}

function pickBestCandidate(
  candidates: DevServerCandidate[],
): DevServerCandidate | null {
  const [candidate] = [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.packageDir.localeCompare(right.packageDir);
  });

  return candidate ?? null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function toShellEnvAssignment(key: string, value: string): string {
  return `${key}=${shellQuote(value)}`;
}

function buildEnvPrefix(env: Record<string, string>): string {
  const entries = Object.entries(env);
  if (entries.length === 0) {
    return "";
  }

  return `env ${entries
    .map(([key, value]) => toShellEnvAssignment(key, value))
    .join(" ")} `;
}

function getFrameworkArgs(framework: DevFramework, port: number): string[] {
  switch (framework) {
    case "next":
      return ["--hostname", "0.0.0.0", "--port", String(port)];
    case "vite":
    case "astro":
    case "nuxt":
      return ["--host", "0.0.0.0", "--port", String(port)];
    default:
      return [];
  }
}

function buildRunCommand(
  packageManager: JavaScriptPackageManager,
  framework: DevFramework,
  port: number,
): string {
  const extraArgs = getFrameworkArgs(framework, port).join(" ");

  switch (packageManager) {
    case "bun":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} bun run dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
    case "pnpm":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} pnpm dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
    case "yarn":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} yarn dev${extraArgs ? ` ${extraArgs}` : ""}`;
    case "npm":
      return `env BROWSER=none HOST=0.0.0.0 PORT=${port} npm run dev${extraArgs ? ` -- ${extraArgs}` : ""}`;
  }
}

function getPidPath(packageDirAbs: string, port: number): string {
  return path.posix.join(
    packageDirAbs,
    `${DEV_SERVER_FILE_PREFIX}-${port}.pid`,
  );
}

function getLogPath(packageDirAbs: string, port: number): string {
  return path.posix.join(
    packageDirAbs,
    `${DEV_SERVER_FILE_PREFIX}-${port}.log`,
  );
}

function buildLaunchCommand(params: {
  packageDirAbs: string;
  pidPath: string;
  logPath: string;
  setupCommands: string[];
  runCommand: string;
}): string {
  const commandSteps = [
    `printf '%s' "$$" > ${shellQuote(params.pidPath)}`,
    ...params.setupCommands,
    `exec ${params.runCommand} > ${shellQuote(params.logPath)} 2>&1`,
  ];

  return commandSteps.join(" && ");
}

async function findSandboxRecipe(
  sandbox: ConnectedSandbox,
): Promise<SandboxRecipe | null> {
  for (const recipePath of SANDBOX_RECIPE_PATHS) {
    const absolutePath = path.posix.join(sandbox.workingDirectory, recipePath);
    try {
      await sandbox.access(absolutePath);
    } catch {
      continue;
    }

    try {
      return parseSandboxRecipe(
        await sandbox.readFile(absolutePath, "utf-8"),
        recipePath,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid sandbox recipe ${recipePath}: ${message}`, {
        cause: error,
      });
    }
  }

  return null;
}

async function findDevServerCandidates(
  sandbox: ConnectedSandbox,
): Promise<DevServerCandidate[]> {
  const result = await sandbox.exec(
    PACKAGE_JSON_FIND_COMMAND,
    sandbox.workingDirectory,
    30_000,
  );

  if (!result.success) {
    throw new Error(result.stderr || "Failed to search for package.json files");
  }

  const packageJsonPaths = result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizePackageJsonPath(entry))
    .slice(0, 100);

  const candidates = await Promise.all(
    packageJsonPaths.map(async (packageJsonPath) => {
      try {
        const absolutePath = path.posix.join(
          sandbox.workingDirectory,
          packageJsonPath,
        );
        const manifest = parseManifest(
          await sandbox.readFile(absolutePath, "utf-8"),
        );
        return manifest ? buildCandidate(manifest, packageJsonPath) : null;
      } catch {
        return null;
      }
    }),
  );

  return candidates.filter(
    (candidate): candidate is DevServerCandidate => candidate !== null,
  );
}

async function resolveDevServerTarget(
  sandbox: ConnectedSandbox,
): Promise<LaunchableDevServerTarget | null> {
  const recipe = await findSandboxRecipe(sandbox);
  if (recipe) {
    const supportedPort = toSupportedPort(recipe.dev.port);
    if (supportedPort === null) {
      throw new Error(
        `${recipe.recipePath} dev.port must be one of the exposed sandbox ports: ${DEFAULT_SANDBOX_PORTS.join(
          ", ",
        )}.`,
      );
    }
    const packageDirAbs = resolvePackageDirAbs(
      sandbox.workingDirectory,
      recipe.dev.cwd,
    );

    return {
      packagePath: recipe.recipePath,
      packageDir: recipe.dev.cwd,
      packageDirAbs,
      port: supportedPort,
      healthPath: recipe.dev.healthPath,
      recipe,
    };
  }

  const candidate = pickBestCandidate(await findDevServerCandidates(sandbox));
  if (!candidate) {
    return null;
  }

  return {
    packagePath: candidate.packagePath,
    packageDir: candidate.packageDir,
    packageDirAbs: resolvePackageDirAbs(
      sandbox.workingDirectory,
      candidate.packageDir,
    ),
    port: candidate.port,
    healthPath: "/",
    candidate,
  };
}

async function getRunningPid(params: {
  sandbox: ConnectedSandbox;
  pidPath: string;
  cwd: string;
}): Promise<string | null> {
  try {
    const pid = (await params.sandbox.readFile(params.pidPath, "utf-8")).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) {
      return null;
    }

    const checkResult = await params.sandbox.exec(
      `kill -0 ${pid}`,
      params.cwd,
      5_000,
    );
    return checkResult.success ? pid : null;
  } catch {
    return null;
  }
}

async function checkLocalPortHealth(params: {
  sandbox: ConnectedSandbox;
  cwd: string;
  port: number;
  healthPath: string;
}): Promise<number | null> {
  const result = await params.sandbox.exec(
    `curl -fsS -o /dev/null -w '%{http_code}' ${shellQuote(
      `http://127.0.0.1:${params.port}${params.healthPath}`,
    )}`,
    params.cwd,
    10_000,
  );
  if (!result.success) {
    return null;
  }

  const status = Number.parseInt(result.stdout.trim(), 10);
  return Number.isInteger(status) ? status : null;
}

async function waitForLocalPortHealth(params: {
  sandbox: ConnectedSandbox;
  cwd: string;
  port: number;
  healthPath: string;
  timeoutMs: number;
}): Promise<number | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < params.timeoutMs) {
    const status = await checkLocalPortHealth(params);
    if (status !== null && status < 500) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

function toResponse(service: SandboxService): ManagedServiceResponse {
  return {
    id: service.id,
    kind: service.kind,
    status: service.status,
    packagePath: formatPackagePath(service.packageDir),
    port: service.port,
    url: service.url,
    logPath: service.logPath,
    lastHealthStatus: service.lastHealthStatus,
    failureMessage: service.failureMessage,
  };
}

export function toManagedServiceResponse(
  service: SandboxService,
): ManagedServiceResponse {
  return toResponse(service);
}

export async function listManagedServices(params: {
  sessionId: string;
}): Promise<ManagedServiceResponse[]> {
  const services = await listSandboxServices(params.sessionId);
  return services.map(toResponse);
}

export async function startManagedDevServer(params: {
  session: Pick<Session, "id" | "userId">;
  sandbox: ConnectedSandbox;
}): Promise<ManagedServiceResponse> {
  if (!params.sandbox.execDetached) {
    throw new Error("Sandbox does not support background commands");
  }
  if (!params.sandbox.domain) {
    throw new Error("Sandbox does not expose preview URLs");
  }

  const target = await resolveDevServerTarget(params.sandbox);
  if (!target) {
    await emitSessionEvent({
      sessionId: params.session.id,
      userId: params.session.userId,
      source: "service",
      actorType: "sandbox",
      eventName: "managed_service.dev_server.failed",
      status: "failed",
      summary: "No supported dev script found for managed dev server.",
      sandboxName: getSandboxName(params.sandbox),
    });
    throw new Error("No supported dev script found in package.json files");
  }

  const existingServices = await listSandboxServices(params.session.id);
  const existing = existingServices.find(
    (service) => service.kind === "dev_server" && service.port === target.port,
  );
  if (existing?.logPath) {
    const pidPath = getPidPath(target.packageDirAbs, target.port);
    const pid = await getRunningPid({
      sandbox: params.sandbox,
      pidPath,
      cwd: target.packageDirAbs,
    });
    const healthStatus = pid
      ? await checkLocalPortHealth({
          sandbox: params.sandbox,
          cwd: target.packageDirAbs,
          port: target.port,
          healthPath: target.healthPath,
        })
      : null;
    if (pid && healthStatus !== null) {
      const refreshed = await updateSandboxService(existing.id, {
        status: "running",
        pid,
        lastHealthStatus: healthStatus,
        lastSeenAt: new Date(),
        failureMessage: null,
      });
      await emitSessionEvent({
        sessionId: params.session.id,
        userId: params.session.userId,
        source: "service",
        actorType: "sandbox",
        eventName: "managed_service.dev_server.reused",
        status: "succeeded",
        summary: `Managed dev server is already running on port ${target.port}.`,
        sandboxName: getSandboxName(params.sandbox),
        serviceId: existing.id,
        payload: {
          packagePath: target.packagePath,
          port: target.port,
          url: existing.url,
          healthStatus,
        },
      });
      return toResponse(refreshed ?? existing);
    }
  }

  const url = params.sandbox.domain(target.port);
  const pidPath = getPidPath(target.packageDirAbs, target.port);
  const logPath = getLogPath(target.packageDirAbs, target.port);
  let packageManagerPayload: Record<string, string> = {};
  let framework = target.candidate?.framework ?? "custom";
  let launchCommand: string;
  if (target.recipe) {
    const recipeEnv = {
      BROWSER: "none",
      HOST: "0.0.0.0",
      PORT: String(target.port),
      ...target.recipe.env,
      ...target.recipe.dev.env,
    };
    launchCommand = buildLaunchCommand({
      packageDirAbs: target.packageDirAbs,
      pidPath,
      logPath,
      setupCommands: [
        ...target.recipe.installCommands,
        ...target.recipe.buildCommands,
      ],
      runCommand: `${buildEnvPrefix(recipeEnv)}${target.recipe.dev.command}`,
    });
    packageManagerPayload = { recipePath: target.recipe.recipePath };
  } else if (target.candidate) {
    let packageManagerDetection: Awaited<
      ReturnType<typeof detectJavaScriptPackageManager>
    >;
    try {
      packageManagerDetection = await detectJavaScriptPackageManager({
        sandbox: params.sandbox,
        packageDirAbs: target.packageDirAbs,
        packageManagerField: target.candidate.packageManagerField,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitSessionEvent({
        sessionId: params.session.id,
        userId: params.session.userId,
        source: "service",
        actorType: "sandbox",
        eventName: "managed_service.dev_server.blocked",
        status: "blocked",
        summary: `Managed dev server is blocked: ${message}`,
        sandboxName: getSandboxName(params.sandbox),
        payload: {
          packagePath: target.packagePath,
          packageManagerField: target.candidate.packageManagerField,
          port: target.port,
          url,
        },
      });
      throw error;
    }

    const { packageManager, installRootAbs } = packageManagerDetection;
    framework = target.candidate.framework;
    launchCommand = buildLaunchCommand({
      packageDirAbs: target.packageDirAbs,
      pidPath,
      logPath,
      setupCommands: [
        installRootAbs === target.packageDirAbs
          ? INSTALL_COMMANDS[packageManager]
          : `(cd ${shellQuote(installRootAbs)} && ${INSTALL_COMMANDS[packageManager]})`,
      ],
      runCommand: buildRunCommand(packageManager, framework, target.port),
    });
    packageManagerPayload = {
      packageManager,
      packageManagerSource: packageManagerDetection.source,
      packageManagerReason: packageManagerDetection.reason,
    };
  } else {
    throw new Error("No launchable dev server target was resolved.");
  }
  const now = new Date();
  const initialService: NewSandboxService = {
    id: existing?.id ?? nanoid(),
    sessionId: params.session.id,
    userId: params.session.userId,
    kind: "dev_server",
    status: "starting",
    packageDir: target.packageDir,
    command: launchCommand,
    port: target.port,
    url,
    pid: null,
    commandId: null,
    logPath,
    healthPath: target.healthPath,
    lastHealthStatus: null,
    lastStartedAt: now,
    lastSeenAt: now,
    lastStoppedAt: null,
    relaunchOnResume: true,
    failureMessage: null,
  };
  const service = await upsertSandboxService(initialService);
  await emitSessionEvent({
    sessionId: params.session.id,
    userId: params.session.userId,
    source: "service",
    actorType: "sandbox",
    eventName: "managed_service.dev_server.starting",
    status: "started",
    summary: `Starting managed dev server for ${target.packagePath} on port ${target.port}.`,
    sandboxName: getSandboxName(params.sandbox),
    serviceId: service.id,
    payload: {
      packagePath: target.packagePath,
      ...packageManagerPayload,
      framework,
      port: target.port,
      url,
      logPath,
      healthPath: target.healthPath,
    },
  });

  try {
    const { commandId } = await params.sandbox.execDetached(
      launchCommand,
      target.packageDirAbs,
    );
    const healthStatus = await waitForLocalPortHealth({
      sandbox: params.sandbox,
      cwd: target.packageDirAbs,
      port: target.port,
      healthPath: target.healthPath,
      timeoutMs: 120_000,
    });
    if (healthStatus === null) {
      throw new Error(
        `Dev server did not respond on port ${target.port} before the startup timeout. Open the logs for details.`,
      );
    }
    const pid = await getRunningPid({
      sandbox: params.sandbox,
      pidPath,
      cwd: target.packageDirAbs,
    });
    const running = await updateSandboxService(service.id, {
      status: "running",
      pid,
      commandId,
      lastHealthStatus: healthStatus,
      lastSeenAt: new Date(),
      failureMessage: null,
    });
    await emitSessionEvent({
      sessionId: params.session.id,
      userId: params.session.userId,
      source: "service",
      actorType: "sandbox",
      eventName: "managed_service.dev_server.running",
      status: "succeeded",
      summary: `Managed dev server is running at ${url}.`,
      sandboxName: getSandboxName(params.sandbox),
      serviceId: service.id,
      payload: {
        packagePath: target.packagePath,
        port: target.port,
        url,
        commandId,
        healthStatus,
        pid,
      },
    });
    return toResponse(running ?? service);
  } catch (error) {
    const failed = await updateSandboxService(service.id, {
      status: "failed",
      failureMessage: error instanceof Error ? error.message : String(error),
    });
    await emitSessionEvent({
      sessionId: params.session.id,
      userId: params.session.userId,
      source: "service",
      actorType: "sandbox",
      eventName: "managed_service.dev_server.failed",
      status: "failed",
      summary: `Managed dev server failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      sandboxName: getSandboxName(params.sandbox),
      serviceId: service.id,
      payload: {
        packagePath: target.packagePath,
        port: target.port,
        url,
      },
    });
    return toResponse(failed ?? service);
  }
}

export async function stopManagedService(params: {
  sessionId: string;
  serviceId: string;
  sandbox: ConnectedSandbox;
}): Promise<ManagedServiceResponse | null> {
  const service = await getSandboxService({
    sessionId: params.sessionId,
    serviceId: params.serviceId,
  });
  if (!service) {
    return null;
  }

  if (service.pid && /^[1-9][0-9]*$/.test(service.pid)) {
    await params.sandbox
      .exec(
        `kill ${service.pid} 2>/dev/null || true`,
        params.sandbox.workingDirectory,
        5_000,
      )
      .catch(() => undefined);
  }

  const stopped = await updateSandboxService(service.id, {
    status: "stopped",
    lastStoppedAt: new Date(),
  });
  await emitSessionEvent({
    sessionId: params.sessionId,
    userId: service.userId,
    source: "service",
    actorType: "sandbox",
    eventName: "managed_service.stopped",
    status: "succeeded",
    summary: `Managed ${service.kind} stopped.`,
    sandboxName: getSandboxName(params.sandbox),
    serviceId: service.id,
    payload: {
      kind: service.kind,
      port: service.port,
      url: service.url,
    },
  });
  return stopped ? toResponse(stopped) : null;
}
