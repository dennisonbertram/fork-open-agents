function normalizeHost(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(
      value.startsWith("http://") || value.startsWith("https://")
        ? value
        : `https://${value}`,
    ).host;
  } catch {
    return null;
  }
}

function getWildcardHostPattern(host: string): string | null {
  const hostname = host.split(":")[0];
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("[")
  ) {
    return null;
  }

  return `*.${host}`;
}

export function getAuthBaseURLFallback(): string | undefined {
  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL;
  }

  // On preview deployments, prefer the stable per-branch alias
  // (`VERCEL_BRANCH_URL`, e.g. `project-git-branch-team.vercel.app`) over the
  // per-deployment URL (`VERCEL_URL`), whose host changes on every redeploy.
  // The branch alias is the origin users actually browse, so building the
  // OAuth redirect_uri from it keeps the sign-in cookie/redirect round-trip
  // same-origin instead of stranding state on a domain the user never visits.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL) {
    return `https://${process.env.VERCEL_BRANCH_URL}`;
  }

  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;
}

export function getAllowedAuthHosts(): string[] {
  const hosts = new Set<string>([
    "localhost:3000",
    "localhost:*",
    "127.0.0.1:3000",
    "127.0.0.1:*",
    "[::1]:3000",
    "[::1]:*",
  ]);

  for (const value of [
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    const host = normalizeHost(value);
    if (!host) {
      continue;
    }

    hosts.add(host);

    const wildcardPattern = getWildcardHostPattern(host);
    if (wildcardPattern) {
      hosts.add(wildcardPattern);
    }
  }

  return [...hosts];
}
