const REPOSITORY_KEY_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

export type RepositoryAllowlistPolicy =
  | { state: "missing"; entries: Set<string> }
  | {
      state: "invalid";
      entries: Set<string>;
      invalidEntryCount: number;
    }
  | { state: "wildcard"; entries: Set<string> }
  | { state: "list"; entries: Set<string> };

export type RepositoryAllowlistAccess =
  | { allowed: true }
  | { allowed: false; reason: "missing" | "invalid" | "not_listed" };

function normalizeRepositoryKey(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

export function parseRepositoryAllowlist(
  rawValue: string | undefined,
): RepositoryAllowlistPolicy {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return { state: "missing", entries: new Set() };
  }
  if (trimmed === "*") {
    return { state: "wildcard", entries: new Set() };
  }

  const candidates = trimmed
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  const invalidEntryCount = candidates.filter(
    (entry) => !REPOSITORY_KEY_PATTERN.test(entry),
  ).length;
  if (invalidEntryCount > 0 || candidates.length === 0) {
    return {
      state: "invalid",
      entries: new Set(),
      invalidEntryCount: Math.max(invalidEntryCount, 1),
    };
  }

  return { state: "list", entries: new Set(candidates) };
}

export function checkRepositoryAllowlist(
  policy: RepositoryAllowlistPolicy,
  owner: string,
  repo: string,
): RepositoryAllowlistAccess {
  if (policy.state === "wildcard") {
    return { allowed: true };
  }
  if (policy.state === "missing") {
    return { allowed: false, reason: "missing" };
  }
  if (policy.state === "invalid") {
    return { allowed: false, reason: "invalid" };
  }
  if (policy.entries.has(normalizeRepositoryKey(owner, repo))) {
    return { allowed: true };
  }
  return { allowed: false, reason: "not_listed" };
}
