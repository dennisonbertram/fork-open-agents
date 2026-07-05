import * as path from "path";
import type { ExecResult, Sandbox } from "@open-agents/sandbox";
import {
  skillFrontmatterSchema,
  frontmatterToOptions,
  type SkillMetadata,
} from "./types";

/**
 * Built-in commands that skills cannot shadow.
 * Skills with these names will be unreachable via slash command.
 */
const BUILTIN_COMMANDS = ["model", "resume", "new"];

/** Timeout for the batched skill-discovery exec call. */
const DISCOVERY_EXEC_TIMEOUT_MS = 30_000;

/** Number of bytes read from each skill file by the fast-path exec script. */
const DISCOVERY_HEAD_BYTES = 2048;

/** Marker printed before each file's content by the batched discovery script. */
const DISCOVERY_MARKER_PREFIX = "<<<OA_SKILL_FILE:";
const DISCOVERY_MARKER_SUFFIX = ">>>";

/**
 * Single-quote a value for safe inclusion in a `bash -c` command string.
 * Mirrors the shellQuote helper in packages/sandbox/vercel/workspace-setup-command.ts.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * A single skill file discovered by the batched fast-path exec command,
 * before frontmatter has been parsed.
 */
export interface DiscoveredSkillFile {
  /** Directory containing the skill file (parent of SKILL.md/skill.md). */
  skillDir: string;
  /** "SKILL.md" or "skill.md". */
  filename: string;
  /** First DISCOVERY_HEAD_BYTES bytes of the file's content. */
  content: string;
}

/**
 * Build a single bash script that scans every given directory for immediate
 * subdirectories, and for each one prints a marker line followed by the
 * first DISCOVERY_HEAD_BYTES bytes of its SKILL.md (preferred) or skill.md.
 * Running this via a single sandbox.exec() call replaces what would
 * otherwise be a stat + readdir per directory and up to 2 access calls plus
 * a readFile per subdirectory.
 */
export function buildSkillDiscoveryCommand(directories: string[]): string {
  const dirList = directories.map(shellQuote).join(" ");
  const lines = [
    `for dir in ${dirList}; do`,
    '  [ -d "$dir" ] || continue',
    '  for sub in "$dir"/*/; do',
    '    [ -d "$sub" ] || continue',
    // $sub keeps its trailing slash from the glob, so plain concatenation
    // yields "dir/SKILL.md" without any ${} parameter expansion (which the
    // no-template-curly-in-string lint rule rejects inside plain strings).
    '    if [ -f "$sub"SKILL.md ]; then',
    '      f="$sub"SKILL.md',
    '    elif [ -f "$sub"skill.md ]; then',
    '      f="$sub"skill.md',
    "    else",
    "      continue",
    "    fi",
    `    printf '\\n${DISCOVERY_MARKER_PREFIX}%s${DISCOVERY_MARKER_SUFFIX}\\n' "$f"`,
    `    head -c ${DISCOVERY_HEAD_BYTES} "$f"`,
    "  done",
    "done",
  ];
  return lines.join("\n");
}

/**
 * Parse the combined stdout produced by buildSkillDiscoveryCommand() into
 * one entry per discovered skill file, in the order they were printed.
 */
export function parseSkillDiscoveryOutput(
  stdout: string,
): DiscoveredSkillFile[] {
  const markerRegex = new RegExp(
    `${DISCOVERY_MARKER_PREFIX}(.+?)${DISCOVERY_MARKER_SUFFIX}\\n`,
    "g",
  );
  const matches = [...stdout.matchAll(markerRegex)];

  const files: DiscoveredSkillFile[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match?.[1] || match.index === undefined) continue;

    const filePath = match[1];
    const contentStart = match.index + match[0].length;
    const nextMatch = matches[i + 1];
    const contentEnd =
      nextMatch?.index !== undefined ? nextMatch.index : stdout.length;

    files.push({
      skillDir: path.dirname(filePath),
      filename: path.basename(filePath),
      content: stdout.slice(contentStart, contentEnd),
    });
  }

  return files;
}

