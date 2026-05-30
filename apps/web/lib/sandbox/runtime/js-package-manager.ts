import path from "node:path";

export type JavaScriptPackageManager = "bun" | "pnpm" | "yarn" | "npm";

export const INSTALL_COMMANDS: Record<JavaScriptPackageManager, string> = {
  bun: "bun install",
  pnpm: "pnpm install",
  yarn: "yarn install",
  npm: "npm install",
};

export const PACKAGE_MANAGER_LOCKFILES: Array<{
  manager: JavaScriptPackageManager;
  files: string[];
}> = [
  { manager: "bun", files: ["bun.lockb", "bun.lock"] },
  { manager: "pnpm", files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"] },
  { manager: "yarn", files: ["yarn.lock"] },
  { manager: "npm", files: ["package-lock.json"] },
];

export type PackageManagerDetectionSource =
  | "lockfile"
  | "package_manager_field"
  | "available_command";

export type PackageManagerDetection = {
  packageManager: JavaScriptPackageManager;
  installRootAbs: string;
  source: PackageManagerDetectionSource;
  reason: string;
};

type SandboxPackageManagerProbe = {
  workingDirectory: string;
  access(targetPath: string): Promise<void>;
  readFile(targetPath: string, encoding: "utf-8"): Promise<string>;
  exec(
    command: string,
    cwd?: string,
    timeoutMs?: number,
  ): Promise<{ success: boolean }>;
};

const PACKAGE_MANAGER_FALLBACK_ORDER: JavaScriptPackageManager[] = [
  "bun",
  "pnpm",
  "yarn",
  "npm",
];

export const NO_PACKAGE_MANAGER_ERROR_PREFIX =
  "No supported JavaScript package manager is available in this sandbox";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getAncestorDirectories(
  startDir: string,
  stopDir: string,
): string[] {
  const directories: string[] = [];
  let currentDir = startDir;

  while (true) {
    directories.push(currentDir);

    if (currentDir === stopDir) {
      break;
    }

    const nextDir = path.posix.dirname(currentDir);
    if (nextDir === currentDir) {
      break;
    }

    currentDir = nextDir;
  }

  return directories;
}

export function parsePackageManagerName(
  packageManagerField: string | undefined,
): JavaScriptPackageManager | null {
  if (!packageManagerField) {
    return null;
  }

  const [packageManagerName] = packageManagerField.split("@");
  switch (packageManagerName) {
    case "bun":
    case "pnpm":
    case "yarn":
    case "npm":
      return packageManagerName;
    default:
      return null;
  }
}

export function getPackageManagerLockfiles(
  packageManager: JavaScriptPackageManager,
): string[] {
  return (
    PACKAGE_MANAGER_LOCKFILES.find((entry) => entry.manager === packageManager)
      ?.files ?? []
  );
}

async function pathExists(
  sandbox: Pick<SandboxPackageManagerProbe, "access">,
  targetPath: string,
): Promise<boolean> {
  try {
    await sandbox.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isCommandAvailable(params: {
  sandbox: SandboxPackageManagerProbe;
  cwd: string;
  command: JavaScriptPackageManager;
}): Promise<boolean> {
  try {
    const result = await params.sandbox.exec(
      `command -v ${shellQuote(params.command)} >/dev/null 2>&1`,
      params.cwd,
      5_000,
    );
    return result.success;
  } catch {
    return false;
  }
}

function parsePackageJsonPackageManager(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) && typeof parsed.packageManager === "string"
      ? parsed.packageManager
      : undefined;
  } catch {
    return undefined;
  }
}

async function requireAvailablePackageManager(params: {
  sandbox: SandboxPackageManagerProbe;
  cwd: string;
  packageManager: JavaScriptPackageManager;
  reason: string;
}): Promise<void> {
  if (
    await isCommandAvailable({
      sandbox: params.sandbox,
      cwd: params.cwd,
      command: params.packageManager,
    })
  ) {
    return;
  }

  throw new Error(
    `Detected ${params.packageManager} from ${params.reason}, but ${params.packageManager} is not available in this sandbox. Configure the managed runtime profile to install ${params.packageManager}, or update the package metadata.`,
  );
}

async function chooseAvailablePackageManager(params: {
  sandbox: SandboxPackageManagerProbe;
  cwd: string;
}): Promise<JavaScriptPackageManager> {
  for (const packageManager of PACKAGE_MANAGER_FALLBACK_ORDER) {
    if (
      await isCommandAvailable({
        sandbox: params.sandbox,
        cwd: params.cwd,
        command: packageManager,
      })
    ) {
      return packageManager;
    }
  }

  throw new Error(
    `${NO_PACKAGE_MANAGER_ERROR_PREFIX} (checked bun, pnpm, yarn, npm). Configure a managed runtime profile setup command before starting a package.json dev server.`,
  );
}

export async function detectJavaScriptPackageManager(params: {
  sandbox: SandboxPackageManagerProbe;
  packageDirAbs: string;
  packageManagerField: string | undefined;
}): Promise<PackageManagerDetection> {
  const ancestorDirectories = getAncestorDirectories(
    params.packageDirAbs,
    params.sandbox.workingDirectory,
  );

  for (const directory of ancestorDirectories) {
    for (const entry of PACKAGE_MANAGER_LOCKFILES) {
      for (const lockfile of entry.files) {
        const lockfilePath = path.posix.join(directory, lockfile);
        if (await pathExists(params.sandbox, lockfilePath)) {
          const reason = `${lockfilePath}`;
          await requireAvailablePackageManager({
            sandbox: params.sandbox,
            cwd: directory,
            packageManager: entry.manager,
            reason,
          });
          return {
            packageManager: entry.manager,
            installRootAbs: directory,
            source: "lockfile",
            reason,
          };
        }
      }
    }
  }

  for (const directory of ancestorDirectories) {
    const packageJsonPath = path.posix.join(directory, "package.json");
    if (!(await pathExists(params.sandbox, packageJsonPath))) {
      continue;
    }

    const packageManager = parsePackageManagerName(
      parsePackageJsonPackageManager(
        await params.sandbox.readFile(packageJsonPath, "utf-8"),
      ),
    );
    if (!packageManager) {
      continue;
    }

    const reason = `${packageJsonPath} packageManager`;
    await requireAvailablePackageManager({
      sandbox: params.sandbox,
      cwd: directory,
      packageManager,
      reason,
    });
    return {
      packageManager,
      installRootAbs: directory,
      source: "package_manager_field",
      reason,
    };
  }

  const packageManager = parsePackageManagerName(params.packageManagerField);
  if (packageManager) {
    const reason = "candidate packageManager field";
    await requireAvailablePackageManager({
      sandbox: params.sandbox,
      cwd: params.packageDirAbs,
      packageManager,
      reason,
    });
    return {
      packageManager,
      installRootAbs: params.packageDirAbs,
      source: "package_manager_field",
      reason,
    };
  }

  const availablePackageManager = await chooseAvailablePackageManager({
    sandbox: params.sandbox,
    cwd: params.packageDirAbs,
  });
  return {
    packageManager: availablePackageManager,
    installRootAbs: params.packageDirAbs,
    source: "available_command",
    reason: `${availablePackageManager} is available in sandbox PATH`,
  };
}
