/**
 * Refuses to apply migrations to the production database from a build that is
 * not the production deploy (#1167).
 *
 * The incident: Preview and Production shared one `POSTGRES_URL`, and
 * `apps/web/package.json` runs `db:migrate:apply` as part of every build. A PR
 * preview build therefore applied an unmerged, unreviewed migration to the
 * production database 29 seconds after the preview deployment started. The same
 * hazard exists locally, where `.env.local` also pointed at production (#1162).
 *
 * Pointing Preview at its own Neon branch is the real fix; this is the backstop
 * that makes the mistake loud instead of silent if the configuration ever drifts
 * back.
 *
 * DELIBERATELY FAILS OPEN. Migrations run during every build, so a guard that
 * refuses when it is merely unconfigured would block every deploy — worse than
 * the bug it prevents. It only refuses when it can positively identify the
 * target as production AND the build is not the production deploy.
 */

export type MigrationTargetDecision =
  | { allowed: true; reason?: undefined }
  | { allowed: false; reason: string };

/**
 * Reduces a database host to an identity that survives the pooled/direct split.
 *
 * Neon exposes one database at two hostnames — `<endpoint>-pooler.<region>…` and
 * `<endpoint>.<region>…`. They are the same data, so comparing raw hostnames
 * would wave the direct variant straight through, which is the entire hazard
 * again. Returns undefined for anything unparseable so callers fail open.
 */
function databaseIdentity(hostOrUrl: string): string | undefined {
  let hostname = hostOrUrl.trim();

  if (hostname.includes("://")) {
    try {
      hostname = new URL(hostname).hostname;
    } catch {
      return undefined;
    }
  }

  if (!hostname || hostname.includes(" ")) {
    return undefined;
  }

  const [endpoint, ...rest] = hostname.toLowerCase().split(".");
  if (!endpoint) {
    return undefined;
  }

  // A bare hostname with no dots is not a real database host (e.g. "not-a-url").
  if (rest.length === 0) {
    return undefined;
  }

  return [endpoint.replace(/-pooler$/, ""), ...rest].join(".");
}

export function decideMigrationTarget(input: {
  databaseUrl: string;
  productionHost: string | undefined;
  vercelEnv: string | undefined;
  allowOverride: boolean;
}): MigrationTargetDecision {
  const { allowOverride, databaseUrl, productionHost, vercelEnv } = input;

  // Unconfigured: nothing to compare against. Fail open.
  if (!productionHost) {
    return { allowed: true };
  }

  const target = databaseIdentity(databaseUrl);
  const production = databaseIdentity(productionHost);
  if (!(target && production) || target !== production) {
    return { allowed: true };
  }

  // The production deploy is the one build that is supposed to migrate
  // production.
  if (vercelEnv === "production") {
    return { allowed: true };
  }

  if (allowOverride) {
    return { allowed: true };
  }

  const where = vercelEnv ? `a "${vercelEnv}" build` : "a local build";

  // Only ever the host identity — never the URL, which carries credentials.
  return {
    allowed: false,
    reason:
      `Refusing to apply migrations to the production database (${production}) from ${where}. ` +
      "Migrations run during every build, so this would apply unreviewed schema changes to live data. " +
      "Point this environment at its own database, or set ALLOW_PRODUCTION_MIGRATION=1 to override deliberately.",
  };
}