/**
 * Parse frontmatter from a skill file's content into SkillMetadata, or
 * null if the frontmatter is missing/invalid. Shared by both the fast and
 * sequential discovery paths so results are identical either way.
 */
function toSkillMetadata(
  skillDir: string,
  filename: string,
  content: string,
): SkillMetadata | null {
  const result = parseSkillFrontmatter(content);
  if (!result.success) return null;

  const frontmatter = result.data;
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    path: skillDir,
    filename,
    options: frontmatterToOptions(frontmatter),
  };
}

/**
 * Apply the built-in-command shadow check and first-wins case-insensitive
 * dedupe, pushing the skill into `skills` if it's eligible. Shared by both
 * the fast and sequential discovery paths so results are identical either
 * way.
 */
function addSkillIfEligible(
  metadata: SkillMetadata,
  skills: SkillMetadata[],
  seenNames: Set<string>,
): void {
  const normalizedName = metadata.name.toLowerCase();

  if (BUILTIN_COMMANDS.includes(normalizedName)) {
    console.warn(
      `Warning: Skill "${metadata.name}" in ${metadata.path} shadows built-in command /${metadata.name}. Skipping.`,
    );
    return;
  }

  if (seenNames.has(normalizedName)) {
    return;
  }
  seenNames.add(normalizedName);
  skills.push(metadata);
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns null if frontmatter is missing or invalid.
 *
 * Expected format:
 * ---
 * name: skill-name
 * description: Short description
 * ---
 */
export function parseSkillFrontmatter(
  content: string,
): ReturnType<typeof skillFrontmatterSchema.safeParse> {
  // Match YAML frontmatter between --- markers
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    return {
      success: false,
      error: new Error("No frontmatter found") as never,
    };
  }

  const yaml = match[1];
  const parsed: Record<string, unknown> = {};

  // Simple YAML parser for frontmatter
  // Handles: key: value, key: "quoted value", multiline not supported
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    // Only split on the first colon to preserve colons in values (e.g., URLs)
    let value: string | boolean = trimmed.slice(colonIndex + 1).trim();

    // Handle quoted strings (including escaped quotes inside)
    if (value.startsWith('"') && value.endsWith('"')) {
      const inner = value.slice(1, -1);
      // Unescape escaped quotes: \" -> "
      value = inner.replace(/\\"/g, '"');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      const inner = value.slice(1, -1);
      // Unescape escaped quotes: \' -> '
      value = inner.replace(/\\'/g, "'");
    } else {
      // Parse booleans only for unquoted values
      if (value === "true") {
        value = true;
      } else if (value === "false") {
        value = false;
      }
    }

    parsed[key] = value;
  }

  return skillFrontmatterSchema.safeParse(parsed);
}

/**
 * Find the SKILL.md file in a directory.
 * Prefers uppercase SKILL.md over lowercase skill.md.
 * Returns null if neither exists.
 */
async function findSkillFile(
  sandbox: Sandbox,
  skillDir: string,
): Promise<string | null> {
  const uppercasePath = path.join(skillDir, "SKILL.md");
  const lowercasePath = path.join(skillDir, "skill.md");

  try {
    await sandbox.access(uppercasePath);
    return uppercasePath;
  } catch {
    // Uppercase not found, try lowercase
  }

  try {
    await sandbox.access(lowercasePath);
    return lowercasePath;
  } catch {
    // Neither found
    return null;
  }
}

/**
 * Discover skills from the given directories using sandbox interface.
 * Scans each directory for subdirectories containing SKILL.md files.
 *
 * This is the slow path: one sandbox.stat + sandbox.readdir per directory,
 * plus up to 2 sandbox.access calls and 1 sandbox.readFile per subdirectory.
 * Each is a network round-trip on a real sandbox. Prefer discoverSkills(),
 * which tries a single-round-trip fast path first and only falls back to
 * this function when that fast path is unavailable.
 *
 * @param sandbox - Sandbox interface for file operations
 * @param directories - List of directories to scan for skills
 * @returns Array of skill metadata (name, description, path, options)
 */
export async function discoverSkillsSequential(
  sandbox: Sandbox,
  directories: string[],
): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];
  const seenNames = new Set<string>();

  for (const dir of directories) {
    // Check if directory exists
    try {
      const stat = await sandbox.stat(dir);
      if (!stat.isDirectory()) continue;
    } catch {
      // Directory doesn't exist, skip
      continue;
    }

    // List subdirectories
    let entries;
    try {
      entries = await sandbox.readdir(dir, { withFileTypes: true });
    } catch {
      // Can't read directory, skip
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check for SKILL.md or skill.md
      const skillDir = path.join(dir, entry.name);
      const skillFile = await findSkillFile(sandbox, skillDir);
      if (!skillFile) continue;

      // Read and parse frontmatter only
      let content: string;
      try {
        content = await sandbox.readFile(skillFile, "utf-8");
      } catch {
        // Can't read file, skip
        continue;
      }

      const metadata = toSkillMetadata(
        skillDir,
        path.basename(skillFile),
        content,
      );
      if (!metadata) {
        // Invalid frontmatter, skip
        continue;
      }

      addSkillIfEligible(metadata, skills, seenNames);
    }
  }

  return skills;
}

