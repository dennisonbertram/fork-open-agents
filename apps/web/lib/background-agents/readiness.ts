import "server-only";

export type BackgroundAgentReadinessStatus = "ready" | "missing" | "disabled";

export interface BackgroundAgentReadinessCheck {
  id:
    | "feature_flag"
    | "auth_database"
    | "vercel_oauth"
    | "github_oauth"
    | "github_app"
    | "sandbox_runtime"
    | "inference_gateway"
    | "repo_allowlist"
    | "cron_secret"
    | "webhook_secret";
  label: string;
  status: BackgroundAgentReadinessStatus;
  detail: string;
  missing: string[];
}

export interface BackgroundAgentReadiness {
  enabled: boolean;
  ready: boolean;
  missing: string[];
  checks: BackgroundAgentReadinessCheck[];
}

function hasValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function checkAll(
  id: BackgroundAgentReadinessCheck["id"],
  label: string,
  names: string[],
  detail: string,
): BackgroundAgentReadinessCheck {
  const missing = names.filter((name) => !hasValue(name));

  return {
    id,
    label,
    status: missing.length === 0 ? "ready" : "missing",
    detail,
    missing,
  };
}

function checkAny(
  id: BackgroundAgentReadinessCheck["id"],
  label: string,
  names: string[],
  detail: string,
): BackgroundAgentReadinessCheck {
  const configured = names.some((name) => hasValue(name));

  return {
    id,
    label,
    status: configured ? "ready" : "missing",
    detail,
    missing: configured ? [] : names,
  };
}

export function getBackgroundAgentReadiness(): BackgroundAgentReadiness {
  const enabled = process.env.BACKGROUND_AGENTS_ENABLED === "true";
  const allowedRepos = process.env.BACKGROUND_AGENTS_ALLOWED_REPOS?.trim();
  const checks: BackgroundAgentReadinessCheck[] = [
    {
      id: "feature_flag",
      label: "Feature flag",
      status: enabled ? "ready" : "disabled",
      detail: "BACKGROUND_AGENTS_ENABLED gates trigger dispatch.",
      missing: enabled ? [] : ["BACKGROUND_AGENTS_ENABLED"],
    },
    checkAll(
      "auth_database",
      "Auth and database",
      ["POSTGRES_URL", "BETTER_AUTH_SECRET"],
      "Required for Settings, sessions, and durable run persistence.",
    ),
    checkAll(
      "vercel_oauth",
      "Vercel sign-in",
      ["NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "VERCEL_APP_CLIENT_SECRET"],
      "Required for authenticated operator access.",
    ),
    checkAll(
      "github_oauth",
      "GitHub OAuth",
      ["NEXT_PUBLIC_GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
      "Required for repo connection and PR creation.",
    ),
    checkAll(
      "github_app",
      "GitHub App",
      [
        "GITHUB_APP_ID",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_WEBHOOK_SECRET",
        "NEXT_PUBLIC_GITHUB_APP_SLUG",
      ],
      "Required for webhook trust and repo-scoped installation access.",
    ),
    checkAny(
      "sandbox_runtime",
      "Sandbox runtime",
      ["VERCEL", "VERCEL_ENV", "VERCEL_TOKEN"],
      "Required so background runs can create run-scoped Vercel Sandboxes.",
    ),
    checkAny(
      "inference_gateway",
      "Inference gateway",
      ["VERCEL", "VERCEL_ENV", "AI_GATEWAY_API_KEY"],
      "Required so unattended background agents can call the default model.",
    ),
    {
      id: "repo_allowlist",
      label: "Repo allowlist",
      status: "ready",
      detail: allowedRepos
        ? "Dispatch is limited to BACKGROUND_AGENTS_ALLOWED_REPOS."
        : "Unset allows all repos; set BACKGROUND_AGENTS_ALLOWED_REPOS for controlled proof.",
      missing: [],
    },
    checkAny(
      "cron_secret",
      "Cron dispatch secret",
      ["BACKGROUND_AGENTS_CRON_SECRET", "CRON_SECRET"],
      "Required for scheduled trigger dispatch.",
    ),
    checkAll(
      "webhook_secret",
      "Generic webhook secret",
      ["BACKGROUND_AGENTS_WEBHOOK_SECRET"],
      "Required for signed webhook.error triggers.",
    ),
  ];
  const missing = Array.from(
    new Set(checks.flatMap((check) => check.missing)),
  ).sort();

  return {
    enabled,
    ready: checks.every((check) => check.status === "ready"),
    missing,
    checks,
  };
}