/**
 * Run the batched fast-path discovery script and parse its output into
 * SkillMetadata, applying the same shadow/dedupe rules as the sequential
 * path. Returns null if the fast path could not be used (exec threw,
 * reported failure, or its output was truncated), in which case the caller
 * should fall back to discoverSkillsSequential().
 */
async function discoverSkillsFast(
  sandbox: Sandbox,
  directories: string[],
): Promise<SkillMetadata[] | null> {
  let result: ExecResult;
  try {
    const command = buildSkillDiscoveryCommand(directories);
    result = await sandbox.exec(
      command,
      sandbox.workingDirectory,
      DISCOVERY_EXEC_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn(
      `Skill discovery fast path threw an error; falling back to per-file discovery: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  if (!result.success || result.truncated) {
    console.warn(
      `Skill discovery fast path failed (success=${result.success}, truncated=${result.truncated}); falling back to per-file discovery.`,
    );
    return null;
  }

  const skills: SkillMetadata[] = [];
  const seenNames = new Set<string>();

  for (const file of parseSkillDiscoveryOutput(result.stdout)) {
    const metadata = toSkillMetadata(
      file.skillDir,
      file.filename,
      file.content,
    );
    if (!metadata) {
      // A skill file whose captured head reached the byte cap may carry
      // frontmatter that extends past DISCOVERY_HEAD_BYTES — the fast path
      // never sees its closing `---`, so parsing fails even though the skill
      // is valid. Rather than silently drop it, fall back to the sequential
      // path, which reads the full file. Genuinely invalid files under the cap
      // are correctly skipped (they parse-fail without hitting the cap).
      if (Buffer.byteLength(file.content, "utf8") >= DISCOVERY_HEAD_BYTES) {
        console.warn(
          `Skill discovery fast path saw ${file.skillDir}/${file.filename} at the ${DISCOVERY_HEAD_BYTES}-byte head cap without parseable frontmatter; falling back to per-file discovery.`,
        );
        return null;
      }
      continue;
    }
    addSkillIfEligible(metadata, skills, seenNames);
  }

  return skills;
}

/**
 * Discover skills from the given directories using the sandbox interface.
 * Scans each directory for subdirectories containing SKILL.md files.
 *
 * Tries a fast path first: a single sandbox.exec() call that scans every
 * directory and reads the head of every skill file in one network
 * round-trip. Falls back to discoverSkillsSequential() (one round-trip per
 * directory/subdirectory operation) if the fast path throws, reports
 * failure, or is truncated, so a batching failure never silently produces
 * an empty skill list.
 *
 * @param sandbox - Sandbox interface for file operations
 * @param directories - List of directories to scan for skills
 * @returns Array of skill metadata (name, description, path, options)
 */
export async function discoverSkills(
  sandbox: Sandbox,
  directories: string[],
): Promise<SkillMetadata[]> {
  if (directories.length === 0) return [];

  const fastResult = await discoverSkillsFast(sandbox, directories);
  if (fastResult !== null) {
    return fastResult;
  }

  return discoverSkillsSequential(sandbox, directories);
}
